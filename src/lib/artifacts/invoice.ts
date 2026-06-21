// Semantic invoice model + builders. The Rust premium invoice renderer
// (`invoice.rs`) consumes this shape via `artifact.render_pdf`.

import type { BrandTheme } from './types';
import { themeToBrand, type ArtifactThemeId } from './design/themes';

export interface InvoiceParty {
  name: string;
  addressLines?: string[];
  taxId?: string;
  email?: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  /** Optional explicit net; computed as quantity * unitPrice when omitted. */
  net?: number;
}

export interface InvoiceTotals {
  net: number;
  vat: number;
  gross: number;
}

export interface InvoiceArtifactModel {
  kind: 'invoice';
  language: 'hu' | 'en';
  testMode: boolean;
  title?: string;
  invoiceNumber: string;
  issuer: InvoiceParty;
  customer: InvoiceParty;
  issueDate: string;
  fulfillmentDate?: string;
  dueDate?: string;
  paymentMethod?: string;
  currency: 'HUF' | 'EUR' | 'USD';
  vatRate: number;
  lineItems: InvoiceLineItem[];
  totals: InvoiceTotals;
  notes?: string;
  themeId?: ArtifactThemeId;
  templateId?: string;
  brand?: BrandTheme;
}

export interface BuildInvoiceInput {
  invoiceNumber?: string;
  testMode?: boolean;
  language?: 'hu' | 'en';
  issuer: InvoiceParty;
  customer: InvoiceParty;
  issueDate?: string;
  fulfillmentDate?: string;
  dueDate?: string;
  paymentMethod?: string;
  currency?: 'HUF' | 'EUR' | 'USD';
  vatRate?: number;
  lineItems: InvoiceLineItem[];
  notes?: string;
  themeId?: ArtifactThemeId;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeInvoiceTotals(lineItems: InvoiceLineItem[], vatRate: number): InvoiceTotals {
  const net = round2(lineItems.reduce((sum, item) => sum + (item.net ?? item.quantity * item.unitPrice), 0));
  const vat = round2((net * vatRate) / 100);
  return { net, vat, gross: round2(net + vat) };
}

/** Build a complete, render-ready invoice model with a theme-derived brand palette. */
export function buildInvoiceModel(input: BuildInvoiceInput): InvoiceArtifactModel {
  const vatRate = input.vatRate ?? 27;
  const themeId = input.themeId ?? 'invoiceBlue';
  const invoiceNumber = input.invoiceNumber ?? `TESZT-${new Date().getFullYear()}-0001`;
  const lineItems = input.lineItems.map((item) => ({
    ...item,
    net: item.net ?? round2(item.quantity * item.unitPrice),
  }));
  return {
    kind: 'invoice',
    language: input.language ?? 'hu',
    testMode: input.testMode ?? false,
    title: `Számla ${invoiceNumber}`,
    invoiceNumber,
    issuer: input.issuer,
    customer: input.customer,
    issueDate: input.issueDate ?? new Date().toISOString().slice(0, 10),
    fulfillmentDate: input.fulfillmentDate,
    dueDate: input.dueDate,
    paymentMethod: input.paymentMethod ?? 'Átutalás',
    currency: input.currency ?? 'HUF',
    vatRate,
    lineItems,
    totals: computeInvoiceTotals(lineItems, vatRate),
    notes: input.notes,
    themeId,
    templateId: 'invoice-blue-premium',
    brand: themeToBrand(themeId),
  };
}

/**
 * Deterministic sample invoice for "Készíts egy teszt számla PDF dokumentumot!".
 * Exercises every accented label the verifier checks for.
 */
export function buildTestInvoiceModel(): InvoiceArtifactModel {
  return buildInvoiceModel({
    invoiceNumber: `TESZT-${new Date().getFullYear()}-0042`,
    testMode: true,
    language: 'hu',
    issuer: {
      name: 'Larund Click Kft.',
      addressLines: ['1051 Budapest, Példa utca 12.'],
      taxId: '12345678-2-41',
      email: 'szamlazas@larund.click',
    },
    customer: {
      name: 'Minta Ügyfél Zrt.',
      addressLines: ['1136 Budapest, Teszt körút 7.'],
      taxId: '87654321-2-42',
    },
    fulfillmentDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10),
    paymentMethod: 'Átutalás',
    currency: 'HUF',
    vatRate: 27,
    lineItems: [
      { description: 'Larund Click éves előfizetés', quantity: 1, unit: 'db', unitPrice: 120_000 },
      { description: 'Bevezetési és testreszabási díj', quantity: 2, unit: 'óra', unitPrice: 25_000 },
      { description: 'Prémium dokumentum sabloncsomag', quantity: 1, unit: 'db', unitPrice: 45_000 },
    ],
    notes: 'Ez egy automatikusan generált teszt számla, valós könyvelési értéke nincs.',
    themeId: 'invoiceBlue',
  });
}
