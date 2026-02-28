import { readFileSync } from 'node:fs'

export interface DetectedSchema {
  name: string
  line: number
  file: string
}

export function scanForSchemas(filePath: string): DetectedSchema[] {
  const content = readFileSync(filePath, 'utf-8')
  const schemas: DetectedSchema[] = []
  const regex = /export\s+const\s+(\w+Schema)\s*=\s*z\./g
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const name = match[1]
    const upToMatch = content.slice(0, match.index)
    const line = upToMatch.split('\n').length
    schemas.push({ name, line, file: filePath })
  }

  return schemas
}
