# Approval Inbox

The Approval Inbox persists sensitive action approvals outside the live chat bubble.

Approval requests include:

- action name
- risk category
- reason
- sanitized args summary
- task and automation run context when available
- expiry and resolution status

Inline chat approval still works. When the agent loop has user/task context, `PromptApprovalService` also creates a durable inbox item and notification, then resolves it after the inline decision.

The UI supports:

- Allow once
- Always allow, only when the risk is not external send or destructive
- Deny

External send and destructive actions should never default to always-allow. Future channel-based task resumption should poll or subscribe to these resolved approval records.
