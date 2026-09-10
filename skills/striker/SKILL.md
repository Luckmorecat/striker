---
name: striker
description:
  Use only when the developer explicitly invokes $striker to operate the Striker
  task dispatcher.
metadata:
  opencode/autoinvoke: "false"
---

# Striker

Proceed only when the developer explicitly invoked `$striker`.

Before invoking the CLI, read [CLI.md](CLI.md) and use its executable-selection
procedure.

Translate the developer's request into one CLI operation. When its syntax is
unclear, inspect the selected binary's `--help` output and the relevant
command's help. Keep the command reference out of this skill so it stays in sync
with the installed binary.

Run the requested operation and return its output. On failure or pause, include
the exit status and Striker's recovery instructions. Pass answers through stdin
unless the developer supplied an answer file.
