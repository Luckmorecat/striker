import { open, readFile } from "node:fs/promises";

import type { TaskIdentity } from "../../core/contracts.js";

const markerPattern = /<!-- striker:completed (\{[^\n]+\}) -->/g;

export async function readCompletionMarkers(
  logPath: string,
): Promise<readonly TaskIdentity[]> {
  const content = await readFile(logPath, "utf8");
  const identities: TaskIdentity[] = [];
  for (const match of content.matchAll(markerPattern)) {
    const value = JSON.parse(match[1] ?? "null") as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      typeof value.id === "string" &&
      "revision" in value &&
      typeof value.revision === "string"
    ) {
      identities.push({ id: value.id, revision: value.revision });
    }
  }
  return identities;
}

export async function appendCompletionMarker(
  logPath: string,
  identity: TaskIdentity,
): Promise<boolean> {
  const existing = await readCompletionMarkers(logPath);
  if (
    existing.some(
      (item) => item.id === identity.id && item.revision === identity.revision,
    )
  ) {
    return false;
  }
  const marker = `\n<!-- striker:completed ${JSON.stringify(identity)} -->\n`;
  const handle = await open(logPath, "a", 0o600);
  try {
    await handle.writeFile(marker);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}
