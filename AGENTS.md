# Project rules

- Keep dependencies pointing from CLI and infrastructure toward core ports. Core
  must not import CLI, `acpx`, filesystem, process, Markdown, or harness code.
- Keep production files at 350 logical lines or fewer and test files at 500.
  Functions must stay within 80 logical lines, complexity 12, and nesting
  depth 4.
- Configuration schemas, permission mappings, transition rules, and completion
  rules each have one authoritative implementation.
- Avoid process-global state, dependency cycles, and implicit harness fallback.
- Run `pnpm check` before handing off work.
