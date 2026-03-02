import { parseOrchestrateArgs } from "./orchestrate-session.js";
import type { createOrchestrateCommandHandlers } from "./orchestrate-command-deps.js";
import type { RuntimeConsistencyController } from "./orchestrate-runtime-consistency.js";

type CommandCtx = {
  args?: string;
  senderId?: string;
  channel?: string;
  messageThreadId?: string | number;
  sessionKey?: string;
  commandTargetSessionKey?: string;
};

type OrchestrateCommandHandlers = ReturnType<typeof createOrchestrateCommandHandlers>;

type HandleOrchestrateCommandParams = {
  ctx: CommandCtx;
  commandHandlers: OrchestrateCommandHandlers;
  consistency: RuntimeConsistencyController;
  renderOrchestrateHelp: () => string;
};

/**
 * Centralizes command parsing, runtime-consistency gating, and subcommand routing so the
 * plugin entry only has to register one handler with the host runtime.
 */
export async function handleOrchestrateCommand({
  ctx,
  commandHandlers,
  consistency,
  renderOrchestrateHelp,
}: HandleOrchestrateCommandParams): Promise<{ text: string }> {
  await consistency.startupConsistencyPromise;
  const startupError = consistency.getStartupError();
  if (startupError) {
    return { text: startupError };
  }

  const parsed = parseOrchestrateArgs(ctx.args);
  try {
    await consistency.assertRuntimeConsistency("command");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: message };
  }

  if (parsed.subcommand === "help") {
    return { text: renderOrchestrateHelp() };
  }

  if (
    parsed.subcommand === "start" ||
    parsed.subcommand === "session" ||
    parsed.subcommand === "stop" ||
    parsed.subcommand === "summary"
  ) {
    return {
      text: await commandHandlers.handleSession(parsed.subcommand, ctx),
    };
  }

  if (parsed.subcommand === "path") {
    return {
      text: await commandHandlers.handlePath(parsed.payload, ctx.senderId),
    };
  }

  if (parsed.subcommand === "status") {
    return {
      text: await commandHandlers.handleStatus(parsed.payload),
    };
  }

  if (parsed.subcommand === "kb-sync") {
    return {
      text: await commandHandlers.handleKbSync(parsed.payload),
    };
  }

  if (parsed.subcommand === "intake") {
    return {
      text: await commandHandlers.handleIntake(parsed.payload, ctx),
    };
  }

  if (parsed.subcommand === "amend") {
    return {
      text: await commandHandlers.handleAmend(parsed.payload),
    };
  }

  if (parsed.subcommand === "run") {
    return {
      text: await commandHandlers.handleRun(parsed.payload, ctx),
    };
  }

  return { text: renderOrchestrateHelp() };
}
