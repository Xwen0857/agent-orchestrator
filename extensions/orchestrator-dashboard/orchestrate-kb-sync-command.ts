import path from "node:path";

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
}

type HandleKbSyncSubcommandParams = {
  payload: string;
  repoRoot: string;
  paths: {
    taskFoldersRoot: string;
    executionRuntime: string;
  };
  io: {
    fileExists: (targetPath: string) => Promise<boolean>;
    readJsonOrDefault: <T>(targetPath: string, fallback: T) => Promise<T>;
    writeJsonAtomic: (targetPath: string, payload: unknown) => Promise<void>;
  };
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName: "kb_import_from_workspace";
    args: string[];
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
};

export async function handleKbSyncSubcommand(
  params: HandleKbSyncSubcommandParams,
): Promise<string> {
  const normalized = params.payload.trim();
  const [taskIdRaw, actionRaw] = normalized.split(/\s+/);
  const taskId = (taskIdRaw || "").trim();
  const action = (actionRaw || "").trim().toLowerCase();
  if (!taskId || !/^[A-Za-z0-9._-]+$/u.test(taskId)) {
    return "usage: /orchestrate kb-sync <task_id> [approve|deny|auto-on|auto-off]";
  }

  const taskDir = path.join(params.paths.taskFoldersRoot, taskId);
  const metaPath = path.join(taskDir, "meta.json");
  if (!(await params.io.fileExists(metaPath))) {
    return `task not found: ${taskId}`;
  }

  const runtime = await params.io.readJsonOrDefault<Record<string, unknown>>(
    params.paths.executionRuntime,
    {},
  );
  const kbImport =
    runtime.kb_import && typeof runtime.kb_import === "object" && !Array.isArray(runtime.kb_import)
      ? (runtime.kb_import as Record<string, unknown>)
      : {};
  const confirmRequired = asBoolean(kbImport.confirm_required, true);
  const autoEnabled = asBoolean(kbImport.auto_enabled, false);
  const maxFiles = asPositiveInt(kbImport.max_files_per_batch, 20);
  const maxBytes = asPositiveInt(kbImport.max_bytes_per_batch, 10 * 1024 * 1024);

  const meta = await params.io.readJsonOrDefault<Record<string, unknown>>(metaPath, {});
  const projectId = String(meta.project_id ?? "prj_default");
  const runRoot = String(
    meta.run_root ?? path.join(params.repoRoot, "projects", projectId, "runs", taskId),
  );
  const requestId = `kbreq_${Date.now()}_${taskId}`;

  if (action === "auto-on" || action === "auto-off") {
    const next = {
      ...runtime,
      kb_import: {
        ...kbImport,
        auto_enabled: action === "auto-on",
      },
    };
    await params.io.writeJsonAtomic(params.paths.executionRuntime, next);
    await params.emitEvent("orchestrate.kb_import.requested", {
      task_id: taskId,
      request_id: requestId,
      action,
      updated_auto_enabled: action === "auto-on",
    });
    return `kb_import_auto_enabled: ${action === "auto-on" ? "true" : "false"}`;
  }

  const preview = await params.runWhitelistedScript({
    repoRoot: params.repoRoot,
    scriptName: "kb_import_from_workspace",
    args: [
      "--task-id",
      taskId,
      "--run-root",
      runRoot,
      "--max-files",
      String(maxFiles),
      "--max-bytes",
      String(maxBytes),
      "--preview",
    ],
    timeoutMs: 30_000,
    maxBufferBytes: 1024 * 1024,
  });
  const previewJson = JSON.parse(preview.stdout || "{}") as Record<string, unknown>;
  const fileCount = asPositiveInt(previewJson.file_count, 0);
  const totalBytes = asPositiveInt(previewJson.total_bytes, 0);
  const topFiles = Array.isArray(previewJson.files)
    ? (previewJson.files as Array<Record<string, unknown>>).slice(0, 5)
    : [];

  if (action === "deny") {
    const now = new Date().toISOString();
    const nextMeta = {
      ...meta,
      kb_import: {
        ...(meta.kb_import && typeof meta.kb_import === "object"
          ? (meta.kb_import as Record<string, unknown>)
          : {}),
        last_request_id: requestId,
        last_decision: "DENY",
        last_decision_at: now,
      },
    };
    await params.io.writeJsonAtomic(metaPath, nextMeta);
    await params.emitEvent("orchestrate.kb_import.denied", {
      task_id: taskId,
      request_id: requestId,
      file_count: fileCount,
      total_bytes: totalBytes,
    });
    return `kb-sync denied: task_id=${taskId}`;
  }

  const shouldAsk = confirmRequired && !autoEnabled && action !== "approve";
  if (shouldAsk) {
    await params.emitEvent("orchestrate.kb_import.requested", {
      task_id: taskId,
      request_id: requestId,
      file_count: fileCount,
      total_bytes: totalBytes,
      run_root: runRoot,
    });
    return [
      `task_id: ${taskId}`,
      "kb_import_confirm_required: true",
      `candidate_files: ${String(fileCount)}`,
      `candidate_bytes: ${String(totalBytes)}`,
      "top_files:",
      ...topFiles.map(
        (row) => `- ${String(row.path ?? "unknown")} (${String(row.size ?? 0)} bytes)`,
      ),
      "",
      "是否允许本次导入？",
      `允许: /orchestrate kb-sync ${taskId} approve`,
      `拒绝: /orchestrate kb-sync ${taskId} deny`,
    ].join("\n");
  }

  const imported = await params.runWhitelistedScript({
    repoRoot: params.repoRoot,
    scriptName: "kb_import_from_workspace",
    args: [
      "--task-id",
      taskId,
      "--run-root",
      runRoot,
      "--max-files",
      String(maxFiles),
      "--max-bytes",
      String(maxBytes),
    ],
    timeoutMs: 30_000,
    maxBufferBytes: 1024 * 1024,
  });
  const importedJson = JSON.parse(imported.stdout || "{}") as Record<string, unknown>;
  const now = new Date().toISOString();
  const nextMeta = {
    ...meta,
    kb_import: {
      ...(meta.kb_import && typeof meta.kb_import === "object"
        ? (meta.kb_import as Record<string, unknown>)
        : {}),
      last_request_id: requestId,
      last_decision: "ALLOW",
      last_decision_at: now,
    },
  };
  await params.io.writeJsonAtomic(metaPath, nextMeta);
  await params.emitEvent("orchestrate.kb_import.approved", {
    task_id: taskId,
    request_id: requestId,
    file_count: asPositiveInt(importedJson.file_count, fileCount),
    total_bytes: asPositiveInt(importedJson.total_bytes, totalBytes),
    pending_file: String(importedJson.pending_file ?? ""),
  });
  return [
    `task_id: ${taskId}`,
    "kb-sync: approved",
    `pending_file: ${String(importedJson.pending_file ?? "(none)")}`,
    `file_count: ${String(importedJson.file_count ?? fileCount)}`,
    `total_bytes: ${String(importedJson.total_bytes ?? totalBytes)}`,
  ].join("\n");
}
