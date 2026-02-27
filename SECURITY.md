# Security Policy

## Reporting

If you find a security issue, do not open a public issue with full exploit details.

Report it privately to the repository owner through GitHub security reporting or direct private contact if available.

Include:

- affected component or path
- impact
- reproduction steps
- any suggested mitigation

## In Scope

Security-sensitive areas in this repository include:

- task state transition logic
- plugin command routing
- workspace and path handling
- ACL and policy enforcement
- runtime script execution
- host integration boundaries with `OpenClaw`

## Out of Scope

The following are generally not security vulnerabilities by themselves:

- issues in intentionally excluded local-only files
- development-only placeholder paths
- missing hardening for features explicitly marked as future work

## Handling Principles

Security fixes should preserve these constraints:

- fail closed when policy cannot be evaluated
- avoid widening write permissions
- avoid introducing hidden implicit trust paths
- keep runtime-generated files separate from policy source files

## Disclosure

Public disclosure should wait until:

1. the issue is understood,
2. a mitigation or patch exists, and
3. affected users have a reasonable upgrade path.
