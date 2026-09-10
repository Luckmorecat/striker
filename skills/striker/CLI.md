# Select the Striker executable

Run this procedure from the target Git repository. It selects the repository's
local executable when present, otherwise `striker` on PATH. Keep the selected
command's output and exit status, including failures.

```sh
run_striker() (
  striker_project_root=$(git rev-parse --show-toplevel) || exit
  striker_local_bin="$striker_project_root/node_modules/.bin/striker"
  if [ -e "$striker_local_bin" ] || [ -L "$striker_local_bin" ]; then
    "$striker_local_bin" "$@"
  elif command -v striker >/dev/null 2>&1; then
    striker "$@"
  else
    printf '%s\n' "Striker is not installed. Run: npm install --global @useless_mob/striker" >&2
    exit 127
  fi
)
```

Call `run_striker` with the requested CLI arguments in the same shell. Resolve
relative arguments against the invocation directory. For skill installation,
start from the target Git root so the skill trees are installed there.
