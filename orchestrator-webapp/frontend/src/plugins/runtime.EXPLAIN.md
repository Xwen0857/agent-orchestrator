# `runtime.ts` Explain

## Purpose

Provides the frontend plugin loader that maps plugin ids to lazy imports and returns any widget nodes those plugins expose.

## Inputs And Outputs

Inputs:
- a list of plugin ids

Outputs:
- an array of rendered React widget nodes

## Step-By-Step Flow

1. Look up each requested plugin id in the static plugin loader map.
2. Skip ids that have no registered loader.
3. Dynamically import the plugin module.
4. If the module exposes `registerWidget`, call it and collect the returned node.
5. Ignore load failures so one plugin cannot break the full UI.

## Failure Modes And Safety Checks

- Missing plugin ids are skipped silently.
- Import failures are swallowed intentionally to preserve UI availability.

## Key Dependencies

- React
- lazily imported frontend plugin modules

## Maintenance Notes

- Keep the plugin id map synchronized with the backend plugin inventory only when a frontend widget actually exists.
- If plugin runtime capabilities expand, preserve the current failure-isolation behavior.
