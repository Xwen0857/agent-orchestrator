/**
 * Shared frontend types for API payloads and plugin extension points.
 */
import type React from 'react'

/** Combined overview payload returned by the backend root dashboard endpoint. */
export type Overview = {
  coreApiVersion: string
  dashboard: Record<string, unknown>
  systemHealth: Record<string, unknown>
}

/** Editable config surfaces exposed by the backend config APIs. */
export type CurrentConfig = {
  plannerCurrent: Record<string, unknown>
  plannerProperties: Record<string, unknown>
  auditPolicy: Record<string, unknown>
}

/** One registered plugin record returned by the backend plugin registry. */
export type PluginInfo = {
  id: string
  manifestPath: string
  enabled: boolean
  installedAt: string
  disabledReason?: string | null
}

/** One backend event as rendered in the frontend event stream. */
export type EventRecord = {
  event_id: string
  event_type: string
  occurred_at: string
  actor: string
  resource: string
  trace_id: string
  payload: Record<string, unknown>
  plugin_id?: string | null
}

/** Minimal extension point passed to frontend plugins that render widgets. */
export type FrontendPluginContext = {
  registerWidget: (widget: React.ReactNode) => void
}
