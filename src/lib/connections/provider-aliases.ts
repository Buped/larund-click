const GOOGLE_WORKSPACE_ALIASES = new Set([
  'google',
  'gmail',
  'google-drive',
  'google-docs',
  'google-sheets',
  'google-calendar',
]);

export function normalizeConnectionProviderId(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  return GOOGLE_WORKSPACE_ALIASES.has(normalized) ? 'google-workspace' : normalized;
}

export function isUsableConnectionRuntime(runtime: string): boolean {
  return runtime === 'connected' || runtime === 'dev_shortcut_active';
}
