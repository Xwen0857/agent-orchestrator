import plugin from "../index.js";
import { describe, expect, it } from "vitest";
import { createMockPluginApi } from "./helpers/mock-plugin-api.js";

describe("orchestrator-dashboard registration", () => {
  it("registers routes and handlers when enabled", () => {
    const { api } = createMockPluginApi({ enabled: true });

    plugin.register?.(api);

    expect(api.registerHttpRoute).toHaveBeenCalledTimes(2);
    expect(api.registerHttpHandler).toHaveBeenCalledTimes(1);
    expect(api.registerGatewayMethod).toHaveBeenCalledWith(
      "orchestrator.overview",
      expect.any(Function),
    );
    expect(api.registerCommand).toHaveBeenCalledWith(expect.objectContaining({ name: "orchestrate" }));
  });

  it("does not register when disabled", () => {
    const { api } = createMockPluginApi({ enabled: false });

    plugin.register?.(api);

    expect(api.registerHttpRoute).not.toHaveBeenCalled();
    expect(api.registerHttpHandler).not.toHaveBeenCalled();
    expect(api.registerCommand).not.toHaveBeenCalled();
  });
});
