import type { CdpTool, ToolContext } from './types.js'
import { getBoundingBox, dispatchClick, toolResult } from './helpers.js'

export function createBatchTools(ctx: ToolContext): CdpTool[] {
  const { bridge } = ctx

  return [
    {
      definition: {
        name: 'electron_execute_steps',
        description:
          'Execute a sequence of actions in one call. Stops on first error. Returns results for each step. Reduces round-trip latency for multi-step interactions.',
        inputSchema: {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              description: 'Array of step objects. Each has one action key.',
              items: {
                type: 'object',
                properties: {
                  click: { type: 'string', description: 'CSS selector to click.' },
                  fill: {
                    type: 'object',
                    properties: {
                      selector: { type: 'string' },
                      text: { type: 'string' },
                    },
                  },
                  type: {
                    type: 'object',
                    properties: {
                      text: { type: 'string' },
                      selector: { type: 'string' },
                    },
                  },
                  press: { type: 'string', description: 'Key name to press.' },
                  wait: { type: 'string', description: 'CSS selector to wait for.' },
                  evaluate: { type: 'string', description: 'JS expression to evaluate.' },
                  screenshot: { type: 'boolean', description: 'Take a screenshot.' },
                  navigate: { type: 'string', description: 'URL to navigate to.' },
                  hover: { type: 'string', description: 'CSS selector to hover.' },
                  pause: { type: 'number', description: 'Milliseconds to wait.' },
                },
              },
            },
          },
          required: ['steps'],
        },
      },
      handler: async ({ steps }: { steps: Array<Record<string, any>> }) => {
        bridge.ensureConnected()
        const client = bridge.getRawClient()
        const results: Array<{ step: number; action: string; ok: boolean; result?: any; error?: string }> = []

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i]
          try {
            if (step.click) {
              const box = await getBoundingBox(bridge, step.click)
              await dispatchClick(client, box.x + box.width / 2, box.y + box.height / 2)
              results.push({ step: i, action: 'click', ok: true, result: { selector: step.click } })

            } else if (step.fill) {
              const { selector, text } = step.fill
              const box = await getBoundingBox(bridge, selector)
              const cx = box.x + box.width / 2
              const cy = box.y + box.height / 2
              await dispatchClick(client, cx, cy)
              await client.Input.dispatchMouseEvent({ type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 3 })
              await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 3 })
              for (const char of text) {
                await client.Input.dispatchKeyEvent({ type: 'keyDown', text: char, key: char, unmodifiedText: char })
                await client.Input.dispatchKeyEvent({ type: 'keyUp', key: char })
              }
              results.push({ step: i, action: 'fill', ok: true, result: { selector, length: text.length } })

            } else if (step.type) {
              const { text, selector } = step.type
              if (selector) {
                const box = await getBoundingBox(bridge, selector)
                await dispatchClick(client, box.x + box.width / 2, box.y + box.height / 2)
              }
              for (const char of text) {
                await client.Input.dispatchKeyEvent({ type: 'keyDown', text: char, key: char, unmodifiedText: char })
                await client.Input.dispatchKeyEvent({ type: 'keyUp', key: char })
              }
              results.push({ step: i, action: 'type', ok: true, result: { length: text.length } })

            } else if (step.press) {
              const KEY_MAP: Record<string, any> = {
                Enter: { keyCode: 13, code: 'Enter', key: 'Enter', text: '\r' },
                Tab: { keyCode: 9, code: 'Tab', key: 'Tab' },
                Escape: { keyCode: 27, code: 'Escape', key: 'Escape' },
                Backspace: { keyCode: 8, code: 'Backspace', key: 'Backspace' },
                Space: { keyCode: 32, code: 'Space', key: ' ', text: ' ' },
              }
              const mapped = KEY_MAP[step.press]
              if (!mapped) throw new Error(`Unsupported key: ${step.press}`)
              const down: any = { type: 'keyDown', key: mapped.key, code: mapped.code, windowsVirtualKeyCode: mapped.keyCode }
              if (mapped.text) down.text = mapped.text
              await client.Input.dispatchKeyEvent(down)
              await client.Input.dispatchKeyEvent({ type: 'keyUp', key: mapped.key, code: mapped.code })
              results.push({ step: i, action: 'press', ok: true, result: { key: step.press } })

            } else if (step.wait) {
              const timeout = 5000
              const interval = 250
              let elapsed = 0
              while (elapsed < timeout) {
                const found = await bridge.evaluate(`!!document.querySelector(${JSON.stringify(step.wait)})`)
                if (found) break
                await new Promise(r => setTimeout(r, interval))
                elapsed += interval
              }
              if (elapsed >= timeout) throw new Error(`Timeout waiting for: ${step.wait}`)
              results.push({ step: i, action: 'wait', ok: true, result: { selector: step.wait } })

            } else if (step.evaluate) {
              const value = await bridge.evaluate(step.evaluate)
              results.push({ step: i, action: 'evaluate', ok: true, result: { value } })

            } else if (step.screenshot) {
              const { data } = await client.Page.captureScreenshot({ format: 'png' })
              const { mkdirSync, writeFileSync } = await import('node:fs')
              const { join } = await import('node:path')
              const dir = ctx.screenshotDir
              mkdirSync(dir, { recursive: true })
              ctx.state.screenshotCounter++
              const filename = `screenshot-${Date.now()}-${ctx.state.screenshotCounter}.png`
              const filepath = join(dir, filename)
              writeFileSync(filepath, Buffer.from(data, 'base64'))
              results.push({ step: i, action: 'screenshot', ok: true, result: { path: filepath } })

            } else if (step.navigate) {
              const loadPromise = new Promise<void>(resolve => { client.Page.loadEventFired(() => resolve()) })
              await client.Page.navigate({ url: step.navigate })
              await loadPromise
              const url = await bridge.evaluate('window.location.href')
              results.push({ step: i, action: 'navigate', ok: true, result: { url } })

            } else if (step.hover) {
              const box = await getBoundingBox(bridge, step.hover)
              await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x: box.x + box.width / 2, y: box.y + box.height / 2 })
              results.push({ step: i, action: 'hover', ok: true, result: { selector: step.hover } })

            } else if (step.pause) {
              await new Promise(r => setTimeout(r, step.pause))
              results.push({ step: i, action: 'pause', ok: true, result: { ms: step.pause } })

            } else {
              results.push({ step: i, action: 'unknown', ok: false, error: `Unknown step: ${JSON.stringify(step)}` })
              break
            }
          } catch (err: any) {
            results.push({ step: i, action: Object.keys(step)[0], ok: false, error: err.message })
            break
          }
        }

        const completed = results.filter(r => r.ok).length
        return toolResult({
          completed,
          total: steps.length,
          stoppedEarly: completed < steps.length,
          results,
        })
      },
    },
    {
      definition: {
        name: 'electron_assert',
        description:
          'Verify one or more conditions about the current page state. Returns pass/fail for each assertion with actual values. Use for testing and validation.',
        inputSchema: {
          type: 'object',
          properties: {
            assertions: {
              type: 'array',
              description: 'Array of assertion objects.',
              items: {
                type: 'object',
                properties: {
                  selector: { type: 'string', description: 'CSS selector of element to check.' },
                  text: { type: 'string', description: 'Expected innerText (substring match).' },
                  value: { type: 'string', description: 'Expected input value (exact match).' },
                  attribute: { type: 'string', description: 'Attribute name to check.' },
                  equals: { type: 'string', description: 'Expected attribute value.' },
                  visible: { type: 'boolean', description: 'Assert element is visible (true) or hidden (false).' },
                  exists: { type: 'boolean', description: 'Assert element exists (true) or does not exist (false).' },
                  url: { type: 'string', description: 'Assert current URL contains this string.' },
                  title: { type: 'string', description: 'Assert page title contains this string.' },
                },
              },
            },
          },
          required: ['assertions'],
        },
      },
      handler: async ({ assertions }: { assertions: Array<Record<string, any>> }) => {
        bridge.ensureConnected()

        const results: Array<{ index: number; pass: boolean; assertion: string; expected: any; actual: any }> = []

        for (let i = 0; i < assertions.length; i++) {
          const a = assertions[i]
          try {
            if (a.url) {
              const actual = await bridge.evaluate('window.location.href')
              const pass = actual.includes(a.url)
              results.push({ index: i, pass, assertion: 'url contains', expected: a.url, actual })

            } else if (a.title) {
              const actual = await bridge.evaluate('document.title')
              const pass = actual.includes(a.title)
              results.push({ index: i, pass, assertion: 'title contains', expected: a.title, actual })

            } else if (a.selector && a.exists !== undefined) {
              const actual = await bridge.evaluate(`!!document.querySelector(${JSON.stringify(a.selector)})`)
              const pass = actual === a.exists
              results.push({ index: i, pass, assertion: a.exists ? 'exists' : 'not exists', expected: a.exists, actual })

            } else if (a.selector && a.visible !== undefined) {
              const actual = await bridge.evaluate(`
                (() => {
                  const el = document.querySelector(${JSON.stringify(a.selector)});
                  if (!el) return false;
                  const style = window.getComputedStyle(el);
                  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                })()
              `)
              const pass = actual === a.visible
              results.push({ index: i, pass, assertion: a.visible ? 'visible' : 'hidden', expected: a.visible, actual })

            } else if (a.selector && a.text) {
              const actual = await bridge.evaluate(`document.querySelector(${JSON.stringify(a.selector)})?.innerText || ''`)
              const pass = actual.includes(a.text)
              results.push({ index: i, pass, assertion: 'text contains', expected: a.text, actual: actual.slice(0, 200) })

            } else if (a.selector && a.value !== undefined) {
              const actual = await bridge.evaluate(`document.querySelector(${JSON.stringify(a.selector)})?.value ?? null`)
              const pass = actual === a.value
              results.push({ index: i, pass, assertion: 'value equals', expected: a.value, actual })

            } else if (a.selector && a.attribute && a.equals !== undefined) {
              const actual = await bridge.evaluate(`document.querySelector(${JSON.stringify(a.selector)})?.getAttribute(${JSON.stringify(a.attribute)})`)
              const pass = actual === a.equals
              results.push({ index: i, pass, assertion: `attribute ${a.attribute} equals`, expected: a.equals, actual })

            } else {
              results.push({ index: i, pass: false, assertion: 'unknown', expected: null, actual: 'Unrecognized assertion format' })
            }
          } catch (err: any) {
            results.push({ index: i, pass: false, assertion: 'error', expected: null, actual: err.message })
          }
        }

        const passed = results.filter(r => r.pass).length
        const failed = results.filter(r => !r.pass).length

        return toolResult({
          passed,
          failed,
          total: assertions.length,
          allPassed: failed === 0,
          results,
        })
      },
    },
  ]
}
