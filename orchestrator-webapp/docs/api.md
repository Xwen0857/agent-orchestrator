# Orchestrator WebApp API

## Core API
- `GET /api/v1/core/overview`
- `GET /api/v1/core/configs/current`
- `POST /api/v1/core/configs/validate`
- `POST /api/v1/core/configs/commit`
- `POST /api/v1/core/configs/rollback`
- `GET /api/v1/core/configs/history`
- `GET /api/v1/core/auth/me`

## Extension API
- `GET /api/v1/ext/plugins`
- `POST /api/v1/ext/plugins/register`
- `POST /api/v1/ext/plugins/{id}/enable`
- `POST /api/v1/ext/plugins/{id}/disable`
- `GET /api/v1/ext/capabilities`

## Event API
- `GET /api/v1/events`
- `POST /api/v1/events/replay/{event_id}`
- `GET /api/v1/events/subscriptions`
- `POST /api/v1/events/subscriptions`

## Headers
- `X-User`
- `X-Email`
- `X-Role: viewer|operator|approver`
