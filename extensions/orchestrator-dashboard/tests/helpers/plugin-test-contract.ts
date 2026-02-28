import type { IncomingMessage, ServerResponse } from "node:http";

export type BeforeAgentStartEvent = {
  messages?: unknown[];
};

export type BeforeAgentStartContext = {
  sessionKey?: string;
};

export type PluginCommandContext = {
  args?: string;
  channel: string;
  senderId?: string;
  sessionKey?: string;
  commandTargetSessionKey?: string;
  messageThreadId?: number;
};

export type PluginCommandDefinition = {
  name: string;
  description?: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;
  handler: (ctx: PluginCommandContext) => unknown | Promise<unknown>;
};

export type PluginHttpRoute = {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
};

export type GatewayMethodParams = {
  respond: (ok: boolean, payload: unknown) => void;
};

export type OpenClawPluginApi = {
  config: {
    gateway?: {
      auth?: {
        token?: string;
        password?: string;
      };
    };
  };
  pluginConfig?: unknown;
  runtime: {
    state: {
      resolveStateDir: () => string;
    };
  };
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  registerTool?: (...args: unknown[]) => void;
  registerHook?: (...args: unknown[]) => void;
  registerHttpHandler: (
    handler: (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>,
  ) => void;
  registerHttpRoute: (route: PluginHttpRoute) => void;
  registerChannel?: (...args: unknown[]) => void;
  registerGatewayMethod: (
    name: string,
    handler: (params: GatewayMethodParams) => unknown | Promise<unknown>,
  ) => void;
  registerCli?: (...args: unknown[]) => void;
  registerService?: (...args: unknown[]) => void;
  registerProvider?: (...args: unknown[]) => void;
  registerCommand: (command: PluginCommandDefinition) => void;
  resolvePath?: (input: string) => string;
  on: (
    event: string,
    handler: (event: BeforeAgentStartEvent, ctx: BeforeAgentStartContext) => unknown,
  ) => void;
  [key: string]: unknown;
};
