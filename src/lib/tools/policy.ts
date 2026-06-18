import type { ControlAction, ToolRisk } from '../control-system/types';
import type { ToolCategory } from './types';

export type PolicyDecision = 'auto' | 'ask' | 'block';

export interface RiskPolicy {
  read_only: PolicyDecision;
  external_read: PolicyDecision;
  local_write: PolicyDecision;
  external_write: PolicyDecision;
  external_send: PolicyDecision;
  destructive: PolicyDecision;
  credential_access: PolicyDecision;
  process_exec: PolicyDecision;
}

export type AutonomyMode = 'manual' | 'semi' | 'full';

export const DEFAULT_POLICY: RiskPolicy = {
  read_only: 'auto',
  external_read: 'auto',
  local_write: 'auto',
  external_write: 'ask',
  external_send: 'ask',
  destructive: 'ask',
  credential_access: 'ask',
  process_exec: 'ask',
};

export const MANUAL_POLICY: RiskPolicy = {
  read_only: 'ask',
  external_read: 'ask',
  local_write: 'ask',
  external_write: 'ask',
  external_send: 'ask',
  destructive: 'ask',
  credential_access: 'ask',
  process_exec: 'ask',
};

// Full autonomy: act silently for everything EXCEPT genuinely destructive actions.
// Sends, external writes, logins (credential_access) and process exec all run
// without asking; only destructive (delete/kill/format/rm -rf) still confirms.
export const FULL_AUTONOMY_POLICY: RiskPolicy = {
  read_only: 'auto',
  external_read: 'auto',
  local_write: 'auto',
  external_write: 'auto',
  external_send: 'auto',
  destructive: 'ask',
  credential_access: 'auto',
  process_exec: 'auto',
};

export function policyForAutonomyMode(mode: AutonomyMode): RiskPolicy {
  if (mode === 'manual') return MANUAL_POLICY;
  if (mode === 'full') return FULL_AUTONOMY_POLICY;
  return DEFAULT_POLICY;
}

/** Static category per action name. */
export const ACTION_CATEGORY: Record<string, ToolCategory> = {
  'cli.run': 'runtime', 'process.start': 'runtime', 'process.status': 'runtime', 'process.kill': 'runtime',
  'file.read': 'files', 'file.write': 'files', 'file.edit': 'files', 'file.list': 'files',
  'file.mkdir': 'files', 'file.copy': 'files', 'file.move': 'files', 'file.delete': 'files',
  'file.search': 'files', 'file.tree': 'files', 'file.exists': 'files', 'file.metadata': 'files',
  'document.read': 'documents', 'document.read_many': 'documents', 'document.summarize': 'documents',
  'folder.scan': 'documents', 'folder.read_relevant': 'documents',
  'sheet.read': 'data', 'sheet.write': 'data', 'sheet.append': 'data', 'sheet.export_csv': 'data', 'sheet.to_json': 'data',
  'doc.read': 'documents', 'doc.write_txt': 'documents', 'doc.write_docx': 'documents',
  'clipboard.get': 'clipboard', 'clipboard.set': 'clipboard',
  'app.open': 'apps', 'window.list': 'apps', 'window.focus': 'apps',
  'keyboard.press': 'apps', 'keyboard.combo': 'apps',
  'browser.open': 'browser', 'browser.read': 'browser', 'browser.get_state': 'browser',
  'browser.click': 'browser', 'browser.type': 'browser', 'browser.key': 'browser',
  'browser.shortcut': 'browser', 'browser.paste': 'browser',
  'browser.assert_text': 'browser', 'browser.assert_url': 'browser', 'browser.wait': 'browser',
  'browser.extract_table': 'browser', 'browser.download': 'browser', 'browser.upload': 'browser',
  'browser.login': 'browser',
  'connection.call': 'connections', 'skill.run': 'skills',
  'workflow.start': 'workflows', 'workflow.status': 'workflows', 'workflow.cancel': 'workflows',
  'approval.request': 'approvals', 'task.complete': 'runtime', 'ask_user': 'runtime',
};

// Commands that must always require approval regardless of policy mode.
const DANGEROUS_CMD = [
  /\brm\s+-rf?\b/i,
  /\bdel\s+\/[sq]/i,
  /\brmdir\s+\/s/i,
  /\bformat\b/i,
  /\breg\s+(delete|add)\b/i,
  /\bsudo\b/i,
  /\brunas\b/i,
  /\bnet\s+user\b/i,
  /\bshutdown\b/i,
  /\bmkfs\b/i,
  /:\(\)\s*\{.*\}\s*;/, // fork bomb
];

const INSTALL_CMD = [
  /\b(npm|yarn|pnpm)\s+(i|install|add)\b/i,
  /\bpip\s+install\b/i,
  /\bcargo\s+install\b/i,
  /\b(apt|apt-get|brew|choco|winget|scoop)\s+(install|add)\b/i,
];

const CREDENTIAL_CMD = [
  /\b(printenv|env|set)\b\s*$/i,
  /\b(cat|type|gc|get-content)\b.*\.(env|pem|key)\b/i,
  /\bsecurity\s+find-generic-password\b/i,
];

export function isDangerousCommand(cmd: string): boolean {
  return DANGEROUS_CMD.some((re) => re.test(cmd));
}

export function commandRisk(cmd: string): ToolRisk {
  if (isDangerousCommand(cmd)) return 'destructive';
  if (CREDENTIAL_CMD.some((re) => re.test(cmd))) return 'credential_access';
  if (INSTALL_CMD.some((re) => re.test(cmd))) return 'process_exec';
  // read-only-ish commands stay low risk; everything else is process_exec.
  if (/^\s*(git\s+(status|log|diff|show|branch)|ls|dir|cat|type|pwd|echo|node\s+--version|--version|where|which|tree)\b/i.test(cmd)) {
    return 'read_only';
  }
  return 'process_exec';
}

/** Dynamically assess the risk of an action (some depend on their args). */
export function assessRisk(action: ControlAction): ToolRisk {
  switch (action.action) {
    case 'cli.run':
      return action.risk ?? commandRisk(action.cmd);
    case 'process.start':
      return 'process_exec';
    case 'process.status':
      return 'read_only';
    case 'process.kill':
      return 'destructive';

    case 'file.read': case 'file.list': case 'file.search': case 'file.tree':
    case 'file.exists': case 'file.metadata': case 'sheet.read':
    case 'document.read': case 'document.read_many': case 'document.summarize':
    case 'folder.scan': case 'folder.read_relevant': case 'sheet.to_json':
    case 'doc.read':
      return 'read_only';
    case 'file.write': case 'file.edit': case 'file.mkdir': case 'file.copy':
    case 'sheet.write': case 'sheet.append': case 'sheet.export_csv':
    case 'doc.write_txt': case 'doc.write_docx': case 'clipboard.set':
      return 'local_write';
    case 'file.move':
      return 'local_write';
    case 'file.delete':
      return 'destructive';

    case 'clipboard.get':
      return 'read_only';

    case 'app.open': case 'window.list': case 'window.focus':
    case 'keyboard.press': case 'keyboard.combo':
      return 'local_write';

    case 'browser.open': case 'browser.read': case 'browser.get_state':
    case 'browser.wait': case 'browser.extract_table':
    case 'browser.assert_text': case 'browser.assert_url':
      return 'external_read';
    case 'browser.click': case 'browser.type': case 'browser.key':
    case 'browser.shortcut': case 'browser.paste':
    case 'browser.download': case 'browser.upload':
      return 'external_write';
    case 'browser.login':
      return 'credential_access';

    case 'connection.call':
      return connectionToolRisk(action.tool);
    case 'skill.run': case 'workflow.start':
      return 'local_write';
    case 'workflow.status':
      return 'read_only';
    case 'workflow.cancel':
      return 'local_write';

    case 'approval.request': case 'task.complete': case 'ask_user':
      return 'read_only';
    default:
      return 'process_exec';
  }
}

function connectionToolRisk(tool: string): ToolRisk {
  const t = tool.toLowerCase();
  if (/(^|\.)(search|get|list|read|query|inspect|retrieve|run_report|realtime|analyze|extract|generate)_/.test(t)) return 'external_read';
  if (/(delete|remove|destroy)/.test(t)) return 'destructive';
  if (/(send|email|message|publish|create_post|reply_to_post|schedule_post|post_message|send_message)/.test(t)) return 'external_send';
  if (/(create|update|write|comment|merge|open_pr|draft|append|deploy|set_env|apply_mutation)/.test(t)) return 'external_write';
  return 'external_read';
}

/** Resolve whether an action may run automatically, must ask, or is blocked. */
export function decide(action: ControlAction, policy: RiskPolicy = DEFAULT_POLICY): {
  risk: ToolRisk;
  decision: PolicyDecision;
} {
  const risk = assessRisk(action);
  let decision = policy[risk] ?? 'ask';
  // Hard overrides: destructive shell + credential access never auto-run.
  if (action.action === 'cli.run' && isDangerousCommand(action.cmd)) decision = 'ask';
  return { risk, decision };
}
