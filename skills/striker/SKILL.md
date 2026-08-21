---
name: striker
description:
  Use only when the developer explicitly invokes $striker to operate the
  project-local Striker task dispatcher.
metadata:
  opencode/autoinvoke: "false"
---

# Striker

Proceed only when the developer explicitly invoked `$striker`.

Resolve the target Git root, then use its `node_modules/.bin/striker` binary.
Stop when the binary is absent. A global installation or package runner is not
the project-local Striker version.

Translate the developer's request into one CLI operation. When its syntax is
unclear, inspect the local binary's `--help` output and the relevant command's
help. Keep the command reference out of this skill so it stays in sync with the
installed binary.

Run the requested operation and return its output. On failure or pause, include
the exit status and Striker's recovery instructions. Pass answers through stdin
unless the developer supplied an answer file.
