import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export function registerOrchestratorOverviewGatewayMethod(params: {
  api: OpenClawPluginApi;
  io: {
    readJsonOrDefault: <T>(targetPath: string, fallback: T) => Promise<T>;
  };
  paths: {
    dashboardJson: string;
    systemHealthJson: string;
  };
}): void {
  const { api, io, paths } = params;
  api.registerGatewayMethod("orchestrator.overview", async ({ respond }) => {
    try {
      const [dashboard, systemHealth] = await Promise.all([
        io.readJsonOrDefault(paths.dashboardJson, {}),
        io.readJsonOrDefault(paths.systemHealthJson, {}),
      ]);
      respond(true, {
        dashboard,
        systemHealth,
        plugin: "orchestrator-dashboard",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respond(false, { error: message });
    }
  });
}
