import { Command } from "commander";
import { expect, test } from "vitest";
import { addAuthCommand } from "./auth-command.js";

test("auth preparation and login are explicit and failures propagate", async () => {
  const calls: string[] = [];
  const program = new Command().exitOverride();
  addAuthCommand(
    program,
    {
      prepare: (binary, directory) => {
        calls.push(`${binary}:${directory ?? "default"}`);
        return Promise.resolve();
      },
      login: () => Promise.reject(new Error("Subscription login required")),
      status: () => Promise.resolve({ ready: false }),
    },
    (text) => {
      calls.push(text);
    },
  );
  await program.parseAsync(
    [
      "auth",
      "prepare",
      "--broker",
      "/local/broker",
      "--auth-directory",
      "/private/auth",
    ],
    { from: "user" },
  );
  expect(calls[0]).toBe("/local/broker:/private/auth");
  await expect(
    program.parseAsync(["auth", "login"], { from: "user" }),
  ).rejects.toThrow("Subscription login required");
});
