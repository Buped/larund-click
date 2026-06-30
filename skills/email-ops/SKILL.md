---
name: "email-ops"
description: "Review, organize, label, draft replies, and optionally send Gmail messages with draft-first approval."
version: "1.0.0"
categories: ["office-results", "email", "google-workspace"]
trigger: "email e-mail gmail inbox triage reply draft valasz levelek rendszerezes atnezes"
trigger_phrases: ["email triage", "gmail reply draft", "emailek atnezese", "levelek rendszerezese", "valasz piszkozat"]
when_to_use: ["Use when the user asks to inspect, organize, summarize, label, draft, reply to, or send email."]
when_not_to_use: ["Do not use for generic document writing unless the output is an email draft or send."]
allowed_tools: ["connection.call", "email.compose", "document.read", "document.read_many", "approval.request", "ask_user"]
requires_connections: ["google-workspace"]
risk: "external_send"
verification_checklist: ["Search/read the real Gmail messages or thread first.", "Create an editable draft before send.", "Require approval before google.gmail.send.", "Read back draft/message status or labels after changes."]
supports_automation: true
supports_manual_run: true
---

# Email Ops

Email work is draft-first and API-first.

## Workflow
1. Search Gmail with a precise query and read every relevant message or thread.
2. Classify urgency, sender, topic, required response, and suggested label/archive action.
3. Create labels when needed, then modify labels only after the target message ids are known.
4. For replies, create a reply draft in the original thread; never create a detached draft when a thread id is available.
5. Use `email.compose` for user-facing editable drafts. It may create a real Gmail draft when connected.
6. Send only when explicitly requested and only after approval.

## API-first email standard — a local txt is never an email
- Drafting/composing/sending an email is a Gmail connection task, NOT a browser task and NOT a local file task. A recipient's `@gmail.com` address does NOT mean "open gmail.com in the browser".
- Read the source first. If a Google Doc/Sheet/Slides/Drive file is attached or @mentioned, its contents were already read via the Google API (see the referenced-input read-backs). Summarize from that real content — never from the file's title. `browser.open` is NOT required when the API read already succeeded.
- Always draft with `email.compose {to, subject, body, cc?, bcc?, sources}`. This ONE call surfaces an EDITABLE, formatted email card in the chat. When Gmail is connected it also creates the real Gmail draft (`[gmail_draft_created]`); when not, it returns `[local_draft]` with a one-click "Connect Gmail" button on the card.
- The `email.compose` card IS the deliverable. After ONE successful `email.compose`, you are DONE: `task.complete`. If it returned `[local_draft]`, complete with a short note like "A piszkozat készen áll a kártyán — egy kattintással csatlakoztathatod a Gmailt és elküldheted." Do NOT loop with `ask_user` to "connect then say done"; the user connects and sends on the card.
- Do NOT call `google.gmail.create_draft` after `email.compose` — it already created the draft; a second call only duplicates. Only call `google.gmail.send` yourself if the user explicitly asked to send now (after approval); its SENT read-back is the only valid "sent" evidence.
- NEVER satisfy an email request with `doc.write_txt`/`doc.write_docx`/`file.write`. A local file is not a Gmail draft or a sent email.
- FORMAT THE EMAIL BEAUTIFULLY. The body renders as styled HTML, so write well-structured markdown, not a flat wall of text: a greeting line, short scannable paragraphs, **bold** for key points/numbers, `##` subheadings and `-` bullet lists where they help, a clear call-to-action, and a sign-off.

## Action shapes (exact JSON)
{"action":"email.compose","to":"<recipient>","cc":"<optional>","bcc":"<optional>","subject":"<subject>","body":"<body>","sources":[{"label":"<source doc>","fileId":"<optional>"}]}

## Verification
- Draft work requires draft id or email.compose evidence.
- Send work requires Gmail SENT read-back.
- Label/archive work requires a message/thread read-back with expected labels.
