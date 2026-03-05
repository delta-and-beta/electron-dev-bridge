import type { ChildProcess } from 'node:child_process'

import type { AppConfig } from '../index.js'
import type { CdpBridge } from '../server/cdp-bridge.js'

export interface CdpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
}

export interface CdpTool {
  definition: CdpToolDefinition
  handler: (args: any) => Promise<any>
}

export interface ToolContext {
  bridge: CdpBridge
  appConfig: AppConfig
  screenshotDir: string
  screenshotFormat: 'png' | 'jpeg'
  state: {
    screenshotCounter: number
    electronProcess: ChildProcess | null
  }
}
