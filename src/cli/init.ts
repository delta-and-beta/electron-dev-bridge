import { resolve, relative, dirname, basename } from 'node:path'
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { scanForHandlers, type DetectedHandler } from '../scanner/ipc-scanner.js'
import { scanForSchemas, type DetectedSchema } from '../scanner/schema-scanner.js'

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'out'])

function findSourceFiles(dir: string): string[] {
  const results: string[] = []

  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = resolve(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...findSourceFiles(full))
    } else if (/\.(ts|js|mts|mjs)$/.test(entry) && !entry.endsWith('.d.ts')) {
      results.push(full)
    }
  }

  return results
}

function singularize(word: string): string {
  if (word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1)
  }
  return word
}

function deriveDescription(channel: string): string {
  const parts = channel.split(':')
  if (parts.length === 2) {
    const domain = parts[0].toLowerCase()
    const action = parts[1]
    const capitalAction = action.charAt(0).toUpperCase() + action.slice(1)
    return `${capitalAction} ${domain}`
  }
  return channel
}

interface SchemaMatch {
  schema: DetectedSchema
  importPath: string
}

function matchSchemaToChannel(
  channel: string,
  schemas: DetectedSchema[],
  configDir: string
): SchemaMatch | undefined {
  const parts = channel.split(':')
  if (parts.length !== 2) return undefined

  const domain = singularize(parts[0].toLowerCase())
  const action = parts[1].toLowerCase()

  for (const schema of schemas) {
    const schemaLower = schema.name.toLowerCase()
    if (schemaLower.includes(domain) && schemaLower.includes(action)) {
      const rel = relative(configDir, schema.file)
        .replace(/\.(ts|js|mts|mjs)$/, '')
      const importPath = rel.startsWith('.') ? rel : `./${rel}`
      return { schema, importPath }
    }
  }

  return undefined
}

function buildToolEntries(
  handlers: DetectedHandler[],
  schemas: DetectedSchema[],
  configDir: string,
): { toolEntries: string[]; imports: Map<string, Set<string>>; linkedCount: number } {
  const imports: Map<string, Set<string>> = new Map()
  const toolEntries: string[] = []
  let linkedCount = 0

  for (const handler of handlers) {
    const match = matchSchemaToChannel(handler.channel, schemas, configDir)
    const description = deriveDescription(handler.channel)

    if (match) {
      linkedCount++
      if (!imports.has(match.importPath)) {
        imports.set(match.importPath, new Set())
      }
      imports.get(match.importPath)!.add(match.schema.name)

      toolEntries.push(
        `    '${handler.channel}': {\n` +
        `      description: '${description}',\n` +
        `      schema: ${match.schema.name},\n` +
        `    }`
      )
    } else {
      toolEntries.push(
        `    '${handler.channel}': {\n` +
        `      description: '${description}',\n` +
        `    }`
      )
    }
  }

  return { toolEntries, imports, linkedCount }
}

function generateConfigSource(
  appName: string,
  toolEntries: string[],
  imports: Map<string, Set<string>>,
): string {
  const importLines: string[] = [
    `import { defineConfig } from 'electron-dev-bridge'`,
  ]

  for (const [path, names] of imports) {
    const sorted = [...names].sort()
    importLines.push(`import { ${sorted.join(', ')} } from '${path}'`)
  }

  const toolsBlock = toolEntries.length > 0
    ? toolEntries.join(',\n')
    : `    // No IPC handlers detected. Add tools manually:\n    // 'channel:action': { description: 'Description' }`

  return `${importLines.join('\n')}

export default defineConfig({
  app: {
    name: '${appName}',
  },
  tools: {
${toolsBlock}
  },
})
`
}

export async function init(): Promise<void> {
  const configPath = resolve('electron-mcp.config.ts')

  if (existsSync(configPath)) {
    console.error('electron-mcp.config.ts already exists. Delete it to re-initialize.')
    process.exit(1)
  }

  const cwd = process.cwd()
  console.log('Scanning source files...')

  const sourceFiles = findSourceFiles(cwd)
  console.log(`   Found ${sourceFiles.length} source files`)

  const allHandlers: DetectedHandler[] = []
  for (const file of sourceFiles) {
    allHandlers.push(...scanForHandlers(file))
  }
  console.log(`   Found ${allHandlers.length} ipcMain.handle() calls`)

  const allSchemas: DetectedSchema[] = []
  for (const file of sourceFiles) {
    allSchemas.push(...scanForSchemas(file))
  }
  console.log(`   Found ${allSchemas.length} Zod schema exports`)

  let appName = basename(cwd)
  const pkgPath = resolve(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      if (pkg.name) appName = pkg.name
    } catch {
      // ignore parse errors
    }
  }

  const { toolEntries, imports, linkedCount } = buildToolEntries(
    allHandlers, allSchemas, dirname(configPath),
  )
  console.log(`   Linked ${linkedCount} schemas to handlers`)

  const config = generateConfigSource(appName, toolEntries, imports)
  writeFileSync(configPath, config, 'utf-8')

  console.log(`\nGenerated electron-mcp.config.ts`)
  console.log(`   ${allHandlers.length} tools, ${linkedCount} with schemas`)
  console.log(`\nNext steps:`)
  console.log(`   1. Review and edit electron-mcp.config.ts`)
  console.log(`   2. Run: npx electron-mcp validate`)
  console.log(`   3. Run: npx electron-mcp register`)
}
