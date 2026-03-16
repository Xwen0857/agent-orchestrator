# `event_bus.py` Explain

## Purpose

Persists backend events to the NDJSON event store and forwards them to webhook subscribers.

## Inputs And Outputs

Inputs:
- event metadata (`event_type`, `actor`, `resource`, `payload`, `trace_id`)
- optional plugin id

Outputs:
- appended event record in the event store
- webhook delivery attempt
- validated `EventRecord` instances

## Step-By-Step Flow

1. Build a new `EventRecord` with a generated event id and current UTC timestamp.
2. Append the event to the NDJSON event store.
3. Deliver the event through the webhook service.
4. For reads, load recent events, optionally filter by event type, and validate the returned models.

## Failure Modes And Safety Checks

- Persists the event before attempting webhook delivery, so the event store remains the source of truth.
- Limits reads to the requested tail window to avoid returning the full event history by default.

## Key Dependencies

- `append_ndjson`
- `read_ndjson`
- `WebhookService`
- `EventRecord`

## Maintenance Notes

- Keep persistence-before-webhook ordering unless delivery semantics intentionally change.
- If event schema evolves, update both the writer and the reader validation path together.
