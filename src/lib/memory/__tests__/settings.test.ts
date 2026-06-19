import { describe, it, expect } from 'vitest';
import { parseMemorySettings, defaultMemorySettings } from '../settings';

describe('parseMemorySettings', () => {
  it('returns defaults for an empty row', () => {
    expect(parseMemorySettings(null)).toEqual(defaultMemorySettings());
  });

  it('coerces 0/1 ints to booleans', () => {
    const s = parseMemorySettings({
      memory_enabled: 1, memory_suggestions: 0, memory_auto_save: 1,
      memory_daily_summary: 0, memory_ask_client_data: 0,
    });
    expect(s.enabled).toBe(true);
    expect(s.suggestions).toBe(false);
    expect(s.autoSaveLowRisk).toBe(true);
    expect(s.dailySummary).toBe(false);
    expect(s.askBeforeClientData).toBe(false);
  });

  it('validates the daily summary time and retention', () => {
    expect(parseMemorySettings({ memory_daily_summary_time: '07:30' }).dailySummaryTime).toBe('07:30');
    expect(parseMemorySettings({ memory_daily_summary_time: 'nonsense' }).dailySummaryTime).toBe('22:00');
    expect(parseMemorySettings({ memory_episodic_retention_days: 90 }).episodicRetentionDays).toBe(90);
    expect(parseMemorySettings({ memory_episodic_retention_days: -5 }).episodicRetentionDays).toBe(30);
  });
});
