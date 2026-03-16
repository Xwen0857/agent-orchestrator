import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { assembleObserverArtifactsForTask } from "../orchestrate-observer-runtime-assembler.js";

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("orchestrate-observer-runtime-assembler", () => {
  it("assembles observer artifacts and updates observer refs without scanning free-form files", async () => {
    const taskRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-observer-runtime-"));
    const taskDir = path.join(taskRoot, "task_demo");
    const metaPath = path.join(taskDir, "meta.json");
    const observerPath = path.join(taskDir, "observer_view.json");
    const terminalDigestPath = path.join(taskDir, "worker_terminal_digest.json");
    const rawLogIndexPath = path.join(taskDir, "worker_raw_log_index.json");
    const runtimeRoot = path.join(taskDir, "worker_stages", "runtime");
    const scratchRoot = path.join(taskDir, "worker_stages", "scratch");
    await fs.mkdir(runtimeRoot, { recursive: true });
    await fs.mkdir(scratchRoot, { recursive: true });
    await fs.writeFile(path.join(runtimeRoot, "terminal.log"), "terminal\n", "utf8");
    await fs.writeFile(path.join(runtimeRoot, "failure.json"), "{\"ok\":false}\n", "utf8");
    await fs.writeFile(path.join(scratchRoot, "notes.txt"), "scratch noise\n", "utf8");
    await writeJson(path.join(taskDir, "result.json"), { status: "failed" });

    const rawTaskMeta = {
      id: "task_demo",
      state: "REJECTED",
      worker_runtime: {
        refinement_route_ref: {
          module_id: "module_demo",
          refinement_task_id: "task_demo",
        },
        milestone_targets: ["bootstrap", "task_complete"],
        milestone_progress_signal: {
          completed_count: 1,
        },
        stage_write_stagnation_seconds: 120,
      },
      worker_stage: {
        worker_stage_id: "workerstage_task_demo",
        worker_stage_root: path.join(taskDir, "worker_stages"),
        runtime_root: runtimeRoot,
        scratch_root: scratchRoot,
        retention: {
          worker_stage_last_fault_class: "worker_stage_exhausted",
        },
        allocation: {
          worker_stage_bytes_used: 42,
          worker_stage_file_count: 2,
        },
      },
      worker_budget: {
        budget_lane: "degraded",
        token_cost_used: 12,
      },
      worker_convergence: {
        convergence_class: "stalled",
      },
      scheduler: {
        degrade: {
          last_stage_write_at: "2026-03-12T00:00:00Z",
          active: true,
        },
        knowledge_handoff: {},
      },
    };
    await writeJson(metaPath, rawTaskMeta);

    const assembled = await assembleObserverArtifactsForTask({
      taskDir,
      metaPath,
      observerPath,
      terminalDigestPath,
      rawLogIndexPath,
      rawTaskMeta,
    });

    const persistedMeta = JSON.parse(await fs.readFile(metaPath, "utf8")) as Record<string, unknown>;
    const rawLogIndex = JSON.parse(await fs.readFile(rawLogIndexPath, "utf8")) as Record<string, unknown>;
    const terminalDigest = JSON.parse(await fs.readFile(terminalDigestPath, "utf8")) as Record<string, unknown>;
    const observerView = JSON.parse(await fs.readFile(observerPath, "utf8")) as Record<string, unknown>;

    expect(assembled.observerView.schema_version).toBe("observer-view-v1");
    expect(rawLogIndex.schema_version).toBe("worker-raw-log-index-v1");
    expect((rawLogIndex.indexed_paths as unknown[])).toContain("worker_stages/runtime/terminal.log");
    expect((rawLogIndex.indexed_paths as unknown[])).not.toContain("worker_stages/scratch/notes.txt");
    expect(terminalDigest).toMatchObject({
      schema_version: "worker-terminal-digest-v1",
      lifecycle_result: "failure",
      evidence: {
        raw_log_index_path: "worker_raw_log_index.json",
      },
    });
    expect(observerView).toMatchObject({
      schema_version: "observer-view-v1",
      task_id: "task_demo",
      terminal: {
        available: true,
        digest_path: "worker_terminal_digest.json",
      },
    });
    expect((persistedMeta.observer as Record<string, unknown>)).toMatchObject({
      runtime_view_path: "observer_view.json",
      runtime_page_id: "runtime",
      terminal_digest_path: "worker_terminal_digest.json",
      terminal_page_id: "terminal",
      raw_log_index_path: "worker_raw_log_index.json",
    });
    expect(
      ((persistedMeta.scheduler as Record<string, unknown>).knowledge_handoff as Record<string, unknown>)
        .last_terminal_digest_path,
    ).toBe("worker_terminal_digest.json");
  });
});
