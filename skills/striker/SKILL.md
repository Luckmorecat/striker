---
name: striker
description:
  Use only when the developer explicitly invokes $striker to run the
  project-local Striker CLI.
metadata:
  opencode/autoinvoke: "false"
---

# Striker

Proceed only when the developer explicitly invoked `$striker`.

Use the target project's installed `node_modules/.bin/striker`. Stop if that
binary is absent. Do not substitute a global installation.

Run only the command the user requested. This package version supports:

```text
striker plan validate <source>
striker skills install --harness codex|claude|opencode|pi
```

Report the command's exit status and error output when it fails.
