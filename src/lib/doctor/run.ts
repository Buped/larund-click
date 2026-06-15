// Live Doctor runner. Gathers real facts from the registries and stores, then
// hands them to the pure `buildReport`. All probes are read-only / non-destructive.

import { TOOL_CATALOG } from '../tools/registry';
import { BUNDLED_SKILL_FILES } from '../skills/bundled';
import { loadSkillFromMarkdown } from '../skills/loader';
import { connectionStatus, ALL_MANIFESTS } from '../connections/registry';
import { createWorkspace, deleteWorkspace } from '../workspaces/store';
import { createMemory, deleteMemory } from '../memory/store';
import { createTaskRun, deleteTaskRun } from '../tasks/store';
import { buildReport } from './checks';
import type { DoctorFacts, DoctorReport } from './types';

const DOCTOR_USER = '__doctor__';

async function probeWorkspaceStore(): Promise<boolean> {
  try {
    const ws = await createWorkspace({ userId: DOCTOR_USER, name: 'doctor-probe' });
    await deleteWorkspace(ws.id);
    return true;
  } catch {
    return false;
  }
}

async function probeMemoryStore(): Promise<boolean> {
  try {
    const m = await createMemory({ userId: DOCTOR_USER, type: 'episodic', title: 'probe', content: 'probe', source: 'system' });
    await deleteMemory(m.id);
    return true;
  } catch {
    return false;
  }
}

async function probeTaskStore(): Promise<boolean> {
  try {
    const t = await createTaskRun({
      userId: DOCTOR_USER,
      sessionId: 'doctor',
      title: 'probe',
      originalPrompt: 'probe',
      modelId: 'core',
      autonomyMode: 'semi',
    });
    await deleteTaskRun(t.id);
    return true;
  } catch {
    return false;
  }
}

function googleWorkspaceStatus(): DoctorFacts['googleWorkspaceStatus'] {
  const m = ALL_MANIFESTS.find((x) => x.id === 'google-workspace');
  if (!m) return 'unknown';
  const s = connectionStatus(m);
  if (s === 'configured' || s === 'missing_auth' || s === 'scaffold') return s;
  return 'unknown';
}

export async function gatherFacts(browserCdpAvailable: boolean | 'unknown' = 'unknown'): Promise<DoctorFacts> {
  const skills = BUNDLED_SKILL_FILES.map((f) => loadSkillFromMarkdown(f, 'bundled'));
  const skillLoadErrors = skills.filter((s) => s.error).map((s) => `${s.manifest.name}: ${s.error}`);

  const [workspaceStoreOk, memoryStoreOk, taskStoreOk] = await Promise.all([
    probeWorkspaceStore(),
    probeMemoryStore(),
    probeTaskStore(),
  ]);

  return {
    toolNames: TOOL_CATALOG.map((t) => t.name),
    bundledSkillCount: skills.filter((s) => s.enabled).length,
    skillLoadErrors,
    googleWorkspaceStatus: googleWorkspaceStatus(),
    browserCdpAvailable,
    workspaceStoreOk,
    memoryStoreOk,
    taskStoreOk,
  };
}

export async function runDoctor(browserCdpAvailable: boolean | 'unknown' = 'unknown'): Promise<DoctorReport> {
  const facts = await gatherFacts(browserCdpAvailable);
  return buildReport(facts);
}
