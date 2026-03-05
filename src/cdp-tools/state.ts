import type { CdpTool, ToolContext } from './types.js'
import { evaluateSelector, getBoundingBox, toolResult } from './helpers.js'

export function createStateTools(ctx: ToolContext): CdpTool[] {
  const { bridge } = ctx

  return [
    {
      definition: {
        name: 'electron_get_text',
        description: 'Get the innerText of a DOM element by CSS selector.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the element.',
            },
          },
          required: ['selector'],
        },
      },
      handler: async ({ selector }: { selector: string }) => {
        bridge.ensureConnected()
        const text = await evaluateSelector(bridge, selector, 'el.innerText')
        return toolResult({ text })
      },
    },
    {
      definition: {
        name: 'electron_get_value',
        description:
          'Get the value property of an input, textarea, or select element.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the form element.',
            },
          },
          required: ['selector'],
        },
      },
      handler: async ({ selector }: { selector: string }) => {
        bridge.ensureConnected()
        const value = await evaluateSelector(bridge, selector, 'el.value')
        return toolResult({ value })
      },
    },
    {
      definition: {
        name: 'electron_get_attribute',
        description: 'Get a specific attribute value from a DOM element.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the element.',
            },
            attribute: {
              type: 'string',
              description: "Attribute name to read (e.g. 'href', 'src', 'data-id').",
            },
          },
          required: ['selector', 'attribute'],
        },
      },
      handler: async ({ selector, attribute }: { selector: string; attribute: string }) => {
        bridge.ensureConnected()
        const value = await evaluateSelector(bridge, selector, `el.getAttribute(${JSON.stringify(attribute)})`)
        return toolResult({ attribute, value })
      },
    },
    {
      definition: {
        name: 'electron_get_bounding_box',
        description:
          'Get the position and dimensions of a DOM element (x, y, width, height).',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the element.',
            },
          },
          required: ['selector'],
        },
      },
      handler: async ({ selector }: { selector: string }) => {
        bridge.ensureConnected()
        const box = await getBoundingBox(bridge, selector)
        return toolResult({ x: box.x, y: box.y, width: box.width, height: box.height })
      },
    },
    {
      definition: {
        name: 'electron_get_url',
        description: 'Get the current page URL of the Electron app.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => {
        bridge.ensureConnected()
        const url = await bridge.evaluate('window.location.href')
        return toolResult({ url })
      },
    },
  ]
}
