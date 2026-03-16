# `build_role_permissions.sh` Explain

## Purpose

Synthesizes the generated and effective role-permission policy files from role `SKILL.md` declarations plus explicit override rules.

## Inputs And Outputs

Inputs:
- role `SKILL.md` files
- `role_permissions.overrides.json`

Outputs:
- `role_permissions.generated.json`
- `role_permissions.effective.json`

## Step-By-Step Flow

1. Ensure the security directory exists.
2. Seed an empty overrides file if it is missing.
3. Run the embedded Python program to:
   - parse path-like references from role skill markdown
   - infer read/write/forbidden path categories
   - apply baseline defaults per role
   - merge in explicit overrides
   - write generated and effective policy JSON payloads

## Failure Modes And Safety Checks

- Creates a minimal overrides file instead of failing when overrides are absent.
- Filters path candidates aggressively so non-path markdown fragments do not enter the policy.
- Keeps baseline defaults for critical runtime paths even when skill files are incomplete.

## Key Dependencies

- role `SKILL.md` files
- security templates directory
- Python policy synthesis block

## Maintenance Notes

- This script intentionally reads `SKILL.md` but should not modify it.
- If the role inventory changes, update the `skills` map and the role-specific baseline defaults together.
