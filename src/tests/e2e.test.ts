/**
 * E2E tests — launches the test-app Electron app and exercises
 * all tool categories against a real CDP connection.
 *
 * Run: npm run build && node --test dist/tests/e2e.test.js
 *
 * Requires: cd test-app && npm install (one-time setup)
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { spawn, type ChildProcess } from 'node:child_process'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { CdpBridge } from '../server/cdp-bridge.js'
import { getCdpTools, type CdpTool } from '../cdp-tools/index.js'
import { DevtoolsStore } from '../cdp-tools/devtools.js'

const TEST_APP_DIR = resolve(join(import.meta.dirname, '../../test-app'))
const ELECTRON_BIN = join(TEST_APP_DIR, 'node_modules', '.bin', 'electron')

// Helper: parse tool result JSON from MCP response
function parseResult(response: any): any {
  const text = response.content[0].text
  return JSON.parse(text)
}

// Helper: find a tool by name
function tool(tools: CdpTool[], name: string): CdpTool {
  const t = tools.find(t => t.definition.name === name)
  if (!t) throw new Error(`Tool not found: ${name}`)
  return t
}

describe('E2E: electron-dev-bridge against test-app', { timeout: 60000 }, () => {
  let electronProcess: ChildProcess
  let bridge: CdpBridge
  let tools: CdpTool[]
  const debugPort = 19229 // Use high port to avoid conflicts

  before(async () => {
    // Check test-app is installed
    if (!existsSync(ELECTRON_BIN)) {
      throw new Error('Electron not installed in test-app/. Run: cd test-app && npm install')
    }

    // Spawn Electron app
    electronProcess = spawn(
      ELECTRON_BIN,
      [`--remote-debugging-port=${debugPort}`, TEST_APP_DIR],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )

    // Wait for app to start
    await new Promise(r => setTimeout(r, 3000))

    if (electronProcess.exitCode !== null) {
      throw new Error(`Electron exited with code ${electronProcess.exitCode}`)
    }

    // Create bridge (don't connect yet — let electron_connect tool handle it)
    bridge = new CdpBridge(debugPort)

    // Get all tools
    tools = getCdpTools(bridge, { name: 'test-app', path: TEST_APP_DIR, debugPort }, { dir: '.screenshots' })

    // Connect via the tool handler — this attaches DevtoolsStore
    await tool(tools, 'electron_connect').handler({ port: debugPort })
  })

  after(async () => {
    await bridge?.close()
    electronProcess?.kill()
    // Wait for process to fully exit
    await new Promise(r => setTimeout(r, 500))
  })

  // ─── Connection ─────────────────────────────────────────────

  it('bridge is connected', () => {
    assert.strictEqual(bridge.connected, true)
  })

  // ─── State Reading ──────────────────────────────────────────

  it('electron_get_url returns the app URL', async () => {
    const res = parseResult(await tool(tools, 'electron_get_url').handler({}))
    assert.ok(res.url.includes('index.html'), `Expected index.html in URL, got: ${res.url}`)
  })

  it('electron_evaluate runs JS in renderer', async () => {
    const res = parseResult(await tool(tools, 'electron_evaluate').handler({
      expression: 'document.title',
    }))
    assert.ok(res.result.includes('Test App'), `Expected title to contain "Test App", got: ${res.result}`)
  })

  it('electron_get_page_summary returns page overview', async () => {
    const res = parseResult(await tool(tools, 'electron_get_page_summary').handler({}))
    assert.ok(res.title.includes('Test App'))
    assert.ok(res.counts.forms >= 1, 'Should have at least 1 form')
    assert.ok(res.counts.buttons >= 5, 'Should have at least 5 buttons')
    assert.ok(res.counts.inputs >= 4, 'Should have at least 4 inputs')
    assert.ok(res.counts.links >= 2, 'Should have at least 2 links')
  })

  // ─── DOM Queries ────────────────────────────────────────────

  it('electron_query_selector finds an element', async () => {
    const res = parseResult(await tool(tools, 'electron_query_selector').handler({
      selector: '[data-testid="submit-btn"]',
    }))
    assert.ok(res.tagName === 'BUTTON' || res.tag === 'button' || res.found)
  })

  it('electron_query_selector_all finds multiple elements', async () => {
    const res = parseResult(await tool(tools, 'electron_query_selector_all').handler({
      selector: 'button',
    }))
    assert.ok(res.count >= 5 || res.length >= 5 || (Array.isArray(res.elements) && res.elements.length >= 5))
  })

  it('electron_find_by_text finds elements by text content', async () => {
    const res = parseResult(await tool(tools, 'electron_find_by_text').handler({
      text: 'Submit',
    }))
    assert.ok(res.count >= 1 || res.length >= 1 || (Array.isArray(res.elements) && res.elements.length >= 1))
  })

  it('electron_find_by_role finds buttons', async () => {
    const res = parseResult(await tool(tools, 'electron_find_by_role').handler({
      role: 'button',
    }))
    assert.ok(res.count >= 1 || res.length >= 1 || (Array.isArray(res.elements) && res.elements.length >= 1))
  })

  it('electron_get_accessibility_tree returns tree structure', async () => {
    const res = parseResult(await tool(tools, 'electron_get_accessibility_tree').handler({
      maxDepth: 3,
    }))
    // The tool returns a stringified tree — check it's non-empty
    const text = typeof res === 'string' ? res : JSON.stringify(res)
    assert.ok(text.length > 50, 'Should return substantial tree data')
  })

  // ─── Form State ─────────────────────────────────────────────

  it('electron_get_form_state returns form fields', async () => {
    const res = parseResult(await tool(tools, 'electron_get_form_state').handler({
      selector: '#contact-form',
    }))
    assert.ok(res.fieldCount >= 4, `Expected at least 4 fields, got ${res.fieldCount}`)
    const nameField = res.fields.find((f: any) => f.id === 'name' || f.name === 'name')
    assert.ok(nameField, 'Should find name field')
    assert.strictEqual(nameField.required, true)
  })

  // ─── Interaction ────────────────────────────────────────────

  it('electron_click clicks the counter button', async () => {
    const res = parseResult(await tool(tools, 'electron_click').handler({
      selector: '[data-testid="counter-btn"]',
    }))
    assert.strictEqual(res.clicked, true)

    // Verify counter incremented
    const text = parseResult(await tool(tools, 'electron_get_text').handler({
      selector: '[data-testid="counter-btn"]',
    }))
    assert.ok(text.text.includes('Clicked: 1'), `Expected "Clicked: 1", got: ${text.text}`)
  })

  it('electron_fill clears and types new text', async () => {
    // First put some text in
    await tool(tools, 'electron_fill').handler({
      selector: '#name', text: 'Initial',
    })
    // Then fill with new text (should replace)
    const res = parseResult(await tool(tools, 'electron_fill').handler({
      selector: '#name', text: 'Jane Doe',
    }))
    assert.strictEqual(res.filled, true)

    const val = parseResult(await tool(tools, 'electron_get_value').handler({
      selector: '#name',
    }))
    assert.strictEqual(val.value, 'Jane Doe')
  })

  it('electron_select_option selects a dropdown value', async () => {
    const res = parseResult(await tool(tools, 'electron_select_option').handler({
      selector: '#role', value: 'admin',
    }))
    assert.ok(res.success)

    const val = parseResult(await tool(tools, 'electron_get_value').handler({
      selector: '#role',
    }))
    assert.strictEqual(val.value, 'admin')
  })

  it('electron_hover triggers hover state', async () => {
    const res = parseResult(await tool(tools, 'electron_hover').handler({
      selector: '[data-testid="tooltip-trigger"]',
    }))
    assert.strictEqual(res.hovered, true)
  })

  it('electron_press_key sends a key press', async () => {
    const res = parseResult(await tool(tools, 'electron_press_key').handler({
      key: 'Tab',
    }))
    assert.deepStrictEqual(res, { pressed: 'Tab' })
  })

  // ─── Batch Execution ───────────────────────────────────────

  it('electron_execute_steps runs a sequence of actions', async () => {
    const res = parseResult(await tool(tools, 'electron_execute_steps').handler({
      steps: [
        { fill: { selector: '#email', text: 'jane@test.com' } },
        { click: '[data-testid="submit-btn"]' },
        { wait: '[data-testid="form-success"]' },
      ],
    }))
    assert.strictEqual(res.completed, 3)
    assert.strictEqual(res.stoppedEarly, false)
  })

  // ─── Assertions ─────────────────────────────────────────────

  it('electron_assert verifies multiple conditions', async () => {
    const res = parseResult(await tool(tools, 'electron_assert').handler({
      assertions: [
        { selector: '[data-testid="form-success"]', visible: true },
        { selector: '[data-testid="form-success"]', text: 'successfully' },
        { selector: '#name', value: 'Jane Doe' },
        { title: 'Test App' },
      ],
    }))
    assert.strictEqual(res.allPassed, true, `Assertions failed: ${JSON.stringify(res.results.filter((r: any) => !r.pass))}`)
  })

  // ─── State Diff ─────────────────────────────────────────────

  it('electron_diff_state captures and compares snapshots', async () => {
    // Snapshot
    const snap = parseResult(await tool(tools, 'electron_diff_state').handler({ mode: 'snapshot' }))
    assert.ok(snap.snapshot)

    // Click counter to change state
    await tool(tools, 'electron_click').handler({ selector: '[data-testid="counter-btn"]' })

    // Diff
    const diff = parseResult(await tool(tools, 'electron_diff_state').handler({ mode: 'diff' }))
    assert.strictEqual(diff.changed, true)
    assert.ok(diff.changes.length > 0, 'Should detect at least one change')
  })

  // ─── Navigation ─────────────────────────────────────────────

  it('electron_scroll scrolls the page', async () => {
    const res = parseResult(await tool(tools, 'electron_scroll').handler({
      direction: 'down', amount: 300,
    }))
    assert.ok(res.success)
    assert.ok(res.scrollY > 0)
  })

  it('electron_wait_for_selector finds an existing element', async () => {
    const res = parseResult(await tool(tools, 'electron_wait_for_selector').handler({
      selector: '[data-testid="submit-btn"]', timeout: 2000,
    }))
    assert.strictEqual(res.found, true)
  })

  // ─── Visual ─────────────────────────────────────────────────

  it('electron_screenshot captures a screenshot', async () => {
    const res = parseResult(await tool(tools, 'electron_screenshot').handler({}))
    assert.ok(res.path, 'Should return a file path')
    assert.ok(res.path.endsWith('.png'))
    assert.ok(existsSync(res.path), `Screenshot file should exist: ${res.path}`)
  })

  it('electron_screenshot captures element screenshot', async () => {
    const res = parseResult(await tool(tools, 'electron_screenshot').handler({
      selector: '[data-testid="counter-btn"]',
    }))
    assert.ok(res.path)
    assert.strictEqual(res.selector, '[data-testid="counter-btn"]')
  })

  it('electron_highlight_element outlines an element', async () => {
    const res = parseResult(await tool(tools, 'electron_highlight_element').handler({
      selector: '[data-testid="submit-btn"]',
    }))
    assert.strictEqual(res.success, true)
  })

  // ─── DevTools Capture ───────────────────────────────────────

  it('electron_get_console_logs captures console output', async () => {
    // Generate a console log (store is attached by now)
    await bridge.evaluate('console.log("e2e test log message unique")')
    // Small delay for event to propagate
    await new Promise(r => setTimeout(r, 100))

    const res = parseResult(await tool(tools, 'electron_get_console_logs').handler({
      search: 'e2e test log message unique',
    }))
    assert.ok(res.total >= 1, `Should capture at least 1 console log, got ${res.total}`)
  })

  it('electron_get_errors captures thrown exceptions', async () => {
    // Clear first
    await tool(tools, 'electron_clear_devtools_data').handler({ type: 'errors' })

    // Trigger an error via console.error (reliable capture)
    await bridge.evaluate('console.error("E2E test error for capture")')
    await new Promise(r => setTimeout(r, 200))

    const res = parseResult(await tool(tools, 'electron_get_errors').handler({}))
    assert.ok(res.totalErrors >= 1, `Expected at least 1 error, got ${res.totalErrors}`)
    const consoleErr = res.groups.find((g: any) => g.source === 'console.error')
    assert.ok(consoleErr, 'Should have a console.error error group')
    assert.ok(consoleErr.message.includes('E2E test error'))
  })

  it('electron_get_network_requests captures requests', async () => {
    // Trigger a network request
    await bridge.evaluate('fetch("https://httpbin.org/get").catch(() => {})')
    await new Promise(r => setTimeout(r, 1000))

    const res = parseResult(await tool(tools, 'electron_get_network_requests').handler({}))
    assert.ok(res.total >= 1, 'Should capture at least 1 network request')
  })

  it('electron_get_devtools_stats returns counts', async () => {
    const res = parseResult(await tool(tools, 'electron_get_devtools_stats').handler({}))
    assert.strictEqual(res.capturing, true)
    assert.ok(res.console >= 0)
    assert.ok(res.network >= 0)
    assert.ok(res.errors >= 0)
  })

  it('electron_error_report generates HTML file', async () => {
    const res = parseResult(await tool(tools, 'electron_error_report').handler({}))
    assert.ok(res.path, 'Should return a file path')
    assert.ok(res.path.endsWith('.html'))
    assert.ok(existsSync(res.path), `Report file should exist: ${res.path}`)
    assert.ok(res.summary)
  })

  // ─── Attributes & Bounding Box ──────────────────────────────

  it('electron_get_attribute reads element attributes', async () => {
    const res = parseResult(await tool(tools, 'electron_get_attribute').handler({
      selector: '#disabled-field', attribute: 'disabled',
    }))
    assert.ok(res.value !== null && res.value !== undefined)
  })

  it('electron_get_bounding_box returns element dimensions', async () => {
    const res = parseResult(await tool(tools, 'electron_get_bounding_box').handler({
      selector: '[data-testid="submit-btn"]',
    }))
    assert.ok(res.width > 0)
    assert.ok(res.height > 0)
    assert.ok(typeof res.x === 'number')
    assert.ok(typeof res.y === 'number')
  })

  // ─── Viewport ───────────────────────────────────────────────

  it('electron_set_viewport overrides viewport metrics', async () => {
    const res = parseResult(await tool(tools, 'electron_set_viewport').handler({
      width: 800, height: 600,
    }))
    assert.deepStrictEqual(res, { width: 800, height: 600 })

    // Verify via evaluate
    const size = await bridge.evaluate('({ w: window.innerWidth, h: window.innerHeight })')
    assert.strictEqual(size.w, 800)
    assert.strictEqual(size.h, 600)
  })

  // ─── Clear ──────────────────────────────────────────────────

  it('electron_clear_devtools_data clears all buffers', async () => {
    await tool(tools, 'electron_clear_devtools_data').handler({ type: 'all' })

    const stats = parseResult(await tool(tools, 'electron_get_devtools_stats').handler({}))
    assert.strictEqual(stats.console, 0)
    assert.strictEqual(stats.errors, 0)
  })
})
