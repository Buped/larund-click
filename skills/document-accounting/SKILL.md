---
name: document-accounting
description: "Read referenced invoices and create an accounting table in local xlsx/csv or Google Sheets."
allowed_tools: ["document.read", "document.read_many", "folder.scan", "folder.read_relevant", "sheet.write", "sheet.read", "connection.call", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "invoice számla accounting könyvel könyvelés xlsx google sheet"
---

# Document Accounting
1. Read all referenced invoice files first with `document.read`/`document.read_many`; for folders use `folder.scan` then `folder.read_relevant`.
2. Extract invoice number, issuer, customer, date, item, net, gross/total and currency.
3. If target is local Excel, use `sheet.write` to `.xlsx` and `sheet.read` back.
4. If target is Google Sheets, use the Google connection and read values back.
5. Complete only when source files read + output rows verified.
