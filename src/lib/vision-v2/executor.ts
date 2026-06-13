// Vision Mouse V2 — deterministic action executor.
//
// Performs an ActionPlan the most stable way available, enforcing the fallback
// order in code (not just in the prompt):
//   DOM locator → UIA invoke/value → hotkey → safe-point mouse → (crop/refine) → raw click
//
// The executor reports HOW it acted (used_method) and a coordinate-conversion
// log, so escalation and observability are precise. before/after screenshots and
// verification are attached by the orchestrator (run-v2.ts).

import { invoke } from '@tauri-apps/api/core';
import type { ActionPlan, ScreenState, ScreenElement, ActionResult, UsedMethod, CliObservation } from './types';
import { validateScreenPoint } from './coordinates';
import { bestTextMatch } from './text-match';
import { suggestShortcut } from './shortcuts';
import { isLargeContainer } from './precision';

export interface ExecutorContext {
  /** Freeze/release the user's physical input around a real injection. */
  guardSetBlock?: (on: boolean) => Promise<void>;
  /** Active-window title/app for shortcut suggestions (defaults from state). */
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findById(state: ScreenState, id?: string): ScreenElement | undefined {
  if (!id) return undefined;
  return state.elements.find((e) => e.id === id);
}

function isDom(e: ScreenElement): boolean {
  return e.source === 'dom' && typeof e.metadata?.domTarget === 'string';
}
function isUia(e: ScreenElement): boolean {
  return e.source === 'uia' && typeof e.metadata?.uiaId === 'string';
}

interface ExecOutcome {
  success: boolean;
  used_method: UsedMethod;
  error?: string;
  log: string[];
  element?: ScreenElement;
  /** True when we exhausted structured tiers and need crop/refine before raw. */
  needsRefine?: boolean;
}

/** Perform a click on a resolved element, walking the fallback tiers. */
async function clickElement(
  el: ScreenElement, state: ScreenState, ctx: ExecutorContext, log: string[],
): Promise<ExecOutcome> {
  // Tier 1 — DOM locator (no pixels).
  if (isDom(el)) {
    try {
      const out = await invoke<string>('browser_click', { target: String(el.metadata!.domTarget) });
      log.push(`dom click "${el.metadata!.domTarget}" → ${out}`);
      return { success: true, used_method: 'dom', log, element: el };
    } catch (e) {
      log.push(`dom click failed: ${String(e)}`);
      // No mouse fallback for DOM (page coords ≠ screen) → report failure.
      return { success: false, used_method: 'dom', error: String(e), log, element: el };
    }
  }

  // Tier 2 — UIA programmatic invoke.
  if (isUia(el)) {
    const token = String(el.metadata!.snapshot_token ?? '');
    const uiaId = String(el.metadata!.uiaId);
    const largeContainer = el.metadata!.is_large_container === true || isLargeContainer(el);
    const wantsRefine = el.metadata!.requires_refine === true;
    // Native invoke is reliable for a SPECIFIC element, but invoking a large
    // container (or one flagged requires_refine) can fire the wrong child — refine
    // first instead of trusting it (Precision V3 #4).
    if (el.metadata!.can_invoke && !largeContainer && !wantsRefine) {
      try {
        const out = await invoke<string>('desktop_invoke_target', { id: uiaId, snapshotToken: token });
        log.push(`uia invoke ${uiaId} → ${out}`);
        return { success: true, used_method: 'uia_invoke', log, element: el };
      } catch (e) {
        log.push(`uia invoke failed: ${String(e)}`);
      }
    } else if (largeContainer || wantsRefine) {
      // No blind safe-inset/invoke on coarse targets — escalate to crop/refine.
      log.push(`uia ${uiaId} is large/low-precision (strategy=${el.metadata!.click_strategy ?? '?'}) → needs refine`);
      return { success: false, used_method: 'uia_invoke', error: 'requires_refine', log, element: el, needsRefine: true };
    }
    // Tier 2b — UIA precise click via clickable point.
    try {
      const out = await invoke<string>('desktop_click_target', { id: uiaId, snapshotToken: token });
      log.push(`uia click_target ${uiaId} → ${out}`);
      return { success: true, used_method: 'uia_invoke', log, element: el };
    } catch (e) {
      const err = String(e);
      log.push(`uia click_target failed: ${err}`);
      if (err.includes('target_not_precise_enough')) {
        return { success: false, used_method: 'uia_invoke', error: err, log, element: el, needsRefine: true };
      }
      // fall through to safe-point mouse
    }
  }

  // Tier 4 — safe-point mouse (only with a real on-screen point).
  const point = el.clickable_point;
  const invalid = validateScreenPoint(point, {
    screen_width: state.screen_width, screen_height: state.screen_height, dpi_scale: state.dpi_scale,
  });
  if (invalid) {
    log.push(`safe-point invalid (${invalid}) → needs refine`);
    return { success: false, used_method: 'none', error: `no clickable point: ${invalid}`, log, element: el, needsRefine: true };
  }
  try {
    if (ctx.guardSetBlock) await ctx.guardSetBlock(true);
    await invoke('mouse_click', { x: point[0], y: point[1], button: 'left' });
    log.push(`safe-point mouse click @${point[0]},${point[1]} (${el.source})`);
    return { success: true, used_method: 'mouse_safe_point', log, element: el };
  } catch (e) {
    return { success: false, used_method: 'mouse_safe_point', error: String(e), log, element: el };
  } finally {
    if (ctx.guardSetBlock) await ctx.guardSetBlock(false);
  }
}

async function typeInto(
  el: ScreenElement | undefined, plan: ActionPlan, state: ScreenState, ctx: ExecutorContext, log: string[],
): Promise<ExecOutcome> {
  const text = plan.text ?? '';
  // DOM input → fill via CDP.
  if (el && isDom(el)) {
    try {
      await invoke<string>('browser_type', { target: String(el.metadata!.domTarget), text });
      log.push(`dom type into "${el.metadata!.domTarget}"`);
      if (plan.press_enter) await invoke('browser_key', { key: 'enter' });
      return { success: true, used_method: 'dom', log, element: el };
    } catch (e) {
      return { success: false, used_method: 'dom', error: String(e), log, element: el };
    }
  }
  // UIA edit → ValuePattern/focus+type via desktop_type_target.
  if (el && isUia(el)) {
    try {
      const out = await invoke<string>('desktop_type_target', {
        id: String(el.metadata!.uiaId), text, snapshotToken: String(el.metadata!.snapshot_token ?? ''),
      });
      log.push(`uia type into ${el.metadata!.uiaId} → ${out}`);
      if (plan.press_enter) await invoke('key_press', { key: 'enter' });
      return { success: true, used_method: 'uia_value', log, element: el };
    } catch (e) {
      log.push(`uia type failed: ${String(e)} → keyboard fallback`);
    }
  }
  // Keyboard fallback: (optionally focus el), clear, type, enter.
  try {
    if (ctx.guardSetBlock) await ctx.guardSetBlock(true);
    if (el) {
      const r = await clickElement(el, state, ctx, log).catch(() => null);
      if (r && !r.success) log.push('focus click before typing failed (continuing)');
      await sleep(120);
    }
    if (plan.clear_before_typing) {
      await invoke('key_combo', { keys: ['ctrl', 'a'] });
      await invoke('key_press', { key: 'delete' });
    }
    await invoke('type_text', { text });
    if (plan.press_enter) await invoke('key_press', { key: 'enter' });
    log.push(`keyboard type ${text.length} chars${plan.press_enter ? ' + enter' : ''}`);
    return { success: true, used_method: 'keyboard', log, element: el };
  } catch (e) {
    return { success: false, used_method: 'keyboard', error: String(e), log, element: el };
  } finally {
    if (ctx.guardSetBlock) await ctx.guardSetBlock(false);
  }
}

/** Resolve click_text / click_label to the best matching element. */
export function resolveTextTarget(
  state: ScreenState, query: string, labelOnly = false,
): ScreenElement | null {
  const pool = state.elements.filter((e) => e.clickable && (!labelOnly || e.source === 'omniparser' || e.source === 'grid'));
  const m = bestTextMatch(query, pool, (e) => e.name || e.text, 0.5);
  if (m) return m.item;
  if (labelOnly) {
    // Fall back to any clickable text match.
    const any = bestTextMatch(query, state.elements.filter((e) => e.clickable), (e) => e.name || e.text, 0.5);
    return any?.item ?? null;
  }
  return null;
}

/**
 * Execute an ActionPlan. Returns an ActionResult WITHOUT before/after or
 * verification (the orchestrator attaches those). `needsRefine` is surfaced via
 * the error/used_method so the orchestrator can crop/refine before any raw click.
 */
export async function executeV2(
  plan: ActionPlan, state: ScreenState, ctx: ExecutorContext = {},
): Promise<ActionResult & { needsRefine?: boolean; chosenElementId?: string; log: string[]; cli?: CliObservation }> {
  const log: string[] = [];
  const base = (o: Partial<ActionResult & { needsRefine?: boolean; chosenElementId?: string; cli?: CliObservation }>) => ({
    success: false, action_executed: plan.action, used_method: 'none' as UsedMethod, log, ...o,
  });

  switch (plan.action) {
    // ── CLI command — launch apps, file/git/npm/cargo/powershell, etc. ──
    case 'cli_command': {
      const command = plan.command ?? '';
      try {
        const res = await invoke<{ stdout: string; stderr: string; exit_code: number; success: boolean }>(
          'shell_run', { command, workingDir: plan.working_dir ?? null },
        );
        log.push(`cli "${command}" → exit ${res.exit_code}`);
        const cli: CliObservation = { command, stdout: res.stdout, stderr: res.stderr, exitCode: res.exit_code };
        return base({
          success: res.success, used_method: 'cli', cli,
          error: res.success ? undefined : (res.stderr || `exit code ${res.exit_code}`),
        });
      } catch (e) {
        return base({ used_method: 'cli', error: String(e), cli: { command, stdout: '', stderr: String(e), exitCode: -1 } });
      }
    }

    // ── Open/navigate the agent's CDP browser (so DOM actions then work) ──
    case 'browser_open': {
      try {
        const out = await invoke<string>('browser_open', { url: plan.url ?? '' });
        log.push(`browser_open ${plan.url} → ${out}`);
        return base({ success: true, used_method: 'browser' });
      } catch (e) {
        return base({ used_method: 'browser', error: String(e) });
      }
    }

    case 'hotkey': {
      const keys = plan.keys ?? [];
      try {
        if (ctx.guardSetBlock) await ctx.guardSetBlock(true);
        await invoke('key_combo', { keys });
        log.push(`hotkey ${keys.join('+')}`);
        return base({ success: true, used_method: 'hotkey' });
      } catch (e) {
        return base({ used_method: 'hotkey', error: String(e) });
      } finally {
        if (ctx.guardSetBlock) await ctx.guardSetBlock(false);
      }
    }

    case 'click_element': {
      const el = findById(state, plan.target?.element_id);
      if (!el) return base({ error: `element ${plan.target?.element_id} not found`, needsRefine: true });
      // If a stabler shortcut exists for this element's text, the planner should
      // have chosen it; we still honour an explicit element click here.
      const out = await clickElement(el, state, ctx, log);
      return base({ ...out, chosenElementId: el.id });
    }

    case 'click_text':
    case 'click_label': {
      const query = plan.target?.text ?? plan.text ?? '';
      const el = resolveTextTarget(state, query, plan.action === 'click_label');
      if (!el) {
        // Maybe a hotkey covers this intent (e.g. "Extensions").
        const sc = suggestShortcut(state.active_window_title, query, state.active_app_name);
        if (sc) {
          try {
            if (ctx.guardSetBlock) await ctx.guardSetBlock(true);
            await invoke('key_combo', { keys: sc.keys });
            log.push(`no element for "${query}"; used shortcut ${sc.keys.join('+')}`);
            return base({ success: true, used_method: 'hotkey' });
          } catch (e) {
            return base({ used_method: 'hotkey', error: String(e) });
          } finally {
            if (ctx.guardSetBlock) await ctx.guardSetBlock(false);
          }
        }
        return base({ error: `no element matched text "${query}"`, needsRefine: true });
      }
      const out = await clickElement(el, state, ctx, log);
      return base({ ...out, chosenElementId: el.id });
    }

    case 'type_text': {
      const el = findById(state, plan.target?.element_id)
        ?? (plan.target?.text ? resolveTextTarget(state, plan.target.text) ?? undefined : undefined);
      const out = await typeInto(el, plan, state, ctx, log);
      return base({ ...out, chosenElementId: el?.id });
    }

    case 'scroll': {
      const el = findById(state, plan.target?.element_id);
      const dir = plan.direction ?? 'down';
      const amount = plan.amount ?? 3;
      try {
        if (el && isUia(el) && el.metadata?.can_scroll) {
          await invoke('desktop_scroll_target', {
            id: String(el.metadata.uiaId), direction: dir, amount,
            snapshotToken: String(el.metadata.snapshot_token ?? ''),
          });
          log.push(`uia scroll ${dir} x${amount}`);
          return base({ success: true, used_method: 'uia_invoke', chosenElementId: el.id });
        }
        const cx = el ? el.center[0] : Math.round(state.screen_width / 2);
        const cy = el ? el.center[1] : Math.round(state.screen_height / 2);
        await invoke('mouse_scroll', { x: cx, y: cy, direction: dir, amount });
        log.push(`wheel scroll ${dir} x${amount} @${cx},${cy}`);
        return base({ success: true, used_method: 'mouse_safe_point' });
      } catch (e) {
        return base({ used_method: 'fallback', error: String(e) });
      }
    }

    case 'raw_click': {
      const x = plan.target?.x ?? 0;
      const y = plan.target?.y ?? 0;
      const invalid = validateScreenPoint([x, y], {
        screen_width: state.screen_width, screen_height: state.screen_height, dpi_scale: state.dpi_scale,
      });
      if (invalid) return base({ used_method: 'mouse_raw', error: `raw_click rejected: ${invalid}` });
      try {
        if (ctx.guardSetBlock) await ctx.guardSetBlock(true);
        await invoke('mouse_click', { x, y, button: 'left' });
        log.push(`RAW mouse click @${x},${y} (last resort)`);
        return base({ success: true, used_method: 'mouse_raw' });
      } catch (e) {
        return base({ used_method: 'mouse_raw', error: String(e) });
      } finally {
        if (ctx.guardSetBlock) await ctx.guardSetBlock(false);
      }
    }

    case 'wait': {
      await sleep(Math.min(plan.timeout_ms ?? 1000, 10000));
      log.push(`wait ${plan.timeout_ms ?? 1000}ms`);
      return base({ success: true, used_method: 'none' });
    }

    case 'done':
    case 'ask_user':
      // Handled by the orchestrator; nothing to actuate.
      return base({ success: true, used_method: 'none' });

    default:
      return base({ error: `unsupported action ${(plan as ActionPlan).action}` });
  }
}
