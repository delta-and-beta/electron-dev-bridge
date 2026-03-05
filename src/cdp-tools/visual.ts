import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { CdpTool, ToolContext } from './types.js'
import { getBoundingBox, toolResult } from './helpers.js'

export function createVisualTools(ctx: ToolContext): CdpTool[] {
  const { bridge, screenshotDir, screenshotFormat, state } = ctx

  return [
    {
      definition: {
        name: 'electron_screenshot',
        description:
          'Take a screenshot of the entire page or a specific element. Saves to disk and returns the file path.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description:
                'CSS selector of an element to screenshot. If omitted, captures the full page.',
            },
            fullPage: {
              type: 'boolean',
              description:
                'Capture the full scrollable page (not just the viewport). Defaults to true.',
            },
          },
        },
      },
      handler: async ({ selector, fullPage = true }: { selector?: string; fullPage?: boolean } = {}) => {
        bridge.ensureConnected()

        const captureParams: Record<string, any> = { format: screenshotFormat }

        if (selector) {
          const box = await getBoundingBox(bridge, selector)
          captureParams.clip = {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            scale: 1,
          }
        } else if (fullPage) {
          captureParams.captureBeyondViewport = true
        }

        const client = bridge.getRawClient()
        const { data } = await client.Page.captureScreenshot(captureParams)

        mkdirSync(screenshotDir, { recursive: true })

        state.screenshotCounter++
        const filename = `screenshot-${Date.now()}-${state.screenshotCounter}.${screenshotFormat}`
        const filepath = join(screenshotDir, filename)
        const buffer = Buffer.from(data, 'base64')
        writeFileSync(filepath, buffer)

        return toolResult({
          path: filepath,
          filename,
          base64Length: data.length,
          selector: selector || null,
        })
      },
    },
    {
      definition: {
        name: 'electron_compare_screenshots',
        description:
          'Compare two screenshot files byte-by-byte and report whether they are identical or how much they differ.',
        inputSchema: {
          type: 'object',
          properties: {
            pathA: {
              type: 'string',
              description: 'Absolute path to the first screenshot file.',
            },
            pathB: {
              type: 'string',
              description: 'Absolute path to the second screenshot file.',
            },
          },
          required: ['pathA', 'pathB'],
        },
      },
      handler: async ({ pathA, pathB }: { pathA: string; pathB: string }) => {
        const [bufA, bufB] = await Promise.all([
          readFile(pathA),
          readFile(pathB),
        ])

        const identical = bufA.equals(bufB)
        let diffBytes = 0

        if (!identical) {
          const len = Math.max(bufA.length, bufB.length)
          for (let i = 0; i < len; i++) {
            if ((bufA[i] || 0) !== (bufB[i] || 0)) {
              diffBytes++
            }
          }
        }

        const totalBytes = Math.max(bufA.length, bufB.length)
        const diffPercent = totalBytes > 0
          ? parseFloat(((diffBytes / totalBytes) * 100).toFixed(2))
          : 0

        return toolResult({ identical, diffPercent, totalBytes, diffBytes })
      },
    },
    {
      definition: {
        name: 'electron_highlight_element',
        description:
          'Temporarily highlight a DOM element with a red outline for visual identification (lasts 3 seconds).',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the element to highlight.',
            },
          },
          required: ['selector'],
        },
      },
      handler: async ({ selector }: { selector: string }) => {
        bridge.ensureConnected()

        await bridge.evaluate(`
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)} + '. Check the selector.');
            const prev = el.style.outline;
            el.style.outline = '3px solid red';
            setTimeout(() => { el.style.outline = prev; }, 3000);
            return true;
          })()
        `)

        return toolResult({ success: true, selector })
      },
    },
  ]
}
