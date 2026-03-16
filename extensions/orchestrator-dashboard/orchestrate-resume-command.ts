import path from "node:path";

type HandleResumeSubcommandParams = {
  payload: string;
  repoRoot: string;
  taskFoldersRoot: string;
  io: {
    fileExists: (targetPath: string) => Promise<boolean>;
  };
  runWhitelistedScript: (params: {
    repoRoot: string;
    scriptName: "planner_resume_hard_replan";
    args: string[];
  }) => Promise<{ stdout: string; stderr: string }>;
  emitEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
};

export async function handleResumeSubcommand(
  params: HandleResumeSubcommandParams,
): Promise<string> {
  const taskId = params.payload.trim();
  if (!taskId || !/^[A-Za-z0-9._-]+$/u.test(taskId)) {
    return "usage: /orchestrate resume <task_id>";
  }

  const taskDir = path.join(params.taskFoldersRoot, taskId);
  const metaPath = path.join(taskDir, "meta.json");
  if (!(await params.io.fileExists(metaPath))) {
    return `task not found: ${taskId}`;
  }

  try {
    await params.runWhitelistedScript({
      repoRoot: params.repoRoot,
      scriptName: "planner_resume_hard_replan",
      args: [path.relative(params.repoRoot, taskDir) || "."],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `orchestrate resume failed: ${message}`;
  }

  await params.emitEvent("orchestrate.task.replan_resumed", {
    task_id: taskId,
    task_dir: taskDir,
  });

  return [
    `task_id: ${taskId}`,
    "hard replan resume triggered",
    "next: run /orchestrate status <task_id> to track execution recovery",
  ].join("\n");
}
