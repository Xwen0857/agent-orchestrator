import fs from "node:fs/promises";
import path from "node:path";

import {
  buildObserverView,
  buildWorkerTerminalDigest,
  type ObserverViewV1,
  type WorkerRawLogIndexV1,
  type WorkerTerminalDigestV1,
} from "./orchestrate-observer-contract.js";

function extractObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, targetPath);
}

export type AssembleObserverArtifactsResult = {
  taskMeta: Record<string, unknown>;
  observerView: ObserverViewV1;
  terminalDigest: WorkerTerminalDigestV1 | null;
  rawLogIndex: WorkerRawLogIndexV1;
};

export async function assembleObserverArtifactsForTask(input: {
  taskDir: string;
  metaPath: string;
  observerPath: string;
  terminalDigestPath: string;
  rawLogIndexPath: string;
  rawTaskMeta: Record<string, unknown>;
}): Promise<AssembleObserverArtifactsResult> {
  const rawLogIndex = await buildWorkerRawLogIndex({
    taskDir: input.taskDir,
    taskMeta: input.rawTaskMeta,
  });
  await writeJsonAtomic(input.rawLogIndexPath, rawLogIndex);
  const evidencePaths = await collectTerminalDigestEvidencePaths(input.taskDir);
  const terminalDigest = buildWorkerTerminalDigest({
    taskMeta: input.rawTaskMeta,
    rawLogIndexPath: path.basename(input.rawLogIndexPath),
    evidencePaths,
  });
  if (terminalDigest) {
    await writeJsonAtomic(input.terminalDigestPath, terminalDigest);
  } else if (await pathExists(input.terminalDigestPath)) {
    await fs.rm(input.terminalDigestPath, { force: true });
  }

  const taskMeta = {
    ...input.rawTaskMeta,
    observer: {
      ...extractObject(input.rawTaskMeta.observer),
      runtime_view_path: String(extractObject(input.rawTaskMeta.observer).runtime_view_path ?? "observer_view.json"),
      runtime_page_id: "runtime",
      terminal_digest_path: terminalDigest ? path.basename(input.terminalDigestPath) : "",
      terminal_page_id: terminalDigest ? "terminal" : "",
      raw_log_index_path: path.basename(input.rawLogIndexPath),
      terminal_last_observed_at: terminalDigest?.observed_at ?? "",
      terminal_lifecycle_result: terminalDigest?.lifecycle_result ?? "",
    },
    scheduler: {
      ...extractObject(input.rawTaskMeta.scheduler),
      knowledge_handoff: {
        ...extractObject(extractObject(input.rawTaskMeta.scheduler).knowledge_handoff),
        last_terminal_digest_path: terminalDigest ? path.basename(input.terminalDigestPath) : "",
        last_terminal_digest_observed_at: terminalDigest?.observed_at ?? "",
      },
    },
  };
  const beforeObserver = JSON.stringify(input.rawTaskMeta.observer ?? {});
  const afterObserver = JSON.stringify(taskMeta.observer ?? {});
  const beforeKnowledgeHandoff = JSON.stringify(
    extractObject(extractObject(input.rawTaskMeta.scheduler).knowledge_handoff),
  );
  const afterKnowledgeHandoff = JSON.stringify(
    extractObject(extractObject(taskMeta.scheduler).knowledge_handoff),
  );
  if (beforeObserver !== afterObserver || beforeKnowledgeHandoff !== afterKnowledgeHandoff) {
    await writeJsonAtomic(input.metaPath, taskMeta);
  }

  const observerView = buildObserverView({ taskMeta });
  await writeJsonAtomic(input.observerPath, observerView);
  return {
    taskMeta,
    observerView,
    terminalDigest,
    rawLogIndex,
  };
}

async function buildWorkerRawLogIndex(input: {
  taskDir: string;
  taskMeta: Record<string, unknown>;
}): Promise<WorkerRawLogIndexV1> {
  const workerStage = extractObject(input.taskMeta.worker_stage);
  const workerStageRoot = String(workerStage.worker_stage_root ?? "").trim();
  const entries = await collectWorkerRawLogIndexEntries({
    taskDir: input.taskDir,
    workerStage,
  });
  return {
    schema_version: "worker-raw-log-index-v1",
    indexed_at: new Date().toISOString(),
    task_id: String(input.taskMeta.id ?? path.basename(input.taskDir)),
    worker_instance_id: String(workerStage.worker_stage_id ?? `${path.basename(input.taskDir)}_worker`),
    worker_stage_root: workerStageRoot,
    entries,
    indexed_paths: entries.map((entry) => entry.path),
  };
}

async function collectWorkerRawLogIndexEntries(input: {
  taskDir: string;
  workerStage: Record<string, unknown>;
}): Promise<WorkerRawLogIndexV1["entries"]> {
  const runtimeRoot = String(input.workerStage.runtime_root ?? "").trim();
  const deliveryRoot = String(input.workerStage.delivery_root ?? "").trim();
  const inputsRoot = String(input.workerStage.inputs_root ?? "").trim();
  const slots = [
    { slot: "runtime_terminal_log", absolutePath: runtimeRoot ? path.join(runtimeRoot, "terminal.log") : "" },
    { slot: "runtime_failure_json", absolutePath: runtimeRoot ? path.join(runtimeRoot, "failure.json") : "" },
    { slot: "runtime_result_json", absolutePath: runtimeRoot ? path.join(runtimeRoot, "result.json") : "" },
    {
      slot: "runtime_execution_trace",
      absolutePath: runtimeRoot ? path.join(runtimeRoot, "execution_trace.ndjson") : "",
    },
    { slot: "delivery_result_json", absolutePath: deliveryRoot ? path.join(deliveryRoot, "result.json") : "" },
    {
      slot: "delivery_export_manifest",
      absolutePath: deliveryRoot ? path.join(deliveryRoot, "export-manifest.json") : "",
    },
    { slot: "inputs_context_json", absolutePath: inputsRoot ? path.join(inputsRoot, "context.json") : "" },
  ];
  const entries: WorkerRawLogIndexV1["entries"] = [];
  for (const slot of slots) {
    if (!slot.absolutePath || !(await pathExists(slot.absolutePath))) {
      continue;
    }
    const stats = await fs.stat(slot.absolutePath);
    const relativePath = path.relative(input.taskDir, slot.absolutePath);
    if (!relativePath || relativePath.startsWith("..")) {
      continue;
    }
    entries.push({
      slot: slot.slot,
      path: relativePath,
      size_bytes: stats.size,
      updated_at: stats.mtime.toISOString(),
    });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectTerminalDigestEvidencePaths(taskDir: string): Promise<string[]> {
  const candidates = [
    "work.md",
    "test.md",
    "worker_runtime_view.json",
    "observer_view.json",
    "worker_failure_pattern_summary.json",
    "scheduler_keeper_assembly_query.json",
    "result.json",
  ];
  const paths: string[] = [];
  for (const relativePath of candidates) {
    if (await pathExists(path.join(taskDir, relativePath))) {
      paths.push(relativePath);
    }
  }
  return paths;
}
