import type { CdpTool, ToolContext } from './types.js'
import { evaluateSelector, toolResult } from './helpers.js'

export function createNavigationTools(ctx: ToolContext): CdpTool[] {
  const { bridge } = ctx

  return [
    {
      definition: {
        name: 'electron_wait_for_selector',
        description:
          'Wait for a DOM element matching a CSS selector to appear, polling until found or timeout.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector to wait for.',
            },
            timeout: {
              type: 'number',
              description: 'Maximum time to wait in milliseconds. Defaults to 5000.',
            },
          },
          required: ['selector'],
        },
      },
      handler: async ({ selector, timeout = 5000 }: { selector: string; timeout?: number }) => {
        bridge.ensureConnected()

        const interval = 250
        let elapsed = 0

        while (elapsed < timeout) {
          const found = await bridge.evaluate(
            `!!document.querySelector(${JSON.stringify(selector)})`,
          )
          if (found) {
            return toolResult({ found: true, selector, elapsed })
          }
          await new Promise(r => setTimeout(r, interval))
          elapsed += interval
        }

        throw new Error(
          `Timeout after ${timeout}ms waiting for selector "${selector}". ` +
            'The element may not exist yet, or the selector may be incorrect. ' +
            'Try increasing the timeout or verifying the selector.',
        )
      },
    },
    {
      definition: {
        name: 'electron_set_viewport',
        description:
          'Set the viewport dimensions of the Electron window for responsive testing.',
        inputSchema: {
          type: 'object',
          properties: {
            width: {
              type: 'number',
              description: 'Viewport width in pixels.',
            },
            height: {
              type: 'number',
              description: 'Viewport height in pixels.',
            },
          },
          required: ['width', 'height'],
        },
      },
      handler: async ({ width, height }: { width: number; height: number }) => {
        bridge.ensureConnected()

        const client = bridge.getRawClient()
        await client.Emulation.setDeviceMetricsOverride({
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        })

        return toolResult({ width, height })
      },
    },
    {
      definition: {
        name: 'electron_scroll',
        description:
          'Scroll the page or a specific element in a given direction.',
        inputSchema: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              description:
                'Scroll direction: "up", "down", "left", or "right". Defaults to "down".',
            },
            amount: {
              type: 'number',
              description: 'Number of pixels to scroll. Defaults to 500.',
            },
            selector: {
              type: 'string',
              description:
                'CSS selector of a scrollable element. If omitted, scrolls the page window.',
            },
          },
        },
      },
      handler: async (
        { direction = 'down', amount = 500, selector }:
        { direction?: string; amount?: number; selector?: string } = {},
      ) => {
        bridge.ensureConnected()

        let dx = 0
        let dy = 0
        switch (direction) {
          case 'up':    dy = -amount; break
          case 'down':  dy = amount;  break
          case 'left':  dx = -amount; break
          case 'right': dx = amount;  break
          default:
            throw new Error(
              `Invalid direction: "${direction}". Use "up", "down", "left", or "right".`,
            )
        }

        if (selector) {
          const result = await evaluateSelector(bridge, selector,
            `(el.scrollBy(${dx}, ${dy}), { success: true, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft })`)
          return toolResult(result)
        }

        const result = await bridge.evaluate(`
          (() => {
            window.scrollBy(${dx}, ${dy});
            return { success: true, scrollX: window.scrollX, scrollY: window.scrollY };
          })()
        `)
        return toolResult(result)
      },
    },
  ]
}
