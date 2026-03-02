import { describe, expect, it } from "vitest";
import {
  buildWorkerIdFromTaskId,
  renderOrchestrateHelp,
  renderRequiredConfigChecklist,
} from "../orchestrate-ui-helpers.js";

describe("orchestrate-ui-helpers", () => {
  it("renders help text with orchestrate commands", () => {
    const help = renderOrchestrateHelp();
    expect(help).toContain("/orchestrate start");
    expect(help).toContain("/orchestrate run");
    expect(help).toContain("/orchestrate help");
  });

  it("renders required config checklist", () => {
    const checklist = renderRequiredConfigChecklist();
    expect(checklist).toContain("required_config:");
    expect(checklist).toContain("planner_current");
    expect(checklist).toContain("worker_profile");
  });

  it("builds normalized worker ids from task ids", () => {
    expect(buildWorkerIdFromTaskId("task_2026-foo_bar")).toBe("worker_2026_foo_bar");
    expect(buildWorkerIdFromTaskId("task_!!!")).toBe("worker_generic");
  });
});
