import React from 'react'

export type FrontendPlugin = {
  id: string
  registerWidget?: () => React.ReactNode
}

const pluginMap: Record<string, () => Promise<{ default: FrontendPlugin }>> = {
  'sample-observability': () => import('./sampleObservabilityPlugin'),
}

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
