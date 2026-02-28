import { readFileSync } from 'node:fs'

export interface DetectedHandler {
  channel: string
  line: number
  file: string
}

export function scanForHandlers(filePath: string): DetectedHandler[] {
  const content = readFileSync(filePath, 'utf-8')
  const handlers: DetectedHandler[] = []
  const regex = /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const channel = match[1]
    const upToMatch = content.slice(0, match.index)
    const line = upToMatch.split('\n').length
    handlers.push({ channel, line, file: filePath })
  }

  return handlers
}
