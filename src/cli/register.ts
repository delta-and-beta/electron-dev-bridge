import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const CONFIG_NAMES = [
  'electron-mcp.config.ts',
  'electron-mcp.config.js',
  'electron-mcp.config.mjs',
]

export async function register(): Promise<void> {
  let configPath: string | undefined
  for (const name of CONFIG_NAMES) {
    const candidate = resolve(name)
    if (existsSync(candidate)) {
      configPath = candidate
      break
    }
  }

  if (!configPath) {
    console.error('Error: No electron-mcp config found. Run: npx electron-mcp init')
    process.exit(1)
  }

  const configContent = readFileSync(configPath, 'utf-8')
  const nameMatch = configContent.match(/name:\s*['"]([^'"]+)['"]/)
  const appName = nameMatch?.[1] || 'electron-app'

  console.log('Registering with Claude Code...')
  console.log(`   Server name: ${appName}`)
  console.log(`   Working directory: ${process.cwd()}`)

  try {
    execFileSync('claude', [
      'mcp', 'add', '--scope', 'user',
      appName, '--', 'npx', 'electron-mcp', 'serve'
    ], { stdio: 'inherit' })
    console.log('\nRegistered! Run: claude mcp list to verify.')
  } catch {
    console.error('\nRegistration failed. Is Claude Code CLI installed?')
    console.error(`   Manual: claude mcp add --scope user "${appName}" -- npx electron-mcp serve`)
    process.exit(1)
  }
}
