import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildLifecycleGovernance(params?: {
  taskId?: string;
  operationId?: string;
  dispatchSeq?: number;
  budgetLane?: "fast" | "degraded" | "reclaim_pending";
  selectedTemplateId?: string;
  selectedTemplateOrigin?: "builtin" | "custom";
  selectedCustomRegistrationEnabled?: boolean;
  selectedCustomRuntimeGateStatus?: "not_applicable" | "allowed" | "blocked";
  selectedCustomCapabilityGateReason?: string;
  allowedTemplateOrigins?: Array<"builtin" | "custom">;
  defaultMessageType?: string;
  defaultTargetRoleTypes?: string[];
  stageIsolationMode?: "wrapper_enforced" | "sandbox_mount" | "containerized";
  stageRuntimeClass?: "default_shell" | "sandbox_reserved" | "container_reserved";
  retainOnSuccess?: boolean;
  purgeArtifactsAfterArchive?: boolean;
}): Record<string, unknown> {
  return {
    schema_version: "worker-lifecycle-governance-contract-v1",
    policy_id: "worker_lifecycle_policy_default_v1",
    task_id: params?.taskId ?? "task_demo",
    operation_id: params?.operationId ?? "op_1",
    dispatch_seq: params?.dispatchSeq ?? 1,
    budget_governance: {
      budget_lane: params?.budgetLane ?? "fast",
      fast_token_budget: 50000,
      degraded_token_budget: 75000,
      reclaim_threshold: 100000,
      primary_axis: "token",
    },
    template_governance: {
      allowed_template_origins: params?.allowedTemplateOrigins ?? ["builtin", "custom"],
      require_enabled_custom_registration: true,
      selected_template_origin: params?.selectedTemplateOrigin ?? "builtin",
      selected_template_id: params?.selectedTemplateId ?? "websocket_calculator",
      selected_custom_registration_enabled: params?.selectedCustomRegistrationEnabled ?? true,
      selected_custom_runtime_gate_status: params?.selectedCustomRuntimeGateStatus ?? "not_applicable",
      selected_custom_capability_gate_reason: params?.selectedCustomCapabilityGateReason ?? "",
    },
    overlay_governance: {
      allowed_overlay_fields: ["delivery_expectations", "default_test_mode", "default_target_role_types"],
      effective_overlay_defaults: {},
    },
    mailbox_governance: {
      default_message_type: params?.defaultMessageType ?? "partial_deliverable",
      default_target_role_types: params?.defaultTargetRoleTypes ?? ["tester-ephemeral"],
      message_type_allowlist: ["partial_deliverable", "dependency_update", "handoff_note"],
    },
    result_governance: {
      required_result_contract_version: "worker-template-result-contract-v1",
      strict_result_validation: true,
    },
    evidence_governance: {
      evidence_profile: "backend_profile",
      require_summary: true,
      require_test_command: true,
      require_changed_files: true,
      require_evidence_notes: true,
      require_runbook: true,
      allow_missing_test_command_with_reason: false,
    },
    worker_stage_governance: {
      worker_stage_scope: "per_worker_instance",
      worker_stage_profile: "normal",
      stage_isolation_mode: params?.stageIsolationMode ?? "wrapper_enforced",
      stage_runtime_class: params?.stageRuntimeClass ?? "default_shell",
      allowed_execution_mode: "local_threads",
      worker_stage_max_bytes: 1_000_000,
      worker_stage_max_file_count: 128,
      worker_stage_max_single_file_bytes: 256_000,
      allow_binary_artifacts: false,
      worker_stage_overflow_policy: "block_write",
      worker_stage_retention_policy: "retain_delivery_only",
      success_cleanup_rule: "retain_delivery_only",
      failure_cleanup_rule: "retain_evidence_bundle",
      purge_on_success: true,
      purge_on_failure: false,
      export_policy: {
        allow_delivery_manifest_only: true,
        retain_on_success: params?.retainOnSuccess ?? true,
        retain_on_failure: true,
        archive_on_tester_consume: true,
        archive_failed_export_evidence: true,
        retain_export_records_when_stage_purged: true,
        purge_artifacts_after_archive: params?.purgeArtifactsAfterArchive ?? false,
        retain_archive_manifest: true,
      },
      mailbox_attachment_policy: {
        allow_exported_artifact_references: true,
        max_attachment_bytes: 5_000_000,
        allowed_artifact_types: ["text/plain", "text/markdown", "application/json", "application/x-python"],
      },
    },
    rebuild_governance: {
      allow_rebuild: true,
      rebuild_on_budget_amendment: true,
      rebuild_on_refinement_amendment: true,
    },
  };
}

function buildWorkerStage(
  taskDir: string,
  taskId: string,
  suffix = "1",
  profile = "normal",
  stageIsolationMode: "wrapper_enforced" | "sandbox_mount" | "containerized" = "wrapper_enforced",
  stageRuntimeClass: "default_shell" | "sandbox_reserved" | "container_reserved" = "default_shell",
): Record<string, unknown> {
  const workerStageId = `workerstage_${taskId}_op_${suffix}`;
  const root = path.join(taskDir, "worker_stages", workerStageId);
  return {
    schema_version: "worker-stage-contract-v1",
    task_id: taskId,
    worker_stage_id: workerStageId,
    worker_stage_profile: profile,
    stage_isolation_mode: stageIsolationMode,
    stage_runtime_class: stageRuntimeClass,
    allowed_execution_mode: "local_threads",
    worker_stage_root: root,
    scratch_root: path.join(root, "scratch"),
    delivery_root: path.join(root, "delivery"),
    inputs_root: path.join(root, "inputs"),
    runtime_root: path.join(root, "runtime"),
    mount_policy: {
      inputs_root: "read_only",
      scratch_root: "read_write",
      delivery_root: "write_only",
      cluster_mailbox: "append_only",
      authority_paths: "read_only",
    },
    allocation: {
      worker_stage_scope: "per_worker_instance",
      worker_stage_max_bytes: 1_000_000,
      worker_stage_max_file_count: 128,
      worker_stage_max_single_file_bytes: 256_000,
      allow_binary_artifacts: false,
      worker_stage_overflow_policy: "block_write",
    },
    retention: {
      worker_stage_retention_policy: "retain_delivery_only",
      success_cleanup_rule: "retain_delivery_only",
      failure_cleanup_rule: "retain_evidence_bundle",
      purge_on_success: true,
      purge_on_failure: false,
    },
  };
}

describe("worker_realize_task.sh", () => {
  it("consumes worker runtime view and publishes a cluster mailbox message without auto-archiving", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-"));
    const taskId = "task_demo_worker";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Build websocket calculator",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
      task_cluster: {
        mailbox_counters: {
          published: 0,
          consumed: 0,
          archived: 0,
        },
      },
    });
    await writeJson(path.join(taskDir, `${taskId}.strategy.json`), {
      goal: "Build websocket calculator",
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: {
        role_type: "worker-delivery",
      },
      worker_stage: buildWorkerStage(taskDir, taskId),
      collaboration: {
        cluster_id: "cluster_demo",
        cluster_root: path.join(taskDir, "task_cluster_workspace"),
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "python",
          framework_layer: "generic",
          custom_overlay_layer: {
            overlay_id: "none",
            overlay_fields: [],
          },
        },
        component_candidates: ["websocket_calculator"],
        goal: "Build websocket calculator",
        preferred_template_ids: ["websocket_calculator"],
      },
      selected_template: {
        template_id: "websocket_calculator",
        template_origin: "builtin",
        template_source_id: "builtin:websocket_calculator",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/websocket_calculator.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        selectedTemplateId: "websocket_calculator",
        selectedTemplateOrigin: "builtin",
        defaultMessageType: "partial_deliverable",
        defaultTargetRoleTypes: ["tester-ephemeral"],
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    execFileSync(
      path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"),
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
    const archive = await fs.readFile(
      path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
      "utf8",
    );
    const mailbox = await fs.readFile(
      path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
      "utf8",
    );
    expect((meta.worker_convergence as Record<string, unknown>).convergence_class).toBe(
      "partial_deliverable",
    );
    expect((meta.worker_runtime as Record<string, unknown>).selected_template_origin).toBe("builtin");
    expect((meta.worker_runtime as Record<string, unknown>).selected_template_source_id).toBe(
      "builtin:websocket_calculator",
    );
    expect((meta.worker_runtime as Record<string, unknown>).template_version).toBe("v1");
    expect((meta.worker_runtime as Record<string, unknown>).registration_source).toBe("builtin_registry");
    expect((meta.worker_runtime as Record<string, unknown>).governance_policy_id).toBe(
      "worker_lifecycle_policy_default_v1",
    );
    expect((meta.worker_runtime as Record<string, unknown>).result_contract_version).toBe(
      "worker-template-result-contract-v1",
    );
    expect((meta.worker_runtime as Record<string, unknown>).allowed_template_origins).toEqual([
      "builtin",
      "custom",
    ]);
    expect((meta.worker_runtime as Record<string, unknown>).custom_registration_required).toBe(true);
    expect((meta.worker_stage as Record<string, unknown>).worker_stage_id).toBe(
      `workerstage_${taskId}_op_1`,
    );
    expect((meta.worker_stage as Record<string, unknown>).worker_stage_root).toBe(
      path.join(taskDir, "worker_stages", `workerstage_${taskId}_op_1`),
    );
    expect((meta.worker_stage as Record<string, unknown>).worker_stage_profile).toBe("normal");
    expect((meta.worker_stage as Record<string, unknown>).stage_isolation_mode).toBe(
      "wrapper_enforced",
    );
    expect((((meta.worker_stage as Record<string, unknown>).allocation as Record<string, unknown>).worker_stage_overflow_status)).toBe("ok");
    expect((((meta.worker_stage as Record<string, unknown>).retention as Record<string, unknown>).worker_stage_exported_artifact_count)).toBe(3);
    expect((((meta.worker_stage as Record<string, unknown>).retention as Record<string, unknown>).worker_stage_last_export_status)).toBe("exported");
    expect((((meta.worker_stage as Record<string, unknown>).retention as Record<string, unknown>).worker_stage_last_export_manifest_class)).toBe(
      "delivery_manifest",
    );
    expect((((meta.worker_stage as Record<string, unknown>).retention as Record<string, unknown>).worker_stage_last_cleanup_at)).toBeTruthy();
    expect((((meta.worker_stage as Record<string, unknown>).retention as Record<string, unknown>).worker_stage_retention_result)).toMatchObject({
      retention_decision: "retain_delivery_only",
    });
    expect(
      (((((meta.worker_stage as Record<string, unknown>).retention as Record<string, unknown>).worker_stage_retention_result as Record<string, unknown>))
        .retained_paths as string[]),
    ).toContain("delivery.export-records.json");
    expect((meta.worker_runtime as Record<string, unknown>).default_message_type).toBe(
      "partial_deliverable",
    );
    expect((meta.task_cluster as Record<string, unknown>).cluster_root).toBe(
      path.join(taskDir, "task_cluster_workspace"),
    );
    expect((meta.task_cluster as Record<string, unknown>).last_published_message_type).toBe(
      "partial_deliverable",
    );
    expect(
      ((meta.task_cluster as Record<string, unknown>).mailbox_counters as Record<string, unknown>).published,
    ).toBe(1);
    expect(
      ((meta.task_cluster as Record<string, unknown>).mailbox_counters as Record<string, unknown>).acknowledged,
    ).toBe(0);
    expect(
      ((meta.task_cluster as Record<string, unknown>).mailbox_counters as Record<string, unknown>).archived,
    ).toBe(0);
    expect(mailbox).toContain("\"target_role_types\":[\"tester-ephemeral\"]");
    expect(mailbox).toContain("\"status\":\"published\"");
    expect(mailbox).toContain("\"attachments\":[");
    expect(archive).toBe("");
  });

  it("reports stalled when no template matches runtime view input", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-unmatched-"));
    const taskId = "task_demo_unmatched";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Unknown delivery task",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
    });
    await writeJson(path.join(taskDir, `${taskId}.strategy.json`), {
      goal: "Unknown delivery task",
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: {
        role_type: "worker-delivery",
      },
      collaboration: {
        cluster_id: "cluster_demo",
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "generic",
          framework_layer: "generic",
          custom_overlay_layer: {
            overlay_id: "none",
            overlay_fields: [],
            config: {},
          },
        },
        component_candidates: ["unmatched_component"],
        goal: "Unknown delivery task",
        preferred_template_ids: [],
      },
      selected_template: {
        template_id: "code_generic_placeholder",
        template_origin: "builtin",
        template_source_id: "builtin:code_generic_placeholder",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "",
        delivery_mode: "unsupported_placeholder",
        template_kind: "placeholder",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        selectedTemplateId: "code_generic_placeholder",
        selectedTemplateOrigin: "builtin",
        defaultMessageType: "partial_deliverable",
        defaultTargetRoleTypes: ["tester-ephemeral"],
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    expect(() =>
      execFileSync(
        path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"),
        [taskDir],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      ),
    ).toThrow();
    const meta = JSON.parse(await fs.readFile(path.join(taskDir, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect((meta.worker_convergence as Record<string, unknown>).convergence_class).toBe("stalled");
  });

  it("executes the java spring template from implementation topology", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-topology-"));
    const taskId = "task_demo_topology";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Build Java Spring backend",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
      task_cluster: {
        mailbox_counters: {
          published: 0,
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
        role_type: "worker-delivery",
      },
      collaboration: {
        cluster_id: "cluster_demo",
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery", "impl_role:backend", "tech:java"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "java",
          framework_layer: "spring",
          custom_overlay_layer: {
            overlay_id: "none",
            overlay_fields: [],
            config: {},
          },
        },
        component_candidates: [],
        goal: "Build Java Spring backend",
        preferred_template_ids: ["code_backend_java_spring"],
      },
      selected_template: {
        template_id: "code_backend_java_spring",
        template_origin: "builtin",
        template_source_id: "builtin:code_backend_java_spring",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/code_backend_java_spring.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        selectedTemplateId: "code_backend_java_spring",
        selectedTemplateOrigin: "builtin",
        defaultMessageType: "partial_deliverable",
        defaultTargetRoleTypes: ["tester-ephemeral"],
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    execFileSync(
      path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"),
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
    expect((meta.worker_convergence as Record<string, unknown>).convergence_class).toBe(
      "partial_deliverable",
    );
    expect(await fs.readFile(path.join(taskDir, "delivery", "build.gradle"), "utf8")).toContain(
      "plugins",
    );
  });

  it("executes the frontend react template and respects default_test_mode overlay", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-frontend-"));
    const taskId = "task_demo_frontend";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Build React frontend",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
      task_cluster: {
        mailbox_counters: { published: 0, acknowledged: 0, consumed: 0, archived: 0 },
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      collaboration: {
        cluster_id: "cluster_demo",
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery", "impl_role:frontend", "tech:typescript"],
        default_target_role_types: ["tester-ephemeral"],
      },
      implementation_topology: {
        custom_overlay_layer: {
          config: {
            default_test_mode: "vite_smoke",
          },
        },
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "frontend",
          tech_layer: "typescript",
          framework_layer: "react",
          custom_overlay_layer: {
            overlay_id: "custom",
            overlay_fields: ["default_test_mode"],
            config: { default_test_mode: "vite_smoke" },
          },
        },
        component_candidates: ["frontend_ui"],
        goal: "Build React frontend",
        preferred_template_ids: ["code_frontend_typescript_react"],
      },
      selected_template: {
        template_id: "code_frontend_typescript_react",
        template_origin: "builtin",
        template_source_id: "builtin:code_frontend_typescript_react",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/code_frontend_typescript_react.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        selectedTemplateId: "code_frontend_typescript_react",
        selectedTemplateOrigin: "builtin",
        defaultMessageType: "partial_deliverable",
        defaultTargetRoleTypes: ["tester-ephemeral"],
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(await fs.readFile(path.join(taskDir, "delivery", "src", "App.tsx"), "utf8")).toContain(
      "Worker Role Template",
    );
    expect(await fs.readFile(path.join(taskDir, "delivery", "RUNBOOK.md"), "utf8")).toContain(
      "vite_smoke",
    );
  });

  it("executes the database sql template", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-sql-"));
    const taskId = "task_demo_sql";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Prepare SQL migration",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
      task_cluster: {
        mailbox_counters: { published: 0, acknowledged: 0, consumed: 0, archived: 0 },
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      collaboration: {
        cluster_id: "cluster_demo",
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery", "impl_role:database", "tech:sql"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "database",
          tech_layer: "sql",
          framework_layer: "generic",
          custom_overlay_layer: {
            overlay_id: "none",
            overlay_fields: [],
            config: {},
          },
        },
        component_candidates: ["database_schema"],
        goal: "Prepare SQL migration",
        preferred_template_ids: ["code_database_sql_generic"],
      },
      selected_template: {
        template_id: "code_database_sql_generic",
        template_origin: "builtin",
        template_source_id: "builtin:code_database_sql_generic",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/code_database_sql_generic.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        selectedTemplateId: "code_database_sql_generic",
        selectedTemplateOrigin: "builtin",
        defaultMessageType: "partial_deliverable",
        defaultTargetRoleTypes: ["tester-ephemeral"],
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(
      await fs.readFile(path.join(taskDir, "delivery", "migrations", "001_create_example_table.sql"), "utf8"),
    ).toContain("CREATE TABLE");
  });

  it("executes the data python template and uses role-aware defaults", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-data-"));
    const taskId = "task_demo_data";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Prepare data transformation bundle",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
      task_cluster: {
        mailbox_counters: { published: 0, acknowledged: 0, consumed: 0, archived: 0 },
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      collaboration: {
        cluster_id: "cluster_demo",
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery", "impl_role:data", "tech:python"],
        default_target_role_types: ["worker-delivery"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "data",
          tech_layer: "python",
          framework_layer: "generic",
          custom_overlay_layer: {
            overlay_id: "data_defaults",
            overlay_fields: ["delivery_expectations", "default_target_role_types"],
            config: {
              delivery_expectations: ["sample_input_output"],
              default_target_role_types: ["worker-delivery"],
            },
          },
        },
        component_candidates: ["data_pipeline"],
        goal: "Prepare data transformation bundle",
        preferred_template_ids: ["code_data_python_generic"],
      },
      selected_template: {
        template_id: "code_data_python_generic",
        template_origin: "builtin",
        template_source_id: "builtin:code_data_python_generic",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/code_data_python_generic.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "dependency_update",
        default_target_role_types: ["worker-delivery"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        selectedTemplateId: "code_data_python_generic",
        selectedTemplateOrigin: "builtin",
        defaultMessageType: "dependency_update",
        defaultTargetRoleTypes: ["worker-delivery"],
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    const meta = JSON.parse(await fs.readFile(path.join(taskDir, "meta.json"), "utf8")) as Record<string, unknown>;
    const mailbox = await fs.readFile(
      path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
      "utf8",
    );
    expect(await fs.readFile(path.join(taskDir, "delivery", "transform_data.py"), "utf8")).toContain(
      "normalize_score",
    );
    expect(await fs.readFile(path.join(taskDir, "delivery", "RUNBOOK.md"), "utf8")).toContain(
      "sample_input_output",
    );
    expect((meta.task_cluster as Record<string, unknown>).last_published_message_type).toBe(
      "dependency_update",
    );
    expect(mailbox).toContain("\"message_type\":\"dependency_update\"");
    expect(mailbox).toContain("\"target_role_types\":[\"worker-delivery\"]");
  });

  it("executes the infra template and publishes a handoff note", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-infra-"));
    const taskId = "task_demo_infra";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Prepare infra config bundle",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
      task_cluster: {
        mailbox_counters: { published: 0, acknowledged: 0, consumed: 0, archived: 0 },
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      collaboration: {
        cluster_id: "cluster_demo",
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery", "impl_role:infra", "tech:generic"],
        default_target_role_types: ["tester-ephemeral", "audit-guard"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "integrate",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "infra",
          tech_layer: "generic",
          framework_layer: "generic",
          custom_overlay_layer: {
            overlay_id: "infra_defaults",
            overlay_fields: ["delivery_expectations"],
            config: {
              delivery_expectations: ["config_bundle", "validation_artifact"],
            },
          },
        },
        component_candidates: ["infra_bundle"],
        goal: "Prepare infra config bundle",
        preferred_template_ids: ["code_infra_generic_generic"],
      },
      selected_template: {
        template_id: "code_infra_generic_generic",
        template_origin: "builtin",
        template_source_id: "builtin:code_infra_generic_generic",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/code_infra_generic_generic.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "handoff_note",
        default_target_role_types: ["tester-ephemeral", "audit-guard"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        selectedTemplateId: "code_infra_generic_generic",
        selectedTemplateOrigin: "builtin",
        defaultMessageType: "handoff_note",
        defaultTargetRoleTypes: ["tester-ephemeral", "audit-guard"],
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    const meta = JSON.parse(await fs.readFile(path.join(taskDir, "meta.json"), "utf8")) as Record<string, unknown>;
    const mailbox = await fs.readFile(
      path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
      "utf8",
    );
    expect(await fs.readFile(path.join(taskDir, "delivery", "infra-compose.yaml"), "utf8")).toContain(
      "example-service",
    );
    expect(await fs.readFile(path.join(taskDir, "delivery", "RUNBOOK.md"), "utf8")).toContain(
      "config_bundle",
    );
    expect((meta.task_cluster as Record<string, unknown>).last_published_message_type).toBe("handoff_note");
    expect(mailbox).toContain("\"message_type\":\"handoff_note\"");
    expect(mailbox).toContain("\"target_role_types\":[\"tester-ephemeral\",\"audit-guard\"]");
  });

  it("executes the script automation template with a role-aware runbook", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-script-"));
    const taskId = "task_demo_script";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Prepare automation helper",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
      task_cluster: {
        mailbox_counters: { published: 0, acknowledged: 0, consumed: 0, archived: 0 },
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      collaboration: {
        cluster_id: "cluster_demo",
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery", "impl_role:script_automation", "tech:python"],
        default_target_role_types: ["tester-ephemeral", "audit-guard"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "integrate",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "script_automation",
          tech_layer: "python",
          framework_layer: "generic",
          custom_overlay_layer: {
            overlay_id: "script_defaults",
            overlay_fields: ["default_test_mode", "default_target_role_types"],
            config: {
              default_test_mode: "python_cli_smoke",
              default_target_role_types: ["tester-ephemeral", "audit-guard"],
            },
          },
        },
        component_candidates: ["automation_helper"],
        goal: "Prepare automation helper",
        preferred_template_ids: ["code_script_automation_python_generic"],
      },
      selected_template: {
        template_id: "code_script_automation_python_generic",
        template_origin: "builtin",
        template_source_id: "builtin:code_script_automation_python_generic",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/code_script_automation_python_generic.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "handoff_note",
        default_target_role_types: ["tester-ephemeral", "audit-guard"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        selectedTemplateId: "code_script_automation_python_generic",
        selectedTemplateOrigin: "builtin",
        defaultMessageType: "handoff_note",
        defaultTargetRoleTypes: ["tester-ephemeral", "audit-guard"],
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(await fs.readFile(path.join(taskDir, "delivery", "automation_cli.py"), "utf8")).toContain(
      "argparse",
    );
    expect(await fs.readFile(path.join(taskDir, "delivery", "RUNBOOK.md"), "utf8")).toContain(
      "python_cli_smoke",
    );
  });

  it("executes a custom template through the standard worker wrapper", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-custom-"));
    const taskId = "task_demo_custom";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Build custom backend delivery",
      worker_runtime: {
        custom_template_registrations: [
          {
            template_id: "custom_backend_python_generic",
            template_origin: "custom",
            template_source_id: "entry:custom_backend_python_generic",
            handler_script: "worker_templates/custom_echo_bundle.sh",
            supported_role_types: ["worker-delivery"],
            artifact_layer: "code",
            coarse_template_role: "backend",
            role_layer: "backend",
            tech_layer: "python",
            framework_layer: "generic",
            mount_tree: "engineering",
            mount_path: ["backend"],
            delivery_mode: "deterministic_python_bundle",
            template_kind: "concrete",
            overlay_capabilities: ["default_test_mode"],
            template_version: "v1",
            registration_source: "entry_worker_import",
            registered_at: "2026-03-11T00:00:00Z",
            enabled: true,
          },
        ],
      },
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
      task_cluster: {
        mailbox_counters: { published: 0, acknowledged: 0, consumed: 0, archived: 0 },
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      collaboration: {
        cluster_id: "cluster_demo",
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery", "impl_role:backend", "tech:python"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "python",
          framework_layer: "generic",
          custom_overlay_layer: {
            overlay_id: "custom_defaults",
            overlay_fields: ["default_test_mode"],
            config: { default_test_mode: "custom_echo_check" },
          },
        },
        component_candidates: ["custom_api"],
        goal: "Build custom backend delivery",
        preferred_template_ids: ["custom_backend_python_generic"],
      },
      selected_template: {
        template_id: "custom_backend_python_generic",
        template_origin: "custom",
        template_source_id: "entry:custom_backend_python_generic",
        template_version: "v1",
        registration_source: "entry_worker_import",
        handler_script: "worker_templates/custom_echo_bundle.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        selectedTemplateId: "custom_backend_python_generic",
        selectedTemplateOrigin: "custom",
        selectedCustomRegistrationEnabled: true,
        defaultMessageType: "partial_deliverable",
        defaultTargetRoleTypes: ["tester-ephemeral"],
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const meta = JSON.parse(await fs.readFile(path.join(taskDir, "meta.json"), "utf8")) as Record<string, unknown>;
    expect((meta.worker_convergence as Record<string, unknown>).convergence_class).toBe("partial_deliverable");
    expect((meta.worker_runtime as Record<string, unknown>).selected_template_origin).toBe("custom");
    expect((meta.worker_runtime as Record<string, unknown>).selected_template_source_id).toBe(
      "entry:custom_backend_python_generic",
    );
    expect(await fs.readFile(path.join(taskDir, "delivery", "custom_delivery.txt"), "utf8")).toContain(
      "template_source_id=entry:custom_backend_python_generic",
    );
  });

  it("reports stalled when a handler returns invalid json", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-invalid-handler-"));
    const taskId = "task_demo_invalid_handler";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Trigger invalid handler",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      collaboration: {
        cluster_id: "cluster_demo",
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "python",
          framework_layer: "generic",
          custom_overlay_layer: {
            overlay_id: "none",
            overlay_fields: [],
            config: {},
          },
        },
        component_candidates: ["custom_api"],
        goal: "Trigger invalid handler",
        preferred_template_ids: ["custom_invalid_handler"],
      },
      selected_template: {
        template_id: "custom_invalid_handler",
        template_origin: "custom",
        template_source_id: "entry:custom_invalid_handler",
        template_version: "v1",
        registration_source: "entry_worker_import",
        handler_script: "worker_templates/invalid_json_handler.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        selectedTemplateId: "custom_invalid_handler",
        selectedTemplateOrigin: "custom",
        selectedCustomRegistrationEnabled: true,
        defaultMessageType: "partial_deliverable",
        defaultTargetRoleTypes: ["tester-ephemeral"],
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    expect(() =>
      execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
        cwd: repoRoot,
        encoding: "utf8",
      }),
    ).toThrow();

    const meta = JSON.parse(await fs.readFile(path.join(taskDir, "meta.json"), "utf8")) as Record<string, unknown>;
    expect((meta.worker_convergence as Record<string, unknown>).convergence_class).toBe("stalled");
    expect((meta.worker_convergence as Record<string, unknown>).reclaim_reason).toBe(
      "runtime_capability_insufficient",
    );
  });

  it("blocks a custom template when lifecycle governance requires an enabled registration", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-disabled-custom-"));
    const taskId = "task_demo_disabled_custom";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Blocked custom template",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      collaboration: {
        cluster_id: "cluster_demo",
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "python",
          framework_layer: "generic",
          custom_overlay_layer: {
            overlay_id: "none",
            overlay_fields: [],
            config: {},
          },
        },
        component_candidates: ["custom_api"],
        goal: "Blocked custom template",
        preferred_template_ids: ["custom_backend_python_generic"],
      },
      selected_template: {
        template_id: "custom_backend_python_generic",
        template_origin: "custom",
        template_source_id: "entry:custom_backend_python_generic",
        template_version: "v1",
        registration_source: "entry_worker_import",
        handler_script: "worker_templates/custom_echo_bundle.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        selectedTemplateId: "custom_backend_python_generic",
        selectedTemplateOrigin: "custom",
        selectedCustomRegistrationEnabled: false,
        defaultMessageType: "partial_deliverable",
        defaultTargetRoleTypes: ["tester-ephemeral"],
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "log.ndjson"), "", "utf8");

    expect(() =>
      execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
        cwd: repoRoot,
        encoding: "utf8",
      }),
    ).toThrow();

    const meta = JSON.parse(await fs.readFile(path.join(taskDir, "meta.json"), "utf8")) as Record<string, unknown>;
    expect((meta.worker_convergence as Record<string, unknown>).convergence_class).toBe("stalled");
    expect((meta.worker_convergence as Record<string, unknown>).reclaim_reason).toBe(
      "runtime_capability_insufficient",
    );
  });

  it("rejects writes outside the execution workspace", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-forbidden-"));
    const taskId = "task_demo_forbidden";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Attempt forbidden write",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      worker_stage: buildWorkerStage(taskDir, taskId, "2"),
      collaboration: {
        cluster_id: "cluster_demo",
        cluster_root: path.join(taskDir, "task_cluster_workspace"),
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "python",
          framework_layer: "generic",
          custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
        },
        component_candidates: ["websocket_calculator"],
        goal: "Attempt forbidden write",
        preferred_template_ids: ["forbidden_write_handler"],
      },
      selected_template: {
        template_id: "forbidden_write_handler",
        template_origin: "builtin",
        template_source_id: "builtin:forbidden_write_handler",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/forbidden_write_handler.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({ taskId }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");

    expect(() =>
      execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
        cwd: repoRoot,
        encoding: "utf8",
      }),
    ).toThrow();

    const meta = JSON.parse(await fs.readFile(path.join(taskDir, "meta.json"), "utf8")) as Record<string, unknown>;
    expect((((meta.worker_stage as Record<string, unknown>).retention as Record<string, unknown>).worker_stage_last_fault_class)).toBe(
      "worker_stage_forbidden_write",
    );
    await expect(fs.stat(path.join(taskDir, "rogue.txt"))).resolves.toBeTruthy();
  });

  it("blocks binary delivery artifacts when governance disallows them", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-binary-"));
    const taskId = "task_demo_binary";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Produce binary artifact",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      worker_stage: buildWorkerStage(taskDir, taskId, "3"),
      collaboration: {
        cluster_id: "cluster_demo",
        cluster_root: path.join(taskDir, "task_cluster_workspace"),
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "python",
          framework_layer: "generic",
          custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
        },
        component_candidates: ["websocket_calculator"],
        goal: "Produce binary artifact",
        preferred_template_ids: ["binary_delivery_handler"],
      },
      selected_template: {
        template_id: "binary_delivery_handler",
        template_origin: "builtin",
        template_source_id: "builtin:binary_delivery_handler",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/binary_delivery_handler.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({ taskId }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");

    expect(() =>
      execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
        cwd: repoRoot,
        encoding: "utf8",
      }),
    ).toThrow();

    const meta = JSON.parse(await fs.readFile(path.join(taskDir, "meta.json"), "utf8")) as Record<string, unknown>;
    expect((((meta.worker_stage as Record<string, unknown>).retention as Record<string, unknown>).worker_stage_last_fault_class)).toBe(
      "worker_stage_binary_artifact_disallowed",
    );
  });

  it("rejects writes into a sibling worker stage", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-cross-stage-"));
    const taskId = "task_demo_cross_stage";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Attempt cross-stage write",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      worker_stage: buildWorkerStage(taskDir, taskId, "5"),
      collaboration: {
        cluster_id: "cluster_demo",
        cluster_root: path.join(taskDir, "task_cluster_workspace"),
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "python",
          framework_layer: "generic",
          custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
        },
        component_candidates: ["websocket_calculator"],
        goal: "Attempt cross-stage write",
        preferred_template_ids: ["cross_stage_write_handler"],
      },
      selected_template: {
        template_id: "cross_stage_write_handler",
        template_origin: "builtin",
        template_source_id: "builtin:cross_stage_write_handler",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/cross_stage_write_handler.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({ taskId }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");

    expect(() =>
      execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
        cwd: repoRoot,
        encoding: "utf8",
      }),
    ).toThrow();

    const meta = JSON.parse(await fs.readFile(path.join(taskDir, "meta.json"), "utf8")) as Record<string, unknown>;
    expect((((meta.worker_stage as Record<string, unknown>).retention as Record<string, unknown>).worker_stage_last_fault_class)).toBe(
      "worker_stage_forbidden_write",
    );
    await expect(
      fs.stat(path.join(taskDir, "worker_stages", "workerstage_cross_target", "rogue.txt")),
    ).resolves.toBeTruthy();
  });

  it("blocks oversized workspace output when delivery exceeds governance budget", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-overflow-"));
    const taskId = "task_demo_overflow";
    const workerStage = buildWorkerStage(taskDir, taskId, "4");
    const lifecycleGovernance = buildLifecycleGovernance({ taskId }) as Record<string, unknown>;
    (lifecycleGovernance.worker_stage_governance as Record<string, unknown>).worker_stage_max_single_file_bytes =
      1024;
    (lifecycleGovernance.worker_stage_governance as Record<string, unknown>).worker_stage_max_bytes = 2048;
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Overflow workspace budget",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      worker_stage: {
        ...workerStage,
        allocation: {
          ...(workerStage.allocation as Record<string, unknown>),
          worker_stage_max_single_file_bytes: 1024,
          worker_stage_max_bytes: 2048,
        },
      },
      collaboration: {
        cluster_id: "cluster_demo",
        cluster_root: path.join(taskDir, "task_cluster_workspace"),
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "python",
          framework_layer: "generic",
          custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
        },
        component_candidates: ["websocket_calculator"],
        goal: "Overflow workspace budget",
        preferred_template_ids: ["oversized_delivery_handler"],
      },
      selected_template: {
        template_id: "oversized_delivery_handler",
        template_origin: "builtin",
        template_source_id: "builtin:oversized_delivery_handler",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/oversized_delivery_handler.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: lifecycleGovernance,
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");

    expect(() =>
      execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
        cwd: repoRoot,
        encoding: "utf8",
      }),
    ).toThrow();

    const meta = JSON.parse(await fs.readFile(path.join(taskDir, "meta.json"), "utf8")) as Record<string, unknown>;
    expect((((meta.worker_stage as Record<string, unknown>).retention as Record<string, unknown>).worker_stage_last_fault_class)).toBe(
      "worker_stage_exhausted",
    );
  });

  it("executes through sandbox_mount isolation and keeps readonly inputs intact", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-sandbox-"));
    const taskId = "task_demo_sandbox";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Sandbox mount worker stage",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      worker_stage: buildWorkerStage(taskDir, taskId, "1", "normal", "sandbox_mount", "sandbox_reserved"),
      collaboration: {
        cluster_id: "cluster_demo",
        cluster_root: path.join(taskDir, "task_cluster_workspace"),
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "python",
          framework_layer: "generic",
          custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
        },
        component_candidates: ["websocket_calculator"],
        goal: "Sandbox mount worker stage",
        preferred_template_ids: ["websocket_calculator"],
      },
      selected_template: {
        template_id: "websocket_calculator",
        template_origin: "builtin",
        template_source_id: "builtin:websocket_calculator",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/websocket_calculator.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        stageIsolationMode: "sandbox_mount",
        stageRuntimeClass: "sandbox_reserved",
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");

    execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    const meta = JSON.parse(await fs.readFile(path.join(taskDir, "meta.json"), "utf8")) as Record<string, unknown>;
    expect((meta.worker_stage as Record<string, unknown>).stage_isolation_mode).toBe("sandbox_mount");
    expect((meta.worker_stage as Record<string, unknown>).stage_runtime_class).toBe("sandbox_reserved");
    expect((((meta.worker_stage as Record<string, unknown>).retention as Record<string, unknown>).worker_stage_last_fault_class)).toBe("");
    await expect(
      fs.access(path.join(taskDir, "worker_stages", "workerstage_task_demo_sandbox_op_1", "runtime")),
    ).rejects.toThrow();
  });

  it("archives and purges exported artifacts when success retention disables active delivery retention", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-realize-archive-"));
    const taskId = "task_demo_archive";
    await writeJson(path.join(taskDir, "meta.json"), {
      id: taskId,
      state: "IN_PROGRESS",
      goal: "Archive delivery artifacts",
      worker_convergence: {
        convergence_class: "not_converged",
        convergence_confidence: 0,
        progress_delta: 0,
        remaining_work_estimate: "",
        reclaim_reason: "",
        reported_at: "",
      },
    });
    await writeJson(path.join(taskDir, "worker_runtime_view.json"), {
      schema_version: "worker-runtime-view-v1",
      task_id: taskId,
      dispatch: { role_type: "worker-delivery" },
      worker_stage: buildWorkerStage(taskDir, taskId),
      collaboration: {
        cluster_id: "cluster_demo",
        cluster_root: path.join(taskDir, "task_cluster_workspace"),
        workspace_root: path.join(taskDir, "task_cluster_workspace"),
        mailbox_path: path.join(taskDir, "task_cluster_workspace", "mailbox.ndjson"),
        archive_path: path.join(taskDir, "task_cluster_workspace", "mailbox.archive.ndjson"),
        memberships: ["role:worker-delivery"],
        default_target_role_types: ["tester-ephemeral"],
      },
      template_selector: {
        role_type: "worker-delivery",
        semantic_topology: {
          transaction_layer: "update",
          action_layer: "implement",
          budget_layer: "fast",
          convergence_layer: "not_converged",
        },
        implementation_topology: {
          artifact_layer: "code",
          role_layer: "backend",
          tech_layer: "python",
          framework_layer: "generic",
          custom_overlay_layer: { overlay_id: "none", overlay_fields: [], config: {} },
        },
        component_candidates: ["websocket_calculator"],
        goal: "Archive delivery artifacts",
        preferred_template_ids: ["websocket_calculator"],
      },
      selected_template: {
        template_id: "websocket_calculator",
        template_origin: "builtin",
        template_source_id: "builtin:websocket_calculator",
        template_version: "v1",
        registration_source: "builtin_registry",
        handler_script: "worker_templates/websocket_calculator.sh",
        delivery_mode: "deterministic_python_bundle",
        template_kind: "concrete",
        default_message_type: "partial_deliverable",
        default_target_role_types: ["tester-ephemeral"],
      },
      lifecycle_governance: buildLifecycleGovernance({
        taskId,
        retainOnSuccess: false,
        purgeArtifactsAfterArchive: true,
      }),
    });
    await fs.writeFile(path.join(taskDir, "work.md"), "", "utf8");
    await fs.writeFile(path.join(taskDir, "test.md"), "", "utf8");

    execFileSync(path.join(repoRoot, "agent-orchestrator", "scripts", "worker_realize_task.sh"), [taskDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    const exportRecords = JSON.parse(
      await fs.readFile(path.join(taskDir, "delivery.export-records.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    const archivedManifest = JSON.parse(
      await fs.readFile(path.join(taskDir, "delivery.archive", "archive-manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    await expect(fs.access(path.join(taskDir, "delivery", "calculator.py"))).rejects.toThrow();
    expect(exportRecords[0]?.archive_status).toBe("archived");
    expect(exportRecords[0]?.retention_status).toBe("archived_only");
    expect(exportRecords[0]?.last_lifecycle_action).toBe("purged_after_archive");
    expect(Array.isArray(archivedManifest.artifacts)).toBe(true);
  });
});
