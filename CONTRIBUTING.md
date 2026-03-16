# Contributing

## Scope

This repository is the source tree for the `Agent Orchestrator` plugin ecosystem. Keep contributions focused on:

- orchestration scripts
- plugin entry and control surfaces
- role definitions
- templates and policy sources
- reproducible tooling and docs

Do not commit local runtime state, generated task outputs, or host-specific overrides.

## Development Model

`OpenClaw` is treated as an external host dependency, not part of this repository.

For local plugin development:

1. Clone this repository.
2. Clone an `OpenClaw` host separately.
3. Link the plugin into the host with:

```bash
bash scripts/install_openclaw_plugin.sh /path/to/openclaw
```

## Workflow

1. Create a focused branch.
2. Make the smallest coherent change that solves the problem.
3. Run the relevant validation for the area you touched.
4. Submit a pull request with a concrete summary and risk notes.

Prefer targeted changes over broad refactors unless the refactor is the actual task.

## Validation

When modifying the plugin layer, run:

```bash
cd /path/to/openclaw
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec vitest run src/plugins/orchestrator-dashboard.plugin.test.ts
```

When modifying this repository's plugin package directly, run lane-based checks:

```bash
bash scripts/test_orchestrator_plugin.sh planner-contract-lane
bash scripts/test_orchestrator_plugin.sh full-plugin-regression
```

Lane intent:
- `planner-contract-lane`: fast contract/regression checks for planner decomposition + split-plan summary surfaces.
- `full-plugin-regression`: full `extensions/orchestrator-dashboard` test suite.

When modifying shell orchestration logic, run the smallest script-level or task-level verification that proves behavior.

If a change is not fully testable in the current environment, state that clearly in the PR.

## Repository Hygiene

Keep generated artifacts out of version control. In particular:

- task run outputs
- workdomains
- generated dashboards
- generated ACL effective files
- local state under `.openclaw*`

If a file is runtime-derived, prefer committing a stable source or README companion instead of the generated output.

## Pull Request Expectations

A good PR should include:

- what changed
- why the change was needed
- what was validated
- any known limitations or follow-up work

Avoid mixing unrelated cleanup with functional changes unless the cleanup is required for correctness.
