import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 180_000,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\n${result.error ?? ""}\n${result.stderr}\n${result.stdout}`,
  );
  return result.stdout;
}

async function writePlan(project) {
  const plan = path.join(project, "plan with spaces");
  await mkdir(plan);
  const files = {
    "plan.json": JSON.stringify({
      version: 3,
      taskSource: "striker-plan",
      assumptions: {},
      defaults: {},
      outcomeRoutes: [],
      tasks: ["01-task.md"],
    }),
    "spine.md": "# Approved smoke plan\n",
    "map.md": "# Smoke map\n",
    "01-task.md":
      "# Smoke task\n\n## Build\n\nCreate a greeting.\n\n## Paths\n\n- greeting.txt\n\n## Test contract\n\n- Check the greeting through the CLI.\n\n## Verify\n\n```sh\ntrue\n```\n",
  };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(plan, name), content);
  }
  await writeFile(
    path.join(project, "striker.config.json"),
    JSON.stringify({ taskSource: "striker-plan" }),
  );
  return plan;
}

async function verifyInstalled(prefix, project, toolsBin, git) {
  await mkdir(project);
  await mkdir(toolsBin);
  await symlink(globalThis.process.execPath, path.join(toolsBin, "node"));
  await symlink(git, path.join(toolsBin, "git"));
  const env = { ...globalThis.process.env, PATH: `${prefix}/bin:${toolsBin}` };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  const options = { cwd: project, env };
  run("git", ["init", "--quiet"], options);
  assert.match(run("striker", ["--help"], options), /Usage: striker/u);
  const plan = await writePlan(project);
  assert.match(run("striker", ["plan", "validate", plan], options), /valid/iu);
  assert.match(
    run("striker", ["skills", "install", "--harness", "codex"], options),
    /Installed public Striker skills/u,
  );
  const installedSkills = path.join(project, ".agents/skills");
  for (const name of [
    "striker",
    "striker-shape",
    "striker-spec",
    "striker-plan",
    "striker-preparation",
  ]) {
    await access(path.join(installedSkills, name, "SKILL.md"));
  }
  const reference = await readFile(
    path.join(installedSkills, "striker/CLI.md"),
    "utf8",
  );
  const procedure = /```sh\n([\s\S]*?)```/u.exec(reference)?.[1];
  assert.ok(
    procedure,
    "installed skills must include the CLI selection procedure",
  );
  assert.match(
    run(
      "/bin/sh",
      ["-c", `${procedure}\nrun_striker plan validate "$1"`, "smoke", plan],
      options,
    ),
    /valid/iu,
  );
  assert.match(
    run("striker", ["skills", "install", "--harness", "codex"], options),
    /already installed/u,
  );
  await assert.rejects(access(path.join(project, "node_modules")), {
    code: "ENOENT",
  });
  await assert.rejects(access(path.join(project, "package.json")), {
    code: "ENOENT",
  });
}

async function main() {
  const source = fileURLToPath(new URL(".", import.meta.url));
  const temporary = await mkdtemp(path.join(tmpdir(), "striker-global-"));
  try {
    globalThis.console.log(
      "Checking executable selection and packing Striker...",
    );
    run("pnpm", ["exec", "vitest", "run", "src/skills/cli-selection.test.ts"], {
      cwd: source,
    });
    run("pnpm", ["pack", "--pack-destination", temporary], { cwd: source });
    const tarballs = (await readdir(temporary)).filter((name) =>
      name.endsWith(".tgz"),
    );
    assert.equal(tarballs.length, 1);
    const prefix = path.join(temporary, "global");
    const git = run("/bin/sh", ["-c", "command -v git"]).trim();
    globalThis.console.log(
      "Installing the tarball and runtime dependencies into a temporary global prefix...",
    );
    run(
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        prefix,
        "--cache",
        path.join(temporary, "cache"),
        "--no-audit",
        "--no-fund",
        path.join(temporary, tarballs[0]),
      ],
      { cwd: temporary },
    );
    await verifyInstalled(
      prefix,
      path.join(temporary, "consumer"),
      path.join(temporary, "tools"),
      git,
    );
    globalThis.console.log(
      "Global installation passed: help, plan validation, public skills, and no consumer dependency.",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();
