import { describe, expect, it } from "vitest";
import { extractSchedulerConfig } from "../orchestrate-scheduler-contract.js";

describe("orchestrate-scheduler-contract", () => {
  it("extracts defaults from empty runtime", () => {
    const cfg = extractSchedulerConfig({});
    expect(cfg.schema_version).toBe("scheduler-config-v1");
    expect(cfg.scheduler_kernel_v2_enabled).toBe(false);
    expect(cfg.strategy).toBe("legacy_script");
    expect(cfg.retry).toEqual({
      base_ms: 2000,
      max_ms: 60000,
      max_attempts: 3,
    });
    expect(cfg.lane_quota).toEqual({
      recovery_min_share: 0.2,
      retry_min_share: 0.2,
      assigned_ready_min_share: 0.4,
    });
    expect(cfg.aging).toEqual({
      step_seconds: 60,
      max_boost: 60,
    });
    expect(cfg.distributed.queue.heartbeat_timeout_ms).toBe(45000);
    expect(cfg.distributed.consumer).toEqual({
      idempotency_max_keys: 10000,
      idempotency_ttl_ms: 86400000,
    });
    expect(cfg.worker_fault_policy).toEqual({
      fault_actuation_mode: "summary_only",
      allow_retry: true,
      allow_rebuild: true,
      allow_reclaim: true,
      allow_block: true,
    });
    expect(cfg.rollback_guard).toEqual({
      max_consecutive_tick_failures: 5,
      min_dispatch_success_rate: 0.6,
      max_queue_depth_growth: 200,
    });
  });

  it("honors explicit kernel_v2 config", () => {
    const cfg = extractSchedulerConfig({
      scheduler: {
        strategy: "kernel_v2",
        scheduler_kernel_v2_enabled: true,
        retry: {
          base_ms: 100,
          max_ms: 3000,
          max_attempts: 8,
        },
        throttle: {
          reserve_ratio: 0.1,
        },
        worker_fault_policy: {
          fault_actuation_mode: "enabled",
          allow_rebuild: false,
        },
      },
    });
    expect(cfg.scheduler_kernel_v2_enabled).toBe(true);
    expect(cfg.strategy).toBe("kernel_v2");
    expect(cfg.retry.max_attempts).toBe(8);
    expect(cfg.throttle.reserve_ratio).toBe(0.1);
    expect(cfg.worker_fault_policy.fault_actuation_mode).toBe("enabled");
    expect(cfg.worker_fault_policy.allow_rebuild).toBe(false);
  });
});
