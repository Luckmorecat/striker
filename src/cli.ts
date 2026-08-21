#!/usr/bin/env node
/// <reference types="node" />

import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseStrikerPlan } from "./adapters/striker-plan/plan-parser.js";
import { runCli } from "./cli/program.js";
import { createPublicSkillInstaller } from "./skills/public-skill-installer.js";

const cwd = process.cwd();

process.exitCode = await runCli(process.argv.slice(2), {
  cwd,
  planValidator: {
    validate: async (source) => {
      const plan = await parseStrikerPlan(path.resolve(cwd, source));
      return { taskCount: plan.tasks.length };
    },
  },
  skillInstaller: createPublicSkillInstaller(
    fileURLToPath(new URL("../skills", import.meta.url)),
  ),
  stderr: process.stderr,
  stdout: process.stdout,
});
