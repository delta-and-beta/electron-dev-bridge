import { pathToFileURL } from 'node:url'
import type { ElectronMcpConfig } from '../index.js'

/**
 * Load an electron-mcp config file, with TypeScript support via tsx.
 */
export async function loadConfig(configPath: string): Promise<ElectronMcpConfig> {
  let mod: any

  if (configPath.endsWith('.ts')) {
    // Use tsx's tsImport for TypeScript configs
    const { tsImport } = await import('tsx/esm/api')
    mod = await tsImport(configPath, import.meta.url)
  } else {
    // Standard import for .js/.mjs configs
    mod = await import(pathToFileURL(configPath).href)
  }

  return mod.default
}
