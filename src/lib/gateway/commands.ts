import type { GatewayCommand } from './types';

export function parseGatewayCommand(text: string): GatewayCommand {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'help' };
  if (!trimmed.startsWith('/')) return { kind: 'task', prompt: trimmed };

  const [cmd, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(' ').trim();
  switch (cmd.toLowerCase()) {
    case '/task':
      return arg ? { kind: 'task', prompt: arg } : { kind: 'unknown', raw: trimmed, reason: '/task requires a prompt' };
    case '/status':
      return arg ? { kind: 'status', taskId: arg } : { kind: 'unknown', raw: trimmed, reason: '/status requires a task id' };
    case '/approve':
      return arg ? { kind: 'approve', approvalId: arg } : { kind: 'unknown', raw: trimmed, reason: '/approve requires an approval id' };
    case '/approve_always':
      return arg ? { kind: 'approve', approvalId: arg, always: true } : { kind: 'unknown', raw: trimmed, reason: '/approve_always requires an approval id' };
    case '/deny':
      return arg ? { kind: 'deny', approvalId: arg } : { kind: 'unknown', raw: trimmed, reason: '/deny requires an approval id' };
    case '/workspaces':
      return { kind: 'workspaces' };
    case '/use_workspace':
      return arg ? { kind: 'use_workspace', workspace: arg } : { kind: 'unknown', raw: trimmed, reason: '/use_workspace requires a name or id' };
    case '/help':
      return { kind: 'help' };
    default:
      return { kind: 'unknown', raw: trimmed, reason: `Unknown command ${cmd}` };
  }
}

export function renderGatewayHelp(): string {
  return [
    '/task <prompt>',
    '/status <taskId>',
    '/approve <approvalId>',
    '/deny <approvalId>',
    '/workspaces',
    '/use_workspace <name/id>',
    '/help',
  ].join('\n');
}
