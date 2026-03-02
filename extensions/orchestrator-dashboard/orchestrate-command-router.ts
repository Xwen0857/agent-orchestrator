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

type RoutedSubcommand = Exclude<
  ReturnType<typeof parseOrchestrateArgs>["subcommand"],
  "help"
>;

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
  const parsed = parseOrchestrateArgs(ctx.args);
  if (parsed.subcommand === "help") {
    const startupError = consistency.getStartupError();
    return {
      text: startupError ? `${startupError}\n\n${renderOrchestrateHelp()}` : renderOrchestrateHelp(),
    };
  }

  await consistency.startupConsistencyPromise;
  const startupError = consistency.getStartupError();
  if (startupError) {
    return { text: startupError };
  }

  try {
    await consistency.assertRuntimeConsistency("command");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: message };
  }

  const dispatch: Record<
    RoutedSubcommand,
    () => Promise<{ text: string }>
  > = {
    start: async () => ({
      text: await commandHandlers.handleSession("start", ctx),
    }),
    session: async () => ({
      text: await commandHandlers.handleSession("session", ctx),
    }),
    stop: async () => ({
      text: await commandHandlers.handleSession("stop", ctx),
    }),
    summary: async () => ({
      text: await commandHandlers.handleSession("summary", ctx),
    }),
    path: async () => ({
      text: await commandHandlers.handlePath(parsed.payload, ctx.senderId),
    }),
    status: async () => ({
      text: await commandHandlers.handleStatus(parsed.payload),
    }),
    "kb-sync": async () => ({
      text: await commandHandlers.handleKbSync(parsed.payload),
    }),
    intake: async () => ({
      text: await commandHandlers.handleIntake(parsed.payload, ctx),
    }),
    amend: async () => ({
      text: await commandHandlers.handleAmend(parsed.payload),
    }),
    run: async () => ({
      text: await commandHandlers.handleRun(parsed.payload, ctx),
    }),
  };

  return dispatch[parsed.subcommand]();
}
