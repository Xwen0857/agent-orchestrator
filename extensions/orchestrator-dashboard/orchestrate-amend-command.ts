import path from "node:path";

type HandleAmendSubcommandParams = {
  payload: string;
  repoRoot: string;
  taskFoldersRoot: string;
  io: {
    fileExists: (targetPath: string) => Promise<boolean>;
    readText: (targetPath: string) => Promise<string>;
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

  const amendPath = path.join(taskDir, "amendments.md");
  const line = `- ${new Date().toISOString()} ${amendment}`;
  if (await params.io.fileExists(amendPath)) {
    const current = await params.io.readText(amendPath);
    await params.io.writeTextAtomic(amendPath, `${current.trimEnd()}\n${line}\n`);
  } else {
    await params.io.writeTextAtomic(amendPath, `# Amendments\n\n${line}\n`);
  }

  try {
    await params.runWhitelistedScript({
      repoRoot: params.repoRoot,
      scriptName: "append_task_event",
      args: [
        path.relative(params.repoRoot, taskDir),
        "planner-core",
        `op_amend_${Date.now()}`,
        "REQUIREMENT_AMENDED",
        amendment.replace(/\s+/g, "_"),
      ],
    });
  } catch {
    // Non-blocking: amendment must still be persisted even if event script fails.
  }

  await params.emitEvent("orchestrate.task.amended", {
    task_id: taskId,
    amendment,
    amendment_path: amendPath,
  });
  return [
    `task_id: ${taskId}`,
    "amendment accepted",
    `amendment: ${amendment}`,
    "next: run /orchestrate status <task_id> to track progress",
  ].join("\n");
}
