# Local Artifact Storage

Generated artifacts are stored under the platform data directory:

- Windows: `%APPDATA%/Larund/artifacts`
- macOS: `~/Library/Application Support/Larund/artifacts`
- Linux: `~/.local/share/Larund/artifacts`

The MVP layout is:

```txt
artifacts/
  local/
    task-{timestamp}/
      artifact-{timestamp}-{title}/
        artifact.json
        source/
          document.json
          deck.json
        output/
          report.pdf
          report.docx
          deck.pptx
          report.html
        preview/
          thumbnail.png
        logs/
```

Use `artifact.list` to discover manifests, `artifact.open` to open an output with the OS default app, and `artifact.copy_to` to save a copy into a user-selected folder. Copying refuses to overwrite an existing target.
