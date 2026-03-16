/**
 * Frontend plugin runtime for lazy-loading optional widget modules.
 * This keeps the main UI resilient when a plugin frontend is absent or fails to load.
 */
import React from 'react'

/** Shape required from lazily loaded frontend plugin modules. */
export type FrontendPlugin = {
  id: string
  registerWidget?: () => React.ReactNode
}

const pluginMap: Record<string, () => Promise<{ default: FrontendPlugin }>> = {
  'sample-observability': () => import('./sampleObservabilityPlugin'),
}

/** Load widget components for the given plugin ids, skipping missing or failing plugins. */
export async function loadWidgets(pluginIds: string[]): Promise<React.ReactNode[]> {
  const widgets: React.ReactNode[] = []
  for (const id of pluginIds) {
    const loader = pluginMap[id]
    if (!loader) continue
    try {
      const mod = await loader()
      if (mod.default.registerWidget) {
        widgets.push(mod.default.registerWidget())
      }
    } catch {
      // Keep UI resilient when plugin frontend fails.
    }
  }
  return widgets
}
