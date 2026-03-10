import path from "node:path";
import { renderTaskAmendmentMirror } from "./orchestrate-task-amendment.js";

type HandleAmendSubcommandParams = {
  payload: string;
  repoRoot: string;
  taskFoldersRoot: string;
  io: {
    fileExists: (targetPath: string) => Promise<boolean>;
    readJsonOrDefault: <T>(targetPath: string, fallback: T) => Promise<T>;
    readText: (targetPath: string) => Promise<string>;
    writeJsonAtomic: (targetPath: string, payload: unknown) => Promise<void>;
    writeTextAtomic: (targetPath: string, payload: string) => Promise<void>;
  };
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName: "append_task_event";
    args: string[];
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
};

export async function handleAmendSubcommand(
  params: HandleAmendSubcommandParams,
): Promise<string> {
  const normalized = params.payload.trim();
  const [taskId, ...rest] = normalized.split(/\s+/);
  const amendment = rest.join(" ").trim();
  if (!taskId || !/^[A-Za-z0-9._-]+$/u.test(taskId) || !amendment) {
    return "usage: /orchestrate amend <task_id> <extra requirement>";
  }

  const taskDir = path.join(params.taskFoldersRoot, taskId);
  const metaPath = path.join(taskDir, "meta.json");
  if (!(await params.io.fileExists(metaPath))) {
    return `task not found: ${taskId}`;
  }

  const amendedAt = new Date().toISOString();
  const operationId = `op_amend_${Date.now()}`;
  const amendPath = path.join(taskDir, "amendments.md");
  await params.runWhitelistedScript({
    repoRoot: params.repoRoot,
    scriptName: "append_task_event",
    args: [
      path.relative(params.repoRoot, taskDir),
      "planner-core",
      operationId,
      "REQUIREMENT_AMENDED",
      amendment.replace(/\s+/g, "_"),
    ],
  });

  const meta = await params.io.readJsonOrDefault<Record<string, unknown>>(metaPath, {});
  const currentCount = Math.max(0, Math.floor(Number(meta.requirement_amendment_count) || 0));
  await params.io.writeJsonAtomic(metaPath, {
    ...meta,
    latest_requirement_amendment: amendment,
    latest_requirement_amended_at: amendedAt,
    requirement_amendment_count: currentCount + 1,
    updated_at: amendedAt,
  });

  let mirrorWritten = false;
  try {
    const current = (await params.io.fileExists(amendPath)) ? await params.io.readText(amendPath) : "";
    await params.io.writeTextAtomic(
      amendPath,
      renderTaskAmendmentMirror({
        currentText: current,
        amendedAt,
        amendment,
      }),
    );
    mirrorWritten = true;
  } catch {
    mirrorWritten = false;
  }

  await params.emitEvent("orchestrate.task.amended", {
    task_id: taskId,
    amendment,
    amended_at: amendedAt,
    authority: {
      meta_path: metaPath,
      event_operation_id: operationId,
    },
    amendment_path: amendPath,
    amendment_path_is_legacy_mirror: true,
    amendment_mirror_written: mirrorWritten,
  });
  return [
    `task_id: ${taskId}`,
    "amendment accepted",
    `amendment: ${amendment}`,
    "next: run /orchestrate status <task_id> to track progress",
  ].join("\n");
}
