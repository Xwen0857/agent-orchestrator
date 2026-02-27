# KB Weighting Model (V1)

This model turns KB from a static archive into a guidance system.

## Inputs

1. Usage signals from `knowledge-base/feedback/kb_feedback.ndjson`.
2. Entry metadata from `knowledge-base/entries/*.md`.
3. Auditor quality signal (`A|B|C|NONE`).

## Feedback event fields

- `timestamp`
- `entry_id`
- `task_id`
- `actor`
- `outcome` (`SUCCESS|FAIL|PARTIAL`)
- `intervention_source` (`SELF_HEAL|HUMAN_CORRECTION|HUMAN_OVERRIDE`)
- `auditor_grade` (`A|B|C|NONE`)
- `reused` (`true|false`)
- `notes`

## Score computation (0-100)

Base score: `50`

Additions:

1. reuse contribution: `min(20, reuse_count * 2)`
2. success ratio contribution: `int(20 * success_count / max(1, reuse_count))`
3. self-heal contribution: `min(10, self_heal_count)`
4. recency contribution:
 - verified <= 7d: `+5`
 - verified <= 30d: `+2`
 - verified > 90d: `-5`

Penalties:

1. human override penalty: `min(20, human_override_count * 3)`
2. auditor penalty:
 - `A`: `+3`
 - `B`: `0`
 - `C`: `-3`

Clamp score to `[0, 100]`.

## Status mapping

1. `CANDIDATE`: no reuse yet.
2. `ACTIVE`: score >= 75.
3. `WATCHLIST`: score >= 45 and < 75.
4. `DEPRECATED`: score < 45.

## Retrieval policy

1. Default retrieval excludes `DEPRECATED`.
2. Ranking uses lexical relevance + weighted score.
3. If repeated `HUMAN_OVERRIDE` occurs, entry should move to `WATCHLIST/DEPRECATED` automatically.
