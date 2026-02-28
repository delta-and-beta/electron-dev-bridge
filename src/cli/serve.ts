import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { startServer } from '../server/mcp-server.js'
import { loadConfig } from '../utils/load-config.js'

const CONFIG_NAMES = [
  'electron-mcp.config.ts',
  'electron-mcp.config.js',
  'electron-mcp.config.mjs',
]

export async function serve(configPath?: string): Promise<void> {
  let resolvedPath: string | undefined

  if (configPath) {
    resolvedPath = resolve(configPath)
  } else {
    for (const name of CONFIG_NAMES) {
      const candidate = resolve(name)
      if (existsSync(candidate)) {
        resolvedPath = candidate
        break
      }
    }
  }

  if (!resolvedPath || !existsSync(resolvedPath)) {
    console.error(
      'Error: No config file found. Create electron-mcp.config.ts or run: npx electron-mcp init'
    )
    process.exit(1)
  }

  const config = await loadConfig(resolvedPath)

  if (!config || !config.app || !config.tools) {
    console.error('Error: Invalid config. Must export default defineConfig({ app, tools })')
    process.exit(1)
  }

  await startServer(config)
}
