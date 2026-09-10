import { expect, it } from "vitest";
import { prepareImage } from "./prepare-image.js";
import { loadBaseline } from "./baseline.js";

it("diagnoses an inaccessible Docker daemon without building or falling back", async () => {
  await expect(
    prepareImage({
      docker: () => Promise.reject(new Error("permission denied")),
    }),
  ).rejects.toThrow(/Docker.*permission denied/);
});

it("builds only the packaged context and reuses a validated immutable cached image", async () => {
  const calls: (readonly string[])[] = [];
  let built = false;
  const imageId = `sha256:${"a".repeat(64)}`;
  const docker = async (args: readonly string[]) => {
    calls.push(args);
    if (args[0] === "image") {
      if (!built) throw new Error("No such image");
      return JSON.stringify([
        {
          Id: imageId,
          Os: "linux",
          Config: {
            Labels: { "org.striker.baseline": (await loadBaseline()).identity },
          },
        },
      ]);
    }
    if (args[0] === "build") built = true;
    return "";
  };
  expect(await prepareImage({ docker })).toMatchObject({ imageId });
  expect(await prepareImage({ docker })).toMatchObject({ imageId });
  expect(calls.filter((args) => args[0] === "build")).toHaveLength(1);
  expect(calls.find((args) => args[0] === "build")?.at(-1)).toBe(
    (await loadBaseline()).root,
  );
  expect(calls.some((args) => args.includes("--pull=never"))).toBe(true);
});

it("never builds or pulls a missing custom image", async () => {
  const calls: string[] = [];
  await expect(
    prepareImage({
      image: "custom:missing",
      docker: (args) => {
        calls.push(args[0] ?? "");
        return args[0] === "info"
          ? Promise.resolve("")
          : Promise.reject(new Error("No such image"));
      },
    }),
  ).rejects.toThrow(/Build\/load it locally first/);
  expect(calls).toEqual(["info", "image"]);
});

it.each(["foreign baseline", "implicit volume"])(
  "refuses %s before executing image code",
  async (violation) => {
    const baseline = await loadBaseline();
    const calls: string[] = [];
    await expect(
      prepareImage({
        docker: (args) => {
          calls.push(args[0] ?? "");
          return Promise.resolve(
            args[0] === "info"
              ? ""
              : JSON.stringify([
                  {
                    Id: `sha256:${"a".repeat(64)}`,
                    Os: "linux",
                    Config: {
                      Labels: {
                        "org.striker.baseline":
                          violation === "foreign baseline"
                            ? "wrong"
                            : baseline.identity,
                      },
                      Volumes:
                        violation === "implicit volume"
                          ? { "/unexpected": {} }
                          : null,
                    },
                  },
                ]),
          );
        },
      }),
    ).rejects.toThrow(violation === "foreign baseline" ? /derive/ : /volumes/);
    expect(calls).toEqual(["info", "image"]);
  },
);

it("reports build and toolchain failures without certifying an image", async () => {
  await expect(
    prepareImage({
      docker: (args) => {
        if (args[0] === "image")
          return Promise.reject(new Error("No such image"));
        if (args[0] === "build")
          return Promise.reject(new Error("network unavailable"));
        return Promise.resolve("");
      },
    }),
  ).rejects.toThrow(/build failed.*network unavailable/);
  const baseline = await loadBaseline();
  await expect(
    prepareImage({
      docker: (args) => {
        if (args[0] === "image")
          return Promise.resolve(
            JSON.stringify([
              {
                Id: `sha256:${"a".repeat(64)}`,
                Os: "linux",
                Config: {
                  Labels: { "org.striker.baseline": baseline.identity },
                },
              },
            ]),
          );
        if (args[0] === "run") return Promise.reject(new Error("pnpm missing"));
        return Promise.resolve("");
      },
    }),
  ).rejects.toThrow(/toolchain validation failed.*pnpm missing/);
});
