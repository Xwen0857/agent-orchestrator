import { vi } from "vitest";

type MockPluginApiOptions = {
  enabled?: boolean;
  repoRoot?: string;
  runtimeConsistencyMode?: "enforce" | "warn";
};

export function createMockPluginApi(options: MockPluginApiOptions = {}) {
  let registeredCommand: any = null;
  let httpHandler: ((req: any, res: any) => Promise<boolean>) | null = null;

  const api: any = {
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
    registerHttpHandler: vi.fn((fn: any) => {
      httpHandler = fn;
    }),
    registerHttpRoute: vi.fn(),
    registerChannel: vi.fn(),
    registerGatewayMethod: vi.fn(),
    registerCli: vi.fn(),
    registerService: vi.fn(),
    registerProvider: vi.fn(),
    registerCommand: vi.fn((command: any) => {
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
  };
}
