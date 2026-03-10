import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPlannerDependencyConfig } from "../orchestrate-planner-dependency-semantics.js";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", relativePath), "utf8");
}

describe("planner invariants document consistency", () => {
  it("keeps split-plan and dependency constants aligned between docs and code", () => {
    const invariantsDoc = readRepoFile("templates/coordination/orchestrator/planner_invariants.md");
    const skillDoc = readRepoFile("planner-core/SKILL.md");
    const runtimeReadme = readRepoFile(
      "templates/coordination/orchestrator/agent_runtime.README.md",
    );
    const config = loadPlannerDependencyConfig();

    expect(invariantsDoc).toContain("planner-split-plan-v1");
    expect(skillDoc).toContain("planner-split-plan-v1");
    expect(invariantsDoc).toContain(config.semantics.dependency_mode);
    expect(skillDoc).toContain(config.semantics.dependency_mode);
    expect(runtimeReadme).toContain(config.semantics.dependency_mode);
    expect(invariantsDoc).toContain(config.defaults.summary_note);
    expect(runtimeReadme).toContain(config.defaults.summary_note);
  });
});
