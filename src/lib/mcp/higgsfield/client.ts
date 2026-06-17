// Higgsfield CLI MCP client. Presents the Higgsfield CLI as an McpClient so it
// flows through the same discovery → security scan → approval → evidence pipeline
// as remote MCP servers. Tools are the curated catalog; calls run the CLI with
// `--json` and return sanitized output. Generation/uploads are approval-gated by
// callMcpTool via each tool's ToolRisk; polling tools enforce a timeout.

import type { McpClient, McpPrompt, McpResource, McpServerConfig, McpToolDefinition } from '../types';
import { getHiggsfieldTool, higgsfieldToolDefinitions } from './tools';
import { runHiggsfield, probeHiggsfieldCli } from './cli';

const POLL_TIMEOUT_MS = 200_000;

export class HiggsfieldCliClient implements McpClient {
  async connect(config: McpServerConfig): Promise<void> {
    if (!config.enabled) throw new Error('mcp_server_disabled');
    const probe = await probeHiggsfieldCli();
    if (probe.state === 'not_installed') throw new Error('higgsfield_cli_not_installed');
    if (probe.state === 'auth_required') throw new Error('higgsfield_auth_required');
    if (probe.state === 'error') throw new Error(`higgsfield_cli_error: ${probe.message}`);
  }

  async disconnect(): Promise<void> {
    /* stateless CLI adapter */
  }

  async listTools(): Promise<McpToolDefinition[]> {
    return higgsfieldToolDefinitions();
  }

  async listResources(): Promise<McpResource[]> {
    return [];
  }

  async listPrompts(): Promise<McpPrompt[]> {
    return [];
  }

  async callTool(
    _serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ success: boolean; output: string; details?: Record<string, unknown>; error?: string }> {
    const tool = getHiggsfieldTool(toolName);
    if (!tool) return { success: false, output: '', error: `higgsfield_unknown_tool:${toolName}` };
    const timeoutMs = tool.polling ? POLL_TIMEOUT_MS : 60_000;
    const result = await runHiggsfield(tool.argv(args ?? {}), { timeoutMs });
    const output = result.stdout || result.stderr;
    if (!result.success) {
      const text = `${result.stdout} ${result.stderr}`.toLowerCase();
      if (/login|sign in|unauth|401|not authenticated|expired/.test(text)) {
        return { success: false, output: '', error: 'higgsfield_auth_required' };
      }
      if (tool.polling && /timeout|timed out/.test(text)) {
        return { success: false, output, error: 'higgsfield_poll_timeout' };
      }
      return { success: false, output: '', error: `higgsfield_cli_failed: ${result.stderr || `exit ${result.exitCode}`}` };
    }
    const parsed = tryParseJson(output);
    return {
      success: true,
      output,
      details: {
        transport: 'cli_adapter',
        providerId: 'higgsfield',
        toolName,
        jobId: extract(parsed, ['id', 'job_id', 'jobId', 'generation_id']),
        outputUrl: extract(parsed, ['url', 'output_url', 'result_url', 'asset_url']),
      },
    };
  }

  async readResource(): Promise<{ success: boolean; output: string; error?: string }> {
    return { success: false, output: '', error: 'higgsfield_no_resources' };
  }

  async getPrompt(): Promise<{ success: boolean; output: string; error?: string }> {
    return { success: false, output: '', error: 'higgsfield_no_prompts' };
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    const probe = await probeHiggsfieldCli();
    return { ok: probe.state === 'ready', message: probe.message };
  }
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // CLI may print a banner line before JSON; grab the first {...} or [...] block.
    const match = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) { try { return JSON.parse(match[0]); } catch { /* ignore */ } }
    return undefined;
  }
}

function extract(parsed: unknown, keys: string[]): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const o = parsed as Record<string, unknown>;
  for (const k of keys) {
    if (typeof o[k] === 'string') return o[k] as string;
  }
  // Look one level into common wrappers.
  for (const wrapper of ['data', 'result', 'generation', 'job']) {
    const inner = o[wrapper];
    if (inner && typeof inner === 'object') {
      const found = extract(inner, keys);
      if (found) return found;
    }
  }
  return undefined;
}
