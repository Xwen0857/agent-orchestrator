import { handleKbSyncSubcommand } from "../orchestrate-kb-sync-command.js";
import { describe, expect, it, vi } from "vitest";

describe("orchestrate-kb-sync command handler", () => {
  it("returns usage for invalid payload", async () => {
    const text = await handleKbSyncSubcommand({
      payload: "",
      repoRoot: "/repo",
      paths: {
        taskFoldersRoot: "/repo/tasks",
        executionRuntime: "/repo/runtime.json",
      },
      io: {
        fileExists: vi.fn(),
        readJsonOrDefault: vi.fn(),
        writeJsonAtomic: vi.fn(),
      },
      runWhitelistedScript: vi.fn(),
      emitEvent: vi.fn(),
    });

    expect(text).toContain("usage: /orchestrate kb-sync");
  });

  it("updates auto import mode without invoking workspace import", async () => {
    const writes: Array<{ path: string; payload: unknown }> = [];
    const emitEvent = vi.fn(async () => {});
    const readJsonOrDefault = async <T>(targetPath: string, fallback: T): Promise<T> => {
      if (targetPath.endsWith("runtime.json")) {
        return {
          ...(fallback as Record<string, unknown>),
          kb_import: { auto_enabled: false },
        } as T;
      }
      return {
        ...(fallback as Record<string, unknown>),
        project_id: "prj_demo",
      } as T;
    };

    const text = await handleKbSyncSubcommand({
      payload: "task_demo auto-on",
      repoRoot: "/repo",
      paths: {
        taskFoldersRoot: "/repo/tasks",
        executionRuntime: "/repo/runtime.json",
      },
      io: {
        fileExists: vi.fn(async (targetPath: string) => targetPath.endsWith("/meta.json")),
        readJsonOrDefault,
        writeJsonAtomic: vi.fn(async (targetPath: string, payload: unknown) => {
          writes.push({ path: targetPath, payload });
        }),
      },
      runWhitelistedScript: vi.fn(),
      emitEvent,
    });

    expect(text).toBe("kb_import_auto_enabled: true");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/repo/runtime.json");
    expect(writes[0]?.payload).toMatchObject({
      kb_import: { auto_enabled: true },
    });
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });
});
