import type { CdpBridge } from '../server/cdp-bridge.js'

export function toolResult(data: any) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

export function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: 'Error: ' + message }], isError: true as const }
}

export async function getBoundingBox(bridge: CdpBridge, selector: string) {
  const box = await bridge.evaluate(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: rect.x, y: rect.y,
        width: rect.width, height: rect.height,
        top: rect.top, right: rect.right,
        bottom: rect.bottom, left: rect.left
      };
    })()
  `)

  if (!box) {
    throw new Error(`Element not found: ${selector}`)
  }

  return box
}

export async function evaluateSelector(
  bridge: CdpBridge,
  selector: string,
  expression: string
): Promise<any> {
  return bridge.evaluate(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)} + '. Check that the selector is correct.');
      return ${expression};
    })()
  `)
}

export async function dispatchClick(client: any, x: number, y: number) {
  await client.Input.dispatchMouseEvent({
    type: 'mousePressed',
    x, y,
    button: 'left',
    clickCount: 1,
  })
  await client.Input.dispatchMouseEvent({
    type: 'mouseReleased',
    x, y,
    button: 'left',
    clickCount: 1,
  })
}
