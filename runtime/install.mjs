import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const baseline = JSON.parse(
  readFileSync(new globalThis.URL("./baseline.json", import.meta.url), "utf8"),
);
execFileSync(
  "npm",
  [
    "install",
    "--global",
    ...Object.entries(baseline.packages).map(
      ([name, version]) => `${name}@${version}`,
    ),
  ],
  { stdio: "inherit" },
);
