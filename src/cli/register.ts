import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export async function register(): Promise<void> {
  const configPath = resolve('electron-mcp.config.ts')
  if (!existsSync(configPath)) {
    console.error('Error: No electron-mcp.config.ts found. Run: npx electron-mcp init')
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
