import { describe, it } from 'node:test'
import assert from 'node:assert'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

import { toolResult, toolError } from '../cdp-tools/helpers.js'

describe('helpers', () => {
  it('toolResult wraps data in MCP text content', () => {
    const result = toolResult({ foo: 'bar' })
    assert.deepStrictEqual(result, {
      content: [{ type: 'text', text: '{\n  "foo": "bar"\n}' }],
    })
  })

  it('toolResult handles null and primitives', () => {
    assert.deepStrictEqual(toolResult(null), { content: [{ type: 'text', text: 'null' }] })
    assert.deepStrictEqual(toolResult(42), { content: [{ type: 'text', text: '42' }] })
    assert.deepStrictEqual(toolResult('hello'), { content: [{ type: 'text', text: '"hello"' }] })
  })

  it('toolError wraps message with isError flag', () => {
    const result = toolError('something failed')
    assert.deepStrictEqual(result, {
      content: [{ type: 'text', text: 'Error: something failed' }],
      isError: true,
    })
  })
})

// ---------------------------------------------------------------------------
// tool-builder: channelToToolName, channelToPreloadPath
// ---------------------------------------------------------------------------

import { channelToToolName, channelToPreloadPath, buildTools } from '../server/tool-builder.js'
import { defineConfig } from '../index.js'

describe('channelToToolName', () => {
  it('replaces colons with underscores', () => {
    assert.strictEqual(channelToToolName('profiles:query'), 'profiles_query')
    assert.strictEqual(channelToToolName('tags:add'), 'tags_add')
  })

  it('handles multiple colons', () => {
    assert.strictEqual(channelToToolName('a:b:c'), 'a_b_c')
  })

  it('handles no colons', () => {
    assert.strictEqual(channelToToolName('simple'), 'simple')
  })
})

describe('channelToPreloadPath', () => {
  it('converts domain:action to window.electronAPI path', () => {
    assert.strictEqual(channelToPreloadPath('profiles:query'), 'window.electronAPI.profiles.query')
    assert.strictEqual(channelToPreloadPath('crawl:start'), 'window.electronAPI.crawl.start')
  })
})

describe('buildTools', () => {
  it('handles empty tools config', async () => {
    const config = defineConfig({ app: { name: 'test' }, tools: {} })
    const tools = await buildTools(config)
    assert.strictEqual(tools.length, 0)
  })

  it('derives name and preloadPath correctly', async () => {
    const config = defineConfig({
      app: { name: 'test' },
      tools: {
        'settings:get': { description: 'Get settings' },
      },
    })
    const tools = await buildTools(config)
    assert.strictEqual(tools[0].name, 'settings_get')
    assert.strictEqual(tools[0].preloadPath, 'window.electronAPI.settings.get')
    assert.strictEqual(tools[0].channel, 'settings:get')
  })

  it('uses preloadPath override when provided', async () => {
    const config = defineConfig({
      app: { name: 'test' },
      tools: {
        'crawl:start': {
          description: 'Start crawl',
          preloadPath: 'window.electronAPI.crawl.startJob',
        },
      },
    })
    const tools = await buildTools(config)
    assert.strictEqual(tools[0].preloadPath, 'window.electronAPI.crawl.startJob')
  })

  it('appends returns to description', async () => {
    const config = defineConfig({
      app: { name: 'test' },
      tools: {
        'data:fetch': { description: 'Fetch data', returns: 'JSON object' },
      },
    })
    const tools = await buildTools(config)
    assert.strictEqual(tools[0].description, 'Fetch data Returns: JSON object')
  })

  it('defaults inputSchema to { type: "object" } without schema', async () => {
    const config = defineConfig({
      app: { name: 'test' },
      tools: { 'test:action': { description: 'Test' } },
    })
    const tools = await buildTools(config)
    assert.deepStrictEqual(tools[0].inputSchema, { type: 'object' })
  })
})

// ---------------------------------------------------------------------------
// resource-builder
// ---------------------------------------------------------------------------

import { buildResources } from '../server/resource-builder.js'

describe('resource-builder', () => {
  it('converts resources to resolved format', () => {
    const config = defineConfig({
      app: { name: 'test' },
      tools: {},
      resources: {
        'status:live': {
          description: 'Live status',
          uri: 'electron://test/status',
          pollExpression: 'window.getStatus()',
        },
      },
    })
    const resources = buildResources(config)
    assert.strictEqual(resources.length, 1)
    assert.strictEqual(resources[0].name, 'status:live')
    assert.strictEqual(resources[0].uri, 'electron://test/status')
    assert.strictEqual(resources[0].mimeType, 'application/json')
  })

  it('returns empty array when no resources', () => {
    const config = defineConfig({ app: { name: 'test' }, tools: {} })
    assert.deepStrictEqual(buildResources(config), [])
  })

  it('handles multiple resources', () => {
    const config = defineConfig({
      app: { name: 'test' },
      tools: {},
      resources: {
        'a:b': { description: 'A', uri: 'electron://test/a', pollExpression: 'a()' },
        'c:d': { description: 'C', uri: 'electron://test/c', pollExpression: 'c()' },
      },
    })
    assert.strictEqual(buildResources(config).length, 2)
  })
})

// ---------------------------------------------------------------------------
// defineConfig
// ---------------------------------------------------------------------------

describe('defineConfig', () => {
  it('returns the config object unchanged', () => {
    const input = { app: { name: 'test' }, tools: { 'a:b': { description: 'x' } } }
    const output = defineConfig(input)
    assert.strictEqual(output, input)
  })
})

// ---------------------------------------------------------------------------
// errorFingerprint
// ---------------------------------------------------------------------------

import { errorFingerprint } from '../cdp-tools/devtools.js'

describe('errorFingerprint', () => {
  it('strips numbers', () => {
    const a = errorFingerprint('Failed at line 42')
    const b = errorFingerprint('Failed at line 99')
    assert.strictEqual(a, b)
  })

  it('strips UUIDs', () => {
    const a = errorFingerprint('User a1b2c3d4-e5f6-7890-abcd-ef1234567890 not found')
    const b = errorFingerprint('User 12345678-1234-1234-1234-123456789abc not found')
    assert.strictEqual(a, b)
    assert.ok(a.includes('<uuid>'))
  })

  it('strips URLs', () => {
    const a = errorFingerprint('Failed to fetch https://api.example.com/users/123')
    const b = errorFingerprint('Failed to fetch https://api.other.com/posts/456')
    assert.strictEqual(a, b)
    assert.ok(a.includes('<url>'))
  })

  it('preserves non-dynamic parts', () => {
    const fp = errorFingerprint('TypeError: Cannot read property')
    assert.strictEqual(fp, 'TypeError: Cannot read property')
  })
})

// ---------------------------------------------------------------------------
// DevtoolsStore
// ---------------------------------------------------------------------------

import { DevtoolsStore, type ErrorEntry } from '../cdp-tools/devtools.js'

describe('DevtoolsStore', () => {
  it('starts empty', () => {
    const store = new DevtoolsStore()
    assert.strictEqual(store.console.length, 0)
    assert.strictEqual(store.network.size, 0)
    assert.strictEqual(store.errors.length, 0)
    assert.strictEqual(store.pendingRequests.size, 0)
  })

  it('getNetworkEntries returns array from map', () => {
    const store = new DevtoolsStore()
    store.network.set('r1', {
      requestId: 'r1', method: 'GET', url: 'http://test.com', startTime: 1000,
    })
    store.network.set('r2', {
      requestId: 'r2', method: 'POST', url: 'http://test.com/api', startTime: 1001,
    })
    const entries = store.getNetworkEntries()
    assert.strictEqual(entries.length, 2)
    assert.strictEqual(entries[0].requestId, 'r1')
  })

  it('clearConsole clears console entries', () => {
    const store = new DevtoolsStore()
    store.console.push({ level: 'log', message: 'test', timestamp: 1 })
    store.clearConsole()
    assert.strictEqual(store.console.length, 0)
  })

  it('clearNetwork clears network entries', () => {
    const store = new DevtoolsStore()
    store.network.set('r1', {
      requestId: 'r1', method: 'GET', url: 'http://test.com', startTime: 1,
    })
    store.clearNetwork()
    assert.strictEqual(store.network.size, 0)
  })

  it('clearErrors clears error entries', () => {
    const store = new DevtoolsStore()
    store.errors.push({
      message: 'err', source: 'exception', timestamp: 1, fingerprint: 'err',
    } as ErrorEntry)
    store.clearErrors()
    assert.strictEqual(store.errors.length, 0)
  })

  it('clearAll clears everything', () => {
    const store = new DevtoolsStore()
    store.console.push({ level: 'log', message: 'x', timestamp: 1 })
    store.network.set('r1', {
      requestId: 'r1', method: 'GET', url: 'http://test.com', startTime: 1,
    })
    store.errors.push({
      message: 'err', source: 'exception', timestamp: 1, fingerprint: 'err',
    } as ErrorEntry)
    store.clearAll()
    assert.strictEqual(store.console.length, 0)
    assert.strictEqual(store.network.size, 0)
    assert.strictEqual(store.errors.length, 0)
  })

  it('getGroupedErrors groups by fingerprint', () => {
    const store = new DevtoolsStore()
    const fp = 'TypeError: Cannot read'
    store.errors.push(
      { message: 'TypeError: Cannot read x', source: 'exception', timestamp: 100, fingerprint: fp } as ErrorEntry,
      { message: 'TypeError: Cannot read y', source: 'exception', timestamp: 200, fingerprint: fp } as ErrorEntry,
      { message: 'Network error', source: 'network', timestamp: 150, fingerprint: 'Network error' } as ErrorEntry,
    )

    const groups = store.getGroupedErrors()
    assert.strictEqual(groups.length, 2)

    // Sorted by lastSeen descending
    const typeError = groups.find(g => g.fingerprint === fp)!
    assert.strictEqual(typeError.count, 2)
    assert.strictEqual(typeError.firstSeen, 100)
    assert.strictEqual(typeError.lastSeen, 200)
    assert.ok(typeError.samples.length <= 3)
  })

  it('getGroupedErrors caps samples at 3', () => {
    const store = new DevtoolsStore()
    for (let i = 0; i < 10; i++) {
      store.errors.push({
        message: 'repeated error', source: 'exception', timestamp: i, fingerprint: 'repeated error',
      } as ErrorEntry)
    }
    const groups = store.getGroupedErrors()
    assert.strictEqual(groups[0].count, 10)
    assert.strictEqual(groups[0].samples.length, 3)
  })

  it('attach captures console events from mock client', () => {
    const store = new DevtoolsStore()
    const handlers: Record<string, Function> = {}

    const mockClient = {
      Runtime: {
        exceptionThrown: (cb: Function) => { handlers['exceptionThrown'] = cb },
        consoleAPICalled: (cb: Function) => { handlers['consoleAPICalled'] = cb },
      },
      Network: {
        requestWillBeSent: (cb: Function) => { handlers['requestWillBeSent'] = cb },
        responseReceived: (cb: Function) => { handlers['responseReceived'] = cb },
        loadingFinished: (cb: Function) => { handlers['loadingFinished'] = cb },
        loadingFailed: (cb: Function) => { handlers['loadingFailed'] = cb },
        getResponseBody: () => Promise.resolve({ body: '' }),
      },
    }

    store.attach(mockClient)

    // Simulate a console.log
    handlers['consoleAPICalled']({
      type: 'log',
      args: [{ value: 'hello world' }],
      timestamp: 1000,
    })
    assert.strictEqual(store.console.length, 1)
    assert.strictEqual(store.console[0].message, 'hello world')
    assert.strictEqual(store.console[0].level, 'log')

    // Simulate console.error — should also add to errors
    handlers['consoleAPICalled']({
      type: 'error',
      args: [{ value: 'something broke' }],
      timestamp: 1001,
    })
    assert.strictEqual(store.console.length, 2)
    assert.strictEqual(store.errors.length, 1)
    assert.strictEqual(store.errors[0].source, 'console.error')
  })

  it('attach captures network request lifecycle from mock client', () => {
    const store = new DevtoolsStore()
    const handlers: Record<string, Function> = {}

    const mockClient = {
      Runtime: {
        exceptionThrown: () => {},
        consoleAPICalled: () => {},
      },
      Network: {
        requestWillBeSent: (cb: Function) => { handlers['requestWillBeSent'] = cb },
        responseReceived: (cb: Function) => { handlers['responseReceived'] = cb },
        loadingFinished: (cb: Function) => { handlers['loadingFinished'] = cb },
        loadingFailed: (cb: Function) => { handlers['loadingFailed'] = cb },
        getResponseBody: () => Promise.resolve({ body: '{"ok":true}' }),
      },
    }

    store.attach(mockClient)

    // Request sent
    handlers['requestWillBeSent']({
      requestId: 'r1',
      request: { method: 'GET', url: 'https://api.test.com/data' },
      timestamp: 1000,
    })
    assert.strictEqual(store.pendingRequests.size, 1)
    assert.strictEqual(store.network.size, 1)

    // Response received
    handlers['responseReceived']({
      requestId: 'r1',
      response: { status: 200, statusText: 'OK' },
    })
    assert.strictEqual(store.network.get('r1')!.status, 200)

    // Loading finished
    handlers['loadingFinished']({ requestId: 'r1', timestamp: 1002 })
    assert.strictEqual(store.pendingRequests.size, 0)
    assert.strictEqual(store.network.get('r1')!.duration, 2000) // (1002 - 1000) * 1000
  })

  it('attach captures network failures and adds to errors', () => {
    const store = new DevtoolsStore()
    const handlers: Record<string, Function> = {}

    const mockClient = {
      Runtime: { exceptionThrown: () => {}, consoleAPICalled: () => {} },
      Network: {
        requestWillBeSent: (cb: Function) => { handlers['requestWillBeSent'] = cb },
        responseReceived: () => {},
        loadingFinished: () => {},
        loadingFailed: (cb: Function) => { handlers['loadingFailed'] = cb },
        getResponseBody: () => Promise.resolve({ body: '' }),
      },
    }

    store.attach(mockClient)

    handlers['requestWillBeSent']({
      requestId: 'r1',
      request: { method: 'POST', url: 'https://api.test.com/submit' },
      timestamp: 1000,
    })

    handlers['loadingFailed']({ requestId: 'r1', errorText: 'net::ERR_FAILED' })
    assert.strictEqual(store.pendingRequests.size, 0)
    assert.strictEqual(store.network.get('r1')!.error, 'net::ERR_FAILED')
    assert.strictEqual(store.errors.length, 1)
    assert.strictEqual(store.errors[0].source, 'network')
  })

  it('attach captures uncaught exceptions', () => {
    const store = new DevtoolsStore()
    const handlers: Record<string, Function> = {}

    const mockClient = {
      Runtime: {
        exceptionThrown: (cb: Function) => { handlers['exceptionThrown'] = cb },
        consoleAPICalled: () => {},
      },
      Network: {
        requestWillBeSent: () => {},
        responseReceived: () => {},
        loadingFinished: () => {},
        loadingFailed: () => {},
        getResponseBody: () => Promise.resolve({ body: '' }),
      },
    }

    store.attach(mockClient)

    handlers['exceptionThrown']({
      timestamp: 1000,
      exceptionDetails: {
        text: 'Uncaught TypeError',
        exception: { description: 'TypeError: foo is not a function\n    at bar.js:10:5' },
        url: 'bar.js',
        lineNumber: 10,
        columnNumber: 5,
      },
    })

    assert.strictEqual(store.errors.length, 1)
    assert.strictEqual(store.errors[0].source, 'exception')
    assert.ok(store.errors[0].message.includes('TypeError'))
    assert.ok(store.errors[0].stack!.includes('bar.js'))
  })

  it('attach does not double-attach', () => {
    const store = new DevtoolsStore()
    let callCount = 0

    const mockClient = {
      Runtime: {
        exceptionThrown: () => { callCount++ },
        consoleAPICalled: () => { callCount++ },
      },
      Network: {
        requestWillBeSent: () => { callCount++ },
        responseReceived: () => { callCount++ },
        loadingFinished: () => { callCount++ },
        loadingFailed: () => { callCount++ },
        getResponseBody: () => Promise.resolve({ body: '' }),
      },
    }

    store.attach(mockClient)
    const first = callCount
    store.attach(mockClient)
    assert.strictEqual(callCount, first, 'Second attach should not register more handlers')
  })

  it('detach allows re-attach', () => {
    const store = new DevtoolsStore()
    let callCount = 0

    const mockClient = {
      Runtime: {
        exceptionThrown: () => { callCount++ },
        consoleAPICalled: () => { callCount++ },
      },
      Network: {
        requestWillBeSent: () => { callCount++ },
        responseReceived: () => { callCount++ },
        loadingFinished: () => { callCount++ },
        loadingFailed: () => { callCount++ },
        getResponseBody: () => Promise.resolve({ body: '' }),
      },
    }

    store.attach(mockClient)
    const first = callCount
    store.detach()
    store.attach(mockClient)
    assert.strictEqual(callCount, first * 2, 'After detach, re-attach should register handlers again')
  })
})

// ---------------------------------------------------------------------------
// generateHtml (error report)
// ---------------------------------------------------------------------------

import { generateHtml } from '../cdp-tools/error-report.js'

describe('generateHtml', () => {
  const baseData = {
    errors: [],
    consoleLogs: [],
    failedRequests: [],
    mainProcessLogs: [],
    stats: { totalErrors: 0 },
    timestamp: '2026-03-15T00:00:00.000Z',
    appUrl: 'http://localhost:3000',
  }

  it('returns valid HTML with doctype', () => {
    const html = generateHtml(baseData)
    assert.ok(html.startsWith('<!DOCTYPE html>'))
    assert.ok(html.includes('</html>'))
  })

  it('includes timestamp and app URL', () => {
    const html = generateHtml(baseData)
    assert.ok(html.includes('2026-03-15'))
    assert.ok(html.includes('localhost:3000'))
  })

  it('includes error data as JSON in script', () => {
    const data = {
      ...baseData,
      errors: [{ message: 'Test error', source: 'exception', count: 3, firstSeen: '2026-01-01', lastSeen: '2026-01-02', stack: 'at foo.js:1' }],
      stats: { totalErrors: 3 },
    }
    const html = generateHtml(data)
    assert.ok(html.includes('Test error'))
    assert.ok(html.includes('exception'))
  })

  it('includes the esc() function for XSS protection', () => {
    const html = generateHtml(baseData)
    assert.ok(html.includes('function esc(s)'))
    assert.ok(html.includes('textContent'))
  })

  it('includes CSS styles', () => {
    const html = generateHtml(baseData)
    assert.ok(html.includes('<style>'))
    assert.ok(html.includes('.error-group'))
    assert.ok(html.includes('.stat-error'))
  })
})

// ---------------------------------------------------------------------------
// scanner (using temp files)
// ---------------------------------------------------------------------------

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanForHandlers } from '../scanner/ipc-scanner.js'
import { scanForSchemas } from '../scanner/schema-scanner.js'

describe('ipc-scanner', () => {
  let dir: string

  it('setup', () => {
    dir = mkdtempSync(join(tmpdir(), 'edb-test-'))
  })

  it('detects ipcMain.handle with single quotes', () => {
    writeFileSync(join(dir, 'a.ts'), `ipcMain.handle('foo:bar', handler)`)
    const results = scanForHandlers(join(dir, 'a.ts'))
    assert.strictEqual(results.length, 1)
    assert.strictEqual(results[0].channel, 'foo:bar')
  })

  it('detects ipcMain.handle with double quotes', () => {
    writeFileSync(join(dir, 'b.ts'), `ipcMain.handle("baz:qux", handler)`)
    const results = scanForHandlers(join(dir, 'b.ts'))
    assert.strictEqual(results.length, 1)
    assert.strictEqual(results[0].channel, 'baz:qux')
  })

  it('detects multiple handlers in one file', () => {
    writeFileSync(join(dir, 'c.ts'), `
      ipcMain.handle('a:b', h1)
      ipcMain.handle('c:d', h2)
      ipcMain.handle('e:f', h3)
    `)
    assert.strictEqual(scanForHandlers(join(dir, 'c.ts')).length, 3)
  })

  it('reports correct line numbers', () => {
    writeFileSync(join(dir, 'd.ts'), `line1\nline2\nipcMain.handle('test:line', h)`)
    const results = scanForHandlers(join(dir, 'd.ts'))
    assert.strictEqual(results[0].line, 3)
  })

  it('returns empty array for file with no handlers', () => {
    writeFileSync(join(dir, 'e.ts'), `console.log('nothing here')`)
    assert.strictEqual(scanForHandlers(join(dir, 'e.ts')).length, 0)
  })

  it('cleanup', () => { rmSync(dir, { recursive: true, force: true }) })
})

describe('schema-scanner', () => {
  let dir: string

  it('setup', () => {
    dir = mkdtempSync(join(tmpdir(), 'edb-test-'))
  })

  it('detects exported Zod schemas', () => {
    writeFileSync(join(dir, 'a.ts'), `export const fooSchema = z.object({})`)
    const results = scanForSchemas(join(dir, 'a.ts'))
    assert.strictEqual(results.length, 1)
    assert.strictEqual(results[0].name, 'fooSchema')
  })

  it('detects multiple schemas', () => {
    writeFileSync(join(dir, 'b.ts'), `
      export const aSchema = z.string()
      export const bSchema = z.number()
      const notExported = z.boolean()
    `)
    const results = scanForSchemas(join(dir, 'b.ts'))
    assert.strictEqual(results.length, 2)
  })

  it('ignores non-schema exports', () => {
    writeFileSync(join(dir, 'c.ts'), `
      export const config = { key: 'value' }
      export function doSomething() {}
    `)
    assert.strictEqual(scanForSchemas(join(dir, 'c.ts')).length, 0)
  })

  it('cleanup', () => { rmSync(dir, { recursive: true, force: true }) })
})
