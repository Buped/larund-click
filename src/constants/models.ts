export const MODELS = [
  { id: 'pulse', name: 'Pulse', icon: 'zap',     tag: 'Fast',     desc: 'Everyday tasks',        cost: '~$0.001/task', openrouter_id: 'google/gemini-3.1-flash-lite' },
  { id: 'core',  name: 'Core',  icon: 'cpu',     tag: 'Balanced', desc: 'Complex workflows',     cost: '~$0.003/task', openrouter_id: 'anthropic/claude-haiku-4-5' },
  { id: 'apex',  name: 'Apex',  icon: 'diamond', tag: 'Powerful', desc: 'Multi-step automation', cost: '~$0.01/task',  openrouter_id: 'google/gemini-2.5-flash', service_tier: 'flex' as const },
] as const;

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'google/gemini-3.1-flash-lite': { input: 0.10,  output: 0.40  },
  'anthropic/claude-haiku-4-5':   { input: 0.80,  output: 4.00  },
  'google/gemini-2.5-flash':      { input: 0.375, output: 2.25  },
  'qwen/qwen3-vl-235b-a22b-instruct': { input: 0.20, output: 0.88 },
  'qwen/qwen3-vl-32b-instruct':    { input: 0.20,  output: 0.60  },
};

export const MARKUP = 1.2;
