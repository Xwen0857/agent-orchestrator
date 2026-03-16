# Role Permission Outputs

`role_permissions.generated.json` and `role_permissions.effective.json` are runtime-generated policy artifacts.

They are produced by:

- `agent-orchestrator/scripts/build_role_permissions.sh`

## Files

- `templates/coordination/security/role_permissions.generated.json`
- `templates/coordination/security/role_permissions.effective.json`
- `templates/coordination/security/role_permissions.overrides.json`

## Source-Control Policy

- keep `role_permissions.overrides.json` in version control
- treat `generated` and `effective` as mutable runtime outputs
- regenerate them locally when orchestration scripts need current policy state

## Why This Exists

The generated and effective ACL documents are continuously rebuilt from role skill files plus overrides. Tracking them in version control causes the working tree to become noisy during normal operation.

This README preserves the contract while allowing the generated outputs to remain operational artifacts instead of source documents.

## Observer Bridge Role

`observer-bridge` is a dedicated ACL role for the passive scheduler-to-core bridge path.

- it may read task-local artifacts under `templates/coordination/tasks/task_folders`
- it may write task-local bridge artifacts under the same task root
- it may not write planner config, audit policy, orchestrator runtime config, or project workspace roots

Planner authority remains owned by `planner-core`; `observer-bridge` only validates and normalizes candidate ingress artifacts.
