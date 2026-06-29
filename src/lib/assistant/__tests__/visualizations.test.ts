import { describe, expect, it } from 'vitest';
import type { AgentStep } from '../../agent-loop';
import { collectAgentVisualizations, visualizationFromAgentStep } from '../visualizations';

function step(id: string, html: string, title = 'Trend'): AgentStep {
  return {
    id,
    type: 'tool_result',
    tool: 'visualization.render',
    output: `Visualization rendered: ${title}`,
    timestamp: '2026-06-28T00:00:00.000Z',
    details: { visualization: { title, html, height: 420 } },
  };
}

describe('agent visualization collection', () => {
  it('extracts visualization details from an agent step', () => {
    const visualization = visualizationFromAgentStep(step('v1', '<svg><text>népesség</text></svg>', 'Népesség'));
    expect(visualization?.title).toBe('Népesség');
    expect(visualization?.html).toContain('népesség');
    expect(visualization?.height).toBe(420);
  });

  it('deduplicates repeated visualization results', () => {
    const visualizations = collectAgentVisualizations([
      step('v1', '<svg><text>A</text></svg>'),
      step('v2', '<svg><text>A</text></svg>'),
      step('v3', '<svg><text>B</text></svg>'),
    ]);
    expect(visualizations).toHaveLength(2);
    expect(visualizations.map((v) => v.html)).toEqual([
      '<svg><text>A</text></svg>',
      '<svg><text>B</text></svg>',
    ]);
  });
});
