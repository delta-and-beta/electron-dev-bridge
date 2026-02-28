import { describe, it } from 'node:test'
import assert from 'node:assert'
import { defineConfig } from '../index.js'
import { buildTools } from '../server/tool-builder.js'
import { buildResources } from '../server/resource-builder.js'
import { scanForHandlers } from '../scanner/ipc-scanner.js'
import { scanForSchemas } from '../scanner/schema-scanner.js'

// ---------------------------------------------------------------------------
// tool-builder
// ---------------------------------------------------------------------------

describe('tool-builder', () => {
  it('converts config tools to MCP tool definitions', async () => {
    const config = defineConfig({
      app: { name: 'test-app' },
      tools: {
        'profiles:query': {
          description: 'Search profiles',
        },
        'tags:add': {
          description: 'Add a tag to a profile',
        },
      },
    })

    const tools = await buildTools(config)

    assert.strictEqual(tools.length, 2)
    assert.strictEqual(tools[0].name, 'profiles_query')
    assert.strictEqual(tools[1].name, 'tags_add')

    // preloadPath auto-derived: profiles:query -> window.electronAPI.profiles.query
    assert.strictEqual(tools[0].preloadPath, 'window.electronAPI.profiles.query')
    assert.strictEqual(tools[1].preloadPath, 'window.electronAPI.tags.add')
  })

  it('appends returns hint to description', async () => {
    const config = defineConfig({
      app: { name: 'test-app' },
      tools: {
        'profiles:query': {
          description: 'Search profiles',
          returns: 'Array of objects',
        },
      },
    })

    const tools = await buildTools(config)

    assert.strictEqual(tools[0].description, 'Search profiles Returns: Array of objects')
  })

  it('respects preloadPath override', async () => {
    const config = defineConfig({
      app: { name: 'test-app' },
      tools: {
        'crawl:start': {
          description: 'Start a crawl job',
          preloadPath: 'window.electronAPI.crawl.startJob',
        },
      },
    })

    const tools = await buildTools(config)

    assert.strictEqual(tools[0].preloadPath, 'window.electronAPI.crawl.startJob')
    // Not the auto-derived window.electronAPI.crawl.start
    assert.notStrictEqual(tools[0].preloadPath, 'window.electronAPI.crawl.start')
  })
})

// ---------------------------------------------------------------------------
// resource-builder
// ---------------------------------------------------------------------------

describe('resource-builder', () => {
  it('converts config resources to MCP resource definitions', () => {
    const config = defineConfig({
      app: { name: 'test-app' },
      tools: {},
      resources: {
        'crawl:progress': {
          description: 'Live crawl progress',
          uri: 'electron://test-app/crawl/progress',
          pollExpression: 'window.electronAPI.crawl.getProgress()',
        },
      },
    })

    const resources = buildResources(config)

    assert.strictEqual(resources.length, 1)
    assert.strictEqual(resources[0].uri, 'electron://test-app/crawl/progress')
    assert.strictEqual(resources[0].name, 'crawl:progress')
    assert.strictEqual(resources[0].description, 'Live crawl progress')
    assert.strictEqual(resources[0].mimeType, 'application/json')
  })

  it('returns empty array when no resources configured', () => {
    const config = defineConfig({
      app: { name: 'test-app' },
      tools: {},
    })

    const resources = buildResources(config)

    assert.strictEqual(resources.length, 0)
    assert.deepStrictEqual(resources, [])
  })
})

// ---------------------------------------------------------------------------
// scanner (using real linkedin-app source)
// ---------------------------------------------------------------------------

describe('scanner', () => {
  const linkedinMainPath =
    '/Users/marchi-lau/Development/repos/delta-and-beta/linkedin-app/src/main/index.ts'
  const linkedinSchemaPath =
    '/Users/marchi-lau/Development/repos/delta-and-beta/linkedin-app/src/main/ipc-schemas.ts'

  it('detects ipcMain.handle calls in source code', () => {
    const handlers = scanForHandlers(linkedinMainPath)

    assert.ok(handlers.length >= 30, `Expected >= 30 handlers, got ${handlers.length}`)

    const channels = handlers.map((h) => h.channel)
    assert.ok(channels.includes('profiles:query'), 'Missing profiles:query')
    assert.ok(channels.includes('tags:add'), 'Missing tags:add')
    assert.ok(channels.includes('crawl:start'), 'Missing crawl:start')
  })

  it('detects Zod schema exports', () => {
    const schemas = scanForSchemas(linkedinSchemaPath)

    assert.ok(schemas.length >= 4, `Expected >= 4 schemas, got ${schemas.length}`)

    const names = schemas.map((s) => s.name)
    assert.ok(names.includes('profileQuerySchema'), 'Missing profileQuerySchema')
    assert.ok(names.includes('crawlJobSchema'), 'Missing crawlJobSchema')
  })
})
