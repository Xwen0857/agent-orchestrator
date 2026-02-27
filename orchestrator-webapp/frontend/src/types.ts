import type React from 'react'

export type Overview = {
  coreApiVersion: string
  dashboard: Record<string, unknown>
  systemHealth: Record<string, unknown>
}

export type CurrentConfig = {
  plannerCurrent: Record<string, unknown>
  plannerProperties: Record<string, unknown>
  auditPolicy: Record<string, unknown>
}

export type PluginInfo = {
  id: string
  manifestPath: string
  enabled: boolean
  installedAt: string
  disabledReason?: string | null
}

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

export type FrontendPluginContext = {
  registerWidget: (widget: React.ReactNode) => void
}
