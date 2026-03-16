# Custom Template Registration Contract

Code owner:
- `extensions/orchestrator-dashboard/orchestrate-worker-runtime-contract.ts`

Purpose:
- define the normalized registration shape that a custom worker template must satisfy before it can enter the worker template registry

## Producer / Consumer

- Producer: `entry` / `keeper` after import, parsing, and governance
- Consumer: worker runtime assembler and template registry builder

## Required Shape

- `schema_version = custom-template-registration-contract-v1`
- `template_id`
- `template_origin = custom`
- `template_source_id`
- `template_version`
- `registration_source`
- `registered_at`
- `enabled = true`
- `handler_script`
- `supported_role_types`
- `artifact_layer`
- `coarse_template_role`
- `role_layer`
- `tech_layer`
- `framework_layer`
- `mount_tree`
- `mount_path`
- `delivery_mode`
- `template_kind`
- `overlay_capabilities`
- `allowed_runtime_classes`
- `allowed_delivery_modes`
- `allowed_attachment_types`
- `allowed_export_classes`
- `allowed_execution_mode`
- `requires_evidence_profile`
- `enabled=false` custom registrations are ignored by the worker registry builder

## Compatibility Rules

- registration must map to the existing worker topology; no new artifact, compatibility role, tech, or framework enums may be introduced here
- `coarse_template_role` may reference a builtin role or a user-registered custom role, but it must already exist in the coarse role registry before registration is consumed
- `coarse_template_role` is the explicit coarse template responsibility class that participates in topology-driven resolution
- `role_layer` remains the compatibility role projection for implementation-layer consumers
- `tech_layer` and `framework_layer` are fine-template derivation inputs, not independent scheduler-owned config layers
- registration must explicitly declare `mount_tree` and `mount_path`; worker runtime must not infer where a custom template belongs
- `mount_path[0]` must equal `coarse_template_role`; disabled roles or disabled templates are filtered before deterministic resolution
- registration may define capability selection inputs such as component candidates or goal matchers
- registration may only declare runtime classes already recognized by `workerStage`; it cannot request new execution authority or bypass scheduler/runtime policy
- registration must declare its capability envelope up front: runtime class, delivery mode, attachment type, export class, execution mode, and evidence profile
- registration may only reference existing scheduler/runtime-owned enums and profiles; it must not invent new fault classes, artifact lifecycle schema, mailbox schema, or evidence authority
- registration must not carry runtime-state or authority fields such as budget lane, convergence class, mailbox status, or planner semantics
- unknown additive fields may exist upstream, but worker runtime only consumes the normalized contract subset
