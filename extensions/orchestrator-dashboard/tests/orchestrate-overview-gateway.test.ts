import { registerOrchestratorOverviewGatewayMethod } from "../orchestrate-overview-gateway.js";
import { describe, expect, it, vi } from "vitest";

describe("orchestrate overview gateway", () => {
  it("registers overview gateway method and returns dashboard state", async () => {
    type GatewayHandler = (params: {
      respond: (ok: boolean, payload: unknown) => void;
    }) => Promise<void>;
    const registered: { handler?: GatewayHandler } = {};
    const api = {
      registerGatewayMethod: vi.fn((name: string, next: GatewayHandler) => {
        expect(name).toBe("orchestrator.overview");
        registered.handler = next;
      }),
    } as unknown as Parameters<typeof registerOrchestratorOverviewGatewayMethod>[0]["api"];
    const respond = vi.fn();

    registerOrchestratorOverviewGatewayMethod({
      api,
      io: {
        readJsonOrDefault: async <T>(targetPath: string, _fallback: T): Promise<T> => {
          const payload = targetPath.endsWith("dashboard.json")
            ? ({ active_pipelines: [] } as unknown)
            : ({ status: "ok" } as unknown);
          return payload as T;
        },
      },
      paths: {
        dashboardJson: "/repo/dashboard.json",
        systemHealthJson: "/repo/system_health.json",
      },
    });

    if (!registered.handler) {
      throw new Error("gateway handler not registered");
    }
    await registered.handler({ respond });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        plugin: "orchestrator-dashboard",
        dashboard: { active_pipelines: [] },
        systemHealth: { status: "ok" },
      }),
    );
  });
});
