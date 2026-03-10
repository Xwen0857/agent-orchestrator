import { handleAmendSubcommand } from "../orchestrate-amend-command.js";
import { handleIntakeSubcommand } from "../orchestrate-intake-command.js";
import { renderTaskAmendmentMirror } from "../orchestrate-task-amendment.js";
import { describe, expect, it, vi } from "vitest";

describe("legacy orchestrate command handlers", () => {
  it("redirects intake into the active session draft", async () => {
    let writtenSummary = "";
    const emitEvent = vi.fn(async () => {});

    const text = await handleIntakeSubcommand({
      payload: "Build websocket tool with tests",
      ctx: {
        channel: "cli",
        senderId: "tester",
        sessionKey: "sess_fallback",
        commandTargetSessionKey: "sess_target",
      },
      readOrchestrateSession: vi.fn(async () => null),
      writeOrchestrateSession: vi.fn(async (next) => {
        writtenSummary = next.draft.task_goal;
      }),
      emitEvent,
      renderOrchestrateHelp: () => "help text",
    });

    expect(writtenSummary).toContain("Build websocket tool");
    expect(text).toContain("legacy helper");
    expect(text).toContain("sess_target");
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });

  it("persists amendments through the handler", async () => {
    const textWrites: Array<{ path: string; payload: string }> = [];
    const jsonWrites: Array<{ path: string; payload: unknown }> = [];
    const emitEvent = vi.fn(async () => {});
    const runWhitelistedScript = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const readJsonOrDefault = async <T,>(_target: string, fallback: T): Promise<T> =>
      ({
        ...(fallback as Record<string, unknown>),
        id: "task_demo",
        requirement_amendment_count: 2,
      } as T);

    const text = await handleAmendSubcommand({
      payload: "task_demo add websocket smoke test",
      repoRoot: "/repo",
      taskFoldersRoot: "/repo/tasks",
      io: {
        fileExists: vi.fn(
          async (targetPath: string) =>
            targetPath.endsWith("/meta.json") || targetPath.endsWith("/amendments.md"),
        ),
        readJsonOrDefault,
        readText: vi.fn(async () => "# Amendments\n"),
        writeJsonAtomic: vi.fn(async (targetPath: string, payload: unknown) => {
          jsonWrites.push({ path: targetPath, payload });
        }),
        writeTextAtomic: vi.fn(async (targetPath: string, payload: string) => {
          textWrites.push({ path: targetPath, payload });
        }),
      },
      runWhitelistedScript,
      emitEvent,
    });

    expect(text).toContain("amendment accepted");
    expect(runWhitelistedScript).toHaveBeenCalledTimes(1);
    expect(jsonWrites).toHaveLength(1);
    expect(jsonWrites[0]?.path).toBe("/repo/tasks/task_demo/meta.json");
    expect(jsonWrites[0]?.payload).toMatchObject({
      latest_requirement_amendment: "add websocket smoke test",
      requirement_amendment_count: 3,
    });
    expect(textWrites).toHaveLength(1);
    expect(textWrites[0]?.path).toBe("/repo/tasks/task_demo/amendments.md");
    expect(textWrites[0]?.payload).toContain("add websocket smoke test");
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });

  it("renders legacy amendment mirror from authority entries", () => {
    const rendered = renderTaskAmendmentMirror({
      currentText: "# Amendments\n",
      amendedAt: "2026-03-10T00:00:00Z",
      amendment: "add websocket smoke test",
    });

    expect(rendered).toContain("# Amendments");
    expect(rendered).toContain("- 2026-03-10T00:00:00Z add websocket smoke test");
  });
});
