---
name: document-accounting
description: "Read referenced invoices, record them into a local xlsx/csv or Google Sheet, and move processed files between bookkeeping folders."
allowed_tools: ["document.read", "document.read_many", "folder.scan", "folder.read_relevant", "sheet.write", "sheet.read", "file.exists", "file.list", "file.read", "file.mkdir", "file.move", "connection.call", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "invoice számla accounting könyvel könyvelés xlsx google sheet"
---

# Document Accounting
1. Read all referenced invoice files first with `document.read`/`document.read_many`; for folders use `folder.scan` then `folder.read_relevant`.
2. Extract invoice number, issuer, customer, date, item, net, gross/total and currency.
3. If target is local Excel, use `sheet.write` to `.xlsx` and `sheet.read` back.
4. If target is Google Sheets, use the Google connection and read values back.
5. If the workflow moves files between folders (e.g. Nem_lekönyvelt → Folyamatban → Lekönyvelt), move them yourself with `file.move` (create the destination with `file.mkdir` first if needed). Moving local files is something you can do — never ask the user to move them by hand. Only `ask_user` if a path is genuinely ambiguous or a file is missing.
6. Complete only when source files read + output rows verified + moved files confirmed (source gone, destination exists).
