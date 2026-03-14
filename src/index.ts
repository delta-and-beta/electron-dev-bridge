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

export interface ElectronMcpConfig {
  app: AppConfig
  tools: Record<string, ToolConfig>
  resources?: Record<string, ResourceConfig>
  cdpTools?: boolean | string[]
  screenshots?: ScreenshotConfig
}

export function defineConfig(config: ElectronMcpConfig): ElectronMcpConfig {
  return config
}

export { CdpBridge } from './server/cdp-bridge.js'
export { getCdpTools } from './cdp-tools/index.js'
export type { CdpTool, CdpToolDefinition } from './cdp-tools/types.js'
