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
  registerHttpHandler: (...args: unknown[]) => void;
  registerHttpRoute: (...args: unknown[]) => void;
  registerChannel?: (...args: unknown[]) => void;
  registerGatewayMethod: (...args: unknown[]) => void;
  registerCli?: (...args: unknown[]) => void;
  registerService?: (...args: unknown[]) => void;
  registerProvider?: (...args: unknown[]) => void;
  registerCommand: (...args: unknown[]) => void;
  resolvePath?: (input: string) => string;
  on: (event: string, handler: (event: any, ctx: any) => unknown) => void;
  [key: string]: unknown;
};
