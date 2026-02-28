import type { ElectronMcpConfig } from '../index.js'

export interface ResolvedResource {
  uri: string
  name: string
  description: string
  pollExpression: string
  mimeType: string
}

export function buildResources(config: ElectronMcpConfig): ResolvedResource[] {
  if (!config.resources) return []

  const resources: ResolvedResource[] = []

  for (const [channel, resourceConfig] of Object.entries(config.resources)) {
    resources.push({
      uri: resourceConfig.uri,
      name: channel,
      description: resourceConfig.description,
      pollExpression: resourceConfig.pollExpression,
      mimeType: 'application/json',
    })
  }

  return resources
}
