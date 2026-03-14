import type { ZodType } from 'zod'

export interface ToolConfig {
  description: string
  schema?: ZodType<any>
  preloadPath?: string
  returns?: string
}

export interface ResourceConfig {
  description: string
  uri: string
  pollExpression: string
}

export interface AppConfig {
  name: string
  path?: string
  debugPort?: number
  electronBin?: string
}

export interface ScreenshotConfig {
  dir?: string
  format?: 'png' | 'jpeg'
}

export interface CustomTool {
  name: string
  description: string
  inputSchema: object
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }>
}

export interface ElectronMcpConfig {
  app: AppConfig
  tools: Record<string, ToolConfig>
  resources?: Record<string, ResourceConfig>
  cdpTools?: boolean | string[]
  screenshots?: ScreenshotConfig
  customTools?: CustomTool[]
}

export function defineConfig(config: ElectronMcpConfig): ElectronMcpConfig {
  return config
}

export { CdpBridge } from './server/cdp-bridge.js'
export { getCdpTools } from './cdp-tools/index.js'
export { startServer } from './server/mcp-server.js'
export type { CdpTool, CdpToolDefinition } from './cdp-tools/types.js'
