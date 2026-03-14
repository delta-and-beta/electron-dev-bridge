# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # tsc — compile src/ → dist/
npm run test       # node --test dist/**/*.test.js (must build first)
npm run lint       # tsc --noEmit — type-check only
npm run dev        # tsc --watch
```

Tests run against compiled JS in `dist/`, not TypeScript source. Always build before testing. To run a single test file: `node --test dist/tests/integration.test.js`.

## What This Is

An MCP server that bridges Claude Code to Electron apps via Chrome DevTools Protocol. Two modes:

1. **IPC mode** — Maps `ipcMain.handle()` channels from a config file to named MCP tools. Calls execute via `bridge.evaluate()` in the renderer using the app's `contextBridge` preload.
2. **CDP mode** — 22 built-in DOM automation tools (click, type, screenshot, etc.) that work on any Electron app with `--remote-debugging-port`.

Both modes run simultaneously. Published as npm package `electron-dev-bridge` with CLI binary `electron-mcp`.

## Architecture

The server starts via: `cli/index.ts` → `cli/serve.ts` → `server/mcp-server.ts`.

**IPC tool flow**: Config `tools` entries → `tool-builder.ts` derives MCP tool names (colons→underscores) and preload paths (`profiles:query` → `window.electronAPI.profiles.query`) → on call, builds JS expression → `bridge.evaluate()` in renderer via CDP `Runtime.evaluate`.

**CDP tool flow**: Six modules in `cdp-tools/` each export `create*Tools(ctx: ToolContext): CdpTool[]`. All share a single `ToolContext` with the bridge, app config, and a mutable `state` object (screenshot counter, spawned electron process). Tools use two CDP access patterns: `bridge.evaluate(js)` for inline JS, or `bridge.getRawClient()` for raw CDP protocol methods.

**Config loading**: `.ts` files load via `tsx/esm/api` `tsImport`; `.js`/`.mjs` via dynamic import. Config must `export default defineConfig({...})`.

**Connection is lazy**: `CdpBridge` is instantiated at startup but `connect()` only happens when `electron_launch` or `electron_connect` is called. Other tools call `bridge.ensureConnected()` which throws if not yet connected.

## Key Conventions

- **ESM-only** with `.js` import extensions (even for `.ts` source). `"module": "NodeNext"`, `strict: true`.
- **No test framework** — uses `node:test` and `node:assert` exclusively.
- **Tests use temp files** — scanner tests create fixtures via `mkdtempSync()` + inline content. Never reference external files or absolute paths.
- **Zod is optional** — `zod-to-json-schema` conversion is try/caught; falls back to `{ type: 'object' }` if Zod isn't installed.
- **`scripts/` is separate** — standalone JS MCP server for zero-install CDP-only usage. Has its own `package.json`. Not part of the SDK.

## Non-Obvious Details

- `electron_launch` waits 2s unconditionally after spawning before calling `bridge.connect()`, then retries connection up to 10 times with 1s delays.
- `CdpBridge.connect()` enables four CDP domains: `Runtime`, `DOM`, `Page`, `Network`. Required before any raw CDP method calls.
- `cdpTools: string[]` is an allowlist — all 22 tools are instantiated first, then filtered. The shared `state` object is always fully initialized.
- `electron_compare_screenshots` is byte-level diff only, not pixel-aware. Identical visuals with different compression will show as different.
- The `init` scanner links schemas to channels by fuzzy matching: singularizes the domain (`profiles` → `profile`), checks if schema name contains both domain and action substrings.
- IPC tool calls pass the entire MCP `arguments` object as a single JSON blob to the preload function. Handlers must accept a single object parameter.
