# Electron Dev Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Status:** Implemented

**Goal:** Build a portable MCP server toolkit that lets Claude Code drive any Electron app via CDP — 25 tools for DOM inspection, interaction, screenshots, plus a preload script, screenshot diff CLI, SKILL.md with playbooks, and reference/example docs.

**Architecture:** Single-file MCP server (`mcp-server.js`) connects to Electron apps via `chrome-remote-interface` over CDP WebSocket. Uses `@modelcontextprotocol/sdk` with stdio transport. Optional preload script enhances DOM access via `contextBridge`. Screenshots saved to disk with paths returned to Claude.

**Tech Stack:** Node.js ES modules, `@modelcontextprotocol/sdk`, `chrome-remote-interface`, CDP WebSocket, CommonJS preload for Electron

---

### Task 1: Project Scaffolding

**Files:**
- Create: `scripts/package.json`
- Create: `references/` (empty dir)
- Create: `examples/` (empty dir)

**Step 1: Create package.json**

```json
{
  "name": "electron-dev-bridge",
  "version": "1.0.0",
  "description": "MCP server for driving Electron apps via Chrome DevTools Protocol",
  "type": "module",
  "main": "mcp-server.js",
  "bin": {
    "screenshot-diff": "./screenshot-diff.js"
  },
  "scripts": {
    "start": "node mcp-server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "chrome-remote-interface": "^0.33.2"
  }
}
```

**Step 2: Install dependencies**

Run: `cd scripts && npm install`
Expected: `node_modules/` created, `package-lock.json` generated, no errors

**Step 3: Create directory structure**

Run: `mkdir -p references examples`
Expected: Both directories exist

**Step 4: Commit**

```bash
git add scripts/package.json scripts/package-lock.json
git commit -m "chore: scaffold project with package.json and deps"
```

---

### Task 2: MCP Server — Imports, State, Helpers & Server Startup

**Files:**
- Create: `scripts/mcp-server.js`

This task creates the server skeleton with all shared infrastructure. No tools yet.

**Step 1: Create the server file with imports and config**

The top of `mcp-server.js`:

```js
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import CDP from 'chrome-remote-interface';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ─── Configuration ───────────────────────────────────────────────
const DEFAULT_PORT = parseInt(process.env.ELECTRON_DEBUG_PORT || '9229', 10);
const DEFAULT_APP_PATH = process.env.ELECTRON_APP_PATH || '';
const ELECTRON_BIN = process.env.ELECTRON_BIN || '';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || join(process.cwd(), '.screenshots');
```

**Step 2: Add state management and helper functions**

Below the config section:

```js
// ─── State ───────────────────────────────────────────────────────
let cdpClient = null;
let electronProcess = null;
let screenshotCounter = 0;

// ─── Helpers ─────────────────────────────────────────────────────

function ensureConnected() {
  if (!cdpClient) {
    throw new Error(
      'Not connected to an Electron app. Use electron_launch to start one or electron_connect to attach to a running app.'
    );
  }
}

async function connectToCDP(port, maxRetries = 10) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const targets = await CDP.List({ port });
      const pageTarget = targets.find((t) => t.type === 'page');
      if (!pageTarget) {
        if (attempt === maxRetries) throw new Error('No page target found after all retries.');
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      const client = await CDP({ target: pageTarget, port });
      await Promise.all([
        client.Runtime.enable(),
        client.DOM.enable(),
        client.Page.enable(),
        client.Network.enable(),
      ]);
      cdpClient = client;
      client.on('disconnect', () => {
        cdpClient = null;
      });
      return client;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function evaluateJS(expression, awaitPromise = false) {
  ensureConnected();
  const { result, exceptionDetails } = await cdpClient.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (exceptionDetails) {
    const msg = exceptionDetails.exception?.description || exceptionDetails.text || 'JS evaluation error';
    throw new Error(msg);
  }
  return result.value;
}

async function getBoundingBox(selector) {
  const box = await evaluateJS(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()
  `);
  if (!box) throw new Error(`Element not found: ${selector}`);
  return box;
}

function toolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function toolError(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}
```

**Step 3: Add server startup at the bottom**

```js
// ─── Server Setup ────────────────────────────────────────────────

const server = new Server(
  { name: 'electron-dev-bridge', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Tool list handler — will be populated in subsequent tasks
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Tool call handler — will be populated in subsequent tasks
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = TOOL_HANDLERS[name];
  if (!handler) return toolError(`Unknown tool: ${name}`);
  try {
    return await handler(args || {});
  } catch (err) {
    return toolError(err.message);
  }
});

// Placeholder arrays — filled by tool registration sections
const TOOLS = [];
const TOOL_HANDLERS = {};

function registerTool(definition, handler) {
  TOOLS.push(definition);
  TOOL_HANDLERS[definition.name] = handler;
}

// Start
const transport = new StdioServerTransport();
await server.connect(transport);

process.on('SIGINT', async () => {
  if (electronProcess) electronProcess.kill();
  await server.close();
  process.exit(0);
});
```

**Step 4: Verify server starts without errors**

Run: `node scripts/mcp-server.js &; sleep 1; kill %1 2>/dev/null`
Expected: No error output. Process starts and can be killed cleanly.

Note: The server will hang waiting for stdio input, which is correct — it's waiting for MCP messages. We just verify no crash on startup.

**Step 5: Commit**

```bash
git add scripts/mcp-server.js
git commit -m "feat: MCP server skeleton with helpers, state, and startup"
```

---

### Task 3: Connection & Lifecycle Tools

**Files:**
- Modify: `scripts/mcp-server.js` — add `electron_launch` and `electron_connect` tools

Insert these tool registrations **above** the `// Start` line (before `const transport = ...`).

**Step 1: Add electron_launch tool**

```js
// ─── Connection & Lifecycle Tools ────────────────────────────────

registerTool(
  {
    name: 'electron_launch',
    description:
      'Launch an Electron app with remote debugging enabled and connect to it via CDP. Returns the process PID and connection status.',
    inputSchema: {
      type: 'object',
      properties: {
        appPath: {
          type: 'string',
          description: 'Path to the Electron app directory (containing package.json). Defaults to ELECTRON_APP_PATH env var.',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional arguments to pass to the Electron process.',
        },
      },
    },
  },
  async ({ appPath, args = [] }) => {
    const app = appPath || DEFAULT_APP_PATH;
    if (!app) {
      throw new Error(
        'No app path provided. Pass appPath parameter or set ELECTRON_APP_PATH environment variable.'
      );
    }
    const resolvedApp = resolve(app);
    const electronBin =
      ELECTRON_BIN || join(resolvedApp, 'node_modules', '.bin', 'electron');
    const port = DEFAULT_PORT;

    const stderrChunks = [];
    const child = spawn(electronBin, [`--remote-debugging-port=${port}`, resolvedApp, ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
    });

    child.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));
    child.on('exit', () => {
      electronProcess = null;
      cdpClient = null;
    });

    electronProcess = child;

    // Wait for the app to start
    await new Promise((r) => setTimeout(r, 2000));

    if (child.exitCode !== null) {
      throw new Error(
        `Electron process exited immediately with code ${child.exitCode}. Stderr: ${stderrChunks.join('')}`
      );
    }

    await connectToCDP(port);

    return toolResult({
      pid: child.pid,
      debugPort: port,
      connected: true,
      stderr: stderrChunks.join('').slice(0, 500),
    });
  }
);
```

**Step 2: Add electron_connect tool**

```js
registerTool(
  {
    name: 'electron_connect',
    description:
      'Connect to an already-running Electron app via Chrome DevTools Protocol. The app must have been launched with --remote-debugging-port.',
    inputSchema: {
      type: 'object',
      properties: {
        port: {
          type: 'number',
          description: `CDP debugging port. Defaults to ${DEFAULT_PORT}.`,
        },
      },
    },
  },
  async ({ port }) => {
    const p = port || DEFAULT_PORT;
    await connectToCDP(p);
    return toolResult({ connected: true, port: p });
  }
);
```

**Step 3: Verify the file still starts cleanly**

Run: `node scripts/mcp-server.js &; sleep 1; kill %1 2>/dev/null`
Expected: No errors.

**Step 4: Commit**

```bash
git add scripts/mcp-server.js
git commit -m "feat: add electron_launch and electron_connect tools"
```

---

### Task 4: DOM Query Tools

**Files:**
- Modify: `scripts/mcp-server.js` — add 5 DOM query tools

Insert below the connection tools section.

**Step 1: Add electron_query_selector**

```js
// ─── DOM Query Tools ─────────────────────────────────────────────

registerTool(
  {
    name: 'electron_query_selector',
    description:
      'Find a single DOM element by CSS selector. Returns its attributes and an HTML preview.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to query.' },
      },
      required: ['selector'],
    },
  },
  async ({ selector }) => {
    ensureConnected();
    const { root } = await cdpClient.DOM.getDocument();
    const { nodeId } = await cdpClient.DOM.querySelector({
      nodeId: root.nodeId,
      selector,
    });
    if (!nodeId) return toolResult({ found: false, selector });

    const { attributes } = await cdpClient.DOM.getAttributes({ nodeId });
    const { outerHTML } = await cdpClient.DOM.getOuterHTML({ nodeId });

    // Parse attribute pairs into object
    const attrObj = {};
    for (let i = 0; i < attributes.length; i += 2) {
      attrObj[attributes[i]] = attributes[i + 1];
    }

    return toolResult({
      found: true,
      nodeId,
      attributes: attrObj,
      outerHTMLPreview: outerHTML.slice(0, 500),
    });
  }
);
```

**Step 2: Add electron_query_selector_all**

```js
registerTool(
  {
    name: 'electron_query_selector_all',
    description:
      'Find all DOM elements matching a CSS selector. Returns the first 50 matches with HTML previews.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to query.' },
      },
      required: ['selector'],
    },
  },
  async ({ selector }) => {
    ensureConnected();
    const { root } = await cdpClient.DOM.getDocument();
    const { nodeIds } = await cdpClient.DOM.querySelectorAll({
      nodeId: root.nodeId,
      selector,
    });

    const limited = nodeIds.slice(0, 50);
    const elements = [];
    for (const nodeId of limited) {
      try {
        const { outerHTML } = await cdpClient.DOM.getOuterHTML({ nodeId });
        elements.push({ nodeId, outerHTMLPreview: outerHTML.slice(0, 200) });
      } catch {
        elements.push({ nodeId, outerHTMLPreview: '[unable to read]' });
      }
    }

    return toolResult({ count: nodeIds.length, returned: limited.length, elements });
  }
);
```

**Step 3: Add electron_find_by_text**

```js
registerTool(
  {
    name: 'electron_find_by_text',
    description:
      'Find DOM elements containing specific text. Uses XPath text search.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to search for (substring match).' },
        tag: { type: 'string', description: 'HTML tag to filter by. Defaults to "*" (any).' },
      },
      required: ['text'],
    },
  },
  async ({ text, tag = '*' }) => {
    const result = await evaluateJS(`
      (() => {
        const xpath = "//${JSON.parse('"' + '${tag}' + '"')}[contains(text(), ${JSON.stringify(text)})]";
        const snapshot = document.evaluate(xpath, document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const elements = [];
        for (let i = 0; i < Math.min(snapshot.snapshotLength, 50); i++) {
          const el = snapshot.snapshotItem(i);
          const r = el.getBoundingClientRect();
          elements.push({
            tag: el.tagName.toLowerCase(),
            text: el.innerText?.slice(0, 200) || '',
            id: el.id || null,
            className: el.className || null,
            boundingBox: { x: r.x, y: r.y, width: r.width, height: r.height },
          });
        }
        return { count: snapshot.snapshotLength, elements };
      })()
    `.replace("${tag}", tag));
    return toolResult(result);
  }
);
```

Note to implementer: The `${tag}` interpolation above is tricky inside a template literal that's itself a string for `evaluateJS`. A cleaner approach: build the XPath expression outside the template and pass it in via `JSON.stringify`. Rewrite to:

```js
registerTool(
  {
    name: 'electron_find_by_text',
    description:
      'Find DOM elements containing specific text. Uses XPath text search.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to search for (substring match).' },
        tag: { type: 'string', description: 'HTML tag to filter by. Defaults to "*" (any).' },
      },
      required: ['text'],
    },
  },
  async ({ text, tag = '*' }) => {
    const safeTag = tag.replace(/[^a-zA-Z0-9*]/g, '');
    const safeText = JSON.stringify(text);
    const result = await evaluateJS(`
      (() => {
        const xpath = "//${safeTag}[contains(text(), ${safeText})]";
        const snapshot = document.evaluate(xpath, document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const elements = [];
        for (let i = 0; i < Math.min(snapshot.snapshotLength, 50); i++) {
          const el = snapshot.snapshotItem(i);
          const r = el.getBoundingClientRect();
          elements.push({
            tag: el.tagName.toLowerCase(),
            text: el.innerText?.slice(0, 200) || '',
            id: el.id || null,
            className: el.className || null,
            boundingBox: { x: r.x, y: r.y, width: r.width, height: r.height },
          });
        }
        return { count: snapshot.snapshotLength, elements };
      })()
    `);
    return toolResult(result);
  }
);
```

**Step 4: Add electron_find_by_role**

```js
registerTool(
  {
    name: 'electron_find_by_role',
    description:
      'Find DOM elements by ARIA role. Includes implicit role mapping (e.g., <button> → "button", <a> → "link").',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'ARIA role to search for (e.g., "button", "link", "textbox").' },
      },
      required: ['role'],
    },
  },
  async ({ role }) => {
    const safeRole = JSON.stringify(role);
    const result = await evaluateJS(`
      (() => {
        const IMPLICIT_ROLES = {
          button: ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]', 'summary'],
          link: ['a[href]', 'area[href]'],
          textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'input[type="tel"]', 'input[type="url"]', 'input[type="search"]', 'input[type="password"]', 'textarea'],
          checkbox: ['input[type="checkbox"]'],
          radio: ['input[type="radio"]'],
          combobox: ['select'],
          img: ['img[alt]'],
          heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
          list: ['ul', 'ol'],
          listitem: ['li'],
          navigation: ['nav'],
          main: ['main'],
          banner: ['header'],
          contentinfo: ['footer'],
          complementary: ['aside'],
          form: ['form'],
          table: ['table'],
          row: ['tr'],
          cell: ['td'],
          columnheader: ['th'],
        };

        const role = ${safeRole};
        const selectors = ['[role="' + role + '"]'];
        if (IMPLICIT_ROLES[role]) selectors.push(...IMPLICIT_ROLES[role]);

        const combined = selectors.join(', ');
        const nodes = document.querySelectorAll(combined);
        const elements = [];
        for (let i = 0; i < Math.min(nodes.length, 50); i++) {
          const el = nodes[i];
          const r = el.getBoundingClientRect();
          elements.push({
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || role + ' (implicit)',
            text: (el.getAttribute('aria-label') || el.innerText || '').slice(0, 200),
            id: el.id || null,
            className: el.className || null,
            boundingBox: { x: r.x, y: r.y, width: r.width, height: r.height },
          });
        }
        return { count: nodes.length, elements };
      })()
    `);
    return toolResult(result);
  }
);
```

**Step 5: Add electron_get_accessibility_tree**

```js
registerTool(
  {
    name: 'electron_get_accessibility_tree',
    description:
      'Get the accessibility tree of the page. Returns a nested JSON tree with roles, names, states, and ARIA attributes for all visible elements.',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: {
          type: 'number',
          description: 'Maximum depth to traverse. Defaults to 10.',
        },
      },
    },
  },
  async ({ maxDepth = 10 }) => {
    const tree = await evaluateJS(`
      (() => {
        const IMPLICIT_ROLES = {
          BUTTON: 'button', A: 'link', INPUT: 'textbox', TEXTAREA: 'textbox',
          SELECT: 'combobox', IMG: 'img', H1: 'heading', H2: 'heading',
          H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
          NAV: 'navigation', MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo',
          ASIDE: 'complementary', FORM: 'form', TABLE: 'table', UL: 'list',
          OL: 'list', LI: 'listitem', TR: 'row', TD: 'cell', TH: 'columnheader',
          SECTION: 'region', ARTICLE: 'article', DIALOG: 'dialog',
        };

        function getRole(el) {
          return el.getAttribute('role') || IMPLICIT_ROLES[el.tagName] || null;
        }

        function getName(el) {
          return el.getAttribute('aria-label')
            || el.getAttribute('alt')
            || el.getAttribute('title')
            || el.getAttribute('placeholder')
            || (el.labels?.[0]?.innerText)
            || (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
                ? el.childNodes[0].textContent.trim().slice(0, 100) : null);
        }

        function isVisible(el) {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
        }

        function walk(el, depth) {
          if (depth > ${maxDepth} || !el || !isVisible(el)) return null;

          const role = getRole(el);
          const name = getName(el);
          const tag = el.tagName.toLowerCase();

          const node = { tag };
          if (role) node.role = role;
          if (name) node.name = name;
          if (el.id) node.id = el.id;
          if (el.className && typeof el.className === 'string') node.class = el.className.split(/\\s+/).slice(0, 5).join(' ');
          if (el.dataset?.testid) node.testId = el.dataset.testid;

          // Interactive state
          if (el.value !== undefined && el.value !== '') node.value = el.value;
          if (el.type) node.type = el.type;
          if (el.href) node.href = el.href;
          if (el.disabled) node.disabled = true;
          if (el.checked) node.checked = true;
          if (el.getAttribute('aria-expanded')) node.expanded = el.getAttribute('aria-expanded');
          if (el.getAttribute('aria-selected')) node.selected = el.getAttribute('aria-selected');
          if (el.getAttribute('aria-disabled')) node.ariaDisabled = el.getAttribute('aria-disabled');

          const children = [];
          for (const child of el.children) {
            const c = walk(child, depth + 1);
            if (c) children.push(c);
          }
          if (children.length > 0) node.children = children;

          return node;
        }

        return walk(document.body, 0);
      })()
    `);
    return toolResult(tree);
  }
);
```

**Step 6: Verify the file still starts cleanly**

Run: `node scripts/mcp-server.js &; sleep 1; kill %1 2>/dev/null`
Expected: No errors.

**Step 7: Commit**

```bash
git add scripts/mcp-server.js
git commit -m "feat: add 5 DOM query tools (querySelector, querySelectorAll, findByText, findByRole, a11yTree)"
```

---

### Task 5: Interaction Tools

**Files:**
- Modify: `scripts/mcp-server.js` — add 4 interaction tools

Insert below the DOM query tools section.

**Step 1: Add electron_click**

```js
// ─── Interaction Tools ───────────────────────────────────────────

registerTool(
  {
    name: 'electron_click',
    description:
      'Click on an element by CSS selector or at specific coordinates. If selector is provided, clicks the center of the element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of element to click.' },
        x: { type: 'number', description: 'X coordinate to click at (used if no selector).' },
        y: { type: 'number', description: 'Y coordinate to click at (used if no selector).' },
      },
    },
  },
  async ({ selector, x, y }) => {
    ensureConnected();
    let clickX, clickY;

    if (selector) {
      const box = await getBoundingBox(selector);
      clickX = box.x + box.width / 2;
      clickY = box.y + box.height / 2;
    } else if (x !== undefined && y !== undefined) {
      clickX = x;
      clickY = y;
    } else {
      throw new Error('Provide either a selector or both x and y coordinates.');
    }

    await cdpClient.Input.dispatchMouseEvent({
      type: 'mousePressed',
      x: clickX,
      y: clickY,
      button: 'left',
      clickCount: 1,
    });
    await cdpClient.Input.dispatchMouseEvent({
      type: 'mouseReleased',
      x: clickX,
      y: clickY,
      button: 'left',
      clickCount: 1,
    });

    return toolResult({ clicked: true, x: clickX, y: clickY });
  }
);
```

**Step 2: Add electron_type_text**

```js
registerTool(
  {
    name: 'electron_type_text',
    description:
      'Type text into the focused element, or into a specific element by selector. If selector is provided, clicks it first for focus.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type.' },
        selector: { type: 'string', description: 'CSS selector of element to type into. Clicks to focus first.' },
      },
      required: ['text'],
    },
  },
  async ({ text, selector }) => {
    ensureConnected();

    if (selector) {
      const box = await getBoundingBox(selector);
      await cdpClient.Input.dispatchMouseEvent({
        type: 'mousePressed',
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        button: 'left',
        clickCount: 1,
      });
      await cdpClient.Input.dispatchMouseEvent({
        type: 'mouseReleased',
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        button: 'left',
        clickCount: 1,
      });
    }

    for (const char of text) {
      await cdpClient.Input.dispatchKeyEvent({
        type: 'keyDown',
        text: char,
        key: char,
        unmodifiedText: char,
      });
      await cdpClient.Input.dispatchKeyEvent({
        type: 'keyUp',
        text: char,
        key: char,
      });
    }

    return toolResult({ typed: true, length: text.length });
  }
);
```

**Step 3: Add electron_press_key**

```js
registerTool(
  {
    name: 'electron_press_key',
    description:
      'Press a keyboard key (Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, Delete, Home, End, Space, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name (e.g., "Enter", "Tab", "Escape", "ArrowDown").' },
      },
      required: ['key'],
    },
  },
  async ({ key }) => {
    ensureConnected();

    const KEY_MAP = {
      Enter: { keyCode: 13, code: 'Enter', key: 'Enter', text: '\r' },
      Tab: { keyCode: 9, code: 'Tab', key: 'Tab', text: '' },
      Escape: { keyCode: 27, code: 'Escape', key: 'Escape', text: '' },
      Backspace: { keyCode: 8, code: 'Backspace', key: 'Backspace', text: '' },
      Delete: { keyCode: 46, code: 'Delete', key: 'Delete', text: '' },
      ArrowUp: { keyCode: 38, code: 'ArrowUp', key: 'ArrowUp', text: '' },
      ArrowDown: { keyCode: 40, code: 'ArrowDown', key: 'ArrowDown', text: '' },
      ArrowLeft: { keyCode: 37, code: 'ArrowLeft', key: 'ArrowLeft', text: '' },
      ArrowRight: { keyCode: 39, code: 'ArrowRight', key: 'ArrowRight', text: '' },
      Home: { keyCode: 36, code: 'Home', key: 'Home', text: '' },
      End: { keyCode: 35, code: 'End', key: 'End', text: '' },
      Space: { keyCode: 32, code: 'Space', key: ' ', text: ' ' },
    };

    const mapped = KEY_MAP[key];
    if (!mapped) {
      throw new Error(`Unknown key: "${key}". Supported: ${Object.keys(KEY_MAP).join(', ')}`);
    }

    await cdpClient.Input.dispatchKeyEvent({
      type: 'keyDown',
      ...mapped,
      windowsVirtualKeyCode: mapped.keyCode,
      nativeVirtualKeyCode: mapped.keyCode,
    });
    await cdpClient.Input.dispatchKeyEvent({
      type: 'keyUp',
      ...mapped,
      windowsVirtualKeyCode: mapped.keyCode,
      nativeVirtualKeyCode: mapped.keyCode,
    });

    return toolResult({ pressed: key });
  }
);
```

**Step 4: Add electron_select_option**

```js
registerTool(
  {
    name: 'electron_select_option',
    description:
      'Select an option in a <select> dropdown by value or visible text.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the <select> element.' },
        value: { type: 'string', description: 'Option value or visible text to select.' },
      },
      required: ['selector', 'value'],
    },
  },
  async ({ selector, value }) => {
    const safeSelector = JSON.stringify(selector);
    const safeValue = JSON.stringify(value);
    const result = await evaluateJS(`
      (() => {
        const select = document.querySelector(${safeSelector});
        if (!select) return { success: false, error: 'Select element not found' };
        if (select.tagName !== 'SELECT') return { success: false, error: 'Element is not a <select>' };

        let found = false;
        for (const opt of select.options) {
          if (opt.value === ${safeValue} || opt.textContent.trim() === ${safeValue}) {
            select.value = opt.value;
            found = true;
            break;
          }
        }
        if (!found) return { success: false, error: 'Option not found: ' + ${safeValue} };

        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true, selected: select.value };
      })()
    `);
    if (!result.success) throw new Error(result.error);
    return toolResult(result);
  }
);
```

**Step 5: Verify and commit**

Run: `node scripts/mcp-server.js &; sleep 1; kill %1 2>/dev/null`
Expected: No errors.

```bash
git add scripts/mcp-server.js
git commit -m "feat: add 4 interaction tools (click, typeText, pressKey, selectOption)"
```

---

### Task 6: Reading State Tools

**Files:**
- Modify: `scripts/mcp-server.js` — add 5 state reading tools

Insert below the interaction tools section.

**Step 1: Add all 5 state reading tools**

```js
// ─── Reading State Tools ─────────────────────────────────────────

registerTool(
  {
    name: 'electron_get_text',
    description: 'Get the inner text content of an element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element.' },
      },
      required: ['selector'],
    },
  },
  async ({ selector }) => {
    const text = await evaluateJS(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        return el.innerText;
      })()
    `);
    return toolResult({ text });
  }
);

registerTool(
  {
    name: 'electron_get_value',
    description: 'Get the value of an input, textarea, or select element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input element.' },
      },
      required: ['selector'],
    },
  },
  async ({ selector }) => {
    const value = await evaluateJS(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        return el.value;
      })()
    `);
    return toolResult({ value });
  }
);

registerTool(
  {
    name: 'electron_get_attribute',
    description: 'Get a specific attribute value from an element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element.' },
        attribute: { type: 'string', description: 'Attribute name to retrieve.' },
      },
      required: ['selector', 'attribute'],
    },
  },
  async ({ selector, attribute }) => {
    const value = await evaluateJS(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        return el.getAttribute(${JSON.stringify(attribute)});
      })()
    `);
    return toolResult({ attribute, value });
  }
);

registerTool(
  {
    name: 'electron_get_bounding_box',
    description: 'Get the position and dimensions of an element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element.' },
      },
      required: ['selector'],
    },
  },
  async ({ selector }) => {
    const box = await getBoundingBox(selector);
    return toolResult(box);
  }
);

registerTool(
  {
    name: 'electron_get_url',
    description: 'Get the current page URL.',
    inputSchema: { type: 'object', properties: {} },
  },
  async () => {
    const url = await evaluateJS('window.location.href');
    return toolResult({ url });
  }
);
```

**Step 2: Verify and commit**

Run: `node scripts/mcp-server.js &; sleep 1; kill %1 2>/dev/null`
Expected: No errors.

```bash
git add scripts/mcp-server.js
git commit -m "feat: add 5 state reading tools (getText, getValue, getAttribute, getBoundingBox, getUrl)"
```

---

### Task 7: Navigation & Viewport Tools

**Files:**
- Modify: `scripts/mcp-server.js` — add 3 navigation/viewport tools

Insert below the state reading tools section.

**Step 1: Add electron_wait_for_selector**

```js
// ─── Navigation & Viewport Tools ─────────────────────────────────

registerTool(
  {
    name: 'electron_wait_for_selector',
    description:
      'Wait for an element matching the CSS selector to appear in the DOM. Polls every 250ms until found or timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for.' },
        timeout: { type: 'number', description: 'Maximum wait time in milliseconds. Defaults to 5000.' },
      },
      required: ['selector'],
    },
  },
  async ({ selector, timeout = 5000 }) => {
    ensureConnected();
    const start = Date.now();
    const safeSelector = JSON.stringify(selector);

    while (Date.now() - start < timeout) {
      const found = await evaluateJS(`!!document.querySelector(${safeSelector})`);
      if (found) {
        return toolResult({ found: true, selector, elapsed: Date.now() - start });
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Timeout after ${timeout}ms waiting for selector: ${selector}`);
  }
);
```

**Step 2: Add electron_set_viewport**

```js
registerTool(
  {
    name: 'electron_set_viewport',
    description: 'Set the viewport dimensions for the page.',
    inputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number', description: 'Viewport width in pixels.' },
        height: { type: 'number', description: 'Viewport height in pixels.' },
      },
      required: ['width', 'height'],
    },
  },
  async ({ width, height }) => {
    ensureConnected();
    await cdpClient.Emulation.setDeviceMetricsOverride({
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return toolResult({ width, height });
  }
);
```

**Step 3: Add electron_scroll**

```js
registerTool(
  {
    name: 'electron_scroll',
    description:
      'Scroll the page or a specific element. Direction can be "up", "down", "left", or "right".',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', description: 'Scroll direction: "up", "down", "left", "right". Defaults to "down".' },
        amount: { type: 'number', description: 'Scroll amount in pixels. Defaults to 500.' },
        selector: { type: 'string', description: 'CSS selector of element to scroll. If omitted, scrolls the window.' },
      },
    },
  },
  async ({ direction = 'down', amount = 500, selector }) => {
    const dx = direction === 'right' ? amount : direction === 'left' ? -amount : 0;
    const dy = direction === 'down' ? amount : direction === 'up' ? -amount : 0;

    if (selector) {
      const result = await evaluateJS(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Element not found: ${selector}');
          el.scrollBy(${dx}, ${dy});
          return { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft };
        })()
      `);
      return toolResult({ success: true, ...result });
    } else {
      const result = await evaluateJS(`
        (() => {
          window.scrollBy(${dx}, ${dy});
          return { scrollX: window.scrollX, scrollY: window.scrollY };
        })()
      `);
      return toolResult({ success: true, ...result });
    }
  }
);
```

**Step 4: Verify and commit**

Run: `node scripts/mcp-server.js &; sleep 1; kill %1 2>/dev/null`
Expected: No errors.

```bash
git add scripts/mcp-server.js
git commit -m "feat: add 3 navigation tools (waitForSelector, setViewport, scroll)"
```

---

### Task 8: Screenshot & Visual Tools

**Files:**
- Modify: `scripts/mcp-server.js` — add 3 screenshot/visual tools

Insert below the navigation tools section.

**Step 1: Add electron_screenshot**

```js
// ─── Screenshot & Visual Tools ───────────────────────────────────

registerTool(
  {
    name: 'electron_screenshot',
    description:
      'Capture a screenshot of the page or a specific element. Saves to disk and returns the file path.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of element to screenshot. If omitted, captures full page.' },
        fullPage: { type: 'boolean', description: 'Capture full page including scrollable area. Defaults to true.' },
      },
    },
  },
  async ({ selector, fullPage = true }) => {
    ensureConnected();

    const captureParams = { format: 'png' };

    if (selector) {
      const box = await getBoundingBox(selector);
      captureParams.clip = {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        scale: 1,
      };
    } else if (fullPage) {
      captureParams.captureBeyondViewport = true;
    }

    const { data } = await cdpClient.Page.captureScreenshot(captureParams);

    // Ensure screenshot directory exists
    if (!existsSync(SCREENSHOT_DIR)) {
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    const timestamp = Date.now();
    screenshotCounter++;
    const filename = `screenshot-${timestamp}-${screenshotCounter}.png`;
    const filepath = join(SCREENSHOT_DIR, filename);

    writeFileSync(filepath, Buffer.from(data, 'base64'));

    return toolResult({
      path: filepath,
      filename,
      base64Length: data.length,
      selector: selector || null,
    });
  }
);
```

**Step 2: Add electron_compare_screenshots**

```js
registerTool(
  {
    name: 'electron_compare_screenshots',
    description:
      'Compare two screenshot files byte-by-byte. Returns whether they are identical and a rough diff percentage. For pixel-level diffing, use the screenshot-diff.js CLI with pixelmatch installed.',
    inputSchema: {
      type: 'object',
      properties: {
        pathA: { type: 'string', description: 'Path to the first screenshot (baseline).' },
        pathB: { type: 'string', description: 'Path to the second screenshot (current).' },
      },
      required: ['pathA', 'pathB'],
    },
  },
  async ({ pathA, pathB }) => {
    const bufA = readFileSync(pathA);
    const bufB = readFileSync(pathB);

    const identical = bufA.equals(bufB);
    const maxLen = Math.max(bufA.length, bufB.length);
    let diffBytes = Math.abs(bufA.length - bufB.length);

    if (!identical) {
      const minLen = Math.min(bufA.length, bufB.length);
      for (let i = 0; i < minLen; i++) {
        if (bufA[i] !== bufB[i]) diffBytes++;
      }
    }

    return toolResult({
      identical,
      diffPercent: maxLen > 0 ? ((diffBytes / maxLen) * 100).toFixed(2) : '0.00',
      totalBytes: maxLen,
      diffBytes,
    });
  }
);
```

**Step 3: Add electron_highlight_element**

```js
registerTool(
  {
    name: 'electron_highlight_element',
    description:
      'Temporarily highlight a DOM element with a red outline for debugging. The highlight lasts 3 seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to highlight.' },
      },
      required: ['selector'],
    },
  },
  async ({ selector }) => {
    await evaluateJS(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        const prev = el.style.outline;
        el.style.outline = '3px solid red';
        setTimeout(() => { el.style.outline = prev; }, 3000);
        return true;
      })()
    `);
    return toolResult({ success: true, selector });
  }
);
```

**Step 4: Verify and commit**

Run: `node scripts/mcp-server.js &; sleep 1; kill %1 2>/dev/null`
Expected: No errors.

```bash
git add scripts/mcp-server.js
git commit -m "feat: add 3 screenshot tools (screenshot, compareScreenshots, highlightElement)"
```

---

### Task 9: Fix Tool Registration Order

**Files:**
- Modify: `scripts/mcp-server.js` — ensure `registerTool` function is defined before tool registrations

The `registerTool` helper, `TOOLS` array, and `TOOL_HANDLERS` object must be defined **before** any `registerTool()` calls. Currently in the skeleton (Task 2), they're at the bottom near `// Start`.

**Step 1: Move declarations above tool registrations**

Move these lines from near the bottom to right after the helpers section (after `function toolError`):

```js
const TOOLS = [];
const TOOL_HANDLERS = {};

function registerTool(definition, handler) {
  TOOLS.push(definition);
  TOOL_HANDLERS[definition.name] = handler;
}
```

Then the server setup section becomes:

```js
// ─── Server Setup ────────────────────────────────────────────────

const server = new Server(
  { name: 'electron-dev-bridge', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = TOOL_HANDLERS[name];
  if (!handler) return toolError(`Unknown tool: ${name}`);
  try {
    return await handler(args || {});
  } catch (err) {
    return toolError(err.message);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on('SIGINT', async () => {
  if (electronProcess) electronProcess.kill();
  await server.close();
  process.exit(0);
});
```

**Step 2: Verify and commit**

Run: `node scripts/mcp-server.js &; sleep 1; kill %1 2>/dev/null`
Expected: No errors. All 25 tools registered.

```bash
git add scripts/mcp-server.js
git commit -m "fix: ensure registerTool is defined before tool registrations"
```

---

### Task 10: Preload Script

**Files:**
- Create: `scripts/preload.js`

**Step 1: Write the preload script**

This is CommonJS (Electron requires it for preload scripts).

```js
// preload.js — Optional preload for enhanced DOM access
// Usage: new BrowserWindow({ webPreferences: { preload: '/path/to/preload.js', contextIsolation: true } })
'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__electronDevBridge', {
  getAccessibilityTree(maxDepth = 10) {
    const IMPLICIT_ROLES = {
      BUTTON: 'button', A: 'link', INPUT: 'textbox', TEXTAREA: 'textbox',
      SELECT: 'combobox', IMG: 'img', H1: 'heading', H2: 'heading',
      H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
      NAV: 'navigation', MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo',
      ASIDE: 'complementary', FORM: 'form', TABLE: 'table', UL: 'list',
      OL: 'list', LI: 'listitem', TR: 'row', TD: 'cell', TH: 'columnheader',
      SECTION: 'region', ARTICLE: 'article', DIALOG: 'dialog',
    };

    function getRole(el) {
      return el.getAttribute('role') || IMPLICIT_ROLES[el.tagName] || null;
    }

    function getName(el) {
      return el.getAttribute('aria-label')
        || el.getAttribute('alt')
        || el.getAttribute('title')
        || el.getAttribute('placeholder')
        || (el.labels && el.labels[0] ? el.labels[0].innerText : null)
        || (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
            ? el.childNodes[0].textContent.trim().slice(0, 100) : null);
    }

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
    }

    function walk(el, depth) {
      if (depth > maxDepth || !el || !isVisible(el)) return null;

      const role = getRole(el);
      const name = getName(el);
      const tag = el.tagName.toLowerCase();
      const r = el.getBoundingClientRect();

      const node = { tag };
      if (role) node.role = role;
      if (name) node.name = name;
      if (el.id) node.id = el.id;
      if (el.className && typeof el.className === 'string') {
        node.class = el.className.split(/\s+/).slice(0, 5).join(' ');
      }
      if (el.dataset && el.dataset.testid) node.testId = el.dataset.testid;

      // Interactive elements get bounding boxes
      if (role === 'button' || role === 'link' || role === 'textbox' ||
          role === 'checkbox' || role === 'combobox' || role === 'radio') {
        node.boundingBox = { x: r.x, y: r.y, width: r.width, height: r.height };
      }

      // State
      if (el.value !== undefined && el.value !== '') node.value = el.value;
      if (el.type) node.type = el.type;
      if (el.href) node.href = el.href;
      if (el.disabled) node.disabled = true;
      if (el.checked) node.checked = true;
      if (el.getAttribute('aria-expanded')) node.expanded = el.getAttribute('aria-expanded');
      if (el.getAttribute('aria-selected')) node.selected = el.getAttribute('aria-selected');
      if (el.getAttribute('aria-disabled')) node.ariaDisabled = el.getAttribute('aria-disabled');

      const children = [];
      for (const child of el.children) {
        const c = walk(child, depth + 1);
        if (c) children.push(c);
      }
      if (children.length > 0) node.children = children;
      return node;
    }

    return walk(document.body, 0);
  },

  findByText(text, { tag = '*', exact = false, maxResults = 50 } = {}) {
    const safeTag = tag.replace(/[^a-zA-Z0-9*]/g, '');
    const xpath = exact
      ? `//${safeTag}[text()="${text}"]`
      : `//${safeTag}[contains(text(), "${text}")]`;
    const snapshot = document.evaluate(
      xpath, document.body, null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
    );
    const elements = [];
    for (let i = 0; i < Math.min(snapshot.snapshotLength, maxResults); i++) {
      const el = snapshot.snapshotItem(i);
      const r = el.getBoundingClientRect();
      elements.push({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || '').slice(0, 200),
        id: el.id || null,
        className: el.className || null,
        boundingBox: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
    }
    return { count: snapshot.snapshotLength, elements };
  },

  getComputedStyles(selector, properties) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const style = window.getComputedStyle(el);
    const defaultProps = [
      'display', 'position', 'width', 'height', 'margin', 'padding',
      'color', 'backgroundColor', 'fontSize', 'fontWeight', 'opacity',
      'visibility', 'overflow', 'zIndex', 'flexDirection', 'justifyContent',
      'alignItems', 'gridTemplateColumns',
    ];
    const props = properties && properties.length > 0 ? properties : defaultProps;
    const result = {};
    for (const prop of props) {
      result[prop] = style.getPropertyValue(prop) || style[prop] || '';
    }
    return result;
  },

  scrollIntoView(selector) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  },

  getFormSummary() {
    const forms = document.querySelectorAll('form');
    return Array.from(forms).map((form, i) => {
      const fields = [];
      const inputs = form.querySelectorAll('input, textarea, select');
      inputs.forEach((input) => {
        const field = {
          tag: input.tagName.toLowerCase(),
          type: input.type || null,
          name: input.name || null,
          id: input.id || null,
          value: input.value || '',
          required: input.required || false,
          disabled: input.disabled || false,
        };
        if (input.tagName === 'SELECT') {
          field.options = Array.from(input.options).map((o) => ({
            value: o.value,
            text: o.textContent.trim(),
            selected: o.selected,
          }));
        }
        if (input.labels && input.labels[0]) {
          field.label = input.labels[0].innerText;
        }
        fields.push(field);
      });
      return {
        index: i,
        id: form.id || null,
        action: form.action || null,
        method: form.method || 'get',
        fields,
      };
    });
  },
});
```

**Step 2: Commit**

```bash
git add scripts/preload.js
git commit -m "feat: add optional preload script for enhanced DOM access"
```

---

### Task 11: Screenshot Diff CLI

**Files:**
- Create: `scripts/screenshot-diff.js`

**Step 1: Write the CLI tool**

```js
#!/usr/bin/env node

// screenshot-diff.js — Standalone screenshot comparison CLI
// Usage: node screenshot-diff.js <baseline.png> <current.png> [--output diff.png] [--threshold 0.1]

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);

function usage() {
  console.error('Usage: screenshot-diff <baseline.png> <current.png> [--output diff.png] [--threshold 0.1]');
  process.exit(2);
}

// Parse args
const positional = [];
let outputPath = null;
let threshold = 0.1;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) {
    outputPath = args[++i];
  } else if (args[i] === '--threshold' && args[i + 1]) {
    threshold = parseFloat(args[++i]);
  } else if (!args[i].startsWith('--')) {
    positional.push(args[i]);
  }
}

if (positional.length < 2) usage();

const [baselinePath, currentPath] = positional;

try {
  const baselineBuffer = readFileSync(baselinePath);
  const currentBuffer = readFileSync(currentPath);

  // Try pixel-level comparison with pixelmatch
  let result;
  try {
    const { default: pixelmatch } = await import('pixelmatch');
    const { PNG } = await import('pngjs');

    const baseline = PNG.sync.read(baselineBuffer);
    const current = PNG.sync.read(currentBuffer);

    if (baseline.width !== current.width || baseline.height !== current.height) {
      result = {
        identical: false,
        method: 'pixelmatch',
        error: 'Images have different dimensions',
        baseline: { width: baseline.width, height: baseline.height },
        current: { width: current.width, height: current.height },
      };
    } else {
      const { width, height } = baseline;
      const diff = new PNG({ width, height });
      const numDiffPixels = pixelmatch(
        baseline.data, current.data, diff.data,
        width, height, { threshold }
      );
      const totalPixels = width * height;
      const identical = numDiffPixels === 0;

      result = {
        identical,
        method: 'pixelmatch',
        diffPixels: numDiffPixels,
        totalPixels,
        diffPercent: ((numDiffPixels / totalPixels) * 100).toFixed(4),
        threshold,
        dimensions: { width, height },
      };

      if (outputPath && !identical) {
        writeFileSync(outputPath, PNG.sync.write(diff));
        result.diffImage = outputPath;
      }
    }
  } catch {
    // Fallback to byte-level comparison
    const identical = baselineBuffer.equals(currentBuffer);
    const maxLen = Math.max(baselineBuffer.length, currentBuffer.length);
    let diffBytes = Math.abs(baselineBuffer.length - currentBuffer.length);

    if (!identical) {
      const minLen = Math.min(baselineBuffer.length, currentBuffer.length);
      for (let i = 0; i < minLen; i++) {
        if (baselineBuffer[i] !== currentBuffer[i]) diffBytes++;
      }
    }

    result = {
      identical,
      method: 'byte-comparison',
      note: 'Install pixelmatch and pngjs for pixel-level comparison: npm install pixelmatch pngjs',
      totalBytes: maxLen,
      diffBytes,
      diffPercent: maxLen > 0 ? ((diffBytes / maxLen) * 100).toFixed(4) : '0.0000',
    };
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.identical ? 0 : 1);
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(2);
}
```

**Step 2: Make it executable**

Run: `chmod +x scripts/screenshot-diff.js`

**Step 3: Verify it runs (no images needed, just check help/error)**

Run: `node scripts/screenshot-diff.js 2>&1 || true`
Expected: "Usage: screenshot-diff ..." message, exit code 2.

**Step 4: Commit**

```bash
git add scripts/screenshot-diff.js
git commit -m "feat: add standalone screenshot-diff CLI tool"
```

---

### Task 12: SKILL.md

**Files:**
- Create: `SKILL.md`

Write the complete skill definition. Must be under 500 lines. Points to references/ for full details.

**Step 1: Write SKILL.md**

The full content should include:
- YAML frontmatter with name `electron-dev-automation` and description
- Quick Start (4 steps, mcp.json config snippet)
- Architecture diagram (ASCII)
- Tool reference table (grouped, concise)
- 5 Operational Playbooks (Build & Verify, E2E Test, Visual Regression, Debug UI Bug, Form Automation)
- Screenshot Evaluation Guide
- Selector Strategy
- Waiting Strategy
- Troubleshooting

Key content for each playbook — show the tool chain sequence concisely (e.g., "launch → wait → screenshot → evaluate → fix → re-verify"). Point to `references/playbooks.md` for expanded versions.

The mcp.json config snippet:

```json
{
  "mcpServers": {
    "electron-dev-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/electron-dev-bridge/scripts/mcp-server.js"],
      "env": {
        "ELECTRON_DEBUG_PORT": "9229",
        "SCREENSHOT_DIR": ".screenshots"
      }
    }
  }
}
```

**Step 2: Commit**

```bash
git add SKILL.md
git commit -m "feat: add SKILL.md with playbooks and operational guidance"
```

---

### Task 13: Reference Documentation — tools-api.md

**Files:**
- Create: `references/tools-api.md`

Full API reference for all 25 tools. For each tool:
- Name, description
- Parameters with types and defaults
- Return value with example JSON
- Notes/caveats
- Usage example

Group by category matching the server sections. Use the exact inputSchema from mcp-server.js as the source of truth for params.

**Step 1: Write tools-api.md**

**Step 2: Commit**

```bash
git add references/tools-api.md
git commit -m "docs: add full tools API reference"
```

---

### Task 14: Reference Documentation — playbooks.md

**Files:**
- Create: `references/playbooks.md`

Expanded versions of the 5 playbooks from SKILL.md. Each playbook should show:
- Exact tool names and parameters at each step
- Decision points ("if screenshot shows X, do Y")
- Common pitfalls
- Expected outcomes

**Step 1: Write playbooks.md**

**Step 2: Commit**

```bash
git add references/playbooks.md
git commit -m "docs: add expanded operational playbooks"
```

---

### Task 15: Reference Documentation — cdp-reference.md

**Files:**
- Create: `references/cdp-reference.md`

Quick reference for CDP domains used by the MCP server:
- `Runtime.evaluate` — returnByValue, awaitPromise, exceptions
- `DOM.getDocument`, `querySelector`, `querySelectorAll`, `getAttributes`, `getOuterHTML`
- `Input.dispatchMouseEvent`, `dispatchKeyEvent`
- `Page.captureScreenshot`
- `Emulation.setDeviceMetricsOverride`
- `Network.enable`

Include notes on nodeId vs remoteObjectId, common gotchas.

**Step 1: Write cdp-reference.md**

**Step 2: Commit**

```bash
git add references/cdp-reference.md
git commit -m "docs: add CDP domain quick reference"
```

---

### Task 16: Example — basic-test.md

**Files:**
- Create: `examples/basic-test.md`

Walk through testing a counter Electron app:
1. Sample app code (main.js ~30 lines, index.html ~30 lines)
2. MCP config snippet
3. Tool call sequence: launch → wait → screenshot → click → wait → get_text → verify → screenshot

Use realistic tool parameters and expected outputs.

**Step 1: Write basic-test.md**

**Step 2: Commit**

```bash
git add examples/basic-test.md
git commit -m "docs: add basic test example with counter app"
```

---

### Task 17: Example — form-automation.md

**Files:**
- Create: `examples/form-automation.md`

Form with text inputs, dropdown, checkbox, submit:
1. Sample HTML
2. Tool sequence: get_accessibility_tree → type_text → select_option → click checkbox → screenshot → click submit → wait → get_text → verify

**Step 1: Write form-automation.md**

**Step 2: Commit**

```bash
git add examples/form-automation.md
git commit -m "docs: add form automation example"
```

---

### Task 18: Example — visual-regression.md

**Files:**
- Create: `examples/visual-regression.md`

Baseline → change → diff workflow:
1. Launch, screenshot baseline
2. CSS change, restart, screenshot current
3. compare_screenshots, interpret diff
4. screenshot-diff.js CLI for CI

**Step 1: Write visual-regression.md**

**Step 2: Commit**

```bash
git add examples/visual-regression.md
git commit -m "docs: add visual regression testing example"
```

---

### Task 19: Final Verification & Smoke Test

**Files:**
- No new files

**Step 1: Verify npm install works**

Run: `cd scripts && rm -rf node_modules && npm install`
Expected: Clean install, no errors

**Step 2: Verify server starts**

Run: `node scripts/mcp-server.js &; sleep 1; kill %1 2>/dev/null`
Expected: No errors on startup

**Step 3: Verify screenshot-diff CLI**

Run: `node scripts/screenshot-diff.js 2>&1; echo "Exit: $?"`
Expected: Usage message, exit code 2

**Step 4: Verify file counts**

Run: `find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -name '.DS_Store' -not -name 'package-lock.json' | sort`
Expected: 11 files total:
- `SKILL.md`
- `docs/plans/2026-02-28-electron-dev-bridge-design.md`
- `docs/plans/2026-02-28-electron-dev-bridge-implementation.md`
- `scripts/package.json`
- `scripts/mcp-server.js`
- `scripts/preload.js`
- `scripts/screenshot-diff.js`
- `references/tools-api.md`
- `references/playbooks.md`
- `references/cdp-reference.md`
- `examples/basic-test.md`
- `examples/form-automation.md`
- `examples/visual-regression.md`

**Step 5: Verify SKILL.md line count**

Run: `wc -l SKILL.md`
Expected: Under 500 lines

**Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "chore: final verification pass"
```
