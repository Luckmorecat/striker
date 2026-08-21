import { writeFile } from "node:fs/promises";

import { format } from "prettier";

import { planManifestJsonSchema } from "./dist/adapters/striker-plan/plan-manifest.js";
import { projectConfigJsonSchema } from "./dist/config/project-config.js";

await writeFile(
  new globalThis.URL("./plan.schema.json", import.meta.url),
  await format(JSON.stringify(planManifestJsonSchema), { parser: "json" }),
);

await writeFile(
  new globalThis.URL("./schema.json", import.meta.url),
  await format(JSON.stringify(projectConfigJsonSchema), { parser: "json" }),
);
