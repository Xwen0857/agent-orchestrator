import {
  createConfigService,
  parseListKv,
  parsePlainKv,
  updateListKvText,
  updatePlainKvText,
} from "../orchestrate-config-service.js";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("orchestrate config service", () => {
  it("parses and updates key-value config text", () => {
    expect(parsePlainKv("version: 1\nstate_machine: strict\n")).toMatchObject({
      version: 1,
      state_machine: "strict",
    });
    expect(parseListKv("- worker_timeout_minutes: 30\n")).toMatchObject({
      worker_timeout_minutes: 30,
    });

    expect(updatePlainKvText("version: 1\n", { version: 2, next: true })).toContain("version: 2");
    expect(updatePlainKvText("version: 1\n", { version: 2, next: true })).toContain("next: true");
    expect(updateListKvText("- worker_timeout_minutes: 30\n", { worker_timeout_minutes: 45 })).toContain(
      "- worker_timeout_minutes: 45",
    );
  });

  it("loads config and validates draft content", async () => {
    const service = createConfigService({
      paths: {
        plannerCurrent: "/repo/current",
        plannerProperties: "/repo/properties",
        auditPolicy: "/repo/audit.json",
      },
      lockPath: "/tmp/agent-orchestrator-config.lock",
      io: {
        readText: async (targetPath: string) => {
          if (targetPath.endsWith("/current")) {
            return [
              "version: 1",
              "state_machine: strict",
              "transition_script: scripts/transition.sh",
              "audit_gate_script: scripts/audit.sh",
            ].join("\n");
          }
          return "- worker_timeout_minutes: 30\n";
        },
        readJsonOrDefault: async <T>(_targetPath: string, _fallback: T) => ({ rules: [] }) as T,
      },
    });

    const current = await service.loadCurrentConfig();
    expect(current.plannerCurrent).toMatchObject({ version: 1 });

    const validation = await service.validateDraft({
      plannerCurrent: {
        version: 2,
        state_machine: "strict",
        transition_script: "scripts/transition.sh",
        audit_gate_script: "scripts/audit.sh",
      },
      plannerProperties: {
        worker_timeout_minutes: 45,
      },
      auditPolicy: {
        rules: [],
      },
    });
    expect(validation.valid).toBe(true);
    expect(validation.riskLevel).toBe("MEDIUM");
  });

  it("acquires and releases the config lock", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "orchestrate-config-"));
    const lockPath = path.join(tempDir, ".commit.lock");
    const service = createConfigService({
      paths: {
        plannerCurrent: "/unused/current",
        plannerProperties: "/unused/properties",
        auditPolicy: "/unused/audit.json",
      },
      lockPath,
      io: {
        readText: async () => "",
        readJsonOrDefault: async <T>(_targetPath: string, fallback: T) => fallback,
      },
    });

    await expect(service.acquireLock()).resolves.toBe(true);
    await expect(service.acquireLock()).resolves.toBe(false);
    expect((await readFile(lockPath, "utf8")).trim()).not.toBe("");
    await service.releaseLock();
    await expect(service.acquireLock()).resolves.toBe(true);
  });
});
