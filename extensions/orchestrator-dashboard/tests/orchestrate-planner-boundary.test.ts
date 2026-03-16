import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const plannerSplitPlanModules = [
  "orchestrate-planner-split-plan-contract.ts",
  "orchestrate-planner-split-plan-parse.ts",
  "orchestrate-planner-split-plan-validate.ts",
  "orchestrate-planner-split-plan-summary.ts",
  "orchestrate-planner-split-plan-schema.ts",
];
const uiRuntimeModules = [
  "./orchestrate-response.js",
  "./orchestrate-view-model.js",
  "./orchestrate-run-command.js",
  "./orchestrate-status-command.js",
];

function readTarget(file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

describe("orchestrate planner boundary governance", () => {
  it("keeps orchestrate-planner-contract.ts as types + re-export barrel only", () => {
    const source = readTarget("orchestrate-planner-contract.ts");
    expect(source).toContain("Do not add runtime logic here");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/^\s*export\s+function\s/m);
    expect(source).not.toMatch(/^\s*function\s/m);
    expect(source).not.toMatch(/^\s*class\s/m);
    expect(source).not.toMatch(/^\s*(const|let|var)\s/m);
  });

  it("enforces planner import direction on core paths", () => {
    const viewModel = readTarget("orchestrate-view-model.ts");
    expect(viewModel).toContain('from "./orchestrate-planner-projection.js"');
    for (const modulePath of plannerSplitPlanModules) {
      const importPath = `from "./${modulePath.replace(".ts", ".js")}"`;
      expect(viewModel).not.toContain(importPath);
    }

    const runCommand = readTarget("orchestrate-run-command.ts");
    const statusCommand = readTarget("orchestrate-status-command.ts");
    const agentRuntime = readTarget("orchestrate-agent-runtime.ts");
    const forbiddenPlannerImport = 'from "./orchestrate-planner-split-plan-contract.js"';
    expect(runCommand).not.toContain(forbiddenPlannerImport);
    expect(statusCommand).not.toContain(forbiddenPlannerImport);
    expect(agentRuntime).not.toContain(forbiddenPlannerImport);
  });

  it("keeps split-plan contract focused on normalization/validation responsibility", () => {
    const splitPlanContract = readTarget("orchestrate-planner-split-plan-contract.ts");
    expect(splitPlanContract).toContain("normalize schema -> parse fields -> validate invariants");
    expect(splitPlanContract).not.toContain("function requireLeafUnit");
    expect(splitPlanContract).not.toContain("function requirePositiveInt");
    expect(splitPlanContract).not.toContain("function computeDependencySummary");
    for (const importPath of uiRuntimeModules) {
      expect(splitPlanContract).not.toContain(`from "${importPath}"`);
    }
  });

  it("keeps split-plan subdomain modules isolated from UI/runtime command layers", () => {
    for (const file of plannerSplitPlanModules.slice(1)) {
      const source = readTarget(file);
      for (const importPath of uiRuntimeModules) {
        expect(source).not.toContain(`from "${importPath}"`);
      }
    }
  });

  it("keeps response from re-implementing split-plan dependency graph derivation", () => {
    const response = readTarget("orchestrate-response.ts");
    expect(response).toContain('from "./orchestrate-planner-hints-contract.js"');
    expect(response).not.toContain("fallbackDependencyLinks");
    expect(response).not.toContain("fallbackDependencyRoots");
    expect(response).not.toContain("fallbackDependencyBlocked");
    expect(response).not.toContain("fallbackCrossModuleLinks");
    expect(response).not.toContain("dependencySummary.mode");
  });
});
