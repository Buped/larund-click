import type { ToolRisk } from '../tools/types';
import type { SandboxDecision, SandboxProfile } from './types';

export function evaluateSandbox(args: {
  profile: SandboxProfile;
  risk: ToolRisk;
  filePath?: string;
  url?: string;
}): SandboxDecision {
  const { profile, risk } = args;
  if (!profile.allowedRiskLevels.includes(risk)) return deny(profile.id, `Risk ${risk} is not allowed by profile ${profile.name}.`);
  if (risk === 'process_exec' && !profile.allowProcessExec) return deny(profile.id, 'Process execution is disabled by sandbox profile.');
  if (risk === 'credential_access' && !profile.allowCredentialAccess) return deny(profile.id, 'Credential access is disabled by sandbox profile.');
  if (risk === 'external_send' && !profile.allowExternalSend) return deny(profile.id, 'External send is disabled by sandbox profile.');
  if (args.filePath && profile.filesystemRoots.length > 0 && !withinRoots(args.filePath, profile.filesystemRoots)) {
    return deny(profile.id, `Path ${args.filePath} is outside allowed filesystem roots.`);
  }
  if (args.url && profile.networkAllowlist.length > 0 && !urlAllowed(args.url, profile.networkAllowlist)) {
    return deny(profile.id, `URL ${args.url} is outside network allowlist.`);
  }
  return {
    allowed: true,
    requiresApproval: profile.requireApprovalFor.includes(risk),
    reason: profile.requireApprovalFor.includes(risk) ? `Risk ${risk} requires approval.` : 'Allowed by sandbox profile.',
    profileId: profile.id,
  };
}

function deny(profileId: string, reason: string): SandboxDecision {
  return { allowed: false, requiresApproval: false, reason, profileId };
}

function withinRoots(path: string, roots: string[]): boolean {
  const normalized = normalize(path);
  return roots.some((root) => root === '~' || normalized.startsWith(normalize(root)));
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function urlAllowed(url: string, allowlist: string[]): boolean {
  return allowlist.some((entry) => {
    if (entry === 'https://*') return /^https:\/\//i.test(url);
    if (entry.endsWith('*')) return url.toLowerCase().startsWith(entry.slice(0, -1).toLowerCase());
    return url.toLowerCase().startsWith(entry.toLowerCase());
  });
}
