import { describe, expect, it } from 'vitest';
import { detectPageState } from '../detect-page-state';
import { detectManualBlocker } from '../manual-blockers';
import { buildTsv, sampleRows, isGoogleSheetsTask, readBackContains } from '../google-sheets';

describe('detect-page-state', () => {
  it('detects a Google login wall', () => {
    const out = 'URL: https://accounts.google.com/signin\nTITLE: Sign in\nSTATE_HINTS: login_required\nINPUTS:\ninput[email]: Email or phone';
    const st = detectPageState(out);
    expect(st.kind).toBe('login_required');
    expect(st.isManualBlocker).toBe(true);
    expect(st.url).toBe('https://accounts.google.com/signin');
  });

  it('treats a ready webapp as not blocked', () => {
    const out = 'URL: https://docs.google.com/spreadsheets/d/x\nTITLE: Sheet\nINPUTS:\ninput[text]: cell\ngrid';
    const st = detectPageState(out);
    expect(st.isManualBlocker).toBe(false);
  });
});

describe('manual-blockers', () => {
  it('catches accounts.google.com and captcha', () => {
    expect(detectManualBlocker('please continue at accounts.google.com').kind).toBe('login_required');
    expect(detectManualBlocker("I'm not a robot reCAPTCHA").kind).toBe('captcha');
    expect(detectManualBlocker('Access denied').kind).toBe('permission_required');
    expect(detectManualBlocker('all good here').blocked).toBe(false);
  });
});

describe('google-sheets helpers', () => {
  it('recognises Google Sheets tasks', () => {
    expect(isGoogleSheetsTask('töltsd fel a google táblázatot')).toBe(true);
    expect(isGoogleSheetsTask('open sheets.new')).toBe(true);
    expect(isGoogleSheetsTask('make an excel file')).toBe(false);
  });

  it('builds TSV from rows', () => {
    const tsv = buildTsv([['Név', 'Email'], ['Kovács János', 'a@b.com']]);
    expect(tsv).toBe('Név\tEmail\nKovács János\ta@b.com');
  });

  it('generates N sample rows with a header', () => {
    const rows = sampleRows(5);
    expect(rows.length).toBe(6); // header + 5
    expect(rows[0].length).toBe(3);
  });

  it('confirms read-back contains pasted values', () => {
    const read = 'URL: x\nKovács János\nNagy Anna\nmore text';
    expect(readBackContains(read, ['Kovács János', 'Nagy Anna'])).toBe(true);
    expect(readBackContains(read, ['Nobody', 'Missing'])).toBe(false);
  });
});
