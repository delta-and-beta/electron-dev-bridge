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
    {
      definition: {
        name: 'electron_evaluate',
        description:
          'Execute arbitrary JavaScript in the Electron renderer process and return the result. Use for inspecting app state, calling functions, or any operation not covered by other tools.',
        inputSchema: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description:
                'JavaScript expression to evaluate. Can be any valid JS including async/await. The result is returned by value.',
            },
            awaitPromise: {
              type: 'boolean',
              description:
                'Whether to await the result if it is a Promise. Default: true.',
            },
          },
          required: ['expression'],
        },
      },
      handler: async ({
        expression,
        awaitPromise = true,
      }: {
        expression: string
        awaitPromise?: boolean
      }) => {
        bridge.ensureConnected()
        const result = await bridge.evaluate(expression, awaitPromise)
        return toolResult({ result })
      },
    },
    {
      definition: {
        name: 'electron_get_page_summary',
        description:
          'Get a structured overview of the current page in one call: title, URL, counts of forms/buttons/links/images, visible error messages, loading indicators, and meta info. Use this first to understand a page before deciding what to do.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => {
        bridge.ensureConnected()
        const summary = await bridge.evaluate(`
          (() => {
            const inputs = document.querySelectorAll('input, textarea, select');
            const buttons = document.querySelectorAll('button, [role="button"], input[type="submit"]');
            const links = document.querySelectorAll('a[href]');
            const images = document.querySelectorAll('img');
            const forms = document.querySelectorAll('form');
            const errors = document.querySelectorAll('[class*="error"], [class*="Error"], [role="alert"], .invalid-feedback, .form-error');
            const loading = document.querySelectorAll('[class*="loading"], [class*="spinner"], [aria-busy="true"]');
            const modals = document.querySelectorAll('[role="dialog"], [class*="modal"][class*="show"], [class*="modal"][class*="open"]');

            const errorMessages = [];
            errors.forEach(el => {
              const text = el.textContent?.trim();
              if (text && text.length < 200) errorMessages.push(text);
            });

            return {
              title: document.title,
              url: window.location.href,
              counts: {
                forms: forms.length,
                inputs: inputs.length,
                buttons: buttons.length,
                links: links.length,
                images: images.length,
              },
              errors: errorMessages.slice(0, 10),
              hasErrors: errorMessages.length > 0,
              isLoading: loading.length > 0,
              hasModals: modals.length > 0,
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                scrollHeight: document.documentElement.scrollHeight,
              },
              meta: {
                charset: document.characterSet,
                lang: document.documentElement.lang || null,
              },
            };
          })()
        `)
        return toolResult(summary)
      },
    },
  ]
}
