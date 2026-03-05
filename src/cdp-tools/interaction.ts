import type { CdpTool, ToolContext } from './types.js'
import { dispatchClick, getBoundingBox, toolResult } from './helpers.js'

const KEY_MAP: Record<string, { keyCode: number; code: string; key: string; text?: string }> = {
  Enter: { keyCode: 13, code: 'Enter', key: 'Enter', text: '\r' },
  Tab: { keyCode: 9, code: 'Tab', key: 'Tab' },
  Escape: { keyCode: 27, code: 'Escape', key: 'Escape' },
  Backspace: { keyCode: 8, code: 'Backspace', key: 'Backspace' },
  Delete: { keyCode: 46, code: 'Delete', key: 'Delete' },
  ArrowUp: { keyCode: 38, code: 'ArrowUp', key: 'ArrowUp' },
  ArrowDown: { keyCode: 40, code: 'ArrowDown', key: 'ArrowDown' },
  ArrowLeft: { keyCode: 37, code: 'ArrowLeft', key: 'ArrowLeft' },
  ArrowRight: { keyCode: 39, code: 'ArrowRight', key: 'ArrowRight' },
  Home: { keyCode: 36, code: 'Home', key: 'Home' },
  End: { keyCode: 35, code: 'End', key: 'End' },
  Space: { keyCode: 32, code: 'Space', key: ' ', text: ' ' },
}

export function createInteractionTools(ctx: ToolContext): CdpTool[] {
  const { bridge } = ctx

  return [
    {
      definition: {
        name: 'electron_click',
        description:
          'Click on an element by CSS selector or at specific x/y coordinates.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the element to click.',
            },
            x: {
              type: 'number',
              description: 'X coordinate to click at (used if no selector).',
            },
            y: {
              type: 'number',
              description: 'Y coordinate to click at (used if no selector).',
            },
          },
        },
      },
      handler: async ({ selector, x, y }: { selector?: string; x?: number; y?: number } = {}) => {
        bridge.ensureConnected()

        let clickX: number
        let clickY: number

        if (selector) {
          const box = await getBoundingBox(bridge, selector)
          clickX = box.x + box.width / 2
          clickY = box.y + box.height / 2
        } else if (x !== undefined && y !== undefined) {
          clickX = x
          clickY = y
        } else {
          throw new Error(
            'Provide either a selector or both x and y coordinates to click.',
          )
        }

        const client = bridge.getRawClient()
        await dispatchClick(client, clickX, clickY)

        return toolResult({ clicked: true, x: clickX, y: clickY })
      },
    },
    {
      definition: {
        name: 'electron_type_text',
        description:
          'Type text into the focused element or a specific element (clicks it first if selector provided).',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text string to type.',
            },
            selector: {
              type: 'string',
              description:
                'CSS selector of the element to type into. Will be clicked to focus first.',
            },
          },
          required: ['text'],
        },
      },
      handler: async ({ text, selector }: { text: string; selector?: string }) => {
        bridge.ensureConnected()

        const client = bridge.getRawClient()

        if (selector) {
          const box = await getBoundingBox(bridge, selector)
          await dispatchClick(client, box.x + box.width / 2, box.y + box.height / 2)
        }

        for (const char of text) {
          await client.Input.dispatchKeyEvent({
            type: 'keyDown',
            text: char,
            key: char,
            unmodifiedText: char,
          })
          await client.Input.dispatchKeyEvent({
            type: 'keyUp',
            key: char,
          })
        }

        return toolResult({ typed: true, length: text.length })
      },
    },
    {
      definition: {
        name: 'electron_press_key',
        description:
          'Press a special key (Enter, Tab, Escape, arrow keys, etc.).',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'Key name: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, Space.',
            },
          },
          required: ['key'],
        },
      },
      handler: async ({ key }: { key: string }) => {
        bridge.ensureConnected()

        const mapped = KEY_MAP[key]
        if (!mapped) {
          throw new Error(
            `Unsupported key: "${key}". Supported keys: ${Object.keys(KEY_MAP).join(', ')}`,
          )
        }

        const downEvent: Record<string, any> = {
          type: 'keyDown',
          key: mapped.key,
          code: mapped.code,
          windowsVirtualKeyCode: mapped.keyCode,
          nativeVirtualKeyCode: mapped.keyCode,
        }
        if (mapped.text) downEvent.text = mapped.text

        const client = bridge.getRawClient()
        await client.Input.dispatchKeyEvent(downEvent)
        await client.Input.dispatchKeyEvent({
          type: 'keyUp',
          key: mapped.key,
          code: mapped.code,
          windowsVirtualKeyCode: mapped.keyCode,
          nativeVirtualKeyCode: mapped.keyCode,
        })

        return toolResult({ pressed: key })
      },
    },
    {
      definition: {
        name: 'electron_select_option',
        description:
          'Select an option in a <select> element by value or visible text.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the <select> element.',
            },
            value: {
              type: 'string',
              description: 'Option value or visible text to select.',
            },
          },
          required: ['selector', 'value'],
        },
      },
      handler: async ({ selector, value }: { selector: string; value: string }) => {
        bridge.ensureConnected()

        const result = await bridge.evaluate(`
          (() => {
            const select = document.querySelector(${JSON.stringify(selector)});
            if (!select) throw new Error('Select element not found: ${selector.replace(/'/g, "\\'")}');
            if (select.tagName !== 'SELECT') throw new Error('Element is not a <select>');

            const value = ${JSON.stringify(value)};
            let found = false;

            for (const opt of select.options) {
              if (opt.value === value || opt.textContent.trim() === value) {
                select.value = opt.value;
                found = true;
                break;
              }
            }

            if (!found) throw new Error('Option not found: ' + value);

            select.dispatchEvent(new Event('change', { bubbles: true }));
            select.dispatchEvent(new Event('input', { bubbles: true }));

            return { success: true, selected: value };
          })()
        `)

        return toolResult(result)
      },
    },
  ]
}
