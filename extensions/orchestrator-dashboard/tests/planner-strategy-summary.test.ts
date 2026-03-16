import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const helperPath = path.join(repoRoot, "agent-orchestrator", "scripts", "planner_strategy_summary.sh");

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "planner-summary-"));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function runHelper(strategyPath: string): Record<string, string> {
  const output = execFileSync(
    "bash",
    [
      "-lc",
      [
        `source ${shellQuote(helperPath)}`,
        `load_planner_strategy_summary ${shellQuote(strategyPath)}`,
        "python3 - <<'PY'\nimport json\nimport os\nprint(json.dumps({\n  'TASK_GOAL': os.environ.get('TASK_GOAL', ''),\n  'SUMMARY_CONSTRAINTS': os.environ.get('SUMMARY_CONSTRAINTS', ''),\n  'SUMMARY_DELIVERABLES': os.environ.get('SUMMARY_DELIVERABLES', ''),\n  'SUMMARY_NOTES': os.environ.get('SUMMARY_NOTES', ''),\n  'PLANNER_GOAL': os.environ.get('PLANNER_GOAL', ''),\n}))\nPY",
      ].join("; "),
    ],
    { encoding: "utf8" },
  );

  return JSON.parse(output) as Record<string, string>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("planner_strategy_summary helper", () => {
  it("assembles planner goal from summary_input fields", async () => {
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const strategyPath = path.join(tempDir, "strategy.json");
    await fs.writeFile(
      strategyPath,
      JSON.stringify({
        goal: "transport-only goal",
        summary_input: {
          task_goal: "Ship feature",
          constraints: ["python only", "no network"],
          deliverables: ["source", "tests"],
          notes: ["prefer local fixtures"],
        },
      }),
      "utf8",
    );

    const result = runHelper(strategyPath);

    expect(result.TASK_GOAL).toBe("Ship feature");
    expect(result.SUMMARY_CONSTRAINTS).toBe("python only; no network");
    expect(result.SUMMARY_DELIVERABLES).toBe("source; tests");
    expect(result.SUMMARY_NOTES).toBe("prefer local fixtures");
    expect(result.PLANNER_GOAL).toBe(
      "Ship feature\nConstraints: python only; no network\nDeliverables: source; tests\nNotes: prefer local fixtures",
    );
  });

  it("falls back to legacy goal-only strategies", async () => {
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const strategyPath = path.join(tempDir, "strategy.json");
    await fs.writeFile(
      strategyPath,
      JSON.stringify({
        goal: "Legacy goal text",
      }),
      "utf8",
    );

    const result = runHelper(strategyPath);

    expect(result.TASK_GOAL).toBe("Legacy goal text");
    expect(result.SUMMARY_CONSTRAINTS).toBe("");
    expect(result.SUMMARY_DELIVERABLES).toBe("");
    expect(result.SUMMARY_NOTES).toBe("");
    expect(result.PLANNER_GOAL).toBe("Legacy goal text");
  });

  it("filters empty and non-string summary members", async () => {
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const strategyPath = path.join(tempDir, "strategy.json");
    await fs.writeFile(
      strategyPath,
      JSON.stringify({
        summary_input: {
          task_goal: "Ship feature",
          constraints: ["python only", "", "   ", 7, "no network"],
          deliverables: ["source", null, "tests", {}],
          notes: ["prefer local fixtures", "", false],
        },
      }),
      "utf8",
    );

    const result = runHelper(strategyPath);

    expect(result.SUMMARY_CONSTRAINTS).toBe("python only; no network");
    expect(result.SUMMARY_DELIVERABLES).toBe("source; tests");
    expect(result.SUMMARY_NOTES).toBe("prefer local fixtures");
    expect(result.PLANNER_GOAL).toBe(
      "Ship feature\nConstraints: python only; no network\nDeliverables: source; tests\nNotes: prefer local fixtures",
    );
  });
});
