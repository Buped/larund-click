import type { ConnectionToolDefinition, ToolRisk } from './types';

/** Build a not-yet-implemented tool for a scaffolded connection. */
export function scaffoldTool(name: string, description: string, risk: ToolRisk): ConnectionToolDefinition {
  return {
    name,
    description,
    risk,
    async run() {
      return { success: false, output: '', error: `connection_scaffold_not_implemented:${name}` };
    },
  };
}
