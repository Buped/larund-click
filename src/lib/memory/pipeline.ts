// The memory extraction pipeline: turn a finished chat turn or task into stored
// memory, honoring the user's MemorySettings. Conservative by design — most
// turns produce nothing. Auto-saved candidates become active memory; the rest go
// to the review queue. Best-effort: callers fire-and-forget; never throws.

import { extractMemoryCandidates, decideMemoryWrites, candidateToInput, type ExtractionContext } from './extractor';
import { createMemory, suggestMemory } from './store';
import { getMemorySettings, type MemorySettings } from './settings';

export interface PipelineInput extends ExtractionContext {
  settings?: MemorySettings;
}

export interface PipelineResult {
  autoSaved: number;
  suggested: number;
}

/**
 * Run extraction for one chat/task turn and persist the results per settings.
 * Returns counts so the UI can surface "Larund remembered N things".
 */
export async function runMemoryExtraction(input: PipelineInput): Promise<PipelineResult> {
  const result: PipelineResult = { autoSaved: 0, suggested: 0 };
  try {
    const settings = input.settings ?? (await getMemorySettings());
    if (!settings.enabled) return result;

    const candidates = extractMemoryCandidates(input);
    if (!candidates.length) return result;

    const { autoSave, suggest } = decideMemoryWrites(candidates, settings);

    for (const c of autoSave) {
      await createMemory({ ...candidateToInput(c, input.userId, input.workspaceId), status: 'active' });
      result.autoSaved++;
    }
    for (const c of suggest) {
      await suggestMemory(candidateToInput(c, input.userId, input.workspaceId));
      result.suggested++;
    }
  } catch (err) {
    console.warn('Memory extraction failed:', err);
  }
  return result;
}
