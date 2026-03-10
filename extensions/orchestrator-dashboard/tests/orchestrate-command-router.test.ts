import { handleOrchestrateCommand } from "../orchestrate-command-router.js";
import { describe, expect, it, vi } from "vitest";

function createCommandHandlers() {
  return {
    handleSession: vi.fn(async () => "session ok"),
    handlePath: vi.fn(async () => "path ok"),
    handleStatus: vi.fn(async () => "status ok"),
    handleKbSync: vi.fn(async () => "kb ok"),
    handleIntake: vi.fn(async () => "intake ok"),
    handleAmend: vi.fn(async () => "amend ok"),
    handleResume: vi.fn(async () => "resume ok"),
    handleRun: vi.fn(async () => "run ok"),
  };
}

function createConsistency(overrides?: Partial<{
  startupError: string;
  assertRuntimeConsistency: () => Promise<{
    runtimeConsistency: "ok" | "mismatch";
    runtimeSignature: string;
    expected: string;
  }>;
}>) {
  return {
    startupConsistencyPromise: Promise.resolve(null),
    getStartupError: vi.fn(() => overrides?.startupError ?? ""),
    assertRuntimeConsistency:
      overrides?.assertRuntimeConsistency ??
      vi.fn(async () => {
        return {
          runtimeConsistency: "ok" as const,
          runtimeSignature: "sig",
          expected: "sig",
        };
      }),
    getSnapshot: vi.fn(() => ({
      runtimeConsistency: "ok" as const,
      runtimeSignature: "sig",
      runtimeExpectedSignature: "sig",
    })),
  };
}

describe("orchestrate command router", () => {
  it("lets help act as a side-effect-free recovery path", async () => {
    const handlers = createCommandHandlers();
    const result = await handleOrchestrateCommand({
      ctx: { args: "help" },
      commandHandlers: handlers,
      consistency: createConsistency({
        startupError: "startup mismatch",
        assertRuntimeConsistency: vi.fn(async () => {
          throw new Error("runtime mismatch");
        }),
      }),
      renderOrchestrateHelp: () => "help text",
    });

    expect(result.text).toContain("startup mismatch");
    expect(result.text).toContain("help text");
    expect(handlers.handleRun).not.toHaveBeenCalled();
    expect(handlers.handleSession).not.toHaveBeenCalled();
  });

  it("returns startup consistency error before dispatch", async () => {
    const handlers = createCommandHandlers();
    const result = await handleOrchestrateCommand({
      ctx: { args: "run" },
      commandHandlers: handlers,
      consistency: createConsistency({ startupError: "startup mismatch" }),
      renderOrchestrateHelp: () => "help",
    });

    expect(result).toEqual({ text: "startup mismatch" });
    expect(handlers.handleRun).not.toHaveBeenCalled();
  });

  it("returns runtime consistency command error before dispatch", async () => {
    const handlers = createCommandHandlers();
    const result = await handleOrchestrateCommand({
      ctx: { args: "status task_demo" },
      commandHandlers: handlers,
      consistency: createConsistency({
        assertRuntimeConsistency: vi.fn(async () => {
          throw new Error("runtime mismatch");
        }),
      }),
      renderOrchestrateHelp: () => "help",
    });

    expect(result).toEqual({ text: "runtime mismatch" });
    expect(handlers.handleStatus).not.toHaveBeenCalled();
  });

  it("dispatches to the matching handler after consistency passes", async () => {
    const handlers = createCommandHandlers();
    const result = await handleOrchestrateCommand({
      ctx: { args: "run", sessionKey: "sess_demo" },
      commandHandlers: handlers,
      consistency: createConsistency(),
      renderOrchestrateHelp: () => "help",
    });

    expect(result).toEqual({ text: "run ok" });
    expect(handlers.handleRun).toHaveBeenCalledWith("", expect.objectContaining({ sessionKey: "sess_demo" }));
  });

  it("dispatches session-scoped commands through the shared session handler", async () => {
    const handlers = createCommandHandlers();
    const result = await handleOrchestrateCommand({
      ctx: { args: "summary", sessionKey: "sess_demo" },
      commandHandlers: handlers,
      consistency: createConsistency(),
      renderOrchestrateHelp: () => "help",
    });

    expect(result).toEqual({ text: "session ok" });
    expect(handlers.handleSession).toHaveBeenCalledWith("summary", expect.objectContaining({ sessionKey: "sess_demo" }));
  });

  it("dispatches runtime recovery through the resume handler", async () => {
    const handlers = createCommandHandlers();
    const result = await handleOrchestrateCommand({
      ctx: { args: "resume task_demo" },
      commandHandlers: handlers,
      consistency: createConsistency(),
      renderOrchestrateHelp: () => "help",
    });

    expect(result).toEqual({ text: "resume ok" });
    expect(handlers.handleResume).toHaveBeenCalledWith("task_demo");
  });
});
