import { describe, it, expect } from 'vitest';
import { extractMemoryCandidates, decideMemoryWrites, looksLikeSecret } from '../extractor';
import { defaultMemorySettings } from '../settings';

const base = { userId: 'u1' };

describe('extractMemoryCandidates — advanced patterns', () => {
  it('captures a preferred name as a user_profile fact', () => {
    const c = extractMemoryCandidates({ ...base, userText: 'Call me Buped from now on.' });
    const name = c.find((x) => x.type === 'user_profile');
    expect(name).toBeTruthy();
    expect(name!.content).toMatch(/Buped/);
    expect(name!.explicit).toBe(true);
  });

  it('captures client tone as a client_profile candidate', () => {
    const c = extractMemoryCandidates({ ...base, userText: 'For Kovács Dental, always use a professional but friendly tone.' });
    const client = c.find((x) => x.type === 'client_profile');
    expect(client).toBeTruthy();
    expect(client!.content).toMatch(/professional but friendly/i);
    expect(client!.clientId).toBe('kov-cs-dental'); // slug of "Kovács Dental" (á → -)
  });

  it('treats explicit "remember this" as explicit', () => {
    const c = extractMemoryCandidates({ ...base, userText: 'Remember this: invoices go in the Q3 folder.' });
    expect(c.some((x) => x.explicit)).toBe(true);
  });

  it('never stores a secret value — records a reference instead', () => {
    const c = extractMemoryCandidates({ ...base, userText: 'My Stripe key is sk_live_abcd1234efgh5678ijkl' });
    expect(c.some((x) => x.type === 'sensitive_reference')).toBe(true);
    for (const cand of c) expect(cand.content).not.toMatch(/sk_live_abcd1234/);
  });

  it('looksLikeSecret detects common key formats', () => {
    expect(looksLikeSecret('ghp_abcdefghij0123456789xyz')).toBe(true);
    expect(looksLikeSecret('just a normal sentence')).toBe(false);
  });
});

describe('decideMemoryWrites', () => {
  it('sends corrections and client data to review even with auto-save on', () => {
    const settings = { ...defaultMemorySettings(), autoSaveLowRisk: true, askBeforeClientData: true };
    const cands = extractMemoryCandidates({ ...base, userText: 'No, that is wrong — use the Q3 folder.' });
    const { autoSave, suggest } = decideMemoryWrites(cands, settings);
    expect(autoSave.find((c) => c.type === 'correction')).toBeUndefined();
    expect(suggest.find((c) => c.type === 'correction')).toBeTruthy();
  });

  it('auto-saves explicit requests regardless of auto-save setting', () => {
    const settings = { ...defaultMemorySettings(), autoSaveLowRisk: false };
    const cands = extractMemoryCandidates({ ...base, userText: 'Call me Buped.' });
    const { autoSave } = decideMemoryWrites(cands, settings);
    expect(autoSave.find((c) => c.type === 'user_profile')).toBeTruthy();
  });

  it('produces nothing when memory is disabled', () => {
    const settings = { ...defaultMemorySettings(), enabled: false };
    const cands = extractMemoryCandidates({ ...base, userText: 'I always prefer concise answers.' });
    const { autoSave, suggest } = decideMemoryWrites(cands, settings);
    expect(autoSave).toHaveLength(0);
    expect(suggest).toHaveLength(0);
  });
});
