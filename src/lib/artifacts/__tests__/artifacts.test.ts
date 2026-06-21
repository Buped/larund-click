import { describe, expect, it } from 'vitest';
import { assertSafeRelativePath, sanitizeFileName, sanitizePathPart } from '../paths';
import { detectPrimaryArtifactKind, planArtifact } from '../planner';
import { ARTIFACT_TEMPLATES, selectArtifactTemplate } from '../templates';
import { buildInvoiceModel, buildTestInvoiceModel, computeInvoiceTotals } from '../invoice';
import { ARTIFACT_THEMES, defaultThemeForKind, themeToBrand } from '../design/themes';

describe('artifact paths', () => {
  it('sanitizes path parts and filenames', () => {
    expect(sanitizePathPart('../Larund riport')).toBe('Larund-riport');
    expect(sanitizeFileName('számla / test.pdf', 'pdf')).toBe('szamla-test.pdf');
  });

  it('rejects traversal paths', () => {
    expect(() => assertSafeRelativePath('../report.pdf')).toThrow(/unsafe/);
    expect(() => assertSafeRelativePath('output/report.pdf')).not.toThrow();
  });
});

describe('artifact planning', () => {
  it('detects requested primary formats', () => {
    expect(detectPrimaryArtifactKind('Készíts prezentációt')).toBe('pptx');
    expect(detectPrimaryArtifactKind('Szerkeszthető Word dokumentum kell')).toBe('docx');
    expect(detectPrimaryArtifactKind('Szép PDF riport')).toBe('pdf');
  });

  it('selects invoice and deck templates', () => {
    expect(selectArtifactTemplate('pdf', 'teszt számla PDF').category).toBe('invoice');
    expect(selectArtifactTemplate('pptx', 'pitch deck').category).toBe('deck');
  });

  it('creates a concrete plan with expected text hints', () => {
    const plan = planArtifact('Készíts PDF riportot Larund Click témában', []);
    expect(plan.primaryKind).toBe('pdf');
    expect(plan.expectedText).toContain('Larund Click');
    expect(plan.templateId).toBeTruthy();
  });
});

describe('artifact templates', () => {
  it('ships the requested starter template set', () => {
    expect(ARTIFACT_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    expect(ARTIFACT_TEMPLATES.map((template) => template.id)).toContain('premium-dark-report');
    expect(ARTIFACT_TEMPLATES.map((template) => template.id)).toContain('pitch-deck-dark');
  });
});

describe('document design system', () => {
  it('exposes the requested starter themes', () => {
    for (const id of ['premiumDark', 'corporateBlue', 'modernLight', 'invoiceBlue', 'invoiceGreen', 'startupPitchDark', 'minimalEditorial', 'technicalSpec'] as const) {
      expect(ARTIFACT_THEMES[id]).toBeTruthy();
    }
  });

  it('maps document kinds to sensible default themes', () => {
    expect(defaultThemeForKind('invoice')).toBe('invoiceBlue');
    expect(defaultThemeForKind('presentation')).toBe('startupPitchDark');
    expect(defaultThemeForKind('generic')).toBe('modernLight');
  });

  it('resolves a theme into a hex brand palette for the renderer', () => {
    const brand = themeToBrand('invoiceBlue', 'Larund');
    expect(brand.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(brand.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('invoice model', () => {
  it('computes net / vat / gross from line items', () => {
    const totals = computeInvoiceTotals(
      [
        { description: 'A', quantity: 2, unitPrice: 1000 },
        { description: 'B', quantity: 1, unitPrice: 500 },
      ],
      27,
    );
    expect(totals.net).toBe(2500);
    expect(totals.vat).toBe(675);
    expect(totals.gross).toBe(3175);
  });

  it('builds a render-ready test invoice with accented anchors and a brand palette', () => {
    const model = buildTestInvoiceModel();
    expect(model.kind).toBe('invoice');
    expect(model.testMode).toBe(true);
    expect(model.templateId).toBe('invoice-blue-premium');
    expect(model.brand?.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(model.lineItems.length).toBeGreaterThanOrEqual(1);
    // accented Hungarian content that verification/design_lint will look for
    expect(model.issuer.name).toContain('Kft');
    expect(model.notes ?? '').toContain('teszt számla');
    expect(model.totals.gross).toBe(model.totals.net + model.totals.vat);
  });

  it('defaults vat rate and payment method', () => {
    const model = buildInvoiceModel({
      issuer: { name: 'X' },
      customer: { name: 'Y' },
      lineItems: [{ description: 'Z', quantity: 1, unitPrice: 100 }],
    });
    expect(model.vatRate).toBe(27);
    expect(model.paymentMethod).toBeTruthy();
    expect(model.currency).toBe('HUF');
  });
});
