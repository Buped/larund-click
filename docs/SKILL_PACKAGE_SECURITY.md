# Skill Package Security

Skill packages can contain risky workflows. Larund treats them as untrusted local artifacts:

- checksum validation is mandatory
- signatures are modeled but not yet verified
- imported skills default disabled
- permissions are visible before install
- dangerous permissions include external send, destructive, credential access, and process execution
- package requirements list connections and MCP servers

No imported package runs automatically.
