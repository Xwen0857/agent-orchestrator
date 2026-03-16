import { loadEligibleTasks } from "./orchestrate-scheduler-task-snapshot-loader.js";

export async function runSchedulerTaskSnapshotPhase(input: {
  tasksRoot: string;
}) {
  return loadEligibleTasks(input.tasksRoot);
}
