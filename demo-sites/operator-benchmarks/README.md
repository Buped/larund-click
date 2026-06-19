# Larund Operator Benchmark — demo fixtures

Local **mock** sites + files for runtime / e2e validation of the no-mouse operator.
Nothing here is a real site or real data. Never point benchmarks at a live customer.

## Start the fixture server

```bash
node demo-sites/operator-benchmarks/serve.mjs        # http://localhost:8787
# or a custom port:
PORT=9000 node demo-sites/operator-benchmarks/serve.mjs
```

## Mock sites

| Route | Purpose | Used by |
| ----- | ------- | ------- |
| `/` | Hub linking to all fixtures | — |
| `/portal/login.html` | Login (`demo` / `demo123`) → `invoices.html` | B01 / P0-4 (browser.login) |
| `/portal/invoices.html` | Invoice list; latest links to the PDF | B01 / P0-4 |
| `/portal/invoice.pdf` | **FlateDecode-compressed** text PDF (real-world), download | browser.download, Tier-1 PDF text extraction |
| `/portal/invoice-scanned.pdf` | **Scanned** PDF (image-only, no text layer) | Tier-2 PDF vision fallback |
| `/portal/invoice.txt` | Text invoice, served as a download | browser.download |
| `/form/` | Contact form; submit shows "Form submitted successfully" | B17 / P0-5 (approval before submit) |
| `/upload/` | File input; shows the picked file name | browser_upload |
| `/table/` | HTML orders table | browser_extract_table |
| `/admin/` | Mock product admin with search + missing image/price/SEO | B08-style read/click/type |

## Local file fixtures (`files/`)

| File | Purpose |
| ---- | ------- |
| `files/meeting-notes.md` | Meeting note input for B05 / P0-2 |
| `files/downloads/invoice-vendorx-2026-06.txt` | Invoice (→ Könyvelés) for B14 / P0-3 |
| `files/downloads/contract-acme-2026.txt` | Contract (→ Szerződések) |
| `files/downloads/logo-sample.png` | Image (→ Assets) |
| `files/downloads/notes-misc.txt` | Ambiguous (→ Review) |

> Copy `files/downloads/` to a scratch folder before running P0-3 so you can re-run it.

## Browser capability targets

- **browser_read (selector):** read `#download-latest` on `/portal/invoices.html`, or
  `#result` on `/form/` and `/upload/`.
- **browser_download:** download `/portal/invoice.pdf` → verify the saved path.
- **browser_upload:** set `#fileInput` on `/upload/` → `#result` shows the file name.
- **browser_extract_table:** extract `#orders` on `/table/` → TSV with 4 order rows.

See `docs/BENCHMARK_AUDIT_REPORT.md` → "Runtime Smoke Test Plan" for the full steps and
PASS/PARTIAL/FAIL criteria, and `src/lib/benchmarks/p0Smoke.ts` for the runnable P0 set.
