#!/usr/bin/env node

// ============================================================================
// MCP Server for driving Electron apps via Chrome DevTools Protocol
// ============================================================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import CDP from "chrome-remote-interface";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// ============================================================================
// Configuration (from environment variables)
// ============================================================================

const DEFAULT_PORT = parseInt(process.env.ELECTRON_DEBUG_PORT || "9229", 10);
const DEFAULT_APP_PATH = process.env.ELECTRON_APP_PATH || "";
const ELECTRON_BIN = process.env.ELECTRON_BIN || "";
const SCREENSHOT_DIR =
  process.env.SCREENSHOT_DIR || join(process.cwd(), ".screenshots");

// ============================================================================
// State
// ============================================================================

let cdpClient = null;
let electronProcess = null;
let screenshotCounter = 0;

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Throws if no CDP connection is active.
 */
function ensureConnected() {
  if (cdpClient === null) {
    throw new Error(
      "Not connected to an Electron app. " +
        'Use the "connect" or "launch" tool first.',
    );
  }
}

/**
 * Connect to a running Electron app via CDP.
 * Retries up to maxRetries times with 1-second intervals.
 */
async function connectToCDP(port, maxRetries = 10) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const targets = await CDP.List({ port });
      const page = targets.find((t) => t.type === "page");

      if (!page) {
        throw new Error("No page target found among CDP targets");
      }

      const client = await CDP({ target: page, port });

      await client.Runtime.enable();
      await client.DOM.enable();
      await client.Page.enable();
      await client.Network.enable();

      cdpClient = client;

      client.on("disconnect", () => {
        cdpClient = null;
      });

      return client;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  throw new Error(
    `Failed to connect to CDP on port ${port} after ${maxRetries} attempts: ${lastError?.message}`,
  );
}

/**
 * Evaluate a JavaScript expression in the connected Electron app.
 */
async function evaluateJS(expression, awaitPromise = false) {
  ensureConnected();

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
}

/**
 * Get the bounding box of a DOM element by CSS selector.
 */
async function getBoundingBox(selector) {
  const box = await evaluateJS(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left
      };
    })()
  `);

  if (!box) {
    throw new Error(`Element not found: ${selector}`);
  }

  return box;
}

/**
 * Format a successful tool result.
 */
function toolResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Format an error tool result.
 */
function toolError(message) {
  return {
    content: [{ type: "text", text: "Error: " + message }],
    isError: true,
  };
}

// ============================================================================
// Tool registration infrastructure
// ============================================================================

const TOOLS = [];
const TOOL_HANDLERS = {};

/**
 * Register a tool with its definition and handler.
 * Must be called before server setup.
 */
function registerTool(definition, handler) {
  TOOLS.push(definition);
  TOOL_HANDLERS[definition.name] = handler;
}

// ============================================================================
// ─── Connection & Lifecycle Tools ──────────────────────────────────────────
// ============================================================================

registerTool(
  {
    name: "electron_launch",
    description:
      "Launch an Electron application with remote debugging enabled and connect to it via CDP.",
    inputSchema: {
      type: "object",
      properties: {
        appPath: {
          type: "string",
          description:
            "Path to the Electron app directory. Defaults to ELECTRON_APP_PATH env var.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Additional command-line arguments to pass to Electron.",
        },
      },
    },
  },
  async ({ appPath, args = [] } = {}) => {
    const resolvedAppPath = resolve(appPath || DEFAULT_APP_PATH);
    if (!resolvedAppPath) {
      throw new Error(
        "No app path provided. Pass appPath or set ELECTRON_APP_PATH env var.",
      );
    }

    const electronBin =
      ELECTRON_BIN || join(resolvedAppPath, "node_modules", ".bin", "electron");

    const child = spawn(
      electronBin,
      [`--remote-debugging-port=${DEFAULT_PORT}`, resolvedAppPath, ...args],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    electronProcess = child;

    const stderrChunks = [];
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk.toString()));

    child.on("exit", () => {
      electronProcess = null;
      cdpClient = null;
    });

    // Wait for the app to start up
    await new Promise((r) => setTimeout(r, 2000));

    if (child.exitCode !== null) {
      throw new Error(
        `Electron process exited immediately with code ${child.exitCode}. ` +
          `stderr: ${stderrChunks.join("")}. ` +
          "Check that the app path is correct and Electron is installed.",
      );
    }

    await connectToCDP(DEFAULT_PORT);

    return toolResult({
      pid: child.pid,
      debugPort: DEFAULT_PORT,
      connected: true,
      stderr: stderrChunks.join(""),
    });
  },
);

registerTool(
  {
    name: "electron_connect",
    description:
      "Connect to an already-running Electron app via Chrome DevTools Protocol.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description:
            "CDP debugging port. Defaults to ELECTRON_DEBUG_PORT env var or 9229.",
        },
      },
    },
  },
  async ({ port } = {}) => {
    const targetPort = port || DEFAULT_PORT;
    await connectToCDP(targetPort);
    return toolResult({ connected: true, port: targetPort });
  },
);

// ============================================================================
// ─── DOM Query Tools ───────────────────────────────────────────────────────
// ============================================================================

registerTool(
  {
    name: "electron_query_selector",
    description:
      "Find a single DOM element matching a CSS selector. Returns attributes and an HTML preview.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to match.",
        },
      },
      required: ["selector"],
    },
  },
  async ({ selector }) => {
    ensureConnected();

    const { root } = await cdpClient.DOM.getDocument();
    const { nodeId } = await cdpClient.DOM.querySelector({
      nodeId: root.nodeId,
      selector,
    });

    if (nodeId === 0) {
      return toolResult({ found: false });
    }

    const { attributes: attrArray } = await cdpClient.DOM.getAttributes({
      nodeId,
    });
    const { outerHTML } = await cdpClient.DOM.getOuterHTML({ nodeId });

    const attributes = {};
    for (let i = 0; i < attrArray.length; i += 2) {
      attributes[attrArray[i]] = attrArray[i + 1];
    }

    return toolResult({
      found: true,
      nodeId,
      attributes,
      outerHTMLPreview: outerHTML.slice(0, 500),
    });
  },
);

registerTool(
  {
    name: "electron_query_selector_all",
    description:
      "Find all DOM elements matching a CSS selector. Returns up to 50 elements with HTML previews.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to match.",
        },
      },
      required: ["selector"],
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

    for (const nid of limited) {
      const { outerHTML } = await cdpClient.DOM.getOuterHTML({ nodeId: nid });
      elements.push({
        nodeId: nid,
        outerHTMLPreview: outerHTML.slice(0, 500),
      });
    }

    return toolResult({
      count: nodeIds.length,
      returned: limited.length,
      elements,
    });
  },
);

registerTool(
  {
    name: "electron_find_by_text",
    description:
      "Find DOM elements containing specific text content using XPath. Returns up to 50 matches.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text content to search for (partial match).",
        },
        tag: {
          type: "string",
          description:
            'HTML tag to restrict search to (e.g. "button", "span"). Defaults to "*" (any tag).',
        },
      },
      required: ["text"],
    },
  },
  async ({ text, tag = "*" }) => {
    ensureConnected();

    // Sanitize tag: allow only alphanumeric and *
    const safeTag = tag.replace(/[^a-zA-Z0-9*]/g, "") || "*";
    const safeText = JSON.stringify(text);

    const result = await evaluateJS(`
      (() => {
        const results = [];
        const xpath = '//${safeTag}[contains(text(), ${safeText})]';
        const snapshot = document.evaluate(
          xpath, document.body, null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
        );
        const count = snapshot.snapshotLength;
        const limit = Math.min(count, 50);
        for (let i = 0; i < limit; i++) {
          const el = snapshot.snapshotItem(i);
          const rect = el.getBoundingClientRect();
          results.push({
            tag: el.tagName.toLowerCase(),
            textPreview: (el.textContent || '').trim().slice(0, 200),
            id: el.id || null,
            className: el.className || null,
            boundingBox: {
              x: rect.x, y: rect.y,
              width: rect.width, height: rect.height
            }
          });
        }
        return { count, elements: results };
      })()
    `);

    return toolResult(result);
  },
);

registerTool(
  {
    name: "electron_find_by_role",
    description:
      "Find DOM elements by ARIA role (explicit or implicit). Returns up to 50 matches.",
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          description:
            'ARIA role to search for (e.g. "button", "link", "textbox", "heading").',
        },
      },
      required: ["role"],
    },
  },
  async ({ role }) => {
    ensureConnected();

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
          columnheader: ['th']
        };

        const role = ${safeRole};
        const selectors = ['[role="' + role + '"]'];
        const implicit = IMPLICIT_ROLES[role];
        if (implicit) {
          implicit.forEach(s => selectors.push(s));
        }

        const combined = selectors.join(', ');
        const all = document.querySelectorAll(combined);
        const count = all.length;
        const limit = Math.min(count, 50);
        const elements = [];

        for (let i = 0; i < limit; i++) {
          const el = all[i];
          const rect = el.getBoundingClientRect();
          elements.push({
            role: el.getAttribute('role') || role,
            text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 200),
            id: el.id || null,
            className: el.className || null,
            boundingBox: {
              x: rect.x, y: rect.y,
              width: rect.width, height: rect.height
            }
          });
        }

        return { count, elements };
      })()
    `);

    return toolResult(result);
  },
);

registerTool(
  {
    name: "electron_get_accessibility_tree",
    description:
      "Get a structured accessibility tree of the current page, including roles, names, and interactive states.",
    inputSchema: {
      type: "object",
      properties: {
        maxDepth: {
          type: "number",
          description:
            "Maximum depth to traverse the DOM tree. Defaults to 10.",
        },
      },
    },
  },
  async ({ maxDepth = 10 } = {}) => {
    ensureConnected();

    const tree = await evaluateJS(`
      (() => {
        const IMPLICIT_ROLES = {
          BUTTON: 'button', A: 'link', INPUT: 'textbox', TEXTAREA: 'textbox',
          SELECT: 'combobox', IMG: 'img', H1: 'heading', H2: 'heading',
          H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
          UL: 'list', OL: 'list', LI: 'listitem', NAV: 'navigation',
          MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo',
          ASIDE: 'complementary', FORM: 'form', TABLE: 'table',
          TR: 'row', TD: 'cell', TH: 'columnheader', SUMMARY: 'button'
        };

        function walk(el, depth) {
          if (depth > ${maxDepth}) return null;
          if (!el || el.nodeType !== 1) return null;

          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return null;

          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role') || IMPLICIT_ROLES[el.tagName] || null;

          // Determine accessible name
          let name = el.getAttribute('aria-label')
            || el.getAttribute('alt')
            || el.getAttribute('title')
            || el.getAttribute('placeholder');

          if (!name && el.id) {
            const label = document.querySelector('label[for="' + el.id + '"]');
            if (label) name = label.textContent.trim();
          }

          if (!name) {
            // Use direct text node content only
            let directText = '';
            for (const child of el.childNodes) {
              if (child.nodeType === 3) directText += child.textContent;
            }
            directText = directText.trim();
            if (directText) name = directText.slice(0, 200);
          }

          const classes = el.className && typeof el.className === 'string'
            ? el.className.split(/\\s+/).slice(0, 5).join(' ')
            : null;

          const node = { tag };
          if (role) node.role = role;
          if (name) node.name = name;
          if (el.id) node.id = el.id;
          if (classes) node.class = classes;
          if (el.dataset && el.dataset.testid) node.dataTestId = el.dataset.testid;

          // Interactive state
          if (el.value !== undefined && el.value !== '') node.value = String(el.value).slice(0, 200);
          if (el.type) node.type = el.type;
          if (el.href) node.href = el.href;
          if (el.disabled) node.disabled = true;
          if (el.checked) node.checked = true;
          const expanded = el.getAttribute('aria-expanded');
          if (expanded !== null) node.ariaExpanded = expanded;
          const selected = el.getAttribute('aria-selected');
          if (selected !== null) node.ariaSelected = selected;
          const ariaDisabled = el.getAttribute('aria-disabled');
          if (ariaDisabled !== null) node.ariaDisabled = ariaDisabled;

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
  },
);

// ============================================================================
// ─── Interaction Tools ─────────────────────────────────────────────────────
// ============================================================================

registerTool(
  {
    name: "electron_click",
    description:
      "Click on an element by CSS selector or at specific x/y coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element to click.",
        },
        x: {
          type: "number",
          description: "X coordinate to click at (used if no selector).",
        },
        y: {
          type: "number",
          description: "Y coordinate to click at (used if no selector).",
        },
      },
    },
  },
  async ({ selector, x, y } = {}) => {
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
      throw new Error(
        "Provide either a selector or both x and y coordinates to click.",
      );
    }

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

    return toolResult({ clicked: true, x: clickX, y: clickY });
  },
);

registerTool(
  {
    name: "electron_type_text",
    description:
      "Type text into the focused element or a specific element (clicks it first if selector provided).",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text string to type.",
        },
        selector: {
          type: "string",
          description:
            "CSS selector of the element to type into. Will be clicked to focus first.",
        },
      },
      required: ["text"],
    },
  },
  async ({ text, selector }) => {
    ensureConnected();

    if (selector) {
      const box = await getBoundingBox(selector);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await cdpClient.Input.dispatchMouseEvent({
        type: "mousePressed",
        x: cx,
        y: cy,
        button: "left",
        clickCount: 1,
      });
      await cdpClient.Input.dispatchMouseEvent({
        type: "mouseReleased",
        x: cx,
        y: cy,
        button: "left",
        clickCount: 1,
      });
    }

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

    return toolResult({ typed: true, length: text.length });
  },
);

registerTool(
  {
    name: "electron_press_key",
    description:
      "Press a special key (Enter, Tab, Escape, arrow keys, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "Key name: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, Space.",
        },
      },
      required: ["key"],
    },
  },
  async ({ key }) => {
    ensureConnected();

    const KEY_MAP = {
      Enter: { keyCode: 13, code: "Enter", key: "Enter", text: "\r" },
      Tab: { keyCode: 9, code: "Tab", key: "Tab" },
      Escape: { keyCode: 27, code: "Escape", key: "Escape" },
      Backspace: { keyCode: 8, code: "Backspace", key: "Backspace" },
      Delete: { keyCode: 46, code: "Delete", key: "Delete" },
      ArrowUp: { keyCode: 38, code: "ArrowUp", key: "ArrowUp" },
      ArrowDown: { keyCode: 40, code: "ArrowDown", key: "ArrowDown" },
      ArrowLeft: { keyCode: 37, code: "ArrowLeft", key: "ArrowLeft" },
      ArrowRight: { keyCode: 39, code: "ArrowRight", key: "ArrowRight" },
      Home: { keyCode: 36, code: "Home", key: "Home" },
      End: { keyCode: 35, code: "End", key: "End" },
      Space: { keyCode: 32, code: "Space", key: " ", text: " " },
    };

    const mapped = KEY_MAP[key];
    if (!mapped) {
      throw new Error(
        `Unsupported key: "${key}". Supported keys: ${Object.keys(KEY_MAP).join(", ")}`,
      );
    }

    const downEvent = {
      type: "keyDown",
      key: mapped.key,
      code: mapped.code,
      windowsVirtualKeyCode: mapped.keyCode,
      nativeVirtualKeyCode: mapped.keyCode,
    };
    if (mapped.text) downEvent.text = mapped.text;

    await cdpClient.Input.dispatchKeyEvent(downEvent);
    await cdpClient.Input.dispatchKeyEvent({
      type: "keyUp",
      key: mapped.key,
      code: mapped.code,
      windowsVirtualKeyCode: mapped.keyCode,
      nativeVirtualKeyCode: mapped.keyCode,
    });

    return toolResult({ pressed: key });
  },
);

registerTool(
  {
    name: "electron_select_option",
    description:
      "Select an option in a <select> element by value or visible text.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the <select> element.",
        },
        value: {
          type: "string",
          description: "Option value or visible text to select.",
        },
      },
      required: ["selector", "value"],
    },
  },
  async ({ selector, value }) => {
    ensureConnected();

    const result = await evaluateJS(`
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
    `);

    return toolResult(result);
  },
);

// ============================================================================
// ─── Reading State Tools ───────────────────────────────────────────────────
// ============================================================================

registerTool(
  {
    name: "electron_get_text",
    description: "Get the innerText of a DOM element by CSS selector.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element.",
        },
      },
      required: ["selector"],
    },
  },
  async ({ selector }) => {
    ensureConnected();

    const text = await evaluateJS(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector.replace(/'/g, "\\'")}. Check that the selector is correct.');
        return el.innerText;
      })()
    `);

    return toolResult({ text });
  },
);

registerTool(
  {
    name: "electron_get_value",
    description:
      "Get the value property of an input, textarea, or select element.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the form element.",
        },
      },
      required: ["selector"],
    },
  },
  async ({ selector }) => {
    ensureConnected();

    const value = await evaluateJS(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector.replace(/'/g, "\\'")}. Check that the selector is correct.');
        return el.value;
      })()
    `);

    return toolResult({ value });
  },
);

registerTool(
  {
    name: "electron_get_attribute",
    description: "Get a specific attribute value from a DOM element.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element.",
        },
        attribute: {
          type: "string",
          description: "Attribute name to read (e.g. 'href', 'src', 'data-id').",
        },
      },
      required: ["selector", "attribute"],
    },
  },
  async ({ selector, attribute }) => {
    ensureConnected();

    const value = await evaluateJS(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector.replace(/'/g, "\\'")}. Check that the selector is correct.');
        return el.getAttribute(${JSON.stringify(attribute)});
      })()
    `);

    return toolResult({ attribute, value });
  },
);

registerTool(
  {
    name: "electron_get_bounding_box",
    description:
      "Get the position and dimensions of a DOM element (x, y, width, height).",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element.",
        },
      },
      required: ["selector"],
    },
  },
  async ({ selector }) => {
    ensureConnected();
    const box = await getBoundingBox(selector);
    return toolResult({ x: box.x, y: box.y, width: box.width, height: box.height });
  },
);

registerTool(
  {
    name: "electron_get_url",
    description: "Get the current page URL of the Electron app.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  async () => {
    ensureConnected();
    const url = await evaluateJS("window.location.href");
    return toolResult({ url });
  },
);

// ============================================================================
// ─── Navigation & Viewport Tools ──────────────────────────────────────────
// ============================================================================

registerTool(
  {
    name: "electron_wait_for_selector",
    description:
      "Wait for a DOM element matching a CSS selector to appear, polling until found or timeout.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to wait for.",
        },
        timeout: {
          type: "number",
          description: "Maximum time to wait in milliseconds. Defaults to 5000.",
        },
      },
      required: ["selector"],
    },
  },
  async ({ selector, timeout = 5000 }) => {
    ensureConnected();

    const interval = 250;
    let elapsed = 0;

    while (elapsed < timeout) {
      const found = await evaluateJS(
        `!!document.querySelector(${JSON.stringify(selector)})`,
      );
      if (found) {
        return toolResult({ found: true, selector, elapsed });
      }
      await new Promise((r) => setTimeout(r, interval));
      elapsed += interval;
    }

    throw new Error(
      `Timeout after ${timeout}ms waiting for selector "${selector}". ` +
        "The element may not exist yet, or the selector may be incorrect. " +
        "Try increasing the timeout or verifying the selector.",
    );
  },
);

registerTool(
  {
    name: "electron_set_viewport",
    description:
      "Set the viewport dimensions of the Electron window for responsive testing.",
    inputSchema: {
      type: "object",
      properties: {
        width: {
          type: "number",
          description: "Viewport width in pixels.",
        },
        height: {
          type: "number",
          description: "Viewport height in pixels.",
        },
      },
      required: ["width", "height"],
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
  },
);

registerTool(
  {
    name: "electron_scroll",
    description:
      "Scroll the page or a specific element in a given direction.",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          description:
            'Scroll direction: "up", "down", "left", or "right". Defaults to "down".',
        },
        amount: {
          type: "number",
          description: "Number of pixels to scroll. Defaults to 500.",
        },
        selector: {
          type: "string",
          description:
            "CSS selector of a scrollable element. If omitted, scrolls the page window.",
        },
      },
    },
  },
  async ({ direction = "down", amount = 500, selector } = {}) => {
    ensureConnected();

    let dx = 0;
    let dy = 0;
    switch (direction) {
      case "up":
        dy = -amount;
        break;
      case "down":
        dy = amount;
        break;
      case "left":
        dx = -amount;
        break;
      case "right":
        dx = amount;
        break;
      default:
        throw new Error(
          `Invalid direction: "${direction}". Use "up", "down", "left", or "right".`,
        );
    }

    if (selector) {
      const result = await evaluateJS(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Element not found: ${selector.replace(/'/g, "\\'")}');
          el.scrollBy(${dx}, ${dy});
          return { success: true, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft };
        })()
      `);
      return toolResult(result);
    } else {
      const result = await evaluateJS(`
        (() => {
          window.scrollBy(${dx}, ${dy});
          return { success: true, scrollX: window.scrollX, scrollY: window.scrollY };
        })()
      `);
      return toolResult(result);
    }
  },
);

// ============================================================================
// ─── Screenshot & Visual Tools ─────────────────────────────────────────────
// ============================================================================

registerTool(
  {
    name: "electron_screenshot",
    description:
      "Take a screenshot of the entire page or a specific element. Saves to disk and returns the file path.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description:
            "CSS selector of an element to screenshot. If omitted, captures the full page.",
        },
        fullPage: {
          type: "boolean",
          description:
            "Capture the full scrollable page (not just the viewport). Defaults to true.",
        },
      },
    },
  },
  async ({ selector, fullPage = true } = {}) => {
    ensureConnected();

    const captureParams = { format: "png" };

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

    if (!existsSync(SCREENSHOT_DIR)) {
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    screenshotCounter++;
    const filename = `screenshot-${Date.now()}-${screenshotCounter}.png`;
    const filepath = join(SCREENSHOT_DIR, filename);
    const buffer = Buffer.from(data, "base64");
    writeFileSync(filepath, buffer);

    return toolResult({
      path: filepath,
      filename,
      base64Length: data.length,
      selector: selector || null,
    });
  },
);

registerTool(
  {
    name: "electron_compare_screenshots",
    description:
      "Compare two screenshot files byte-by-byte and report whether they are identical or how much they differ.",
    inputSchema: {
      type: "object",
      properties: {
        pathA: {
          type: "string",
          description: "Absolute path to the first screenshot file.",
        },
        pathB: {
          type: "string",
          description: "Absolute path to the second screenshot file.",
        },
      },
      required: ["pathA", "pathB"],
    },
  },
  async ({ pathA, pathB }) => {
    const bufA = readFileSync(pathA);
    const bufB = readFileSync(pathB);

    const identical = bufA.equals(bufB);
    let diffBytes = 0;

    if (!identical) {
      const len = Math.max(bufA.length, bufB.length);
      for (let i = 0; i < len; i++) {
        if ((bufA[i] || 0) !== (bufB[i] || 0)) {
          diffBytes++;
        }
      }
    }

    const totalBytes = Math.max(bufA.length, bufB.length);
    const diffPercent = totalBytes > 0
      ? parseFloat(((diffBytes / totalBytes) * 100).toFixed(2))
      : 0;

    return toolResult({ identical, diffPercent, totalBytes, diffBytes });
  },
);

registerTool(
  {
    name: "electron_highlight_element",
    description:
      "Temporarily highlight a DOM element with a red outline for visual identification (lasts 3 seconds).",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element to highlight.",
        },
      },
      required: ["selector"],
    },
  },
  async ({ selector }) => {
    ensureConnected();

    await evaluateJS(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector.replace(/'/g, "\\'")}. Check the selector.');
        const prev = el.style.outline;
        el.style.outline = '3px solid red';
        setTimeout(() => { el.style.outline = prev; }, 3000);
        return true;
      })()
    `);

    return toolResult({ success: true, selector });
  },
);

// ============================================================================
// Server setup
// ============================================================================

const server = new Server(
  { name: "electron-dev-bridge", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = TOOL_HANDLERS[name];

  if (!handler) {
    return toolError(`Unknown tool: ${name}`);
  }

  try {
    return await handler(args);
  } catch (err) {
    return toolError(err.message);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", async () => {
  if (electronProcess) {
    electronProcess.kill();
  }
  await server.close();
  process.exit(0);
});
