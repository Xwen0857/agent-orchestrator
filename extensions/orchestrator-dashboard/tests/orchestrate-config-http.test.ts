import { handleConfigHttpRequest } from "../orchestrate-config-http.js";
import { describe, expect, it, vi } from "vitest";

function createRes() {
  return {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn(),
  };
}

describe("orchestrate config http handler", () => {
  it("serves current config endpoint", async () => {
    const res = createRes();
    const sendJson = vi.fn();

    const handled = await handleConfigHttpRequest({
      req: { method: "GET" } as never,
      res: res as never,
      subPath: "/configs/current",
      repoRoot: "/repo",
      io: {
        fileExists: vi.fn(async () => false),
        readText: vi.fn(async () => ""),
        writeTextAtomic: vi.fn(async () => {}),
        writeJsonAtomic: vi.fn(async () => {}),
        readNdjson: vi.fn(async () => []),
      },
      pathsByName: {
        plannerCurrent: "/repo/current",
        plannerProperties: "/repo/properties",
        auditPolicy: "/repo/audit.json",
        auditHistory: "/repo/history.ndjson",
        snapshotScript: "/repo/snapshot.sh",
        rollbackScript: "/repo/rollback.sh",
      },
      helpers: {
        loadCurrentConfig: vi.fn(async () => ({ plannerCurrent: { version: 1 } })),
        validateDraft: vi.fn(async () => ({ valid: true, requiresApproval: false, riskLevel: "LOW", changedKeys: {} })),
        acquireLock: vi.fn(async () => true),
        releaseLock: vi.fn(async () => {}),
        emitEvent: vi.fn(async () => {}),
        runScript: vi.fn(async () => ({ stdout: "", stderr: "" })),
        updatePlainKvText: vi.fn((s) => s),
        updateListKvText: vi.fn((s) => s),
      },
      parseJsonBody: vi.fn(async () => ({})),
      sendJson,
    });

    expect(handled).toBe(true);
    expect(sendJson).toHaveBeenCalledWith(res, 200, { plannerCurrent: { version: 1 } });
  });

  it("commits a valid draft and emits commit event", async () => {
    const res = createRes();
    const sendJson = vi.fn();
    const emitEvent = vi.fn(async () => {});
    const writeTextAtomic = vi.fn(async () => {});
    const writeJsonAtomic = vi.fn(async () => {});

    const handled = await handleConfigHttpRequest({
      req: { method: "POST" } as never,
      res: res as never,
      subPath: "/configs/commit",
      repoRoot: "/repo",
      io: {
        fileExists: vi.fn(async (targetPath: string) => targetPath.endsWith("snapshot.sh")),
        readText: vi.fn(async () => "version: 1\n"),
        writeTextAtomic,
        writeJsonAtomic,
        readNdjson: vi.fn(async () => []),
      },
      pathsByName: {
        plannerCurrent: "/repo/current",
        plannerProperties: "/repo/properties",
        auditPolicy: "/repo/audit.json",
        auditHistory: "/repo/history.ndjson",
        snapshotScript: "/repo/snapshot.sh",
        rollbackScript: "/repo/rollback.sh",
      },
      helpers: {
        loadCurrentConfig: vi.fn(async () => ({})),
        validateDraft: vi.fn(async () => ({
          valid: true,
          requiresApproval: false,
          riskLevel: "LOW",
          changedKeys: { plannerCurrent: ["version"] },
        })),
        acquireLock: vi.fn(async () => true),
        releaseLock: vi.fn(async () => {}),
        emitEvent,
        runScript: vi.fn(async () => ({ stdout: "snapshot ok", stderr: "" })),
        updatePlainKvText: vi.fn(() => "version: 2\n"),
        updateListKvText: vi.fn(() => "- worker_timeout_minutes: 45\n"),
      },
      parseJsonBody: vi.fn(async () => ({
        reason: "test commit",
        draft: {
          plannerCurrent: { version: 2 },
          plannerProperties: { worker_timeout_minutes: 45 },
          auditPolicy: { rules: [] },
        },
      })),
      sendJson,
    });

    expect(handled).toBe(true);
    expect(writeTextAtomic).toHaveBeenCalledTimes(2);
    expect(writeJsonAtomic).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith(
      "config.committed",
      expect.objectContaining({ committed: true, riskLevel: "LOW" }),
      expect.anything(),
    );
    expect(sendJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({ committed: true, riskLevel: "LOW" }),
    );
  });
});
