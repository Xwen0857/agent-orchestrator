import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("tester_run_task.sh", () => {
  it("acknowledges then archives a targeted cluster mailbox message", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "tester-run-task-"));
    const taskId = "task_demo_tester";
    const clusterRoot = path.join(taskDir, "task_cluster_workspace");
    await fs.mkdir(clusterRoot, { recursive: true });
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "TESTING",
      task_cluster: {
        cluster_id: "cluster_demo",
        mailbox_counters: {
          published: 1,
          consumed: 0,
          archived: 0,
        },
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      collaboration: {
        cluster_id: "cluster_demo",
        dispatch: undefined,
        mailbox_path: path.join(clusterRoot, "mailbox.ndjson"),
        archive_path: path.join(clusterRoot, "mailbox.archive.ndjson"),
        memberships: ["role:tester-ephemeral", "project:prj_demo"],
      },
      dispatch: {
        role_type: "tester-ephemeral",
      },
    });
    await fs.mkdir(path.join(taskDir, "delivery"), { recursive: true });
    await fs.writeFile(
      path.join(taskDir, "delivery", "test_sample.py"),
      "import unittest\n\nclass Sample(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(clusterRoot, "mailbox.ndjson"),
      `${JSON.stringify({
        schema_version: "task-cluster-message-v1",
        message_id: "msg_1",
        task_id: taskId,
        cluster_id: "cluster_demo",
        created_at: "2026-03-09T00:00:00Z",
        expires_at: "2099-03-09T00:00:00Z",
        message_type: "partial_deliverable",
        memberships: ["role:tester-ephemeral"],
        target_role_types: ["tester-ephemeral"],
        target_worker_ids: [],
        acknowledged_by: [],
        requires_ack: true,
        archive_policy: "archive_after_single_consume",
        content: "worker delivery bundle ready",
        status: "published",
      })}\n`,
      "utf8",
    );
    await fs.writeFile(path.join(clusterRoot, "mailbox.archive.ndjson"), "", "utf8");
    await writeJson(path.join(taskDir, "delivery.export-records.json"), [
      {
        artifact_id: "artifact_1",
        path: "delivery/output.py",
        artifact_type: "application/x-python",
        size_bytes: 42,
        digest_sha256: "abc",
        export_class: "delivery_manifest",
        exported_at: "2026-03-09T00:00:00Z",
        consumption_status: "available",
        archive_status: "active",
      },
    ]);
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    execFileSync(
      path.join(repoRoot, "agent-orchestrator", "scripts", "tester_run_task.sh"),
      [taskDir],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    let mailbox = await fs.readFile(path.join(clusterRoot, "mailbox.ndjson"), "utf8");
    expect(mailbox).toContain("\"status\":\"acknowledged\"");

    execFileSync(
      path.join(repoRoot, "agent-orchestrator", "scripts", "tester_run_task.sh"),
      [taskDir],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    const meta = JSON.parse(await fs.readFile(path.join(taskDir, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const exportRecords = JSON.parse(
      await fs.readFile(path.join(taskDir, "delivery.export-records.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    mailbox = await fs.readFile(path.join(clusterRoot, "mailbox.ndjson"), "utf8");
    const archive = await fs.readFile(path.join(clusterRoot, "mailbox.archive.ndjson"), "utf8");
    expect(mailbox.trim()).toBe("");
    expect(archive).toContain("\"status\":\"archived\"");
    expect(archive).toContain("\"acknowledged_by\":[\"tester-ephemeral\"]");
    expect(
      ((meta.task_cluster as Record<string, unknown>).mailbox_counters as Record<string, unknown>).acknowledged,
    ).toBe(0);
    expect(
      ((meta.task_cluster as Record<string, unknown>).mailbox_counters as Record<string, unknown>).consumed,
    ).toBe(1);
    expect(
      ((meta.task_cluster as Record<string, unknown>).mailbox_counters as Record<string, unknown>).archived,
    ).toBe(1);
    expect(exportRecords[0]?.consumption_status).toBe("consumed");
    expect(exportRecords[0]?.archive_status).toBe("archived");
    expect(exportRecords[0]?.last_lifecycle_action).toBe("tester_archived");
  });

  it("expires stale messages without consuming them", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "tester-run-expire-"));
    const taskId = "task_demo_expire";
    const clusterRoot = path.join(taskDir, "task_cluster_workspace");
    await fs.mkdir(clusterRoot, { recursive: true });
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "TESTING",
      task_cluster: {
        cluster_id: "cluster_demo",
        mailbox_counters: {
          published: 1,
          acknowledged: 0,
          consumed: 0,
          archived: 0,
        },
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: {
        role_type: "tester-ephemeral",
      },
      collaboration: {
        cluster_id: "cluster_demo",
        mailbox_path: path.join(clusterRoot, "mailbox.ndjson"),
        archive_path: path.join(clusterRoot, "mailbox.archive.ndjson"),
        memberships: ["role:tester-ephemeral"],
      },
    });
    await fs.mkdir(path.join(taskDir, "delivery"), { recursive: true });
    await fs.writeFile(
      path.join(taskDir, "delivery", "test_sample.py"),
      "import unittest\n\nclass Sample(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(clusterRoot, "mailbox.ndjson"),
      `${JSON.stringify({
        schema_version: "task-cluster-message-v1",
        message_id: "msg_expire",
        task_id: taskId,
        cluster_id: "cluster_demo",
        created_at: "2026-03-09T00:00:00Z",
        expires_at: "2020-03-09T00:00:00Z",
        message_type: "partial_deliverable",
        memberships: ["role:tester-ephemeral"],
        target_role_types: ["tester-ephemeral"],
        target_worker_ids: [],
        acknowledged_by: [],
        requires_ack: false,
        archive_policy: "archive_after_single_consume",
        content: "expired delivery bundle",
        status: "published",
      })}\n`,
      "utf8",
    );
    await fs.writeFile(path.join(clusterRoot, "mailbox.archive.ndjson"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    execFileSync(
      path.join(repoRoot, "agent-orchestrator", "scripts", "tester_run_task.sh"),
      [taskDir],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    const mailbox = await fs.readFile(path.join(clusterRoot, "mailbox.ndjson"), "utf8");
    const archive = await fs.readFile(path.join(clusterRoot, "mailbox.archive.ndjson"), "utf8");
    expect(mailbox.trim()).toBe("");
    expect(archive).toContain("\"expired_at\"");
  });

  it("keeps export records active when archive_on_tester_consume is disabled", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "tester-run-active-"));
    const taskId = "task_demo_active";
    const clusterRoot = path.join(taskDir, "task_cluster_workspace");
    await fs.mkdir(clusterRoot, { recursive: true });
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "TESTING",
      task_cluster: {
        cluster_id: "cluster_demo",
        mailbox_counters: {
          published: 1,
          acknowledged: 0,
          consumed: 0,
          archived: 0,
        },
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: {
        role_type: "tester-ephemeral",
      },
      lifecycle_governance: {
        worker_stage_governance: {
          export_policy: {
            archive_on_tester_consume: false,
          },
        },
      },
      collaboration: {
        cluster_id: "cluster_demo",
        mailbox_path: path.join(clusterRoot, "mailbox.ndjson"),
        archive_path: path.join(clusterRoot, "mailbox.archive.ndjson"),
        memberships: ["role:tester-ephemeral"],
      },
    });
    await fs.mkdir(path.join(taskDir, "delivery"), { recursive: true });
    await fs.writeFile(
      path.join(taskDir, "delivery", "test_sample.py"),
      "import unittest\n\nclass Sample(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(clusterRoot, "mailbox.ndjson"),
      `${JSON.stringify({
        schema_version: "task-cluster-message-v1",
        message_id: "msg_active",
        task_id: taskId,
        cluster_id: "cluster_demo",
        created_at: "2026-03-09T00:00:00Z",
        expires_at: "2099-03-09T00:00:00Z",
        message_type: "partial_deliverable",
        memberships: ["role:tester-ephemeral"],
        target_role_types: ["tester-ephemeral"],
        target_worker_ids: [],
        acknowledged_by: [],
        requires_ack: false,
        archive_policy: "archive_after_single_consume",
        content: "delivery bundle ready",
        status: "published",
      })}\n`,
      "utf8",
    );
    await fs.writeFile(path.join(clusterRoot, "mailbox.archive.ndjson"), "", "utf8");
    await writeJson(path.join(taskDir, "delivery.export-records.json"), [
      {
        artifact_id: "artifact_1",
        path: "delivery/output.py",
        artifact_type: "application/x-python",
        size_bytes: 42,
        digest_sha256: "abc",
        export_class: "delivery_manifest",
        exported_at: "2026-03-09T00:00:00Z",
        consumption_status: "available",
        archive_status: "active",
      },
    ]);
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    execFileSync(
      path.join(repoRoot, "agent-orchestrator", "scripts", "tester_run_task.sh"),
      [taskDir],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    const exportRecords = JSON.parse(
      await fs.readFile(path.join(taskDir, "delivery.export-records.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(exportRecords[0]?.consumption_status).toBe("consumed");
    expect(exportRecords[0]?.archive_status).toBe("active");
    expect(exportRecords[0]?.last_lifecycle_action).toBe("tester_consumed");
  });
});
