import type { AgentStep } from '../agent-loop';

export interface ChatVisualization {
  id: string;
  title: string;
  html: string;
  height?: number;
}

export function visualizationFromAgentStep(step: AgentStep): ChatVisualization | null {
  if (step.type !== 'tool_result' || step.tool !== 'visualization.render') return null;
  const visualization = (step.details as { visualization?: unknown } | undefined)?.visualization;
  if (!visualization || typeof visualization !== 'object') return null;
  const value = visualization as { title?: unknown; html?: unknown; height?: unknown };
  if (typeof value.html !== 'string' || !value.html.trim()) return null;
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : 'Visualization';
  const height = typeof value.height === 'number' && Number.isFinite(value.height) ? value.height : undefined;
  return {
    id: `${step.id}:${hashVisualization(title, value.html)}`,
    title,
    html: value.html,
    height,
  };
}

export function collectAgentVisualizations(steps: AgentStep[]): ChatVisualization[] {
  const seen = new Set<string>();
  const out: ChatVisualization[] = [];
  for (const step of steps) {
    const visualization = visualizationFromAgentStep(step);
    if (!visualization) continue;
    const key = `${visualization.title}\n${visualization.html}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(visualization);
  }
  return out;
}

function hashVisualization(title: string, html: string): string {
  const input = `${title}\n${html}`;
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
