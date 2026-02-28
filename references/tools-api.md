# Tools API Reference

Complete API reference for all 22 MCP tools provided by `electron-dev-bridge`.

---

## Table of Contents

1. [Connection & Lifecycle](#1-connection--lifecycle) (2 tools)
2. [DOM Queries](#2-dom-queries) (5 tools)
3. [Interactions](#3-interactions) (4 tools)
4. [Reading State](#4-reading-state) (5 tools)
5. [Navigation & Viewport](#5-navigation--viewport) (3 tools)
6. [Screenshots & Visual](#6-screenshots--visual) (3 tools)

---

## 1. Connection & Lifecycle

### `electron_launch`

Launch an Electron application with remote debugging enabled and connect to it via CDP.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `appPath` | `string` | No | `ELECTRON_APP_PATH` env var | Path to the Electron app directory. Defaults to `ELECTRON_APP_PATH` env var. |
| `args` | `string[]` | No | `[]` | Additional command-line arguments to pass to Electron. |

**Returns**

```json
{
  "pid": 12345,
  "debugPort": 9229,
  "connected": true,
  "stderr": ""
}
```

**Notes**

- If `appPath` is not provided and `ELECTRON_APP_PATH` is not set, the tool returns an error.
- The Electron binary is resolved from `ELECTRON_BIN` env var, or falls back to `<appPath>/node_modules/.bin/electron`.
- The server waits 2 seconds for the app to start before connecting via CDP.
- The debugging port is controlled by `ELECTRON_DEBUG_PORT` env var (default `9229`).
- CDP connection retries up to 10 times with 1-second intervals.

**Example**

```json
{
  "name": "electron_launch",
  "arguments": {
    "appPath": "/home/user/my-electron-app",
    "args": ["--no-sandbox"]
  }
}
```

---

### `electron_connect`

Connect to an already-running Electron app via Chrome DevTools Protocol.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `port` | `number` | No | `ELECTRON_DEBUG_PORT` env var or `9229` | CDP debugging port. Defaults to `ELECTRON_DEBUG_PORT` env var or 9229. |

**Returns**

```json
{
  "connected": true,
  "port": 9229
}
```

**Notes**

- The Electron app must already be running with `--remote-debugging-port` enabled.
- CDP connection retries up to 10 times with 1-second intervals.
- The connection targets the first `page`-type CDP target found.

**Example**

```json
{
  "name": "electron_connect",
  "arguments": {
    "port": 9222
  }
}
```

---

## 2. DOM Queries

### `electron_query_selector`

Find a single DOM element matching a CSS selector. Returns attributes and an HTML preview.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `selector` | `string` | **Yes** | -- | CSS selector to match. |

**Returns**

When found:

```json
{
  "found": true,
  "nodeId": 42,
  "attributes": {
    "id": "submit-btn",
    "class": "btn btn-primary",
    "type": "submit"
  },
  "outerHTMLPreview": "<button id=\"submit-btn\" class=\"btn btn-primary\" type=\"submit\">Save</button>"
}
```

When not found:

```json
{
  "found": false
}
```

**Notes**

- The `outerHTMLPreview` is truncated to 500 characters.
- Uses CDP's `DOM.querySelector` under the hood, which returns the first matching element.
- Requires an active CDP connection; call `electron_connect` or `electron_launch` first.

**Example**

```json
{
  "name": "electron_query_selector",
  "arguments": {
    "selector": "#main-content .title"
  }
}
```

---

### `electron_query_selector_all`

Find all DOM elements matching a CSS selector. Returns up to 50 elements with HTML previews.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `selector` | `string` | **Yes** | -- | CSS selector to match. |

**Returns**

```json
{
  "count": 3,
  "returned": 3,
  "elements": [
    {
      "nodeId": 10,
      "outerHTMLPreview": "<li class=\"item\">Item 1</li>"
    },
    {
      "nodeId": 11,
      "outerHTMLPreview": "<li class=\"item\">Item 2</li>"
    },
    {
      "nodeId": 12,
      "outerHTMLPreview": "<li class=\"item\">Item 3</li>"
    }
  ]
}
```

**Notes**

- Results are capped at 50 elements. `count` reflects the total number of matches; `returned` reflects how many are included in the response.
- Each `outerHTMLPreview` is truncated to 500 characters.

**Example**

```json
{
  "name": "electron_query_selector_all",
  "arguments": {
    "selector": "ul.todo-list > li"
  }
}
```

---

### `electron_find_by_text`

Find DOM elements containing specific text content using XPath. Returns up to 50 matches.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `text` | `string` | **Yes** | -- | Text content to search for (partial match). |
| `tag` | `string` | No | `"*"` | HTML tag to restrict search to (e.g. `"button"`, `"span"`). Defaults to `"*"` (any tag). |

**Returns**

```json
{
  "count": 2,
  "elements": [
    {
      "tag": "button",
      "textPreview": "Save Changes",
      "id": "save-btn",
      "className": "btn primary",
      "boundingBox": {
        "x": 200,
        "y": 400,
        "width": 120,
        "height": 40
      }
    },
    {
      "tag": "span",
      "textPreview": "Saved successfully",
      "id": null,
      "className": "status-text",
      "boundingBox": {
        "x": 200,
        "y": 450,
        "width": 150,
        "height": 20
      }
    }
  ]
}
```

**Notes**

- Uses XPath `contains(text(), ...)` for partial matching.
- The `tag` parameter is sanitized to only allow alphanumeric characters and `*`.
- `textPreview` is truncated to 200 characters.
- Includes bounding box coordinates for each match, useful for follow-up clicks.

**Example**

```json
{
  "name": "electron_find_by_text",
  "arguments": {
    "text": "Submit",
    "tag": "button"
  }
}
```

---

### `electron_find_by_role`

Find DOM elements by ARIA role (explicit or implicit). Returns up to 50 matches.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `role` | `string` | **Yes** | -- | ARIA role to search for (e.g. `"button"`, `"link"`, `"textbox"`, `"heading"`). |

**Returns**

```json
{
  "count": 4,
  "elements": [
    {
      "role": "button",
      "text": "Save",
      "id": "save-btn",
      "className": "btn primary",
      "boundingBox": {
        "x": 100,
        "y": 300,
        "width": 80,
        "height": 36
      }
    }
  ]
}
```

**Notes**

- Matches both explicit `role` attributes and implicit roles from HTML semantics. The implicit role mapping covers:
  - `button` -- `<button>`, `<input type="button">`, `<input type="submit">`, `<input type="reset">`, `<summary>`
  - `link` -- `<a href>`, `<area href>`
  - `textbox` -- `<input>` (text-like types), `<textarea>`
  - `checkbox` -- `<input type="checkbox">`
  - `radio` -- `<input type="radio">`
  - `combobox` -- `<select>`
  - `img` -- `<img alt>`
  - `heading` -- `<h1>` through `<h6>`
  - `list` -- `<ul>`, `<ol>`
  - `listitem` -- `<li>`
  - `navigation` -- `<nav>`
  - `main` -- `<main>`
  - `banner` -- `<header>`
  - `contentinfo` -- `<footer>`
  - `complementary` -- `<aside>`
  - `form` -- `<form>`
  - `table` -- `<table>`
  - `row` -- `<tr>`
  - `cell` -- `<td>`
  - `columnheader` -- `<th>`
- The `text` field uses `aria-label` if set, otherwise falls back to `textContent`.
- `text` is truncated to 200 characters.

**Example**

```json
{
  "name": "electron_find_by_role",
  "arguments": {
    "role": "heading"
  }
}
```

---

### `electron_get_accessibility_tree`

Get a structured accessibility tree of the current page, including roles, names, and interactive states.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `maxDepth` | `number` | No | `10` | Maximum depth to traverse the DOM tree. Defaults to 10. |

**Returns**

```json
{
  "tag": "body",
  "children": [
    {
      "tag": "nav",
      "role": "navigation",
      "children": [
        {
          "tag": "a",
          "role": "link",
          "name": "Home",
          "href": "/home"
        },
        {
          "tag": "a",
          "role": "link",
          "name": "Settings",
          "href": "/settings"
        }
      ]
    },
    {
      "tag": "main",
      "role": "main",
      "children": [
        {
          "tag": "h1",
          "role": "heading",
          "name": "Dashboard"
        },
        {
          "tag": "input",
          "role": "textbox",
          "type": "text",
          "id": "search",
          "value": "",
          "name": "Search..."
        }
      ]
    }
  ]
}
```

**Notes**

- Hidden elements (`display: none` or `visibility: hidden`) are excluded.
- The accessible name is resolved in priority order: `aria-label` > `alt` > `title` > `placeholder` > associated `<label>` > direct text node content.
- Interactive state properties included when present: `value`, `type`, `href`, `disabled`, `checked`, `ariaExpanded`, `ariaSelected`, `ariaDisabled`.
- `data-testid` attributes are surfaced as `dataTestId`.
- Class names are limited to the first 5 classes.
- Direct text content (`name`) is truncated to 200 characters.
- Traversal starts at `document.body`.

**Example**

```json
{
  "name": "electron_get_accessibility_tree",
  "arguments": {
    "maxDepth": 5
  }
}
```

---

## 3. Interactions

### `electron_click`

Click on an element by CSS selector or at specific x/y coordinates.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `selector` | `string` | No | -- | CSS selector of the element to click. |
| `x` | `number` | No | -- | X coordinate to click at (used if no selector). |
| `y` | `number` | No | -- | Y coordinate to click at (used if no selector). |

**Returns**

```json
{
  "clicked": true,
  "x": 160,
  "y": 320
}
```

**Notes**

- You must provide either `selector` or both `x` and `y`. Providing neither returns an error.
- When `selector` is used, the click is dispatched at the center of the element's bounding box.
- The click is simulated as a `mousePressed` followed by `mouseReleased` event (left button, single click).

**Example**

Using a selector:

```json
{
  "name": "electron_click",
  "arguments": {
    "selector": "#submit-btn"
  }
}
```

Using coordinates:

```json
{
  "name": "electron_click",
  "arguments": {
    "x": 250,
    "y": 400
  }
}
```

---

### `electron_type_text`

Type text into the focused element or a specific element (clicks it first if selector provided).

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `text` | `string` | **Yes** | -- | Text string to type. |
| `selector` | `string` | No | -- | CSS selector of the element to type into. Will be clicked to focus first. |

**Returns**

```json
{
  "typed": true,
  "length": 11
}
```

**Notes**

- If `selector` is provided, the element is clicked at its center to receive focus before typing.
- Each character is dispatched individually as a `keyDown`/`keyUp` pair.
- This tool types literal text characters. For special keys (Enter, Tab, etc.), use `electron_press_key` instead.
- Does not clear existing input content. To replace text, first select all with `electron_press_key` or use `electron_click` to focus, then type.

**Example**

```json
{
  "name": "electron_type_text",
  "arguments": {
    "text": "hello world",
    "selector": "#search-input"
  }
}
```

---

### `electron_press_key`

Press a special key (Enter, Tab, Escape, arrow keys, etc.).

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `key` | `string` | **Yes** | -- | Key name: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `Space`. |

**Returns**

```json
{
  "pressed": "Enter"
}
```

**Notes**

- Only the listed keys are supported. Providing an unsupported key name returns an error with the list of valid keys.
- The key is dispatched as a `keyDown` followed by `keyUp` event with the correct `keyCode`, `code`, and `key` values.
- The key press is sent to whatever element currently has focus.

**Example**

```json
{
  "name": "electron_press_key",
  "arguments": {
    "key": "Tab"
  }
}
```

---

### `electron_select_option`

Select an option in a `<select>` element by value or visible text.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `selector` | `string` | **Yes** | -- | CSS selector of the `<select>` element. |
| `value` | `string` | **Yes** | -- | Option value or visible text to select. |

**Returns**

```json
{
  "success": true,
  "selected": "dark"
}
```

**Notes**

- The tool matches against both `option.value` and `option.textContent.trim()`.
- After selecting, it dispatches `change` and `input` events with `{ bubbles: true }` so that framework bindings (React, Vue, etc.) detect the change.
- Returns an error if the element is not a `<select>` or if the option is not found.

**Example**

```json
{
  "name": "electron_select_option",
  "arguments": {
    "selector": "#theme-select",
    "value": "dark"
  }
}
```

---

## 4. Reading State

### `electron_get_text`

Get the `innerText` of a DOM element by CSS selector.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `selector` | `string` | **Yes** | -- | CSS selector of the element. |

**Returns**

```json
{
  "text": "Welcome to the application"
}
```

**Notes**

- Uses `innerText`, which returns the rendered text content (respects CSS visibility and layout).
- Returns an error if the element is not found.

**Example**

```json
{
  "name": "electron_get_text",
  "arguments": {
    "selector": "h1.page-title"
  }
}
```

---

### `electron_get_value`

Get the `value` property of an input, textarea, or select element.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `selector` | `string` | **Yes** | -- | CSS selector of the form element. |

**Returns**

```json
{
  "value": "user@example.com"
}
```

**Notes**

- Reads the `value` property, which reflects the current form control state (not the HTML attribute).
- Works on `<input>`, `<textarea>`, and `<select>` elements.
- Returns an error if the element is not found.

**Example**

```json
{
  "name": "electron_get_value",
  "arguments": {
    "selector": "input[name='email']"
  }
}
```

---

### `electron_get_attribute`

Get a specific attribute value from a DOM element.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `selector` | `string` | **Yes** | -- | CSS selector of the element. |
| `attribute` | `string` | **Yes** | -- | Attribute name to read (e.g. `"href"`, `"src"`, `"data-id"`). |

**Returns**

```json
{
  "attribute": "href",
  "value": "https://example.com/page"
}
```

**Notes**

- Uses `getAttribute()`, so it returns the HTML attribute value (not the DOM property).
- Returns `null` for `value` if the attribute does not exist on the element.
- Returns an error if the element is not found.

**Example**

```json
{
  "name": "electron_get_attribute",
  "arguments": {
    "selector": "a.nav-link",
    "attribute": "href"
  }
}
```

---

### `electron_get_bounding_box`

Get the position and dimensions of a DOM element (x, y, width, height).

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `selector` | `string` | **Yes** | -- | CSS selector of the element. |

**Returns**

```json
{
  "x": 100,
  "y": 200,
  "width": 300,
  "height": 50
}
```

**Notes**

- Uses `getBoundingClientRect()`, so coordinates are relative to the viewport.
- Returns an error if the element is not found.
- The returned coordinates can be used directly with `electron_click` for coordinate-based clicking.

**Example**

```json
{
  "name": "electron_get_bounding_box",
  "arguments": {
    "selector": ".modal-dialog"
  }
}
```

---

### `electron_get_url`

Get the current page URL of the Electron app.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| *(none)* | -- | -- | -- | This tool takes no parameters. |

**Returns**

```json
{
  "url": "file:///home/user/my-app/index.html"
}
```

**Notes**

- Evaluates `window.location.href` in the renderer process.
- Useful for verifying navigation or checking the current route.

**Example**

```json
{
  "name": "electron_get_url",
  "arguments": {}
}
```

---

## 5. Navigation & Viewport

### `electron_wait_for_selector`

Wait for a DOM element matching a CSS selector to appear, polling until found or timeout.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `selector` | `string` | **Yes** | -- | CSS selector to wait for. |
| `timeout` | `number` | No | `5000` | Maximum time to wait in milliseconds. Defaults to 5000. |

**Returns**

```json
{
  "found": true,
  "selector": ".results-panel",
  "elapsed": 750
}
```

**Notes**

- Polls every 250 milliseconds until the element is found or the timeout is reached.
- Returns an error on timeout with a suggestion to increase the timeout or verify the selector.
- Use this after navigation or actions that trigger asynchronous DOM updates.

**Example**

```json
{
  "name": "electron_wait_for_selector",
  "arguments": {
    "selector": ".loading-complete",
    "timeout": 10000
  }
}
```

---

### `electron_set_viewport`

Set the viewport dimensions of the Electron window for responsive testing.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `width` | `number` | **Yes** | -- | Viewport width in pixels. |
| `height` | `number` | **Yes** | -- | Viewport height in pixels. |

**Returns**

```json
{
  "width": 375,
  "height": 812
}
```

**Notes**

- Uses CDP's `Emulation.setDeviceMetricsOverride` with `deviceScaleFactor: 1` and `mobile: false`.
- Useful for testing responsive layouts at specific breakpoints (e.g. 375x812 for mobile, 1024x768 for tablet).

**Example**

```json
{
  "name": "electron_set_viewport",
  "arguments": {
    "width": 1024,
    "height": 768
  }
}
```

---

### `electron_scroll`

Scroll the page or a specific element in a given direction.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `direction` | `string` | No | `"down"` | Scroll direction: `"up"`, `"down"`, `"left"`, or `"right"`. Defaults to `"down"`. |
| `amount` | `number` | No | `500` | Number of pixels to scroll. Defaults to 500. |
| `selector` | `string` | No | -- | CSS selector of a scrollable element. If omitted, scrolls the page window. |

**Returns**

When scrolling the page:

```json
{
  "success": true,
  "scrollX": 0,
  "scrollY": 500
}
```

When scrolling a specific element:

```json
{
  "success": true,
  "scrollTop": 500,
  "scrollLeft": 0
}
```

**Notes**

- Uses `window.scrollBy()` for page-level scrolling and `element.scrollBy()` for element-level scrolling.
- Returns an error if an invalid direction is provided or if the target element is not found.
- The returned `scrollX`/`scrollY` (page) or `scrollTop`/`scrollLeft` (element) reflect the position after scrolling.

**Example**

Scroll a panel down:

```json
{
  "name": "electron_scroll",
  "arguments": {
    "selector": ".chat-messages",
    "direction": "down",
    "amount": 300
  }
}
```

Scroll the page up:

```json
{
  "name": "electron_scroll",
  "arguments": {
    "direction": "up",
    "amount": 200
  }
}
```

---

## 6. Screenshots & Visual

### `electron_screenshot`

Take a screenshot of the entire page or a specific element. Saves to disk and returns the file path.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `selector` | `string` | No | -- | CSS selector of an element to screenshot. If omitted, captures the full page. |
| `fullPage` | `boolean` | No | `true` | Capture the full scrollable page (not just the viewport). Defaults to true. |

**Returns**

```json
{
  "path": "/home/user/my-app/.screenshots/screenshot-1700000000000-1.png",
  "filename": "screenshot-1700000000000-1.png",
  "base64Length": 45678,
  "selector": null
}
```

**Notes**

- Screenshots are saved as PNG files to the directory specified by `SCREENSHOT_DIR` env var (defaults to `.screenshots/` in the current working directory).
- The directory is created automatically if it does not exist.
- When `selector` is provided, only the element's bounding box area is captured (the `fullPage` parameter is ignored).
- When no `selector` is given and `fullPage` is `true`, `captureBeyondViewport` is enabled to capture content outside the visible viewport.
- Filenames include a timestamp and an incrementing counter for uniqueness.

**Example**

Full-page screenshot:

```json
{
  "name": "electron_screenshot",
  "arguments": {}
}
```

Element screenshot:

```json
{
  "name": "electron_screenshot",
  "arguments": {
    "selector": "#dashboard-chart"
  }
}
```

---

### `electron_compare_screenshots`

Compare two screenshot files byte-by-byte and report whether they are identical or how much they differ.

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `pathA` | `string` | **Yes** | -- | Absolute path to the first screenshot file. |
| `pathB` | `string` | **Yes** | -- | Absolute path to the second screenshot file. |

**Returns**

When identical:

```json
{
  "identical": true,
  "diffPercent": 0,
  "totalBytes": 45678,
  "diffBytes": 0
}
```

When different:

```json
{
  "identical": false,
  "diffPercent": 12.34,
  "totalBytes": 45678,
  "diffBytes": 5636
}
```

**Notes**

- This is a raw byte-by-byte comparison of the PNG file data, not a perceptual/pixel comparison.
- `diffPercent` is calculated as `(diffBytes / totalBytes) * 100`, rounded to 2 decimal places.
- `totalBytes` is the size of the larger file.
- Does not require an active CDP connection -- it operates on local files only.
- Use with `electron_screenshot` to take before/after snapshots for visual regression testing.

**Example**

```json
{
  "name": "electron_compare_screenshots",
  "arguments": {
    "pathA": "/home/user/my-app/.screenshots/screenshot-before.png",
    "pathB": "/home/user/my-app/.screenshots/screenshot-after.png"
  }
}
```

---

### `electron_highlight_element`

Temporarily highlight a DOM element with a red outline for visual identification (lasts 3 seconds).

**Parameters**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `selector` | `string` | **Yes** | -- | CSS selector of the element to highlight. |

**Returns**

```json
{
  "success": true,
  "selector": "#target-element"
}
```

**Notes**

- Applies `outline: 3px solid red` to the matched element.
- The highlight automatically reverts after 3 seconds by restoring the element's previous `outline` style.
- Returns an error if the element is not found.
- Useful for debugging: highlight an element, then take a screenshot to visually confirm you have the right target.

**Example**

```json
{
  "name": "electron_highlight_element",
  "arguments": {
    "selector": ".sidebar .active-item"
  }
}
```

---

## Quick Reference

| # | Tool | Category | Required Params |
|---|------|----------|-----------------|
| 1 | `electron_launch` | Connection & Lifecycle | -- |
| 2 | `electron_connect` | Connection & Lifecycle | -- |
| 3 | `electron_query_selector` | DOM Queries | `selector` |
| 4 | `electron_query_selector_all` | DOM Queries | `selector` |
| 5 | `electron_find_by_text` | DOM Queries | `text` |
| 6 | `electron_find_by_role` | DOM Queries | `role` |
| 7 | `electron_get_accessibility_tree` | DOM Queries | -- |
| 8 | `electron_click` | Interactions | `selector` or `x`+`y` |
| 9 | `electron_type_text` | Interactions | `text` |
| 10 | `electron_press_key` | Interactions | `key` |
| 11 | `electron_select_option` | Interactions | `selector`, `value` |
| 12 | `electron_get_text` | Reading State | `selector` |
| 13 | `electron_get_value` | Reading State | `selector` |
| 14 | `electron_get_attribute` | Reading State | `selector`, `attribute` |
| 15 | `electron_get_bounding_box` | Reading State | `selector` |
| 16 | `electron_get_url` | Reading State | -- |
| 17 | `electron_wait_for_selector` | Navigation & Viewport | `selector` |
| 18 | `electron_set_viewport` | Navigation & Viewport | `width`, `height` |
| 19 | `electron_scroll` | Navigation & Viewport | -- |
| 20 | `electron_screenshot` | Screenshots & Visual | -- |
| 21 | `electron_compare_screenshots` | Screenshots & Visual | `pathA`, `pathB` |
| 22 | `electron_highlight_element` | Screenshots & Visual | `selector` |
