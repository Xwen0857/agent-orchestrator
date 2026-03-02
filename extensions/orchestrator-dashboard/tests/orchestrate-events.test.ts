import { describe, expect, it, vi } from "vitest";
import { createOrchestratorEventEmitter } from "../orchestrate-events.js";

describe("orchestrate-events", () => {
  it("writes normalized event rows", async () => {
    const appendNdjson = vi.fn(async () => {});
    const emitEvent = createOrchestratorEventEmitter({
      eventsPath: "/tmp/events.ndjson",
      io: { appendNdjson },
    });

    await emitEvent("orchestrate.demo", { ok: true }, {
      headers: { "x-openclaw-actor": "tester" },
    } as never);

    expect(appendNdjson).toHaveBeenCalledTimes(1);
    const [targetPath, row] = appendNdjson.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(targetPath).toBe("/tmp/events.ndjson");
    expect(row.event_type).toBe("orchestrate.demo");
    expect(row.actor).toBe("tester");
    expect(row.resource).toBe("orchestrator-config");
  });
});
