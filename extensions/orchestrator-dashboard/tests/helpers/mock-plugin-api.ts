import type {
  OpenClawPluginApi,
  PluginCommandContext,
  PluginCommandDefinition,
} from "./plugin-test-contract.js";
import { vi } from "vitest";

type MockPluginApiOptions = {
  enabled?: boolean;
  repoRoot?: string;
  runtimeConsistencyMode?: "enforce" | "warn";
};

type RegisteredHttpHandler = Parameters<OpenClawPluginApi["registerHttpHandler"]>[0];

export function createMockPluginApi(options: MockPluginApiOptions = {}) {
  let registeredCommand: PluginCommandDefinition | null = null;
  let httpHandler: RegisteredHttpHandler | null = null;

  const api: OpenClawPluginApi = {
    id: "orchestrator-dashboard",
    name: "Orchestrator Dashboard",
    source: "test",
    config: {
      gateway: {
        auth: {
          token: "test-token",
        },
      },
    },
    pluginConfig: {
      enabled: options.enabled ?? true,
      repoRoot: options.repoRoot ?? "/tmp/orchestrator",
      runtimeConsistencyMode: options.runtimeConsistencyMode ?? "warn",
    },
    runtime: {
      state: {
        resolveStateDir: () => "/tmp/openclaw-state",
      },
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    registerTool: vi.fn(),
    registerHook: vi.fn(),
    registerHttpHandler: vi.fn((fn) => {
      httpHandler = fn;
    }),
    registerHttpRoute: vi.fn(),
    registerChannel: vi.fn(),
    registerGatewayMethod: vi.fn(),
    registerCli: vi.fn(),
    registerService: vi.fn(),
    registerProvider: vi.fn(),
    registerCommand: vi.fn((command: PluginCommandDefinition) => {
      registeredCommand = command;
    }),
    resolvePath: (input: string) => input,
    on: vi.fn(),
  };

  return {
    api,
    getHttpHandler: () => httpHandler,
    getRegisteredCommand: () => registeredCommand,
  };
}

export function createMockCommandContext(overrides: Record<string, unknown> = {}) {
  return {
    args: "",
    channel: "cli",
    senderId: "tester",
    sessionKey: "test-session",
    messageThreadId: 1,
    ...overrides,
  } satisfies PluginCommandContext;
}
