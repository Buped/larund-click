# MCP Hub

MCP architecture:

- Larund is the MCP Host.
- Each configured server is represented by an MCP client adapter.
- Servers expose tools, resources, and prompts.
- Larund discovers tool metadata and stores durable snapshots before use.

Security behavior:

- untrusted server tools default disabled
- tool metadata is hashed
- metadata changes reset approval
- critical scanner flags keep tools pending until explicitly reviewed
- tool calls go through risk policy, approval, audit, and evidence

The current adapter is `MockMcpClient`. It exercises the same host/client interface expected from a real SDK integration.

UI: Coworker Core -> MCP Hub.
