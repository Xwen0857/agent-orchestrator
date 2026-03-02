import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildRuntimeConsistencyController } from "../orchestrate-runtime-consistency.js";

async function makeTempFile(dir: string, name: string, content: string): Promise<string> {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

describe("orchestrate-runtime-consistency", () => {
  it("returns ok when the expected signature matches", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrate-runtime-"));
    const sourcePath = await makeTempFile(dir, "source.txt", "alpha\n");
    const hash = createHash("sha256")
      .update("source")
      .update("\n")
      .update("alpha\n")
      .update("\n")
      .digest("hex");
    const signaturePath = await makeTempFile(
      dir,
      "runtime.signature.json",
      `${JSON.stringify({ signature: hash })}\n`,
    );

    const controller = buildRuntimeConsistencyController({
      runtimeSignatureFiles: [{ id: "source", candidates: [sourcePath] }],
      runtimeSignaturePath: signaturePath,
      consistencyMode: "enforce",
      readJsonOrDefault: async <T>(targetPath: string, fallback: T) => {
        const raw = await fs.readFile(targetPath, "utf8");
        return JSON.parse(raw) as T;
      },
      readText: async (targetPath: string) => fs.readFile(targetPath, "utf8"),
      emitEvent: vi.fn(async () => {}),
      mismatchCode: "ORCHESTRATOR_RUNTIME_MISMATCH",
    });

    const result = await controller.assertRuntimeConsistency("command");
    expect(result.runtimeConsistency).toBe("ok");
    expect(controller.getSnapshot().runtimeConsistency).toBe("ok");
  });

  it("returns mismatch in warn mode", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrate-runtime-"));
    const sourcePath = await makeTempFile(dir, "source.txt", "beta\n");
    const signaturePath = await makeTempFile(
      dir,
      "runtime.signature.json",
      `${JSON.stringify({ signature: "bad" })}\n`,
    );

    const controller = buildRuntimeConsistencyController({
      runtimeSignatureFiles: [{ id: "source", candidates: [sourcePath] }],
      runtimeSignaturePath: signaturePath,
      consistencyMode: "warn",
      readJsonOrDefault: async <T>(targetPath: string, fallback: T) => {
        const raw = await fs.readFile(targetPath, "utf8");
        return JSON.parse(raw) as T;
      },
      readText: async (targetPath: string) => fs.readFile(targetPath, "utf8"),
      emitEvent: vi.fn(async () => {}),
      mismatchCode: "ORCHESTRATOR_RUNTIME_MISMATCH",
    });

    const result = await controller.assertRuntimeConsistency("command");
    expect(result.runtimeConsistency).toBe("mismatch");
    expect(controller.getSnapshot().runtimeExpectedSignature).toBe("bad");
  });
});
