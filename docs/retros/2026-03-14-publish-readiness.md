# Retro: Publish Readiness — Skills, Production Scan, Security Hardening

**Date:** 2026-03-14
**Session:** Created sample Claude Code skills, ran production readiness scan, fixed critical bugs, renamed package, rewrote README, security scan.

## Incidents

### 1. electron_connect Port Parameter Was Decorative
- **Category:** `api-contract`
- **Incident:** The `electron_connect` tool accepted a `port` parameter but never used it — `bridge.connect()` always used the port from server startup config.
- **Discovery:** The handler computed `targetPort` and reported it in the response, but never called `bridge.setPort()`. Users would see `port: 9230` in the result while actually connecting to port 9229.
- **Evolution:** Always trace parameter flow end-to-end. A parameter that appears in the response but doesn't affect behavior is worse than no parameter — it actively misleads.
- **Action:** [x] Added `bridge.setPort(targetPort)` before `bridge.connect()` and added `setPort()` method to CdpBridge

### 2. electron_launch Guard Was Dead Code
- **Category:** `integration`
- **Incident:** `if (!resolvedAppPath)` could never be true because `path.resolve('')` returns the CWD, never an empty string.
- **Discovery:** The guard was meant to catch "no app path provided" but `resolve()` guarantees a non-empty return. Without a working guard, Electron would launch pointing at CWD, silently failing.
- **Evolution:** Validate raw inputs *before* calling path transformation functions. `resolve()`, `join()`, and `normalize()` always return values — they mask missing inputs.
- **Action:** [x] Moved validation before `resolve()`: check `rawPath = appPath || appConfig.path` before resolving

### 3. Tests Hardcoded to Author's Machine
- **Category:** `testing-gap`
- **Incident:** Scanner tests used absolute paths to `/Users/marchi-lau/.../linkedin-app/`. Tests passed locally but would fail on any other machine.
- **Discovery:** Tests started as "quick local checks" during development and were never made portable. The hardcoded paths also leaked the author's username and project structure.
- **Evolution:** Always use temp files with inline fixtures for unit tests. Never reference external projects — tests must be self-contained.
- **Action:** [x] Rewrote scanner tests using `mkdtempSync()` with inline IPC handler and Zod schema fixtures

### 4. skills/ Not in package.json files
- **Category:** `integration`
- **Incident:** The README instructed users to `cp -r node_modules/electron-mcp-sdk/skills/` but skills/ wasn't in the `files` array, so npm wouldn't include them in the published package.
- **Discovery:** The `files` field was added when the project was first scaffolded and was never updated when skills/ was created.
- **Evolution:** After creating any new top-level directory intended for consumers, immediately check `package.json` `files`.
- **Action:** [x] Added `"skills"` to files array

### 5. electron_select_option Error Message Injection
- **Category:** `api-contract`
- **Incident:** The error message in `electron_select_option` used manual quote escaping (`selector.replace(/'/g, "\\'")`), which is vulnerable to backslash-escape bypass.
- **Discovery:** A selector like `div\'` would break the generated JavaScript string, causing a DoS-level error. Not RCE, but crashes the tool invocation.
- **Evolution:** Always use `JSON.stringify()` for interpolating untrusted strings into generated JavaScript. Manual escaping is error-prone.
- **Action:** [x] Replaced manual escaping with `JSON.stringify(selector)` in the error message

### 6. Env Vars Documented But Never Read
- **Category:** `docs-missing`
- **Incident:** Tool descriptions referenced `ELECTRON_APP_PATH` and `ELECTRON_DEBUG_PORT` env vars, but no code ever read `process.env` for these values.
- **Discovery:** The env var names were in the original design doc but were never implemented. The tool descriptions were copy-pasted from the design without verifying.
- **Evolution:** Verify documentation claims against actual code. Tool descriptions are user-facing — they must be accurate.
- **Action:** [x] Removed env var references from tool descriptions

### 7. No Graceful Shutdown
- **Category:** `integration`
- **Incident:** No SIGINT/SIGTERM handlers anywhere in the codebase. When Claude Code terminates the MCP server, CDP connections and spawned Electron processes leak.
- **Discovery:** MCP servers run as child processes — they get killed when the parent exits. Without cleanup handlers, the CDP WebSocket connection stays open and the Electron child process becomes orphaned.
- **Evolution:** Any server that manages external connections or child processes needs shutdown handlers from day one.
- **Action:** [x] Added SIGINT/SIGTERM handlers that call `bridge.close()` and `server.close()` before exit

### 8. No LICENSE File
- **Category:** `docs-missing`
- **Incident:** `package.json` declared `"license": "MIT"` but no LICENSE file existed in the repo. Many corporate consumers require the actual license file.
- **Discovery:** Standard npm publishing hygiene — the license field alone is insufficient.
- **Action:** [x] Created MIT LICENSE file

### 9. Private Paths Leaked in Source
- **Category:** `api-contract`
- **Incident:** Two files contained hardcoded `/Users/marchi-lau/` paths: `scripts/test-live.js` and `examples/linkedin-app-config.ts`. These leak the developer's username and project structure.
- **Discovery:** Neither file is published to npm (not in `files`), but both are visible if the GitHub repo is public.
- **Action:** [x] Replaced with `process.env.ELECTRON_APP_PATH || "../linkedin-app"` and `'/path/to/your/electron-app'`

## Patterns Observed

### Anti-Patterns
- **Copy-paste from design docs without verifying** — env var references, hardcoded counts, tool descriptions that don't match implementation
- **"Quick local test" that ships** — hardcoded absolute paths in tests that work on one machine
- **Guard-after-transform** — validating *after* `resolve()` masks empty inputs since `resolve()` never returns empty
- **Manual string escaping in generated JS** — backslash-escape bypass is a classic bug; `JSON.stringify()` is always correct
- **Magic numbers** — hardcoded `22` for CDP tool count in `validate.ts` instead of computing dynamically

### Good Patterns
- **Production readiness scan before publish** — the multi-agent review caught 12 issues across 3 categories (critical, important, improvement)
- **Security scan as separate pass** — dedicated secret/credential scan found path leaks that code review missed
- **Portable test fixtures** — `mkdtempSync()` + inline content is the right pattern for file-reading unit tests
- **`npm pack --dry-run`** — verifying exact package contents before publish catches files inclusion/exclusion bugs

## Wisdom Captured

> "A parameter that appears in the response but doesn't affect behavior is worse than no parameter — it actively misleads users."

> "Validate raw inputs before calling path transformation functions. `resolve()`, `join()`, and `normalize()` always return values — they mask missing inputs."

> "Always use `JSON.stringify()` to interpolate untrusted strings into generated JavaScript. Manual quote escaping is a solved problem — use the solution."

> "After creating any new top-level directory intended for consumers, immediately check `package.json` files."

## Action Items
- [x] Fix electron_connect port parameter (bridge.setPort)
- [x] Fix electron_launch dead guard (validate before resolve)
- [x] Rewrite tests with portable temp file fixtures
- [x] Add skills/ to package.json files
- [x] Fix electron_select_option error message injection
- [x] Remove misleading env var documentation
- [x] Add SIGINT/SIGTERM graceful shutdown
- [x] Create LICENSE file
- [x] Remove private paths from source
- [x] Add .env, *.pem, *.key to .gitignore
- [x] Rename package electron-mcp-sdk → electron-dev-bridge
- [x] Add package.json metadata (keywords, repository, bugs, homepage)
- [x] Add --version and --help CLI flags
- [x] Fix register.ts to check all config names (.ts, .js, .mjs)
- [x] Fix validate.ts dynamic CDP tool count
- [x] Exclude test files from npm package
- [x] Rewrite README in delta-and-beta house style

## Docs Audit Summary

**Files scanned:** 8
**Files updated:** 4

| Area | Files | Updated | Notes |
|------|-------|---------|-------|
| docs/plans | 4 | 4 | All 4 plans marked as Implemented |
| docs/retros | 0 | 0 | Created this session (new directory) |
| CLAUDE.md | — | — | Does not exist; project uses SKILL.md |
| SKILL.md | 1 | 0 | Already updated during session (rename) |
| README.md | 1 | 0 | Already rewritten during session |

## Feature Coverage Audit

**Boundary:** First commit (no previous retro)
**Commits scanned:** 30
**Feature commits:** 14 | **Fix:** 3 | **Docs:** 8 | **Refactor:** 2 | **Test:** 1 | **Other:** 2

This is an open-source SDK — no user story framework applies. All features were implemented per the design and implementation plans in `docs/plans/`. Coverage is tracked via plan task completion, not story-based acceptance criteria.

| # | Commit | Type | Description | Plan Coverage |
|---|--------|------|-------------|---------------|
| 1 | `9b8614f` | feat | MCP server skeleton | Implementation plan task 1 |
| 2 | `8706f29` | feat | 22 CDP tools | Implementation plan tasks 2-7 |
| 3 | `ef22925` | feat | Preload script | Implementation plan task 8 |
| 4 | `e3f1f34` | feat | Screenshot-diff CLI | Implementation plan task 9 |
| 5 | `8883d7a` | feat | SDK package scaffold | SDK plan task 1 |
| 6 | `fd4a8a0` | feat | defineConfig API + types | SDK plan task 2 |
| 7 | `668bc8e` | feat | CDP bridge with retry | SDK plan task 3 |
| 8 | `6b9b5ac` | feat | Tool builder + Zod | SDK plan task 4 |
| 9 | `d5e99be` | feat | Resource builder | SDK plan task 5 |
| 10 | `cf3abd0` | feat | Port 22 CDP tools | SDK plan task 6 |
| 11 | `39b0733` | feat | MCP server with routing | SDK plan task 7 |
| 12 | `637db23` | feat | CLI serve command | SDK plan task 8 |
| 13 | `75c9931` | feat | init command + scanners | SDK plan task 9 |
| 14 | `99b355b` | feat | register command | SDK plan task 10 |
| 15 | `692fdf7` | feat | validate command | SDK plan task 11 |
| 16 | `963dfad` | docs | Sample skills | **No plan** — added during this session |
| 17 | `9e95b02` | fix | Production fixes | **No plan** — production scan findings |
| 18 | `48a0946` | fix | Rename, LICENSE, tests | **No plan** — production scan findings |
| 19 | `53b1e07` | security | Remove paths, harden | **No plan** — security scan findings |

**Note:** Commits 16-19 are from this session and represent publish-readiness work not covered by the original plans. This is expected — plans cover feature implementation, not production hardening.
