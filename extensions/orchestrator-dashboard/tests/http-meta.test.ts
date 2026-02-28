import plugin from "../index.js";
import { describe, expect, it } from "vitest";
import { createMockPluginApi } from "./helpers/mock-plugin-api.js";

describe("orchestrator-dashboard http meta", () => {
  it("serves meta endpoint via registered http handler", async () => {
    const { api, getHttpHandler } = createMockPluginApi();

    plugin.register?.(api);

    const httpHandler = getHttpHandler();
    expect(httpHandler).toBeTruthy();

    let body = "";
    const res: any = {
      statusCode: 0,
      headers: new Map<string, string>(),
      setHeader(name: string, value: string) {
        this.headers.set(name.toLowerCase(), value);
      },
      end(chunk: string) {
        body = chunk;
      },
    };

    const handled = await httpHandler?.(
      {
        method: "GET",
        url: "/api/plugins/orchestrator/meta",
        headers: {
          authorization: "Bearer test-token",
        },
      },
      res,
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(body);
    expect(parsed.pluginId).toBe("orchestrator-dashboard");
    expect(parsed.basePath).toBe("/plugins/orchestrator");
  });
});
