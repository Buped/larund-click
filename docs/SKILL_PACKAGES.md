# Skill Packages

Skill packages prepare marketplace-ready local import/export.

Package fields:

- manifest version
- package id
- name/version/publisher
- skills
- optional workflow templates
- required connections and MCP servers
- requested permissions
- checksum
- signature placeholder

Imports are disabled by default:

- imported skills are stored with `source: imported`
- imported skills are disabled until enabled by the user
- dangerous requested permissions are surfaced
- checksum mismatch rejects the package

Signature verification is currently a placeholder and always reports not verified.
