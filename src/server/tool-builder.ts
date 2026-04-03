import type { ElectronMcpConfig } from '../index.js'

export interface ResolvedTool {
  name: string
  description: string
  inputSchema: Record<string, any>
  channel: string
  preloadPath: string
}

export function channelToToolName(channel: string): string {
  return channel.replace(/:/g, '_')
}

export function channelToPreloadPath(channel: string): string {
  const [domain, action] = channel.split(':')
  return `window.electronAPI.${domain}.${action}`
}

async function zodToJsonSchema(schema: any): Promise<Record<string, any>> {
  try {
    const { zodToJsonSchema: convert } = await import('zod-to-json-schema')
    const jsonSchema = convert(schema, { target: 'openApi3' })
    const { $schema, ...rest } = jsonSchema as any
    return rest
  } catch {
    return { type: 'object' }
  }
}

export async function buildTools(config: ElectronMcpConfig): Promise<ResolvedTool[]> {
  const tools: ResolvedTool[] = []

  for (const [channel, toolConfig] of Object.entries(config.tools)) {
    let inputSchema: Record<string, any> = { type: 'object' }

    if (toolConfig.schema) {
      inputSchema = await zodToJsonSchema(toolConfig.schema)
    }

    let description = toolConfig.description
    if (toolConfig.returns) {
      description += ` Returns: ${toolConfig.returns}`
    }

    tools.push({
      name: channelToToolName(channel),
      description,
      inputSchema,
      channel,
      preloadPath: toolConfig.preloadPath || channelToPreloadPath(channel),
    })
  }

  return tools
}
