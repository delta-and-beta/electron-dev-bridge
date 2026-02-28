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
// Tools will be registered here by subsequent tasks
// ============================================================================

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
