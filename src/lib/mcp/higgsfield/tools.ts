// Higgsfield CLI tool catalog. Each tool maps to a `higgsfield` CLI subcommand and
// carries an explicit ToolRisk (the task's risk table), so generation/upload stay
// approval-gated regardless of the generic metadata scanner.
//
// The CLI subcommand names are centralized here so they can be adjusted to match
// the installed CLI version without touching the adapter/runtime.

import type { ToolRisk } from '../../control-system/types';
import type { McpToolDefinition } from '../types';

export interface HiggsfieldToolDef extends McpToolDefinition {
  /** Default risk used to seed the tool snapshot (overrides scanner heuristics). */
  risk: ToolRisk;
  /** Build the CLI argv (after the `higgsfield` binary) from tool arguments. */
  argv: (args: Record<string, unknown>) => string[];
  /** Long-running poll command: enforce a timeout. */
  polling?: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

const obj = (props: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object',
  properties: props,
  required,
  additionalProperties: false,
});
const S = { type: 'string' };
const N = { type: 'number' };

export const HIGGSFIELD_TOOLS: HiggsfieldToolDef[] = [
  {
    name: 'higgsfield.account_status',
    title: 'Account status',
    description: 'Show the signed-in Higgsfield account and remaining credits.',
    risk: 'read_only',
    inputSchema: obj({}),
    argv: () => ['account', '--json'],
  },
  {
    name: 'higgsfield.model_list',
    title: 'List models',
    description: 'List available Higgsfield generation models.',
    risk: 'read_only',
    inputSchema: obj({ kind: { ...S, description: 'Optional filter: image | video | audio' } }),
    argv: (a) => ['models', 'list', ...(str(a.kind) ? ['--type', str(a.kind)] : []), '--json'],
  },
  {
    name: 'higgsfield.model_get',
    title: 'Get model',
    description: 'Get details and parameters for a single Higgsfield model.',
    risk: 'read_only',
    inputSchema: obj({ model_id: S }, ['model_id']),
    argv: (a) => ['models', 'get', str(a.model_id), '--json'],
  },
  {
    name: 'higgsfield.generate_cost',
    title: 'Estimate generation cost',
    description: 'Estimate the credit cost of a generation before running it.',
    risk: 'read_only',
    inputSchema: obj({ model_id: S, prompt: S, params: { type: 'object', additionalProperties: true } }),
    argv: (a) => ['generate', 'cost', ...(str(a.model_id) ? ['--model', str(a.model_id)] : []), ...(str(a.prompt) ? ['--prompt', str(a.prompt)] : []), '--json'],
  },
  {
    name: 'higgsfield.generate_create',
    title: 'Generate (create job)',
    description: 'Create a Higgsfield generation job (image/video/audio) from a prompt and model. Costs credits.',
    risk: 'external_write',
    inputSchema: obj({ model_id: S, prompt: S, aspect_ratio: S, params: { type: 'object', additionalProperties: true } }, ['model_id', 'prompt']),
    argv: (a) => [
      'generate', 'create',
      '--model', str(a.model_id),
      '--prompt', str(a.prompt),
      ...(str(a.aspect_ratio) ? ['--aspect-ratio', str(a.aspect_ratio)] : []),
      '--json',
    ],
  },
  {
    name: 'higgsfield.generate_get',
    title: 'Get generation',
    description: 'Get the status and result of a generation job by id.',
    risk: 'external_read',
    inputSchema: obj({ job_id: S }, ['job_id']),
    argv: (a) => ['generate', 'get', str(a.job_id), '--json'],
  },
  {
    name: 'higgsfield.generate_wait',
    title: 'Wait for generation',
    description: 'Poll a generation job until it completes or the timeout elapses, then return the result URL.',
    risk: 'external_read',
    polling: true,
    inputSchema: obj({ job_id: S, timeout_seconds: N }, ['job_id']),
    argv: (a) => ['generate', 'wait', str(a.job_id), '--timeout', String(num(a.timeout_seconds, 180)), '--json'],
  },
  {
    name: 'higgsfield.generate_list',
    title: 'List generations',
    description: 'List recent generation jobs for the account.',
    risk: 'read_only',
    inputSchema: obj({ limit: N }),
    argv: (a) => ['generate', 'list', ...(a.limit != null ? ['--limit', String(num(a.limit, 20))] : []), '--json'],
  },
  {
    name: 'higgsfield.upload_image',
    title: 'Upload image',
    description: 'Upload a local image file to Higgsfield for use as input. Sends a user file externally.',
    risk: 'external_write',
    inputSchema: obj({ path: S }, ['path']),
    argv: (a) => ['upload', 'image', str(a.path), '--json'],
  },
  {
    name: 'higgsfield.upload_video',
    title: 'Upload video',
    description: 'Upload a local video file to Higgsfield for use as input. Sends a user file externally.',
    risk: 'external_write',
    inputSchema: obj({ path: S }, ['path']),
    argv: (a) => ['upload', 'video', str(a.path), '--json'],
  },
  {
    name: 'higgsfield.upload_audio',
    title: 'Upload audio',
    description: 'Upload a local audio file to Higgsfield for use as input. Sends a user file externally.',
    risk: 'external_write',
    inputSchema: obj({ path: S }, ['path']),
    argv: (a) => ['upload', 'audio', str(a.path), '--json'],
  },
  {
    name: 'higgsfield.soul_id_create',
    title: 'Create Soul ID',
    description: 'Create a Higgsfield Soul ID (character/identity) from uploaded references. Costs credits.',
    risk: 'external_write',
    inputSchema: obj({ name: S, image_ids: { type: 'array', items: S } }, ['name']),
    argv: (a) => ['soul-id', 'create', '--name', str(a.name), '--json'],
  },
  {
    name: 'higgsfield.soul_id_wait',
    title: 'Wait for Soul ID',
    description: 'Poll a Soul ID training job until ready or timeout.',
    risk: 'external_read',
    polling: true,
    inputSchema: obj({ soul_id: S, timeout_seconds: N }, ['soul_id']),
    argv: (a) => ['soul-id', 'wait', str(a.soul_id), '--timeout', String(num(a.timeout_seconds, 300)), '--json'],
  },
  {
    name: 'higgsfield.workflow_list',
    title: 'List workflows',
    description: 'List available Higgsfield workflows.',
    risk: 'read_only',
    inputSchema: obj({}),
    argv: () => ['workflows', 'list', '--json'],
  },
  {
    name: 'higgsfield.workflow_get',
    title: 'Get workflow',
    description: 'Get details and inputs for a single Higgsfield workflow.',
    risk: 'read_only',
    inputSchema: obj({ workflow_id: S }, ['workflow_id']),
    argv: (a) => ['workflows', 'get', str(a.workflow_id), '--json'],
  },
  {
    name: 'higgsfield.generate_workflow',
    title: 'Run workflow',
    description: 'Run a Higgsfield workflow with inputs to produce a generation. Costs credits.',
    risk: 'external_write',
    inputSchema: obj({ workflow_id: S, inputs: { type: 'object', additionalProperties: true } }, ['workflow_id']),
    argv: (a) => ['workflows', 'run', str(a.workflow_id), '--json'],
  },
];

export const HIGGSFIELD_TOOL_RISK: Record<string, ToolRisk> = Object.fromEntries(
  HIGGSFIELD_TOOLS.map((t) => [t.name, t.risk]),
);

export function getHiggsfieldTool(name: string): HiggsfieldToolDef | undefined {
  return HIGGSFIELD_TOOLS.find((t) => t.name === name);
}

export function higgsfieldToolDefinitions(): McpToolDefinition[] {
  return HIGGSFIELD_TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }));
}
