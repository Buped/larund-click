---
name: artifact-invoice
description: "Create professional, designed local invoice PDFs/DOCX files while avoiding invented legal-critical invoice data."
allowed_tools: ["artifact.plan", "artifact.render_pdf", "artifact.render_docx", "artifact.verify", "artifact.design_lint", "artifact.preview", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "szamla számla invoice dijbekero díjbekérő fizetesi bizonylat fizetési bizonylat arajanlat árajánlat"
---

# Artifact Invoice
Use this skill for invoices, test invoices, fee requests, receipts, and invoice-like offers.
Invoices are **always designed by default** — never emit a plain text-in-PDF invoice.

## Workflow
1. Build a structured `InvoiceArtifactModel` (`kind: "invoice"`): `invoiceNumber`, `issuer`,
   `customer`, `issueDate`, optional `fulfillmentDate`/`dueDate`/`paymentMethod`, `currency`,
   `vatRate`, `lineItems[]` (description, quantity, unit, unitPrice), and `testMode`.
   Prefer the `buildInvoiceModel` / `buildTestInvoiceModel` helpers so totals and the
   theme-derived `brand` palette are filled in.
2. Render with `artifact.render_pdf` — the model's `kind: "invoice"` routes it to the
   premium invoice renderer (`invoice-blue-premium`), which embeds a real font so
   Hungarian accents render correctly.
3. `artifact.verify` the output (accent anchors `Számla`, `Kibocsátó`, `Vevő`,
   `Fizetendő`, `ÁFA` are checked automatically for invoices).
4. `artifact.design_lint` the output and pass the model — completion is blocked unless
   `status` is `pass`/`warn`. If it fails (broken accents, empty layout, missing totals),
   fix the model and regenerate.

## Action shapes (exact JSON)
{"action":"artifact.render_pdf","title":"<title>","output_name":"<optional.pdf>","model":{"kind":"invoice","language":"hu","testMode":true,"invoiceNumber":"<no>","currency":"HUF","vatRate":27,"issuer":{"name":"<issuer>","taxId":"<tax>"},"customer":{"name":"<customer>"},"issueDate":"<YYYY-MM-DD>","lineItems":[{"description":"<item>","quantity":1,"unit":"db","unitPrice":0}]}}
{"action":"artifact.design_lint","path":"<path>","kind":"invoice","model":{"kind":"invoice"}}

## Rules
1. If real invoice data is missing, ask for it or clearly mark the output as `TESZT/MINTA` (`testMode: true`).
2. Never invent legally critical issuer, tax number, bank, VAT, or invoice number data for a real invoice.
3. Always include line items, VAT/tax, net subtotal, gross total, payment terms, and issuer/client blocks.
4. The invoice template — not free text — owns the layout: brand header, issuer/customer
   columns, dates strip, zebra line-item table, highlighted amount due, and a footer.
5. Verify invoice number or test marker, issuer/client, and total amount when provided.
