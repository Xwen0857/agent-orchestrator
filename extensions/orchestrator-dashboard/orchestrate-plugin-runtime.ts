import type { createOrchestrateCommandHandlers } from "./orchestrate-command-deps.js";
import type { registerOrchestratorHttpRoutes } from "./orchestrate-http.js";

type CommandDeps = Parameters<typeof createOrchestrateCommandHandlers>[0];
type HttpDeps = Parameters<typeof registerOrchestratorHttpRoutes>[0];

export function buildCommandHandlerDeps(params: CommandDeps): CommandDeps {
  return params;
}

export function buildHttpRouteDeps(params: HttpDeps): HttpDeps {
  return params;
}
