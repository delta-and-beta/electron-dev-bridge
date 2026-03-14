#!/usr/bin/env node

const VERSION = '0.3.0'

const command = process.argv[2]

switch (command) {
  case 'serve':
  case undefined: {
    const configPath = process.argv[3]
    const { serve } = await import('./serve.js')
    await serve(configPath)
    break
  }
  case 'init': {
    const { init } = await import('./init.js')
    await init()
    break
  }
  case 'register': {
    const { register } = await import('./register.js')
    await register()
    break
  }
  case 'validate': {
    const { validate } = await import('./validate.js')
    await validate()
    break
  }
  case '--version':
  case '-v':
    console.log(VERSION)
    break
  case '--help':
  case '-h':
  case 'help':
  default:
    console.log(`electron-dev-bridge v${VERSION}

Commands:
  serve [config]    Start the MCP server (default)
  init              Scaffold a config file from source code
  register          Register with Claude Code
  validate          Validate config and check readiness

Usage:
  npx electron-mcp serve
  npx electron-mcp init
  npx electron-mcp register
  npx electron-mcp validate`)
    break
}
