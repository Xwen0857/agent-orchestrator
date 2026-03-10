# Planner Invariants

This document is the single normative source for planner split-plan invariants.

## Split Plan Schema

- `split_plan.schema_version` MUST be `planner-split-plan-v1`.
- Legacy payloads without `schema_version` are treated as `legacy-v0` and normalized before validation.

## Leaf Unit Invariants

- `leaf_id` MUST be unique inside one `refinement_partition.leaf_units`.
- `module_id`, `module_title`, and `component_candidate` MUST be non-empty strings.
- `depends_on_leaf_ids` entries MUST reference existing leaf ids in the same partition.
- A leaf MUST NOT depend on itself.
- A leaf MUST NOT depend on a future leaf (`dependency.sequence >= leaf.sequence`).
- If `depends_on_component_candidates` is declared, at least one upstream leaf MUST expose each component.
- Every dependency leaf's `component_candidate` MUST be present in `depends_on_component_candidates`.

## Dependency Mode

- Current dependency mode is fixed to `component_semantic_linearized`.
- Current dependency summary note is fixed to `planning_hint_not_scheduler_dag`.
- Dependency chains are planning-time coordination hints, not scheduler DAG execution controls.
- The constants above are guarded by planner contract/config consistency tests.
