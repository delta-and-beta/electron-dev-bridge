# Chrome DevTools Protocol (CDP) Quick Reference

Reference for the CDP domains used by the electron-dev-bridge MCP server. Intended for developers who want to understand how the bridge works under the hood, or who need to extend it with new tools.

The bridge connects to Electron apps via `--remote-debugging-port` and communicates over WebSocket using the `chrome-remote-interface` npm package.

---

## 1. Runtime

Evaluate JavaScript in the renderer process context.

### Methods

**`Runtime.enable()`** -- Enables the Runtime domain. Must be called before using `Runtime.evaluate`. The bridge calls this automatically during `connectToCDP()`.

**`Runtime.evaluate({ expression, returnByValue, awaitPromise })`** -- Execute a JavaScript expression in the page.

| Parameter | Type | Description |
|-----------|------|-------------|
| `expression` | string | JavaScript code to evaluate |
| `returnByValue` | boolean | If `true`, returns the JS value directly instead of a remote object reference. The bridge always sets this to `true`. |
| `awaitPromise` | boolean | If `true`, waits for the returned Promise to resolve before returning the result. |

**Return structure:**

```
result: {
  result: {
    type: "string" | "number" | "object" | ...,
    value: <the actual value>    // <-- this is what you want
  },
  exceptionDetails: {            // present only on error
    exception: {
      description: "Error: ..."
    },
    text: "Uncaught"
  }
}
```

**Key distinction:** `result.result.value` is the deserialized JS value. The outer `result.result` object also contains metadata like `type`, `subtype`, `className`, and `objectId` (a remote object reference). The bridge's `evaluateJS()` helper extracts `.result.value` directly and throws on `exceptionDetails`.

### How the bridge uses it

```js
// From evaluateJS() in mcp-server.js
const result = await cdpClient.Runtime.evaluate({
  expression,
  returnByValue: true,
  awaitPromise,
});

if (result.exceptionDetails) {
  const errText =
    result.exceptionDetails.exception?.description ||
    result.exceptionDetails.text ||
    "Unknown evaluation error";
  throw new Error(`JS evaluation error: ${errText}`);
}

return result.result.value;
```

Most bridge tools wrap their logic in an IIFE passed to `evaluateJS()`:

```js
const value = await evaluateJS(`
  (() => {
    const el = document.querySelector("#my-element");
    if (!el) return null;
    return el.innerText;
  })()
`);
```

---

## 2. DOM

Inspect and query the DOM tree using node IDs.

### Methods

**`DOM.enable()`** -- Enables the DOM domain. Called automatically during connection.

**`DOM.getDocument()`** -- Returns the root document node. You need `root.nodeId` for all subsequent DOM queries.

```js
const { root } = await cdpClient.DOM.getDocument();
// root.nodeId is the starting point for querySelector/querySelectorAll
```

**`DOM.querySelector({ nodeId, selector })`** -- Find a single element by CSS selector.

- Returns `{ nodeId }` where `nodeId` is the matching element's ID.
- Returns `{ nodeId: 0 }` if no element matches -- check for this.

**`DOM.querySelectorAll({ nodeId, selector })`** -- Find all matching elements.

- Returns `{ nodeIds: [1, 2, 3, ...] }` -- an array of node IDs.

**`DOM.getAttributes({ nodeId })`** -- Get all attributes of an element.

- Returns a flat array: `[name1, value1, name2, value2, ...]`
- Parse into key-value pairs by iterating in steps of 2.

**`DOM.getOuterHTML({ nodeId })`** -- Get the outer HTML of an element.

- Returns `{ outerHTML: "<div>...</div>" }`

### nodeId vs remoteObjectId

These are two different identifier systems in CDP:

| Concept | Scope | Used for |
|---------|-------|----------|
| `nodeId` | DOM domain | DOM operations: querySelector, getAttributes, getOuterHTML |
| `remoteObjectId` | Runtime domain | JavaScript object references in the heap |

The bridge primarily uses `nodeId` for DOM queries and `Runtime.evaluate` (with `returnByValue: true`) for everything else, which avoids needing to manage remote object references.

### How the bridge uses it

```js
// From electron_query_selector tool
const { root } = await cdpClient.DOM.getDocument();
const { nodeId } = await cdpClient.DOM.querySelector({
  nodeId: root.nodeId,
  selector,
});

if (nodeId === 0) {
  return toolResult({ found: false });
}

// Parse flat attribute array into object
const { attributes: attrArray } = await cdpClient.DOM.getAttributes({ nodeId });
const attributes = {};
for (let i = 0; i < attrArray.length; i += 2) {
  attributes[attrArray[i]] = attrArray[i + 1];
}

const { outerHTML } = await cdpClient.DOM.getOuterHTML({ nodeId });
```

---

## 3. Input

Dispatch synthetic mouse and keyboard events.

### Mouse Events

**`Input.dispatchMouseEvent({ type, x, y, button, clickCount })`**

| Parameter | Type | Values |
|-----------|------|--------|
| `type` | string | `"mousePressed"`, `"mouseReleased"`, `"mouseMoved"` |
| `x` | number | X coordinate in CSS pixels |
| `y` | number | Y coordinate in CSS pixels |
| `button` | string | `"left"`, `"right"`, `"middle"` |
| `clickCount` | number | 1 for single click, 2 for double click |

A complete click requires two dispatches -- press then release:

```js
// From electron_click tool
await cdpClient.Input.dispatchMouseEvent({
  type: "mousePressed",
  x: clickX,
  y: clickY,
  button: "left",
  clickCount: 1,
});
await cdpClient.Input.dispatchMouseEvent({
  type: "mouseReleased",
  x: clickX,
  y: clickY,
  button: "left",
  clickCount: 1,
});
```

### Keyboard Events

**`Input.dispatchKeyEvent({ type, key, code, text, keyCode, windowsVirtualKeyCode, nativeVirtualKeyCode })`**

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | `"keyDown"`, `"keyUp"`, `"char"` |
| `key` | string | Key value (e.g., `"Enter"`, `"a"`, `"Tab"`) |
| `code` | string | Physical key code (e.g., `"Enter"`, `"KeyA"`, `"Tab"`) |
| `text` | string | Character to insert (for printable keys) |
| `keyCode` | number | Deprecated but needed for compatibility |
| `windowsVirtualKeyCode` | number | Virtual key code (same as keyCode for most keys) |
| `nativeVirtualKeyCode` | number | Native platform key code |

**Typing printable text** -- dispatch keyDown + keyUp per character with `text` and `key`:

```js
// From electron_type_text tool
for (const char of text) {
  await cdpClient.Input.dispatchKeyEvent({
    type: "keyDown",
    text: char,
    key: char,
    unmodifiedText: char,
  });
  await cdpClient.Input.dispatchKeyEvent({
    type: "keyUp",
    key: char,
  });
}
```

**Special keys** -- use key code mappings. The bridge defines these in `electron_press_key`:

| Key | keyCode | code |
|-----|---------|------|
| Enter | 13 | `"Enter"` |
| Tab | 9 | `"Tab"` |
| Escape | 27 | `"Escape"` |
| Backspace | 8 | `"Backspace"` |
| Delete | 46 | `"Delete"` |
| ArrowUp | 38 | `"ArrowUp"` |
| ArrowDown | 40 | `"ArrowDown"` |
| ArrowLeft | 37 | `"ArrowLeft"` |
| ArrowRight | 39 | `"ArrowRight"` |
| Home | 36 | `"Home"` |
| End | 35 | `"End"` |
| Space | 32 | `"Space"` |

```js
// Special key dispatch pattern
await cdpClient.Input.dispatchKeyEvent({
  type: "keyDown",
  key: "Enter",
  code: "Enter",
  windowsVirtualKeyCode: 13,
  nativeVirtualKeyCode: 13,
  text: "\r",
});
await cdpClient.Input.dispatchKeyEvent({
  type: "keyUp",
  key: "Enter",
  code: "Enter",
  windowsVirtualKeyCode: 13,
  nativeVirtualKeyCode: 13,
});
```

---

## 4. Page

Page lifecycle and screenshot capture.

### Methods

**`Page.enable()`** -- Enables the Page domain. Called automatically during connection.

**`Page.captureScreenshot({ format, clip, captureBeyondViewport })`**

| Parameter | Type | Description |
|-----------|------|-------------|
| `format` | string | `"png"` or `"jpeg"` |
| `clip` | object | `{ x, y, width, height, scale }` -- capture a specific region |
| `captureBeyondViewport` | boolean | `true` to capture content below the fold |

Returns `{ data }` where `data` is a base64-encoded image string.

### How the bridge uses it

```js
// Full page screenshot
const { data } = await cdpClient.Page.captureScreenshot({
  format: "png",
  captureBeyondViewport: true,
});

// Element screenshot using bounding box
const box = await getBoundingBox(selector);
const { data } = await cdpClient.Page.captureScreenshot({
  format: "png",
  clip: {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    scale: 1,
  },
});

// Decode and save to disk
const buffer = Buffer.from(data, "base64");
writeFileSync(filepath, buffer);
```

---

## 5. Emulation

Override device and viewport settings.

### Methods

**`Emulation.setDeviceMetricsOverride({ width, height, deviceScaleFactor, mobile })`**

| Parameter | Type | Description |
|-----------|------|-------------|
| `width` | number | Viewport width in pixels |
| `height` | number | Viewport height in pixels |
| `deviceScaleFactor` | number | Device pixel ratio (the bridge uses `1`) |
| `mobile` | boolean | Emulate mobile device (the bridge uses `false`) |

### How the bridge uses it

```js
// From electron_set_viewport tool
await cdpClient.Emulation.setDeviceMetricsOverride({
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
});
```

---

## 6. Network

Network activity monitoring. Enabled during connection but not heavily used by current tools.

### Methods

**`Network.enable()`** -- Enables network monitoring. Called automatically during connection.

### Events (available for extension)

| Event | Fires when | Useful data |
|-------|-----------|-------------|
| `Network.requestWillBeSent` | A request is about to be sent | URL, method, headers, timestamp |
| `Network.responseReceived` | A response is received | Status code, headers, MIME type |
| `Network.loadingFailed` | A request failed | Error text, canceled flag |

Example listener pattern for a future tool:

```js
cdpClient.Network.requestWillBeSent((params) => {
  console.log(`Request: ${params.request.method} ${params.request.url}`);
});

cdpClient.Network.responseReceived((params) => {
  console.log(`Response: ${params.response.status} ${params.response.url}`);
});
```

---

## Common Patterns

### Connecting to a CDP target

The bridge uses `chrome-remote-interface` to list targets and connect to the first page target:

```js
import CDP from "chrome-remote-interface";

// List all debuggable targets
const targets = await CDP.List({ port: 9229 });

// Find the renderer page (not the Electron main process)
const page = targets.find((t) => t.type === "page");

// Connect to it
const client = await CDP({ target: page, port: 9229 });

// Enable the domains you need
await client.Runtime.enable();
await client.DOM.enable();
await client.Page.enable();
await client.Network.enable();
```

### Evaluating JS and handling errors

```js
const result = await client.Runtime.evaluate({
  expression: 'document.title',
  returnByValue: true,
});

if (result.exceptionDetails) {
  // Something went wrong in the evaluated JS
  const message =
    result.exceptionDetails.exception?.description ||
    result.exceptionDetails.text;
  throw new Error(message);
}

const value = result.result.value;  // "My Page Title"
```

### Finding and clicking an element

Input events require pixel coordinates, not selectors. Use `getBoundingClientRect()` to translate:

```js
// Step 1: Get element position via Runtime.evaluate
const box = await client.Runtime.evaluate({
  expression: `(() => {
    const el = document.querySelector('#submit-btn');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`,
  returnByValue: true,
});

const { x, y, width, height } = box.result.value;
const clickX = x + width / 2;
const clickY = y + height / 2;

// Step 2: Dispatch mouse press + release at center of element
await client.Input.dispatchMouseEvent({
  type: "mousePressed", x: clickX, y: clickY, button: "left", clickCount: 1,
});
await client.Input.dispatchMouseEvent({
  type: "mouseReleased", x: clickX, y: clickY, button: "left", clickCount: 1,
});
```

### Taking a screenshot with clipping

Capture just one element instead of the whole page:

```js
// Get the element's bounding box
const box = await client.Runtime.evaluate({
  expression: `(() => {
    const el = document.querySelector('.card');
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`,
  returnByValue: true,
});

const { x, y, width, height } = box.result.value;

// Capture only that region
const { data } = await client.Page.captureScreenshot({
  format: "png",
  clip: { x, y, width, height, scale: 1 },
});

// data is base64-encoded PNG
const buffer = Buffer.from(data, "base64");
writeFileSync("element-screenshot.png", buffer);
```

---

## Gotchas

### Stale nodeIds after DOM mutations

DOM `nodeId` values are invalidated whenever the DOM changes (element added, removed, or moved). After any mutation, you must re-fetch the document and re-query:

```js
// WRONG: reusing a nodeId after the DOM changed
const { root } = await client.DOM.getDocument();
const { nodeId } = await client.DOM.querySelector({ nodeId: root.nodeId, selector: ".item" });
// ... user clicks something, DOM updates ...
await client.DOM.getOuterHTML({ nodeId });  // may fail or return wrong element

// RIGHT: re-fetch after mutations
const { root: freshRoot } = await client.DOM.getDocument();
const { nodeId: freshId } = await client.DOM.querySelector({ nodeId: freshRoot.nodeId, selector: ".item" });
await client.DOM.getOuterHTML({ nodeId: freshId });
```

This is why the bridge calls `DOM.getDocument()` at the start of every DOM tool invocation rather than caching the root.

### returnByValue cannot handle circular references

`Runtime.evaluate` with `returnByValue: true` serializes the result via structured clone. If the JS value contains circular references (e.g., `window`, DOM nodes, or objects that reference each other), the call will fail. Wrap your expressions to return only plain data:

```js
// WRONG: returning a DOM node
await client.Runtime.evaluate({
  expression: 'document.querySelector("div")',
  returnByValue: true,  // fails -- DOM nodes are not serializable
});

// RIGHT: extract the data you need
await client.Runtime.evaluate({
  expression: 'document.querySelector("div").innerText',
  returnByValue: true,  // returns a plain string
});
```

### Input events need coordinates, not selectors

CDP's `Input.dispatchMouseEvent` operates on viewport coordinates. There is no "click this selector" primitive. You must:

1. Resolve the selector to coordinates using `getBoundingClientRect()` via `Runtime.evaluate`
2. Calculate the center point: `x + width/2`, `y + height/2`
3. Dispatch `mousePressed` then `mouseReleased` at those coordinates

If the element is scrolled off-screen, the coordinates may be negative or beyond the viewport. Scroll the element into view first:

```js
await client.Runtime.evaluate({
  expression: `document.querySelector("${selector}").scrollIntoView({ block: "center" })`,
});
```

### captureBeyondViewport for full-page screenshots

By default, `Page.captureScreenshot` only captures what is visible in the current viewport. Content below the fold is not included. Set `captureBeyondViewport: true` to capture the full scrollable page:

```js
// Viewport only (may miss content)
await client.Page.captureScreenshot({ format: "png" });

// Full page including scrolled content
await client.Page.captureScreenshot({ format: "png", captureBeyondViewport: true });
```

### Domain must be enabled before use

Each CDP domain must be explicitly enabled before its methods or events can be used. Calling a method on a disabled domain may silently return empty results or fail. The bridge enables `Runtime`, `DOM`, `Page`, and `Network` during connection. If you add tools using other domains (e.g., `CSS`, `Overlay`, `DOMStorage`), enable them in `connectToCDP()`.

---

## Further Reading

- [Chrome DevTools Protocol documentation](https://chromedevtools.github.io/devtools-protocol/)
- [chrome-remote-interface npm package](https://www.npmjs.com/package/chrome-remote-interface)
- [Electron remote debugging docs](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process)
