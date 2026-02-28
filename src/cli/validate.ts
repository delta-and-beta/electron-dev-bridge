import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { loadConfig } from '../utils/load-config.js'
import type { ElectronMcpConfig } from '../index.js'

const CONFIG_NAMES = [
  'electron-mcp.config.ts',
  'electron-mcp.config.js',
  'electron-mcp.config.mjs',
]

export async function validate(): Promise<void> {
  let configPath: string | undefined
  for (const name of CONFIG_NAMES) {
    const candidate = resolve(name)
    if (existsSync(candidate)) {
      configPath = candidate
      break
    }
  }

  if (!configPath) {
    console.error('Config file: not found')
    console.error('   Run: npx electron-mcp init')
    process.exit(1)
  }

  console.log(`Config file: ${configPath.split('/').pop()}`)

  let config: ElectronMcpConfig
  try {
    config = await loadConfig(configPath)
  } catch (err: any) {
    console.error(`Config load failed: ${err.message}`)
    process.exit(1)
  }

  if (!config.app?.name) {
    console.error('app.name is required')
    process.exit(1)
  }

  const toolCount = Object.keys(config.tools || {}).length
  const schemasCount = Object.values(config.tools || {}).filter(t => t.schema).length
  console.log(`${toolCount} IPC tools defined, ${schemasCount} with Zod schemas`)

  const resourceCount = Object.keys(config.resources || {}).length
  if (resourceCount > 0) {
    console.log(`${resourceCount} resources defined`)
  }

  if (config.cdpTools) {
    const cdpCount = Array.isArray(config.cdpTools) ? config.cdpTools.length : 22
    console.log(`CDP tools: enabled (${cdpCount} tools)`)
  } else {
    console.log('CDP tools: disabled')
  }

  for (const [channel, tool] of Object.entries(config.tools || {})) {
    if (tool.preloadPath) {
      console.log(`Note: Tool '${channel}' has preloadPath override: ${tool.preloadPath}`)
    }
  }

  const cdpTotal = config.cdpTools ? (Array.isArray(config.cdpTools) ? config.cdpTools.length : 22) : 0
  console.log(`\nTotal: ${toolCount + cdpTotal} MCP tools ready`)
}
