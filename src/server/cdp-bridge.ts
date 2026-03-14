import CDP from 'chrome-remote-interface'

export class CdpBridge {
  private client: CDP.Client | null = null
  private port: number

  constructor(port: number = 9229) {
    this.port = port
  }

  get connected(): boolean {
    return this.client !== null
  }

  setPort(port: number): void {
    this.port = port
  }

  async connect(maxRetries = 10): Promise<void> {
    if (this.client) return

    let lastError: Error | undefined

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const targets = await CDP.List({ port: this.port })
        const page = targets.find((t: any) =>
          t.type === 'page' && !t.url.startsWith('devtools://')
        )
        if (!page) throw new Error('No page target found among CDP targets')

        this.client = await CDP({ target: page, port: this.port })
        await Promise.all([
          this.client.Runtime.enable(),
          this.client.DOM.enable(),
          this.client.Page.enable(),
          this.client.Network.enable(),
        ])

        this.client.on('disconnect', () => {
          this.client = null
          // Attempt one auto-reconnect after a brief delay (covers HMR/reload)
          setTimeout(() => {
            if (!this.client) {
              this.connect(1).catch(() => {
                // Reconnect failed — client stays null, tools will prompt to reconnect
              })
            }
          }, 1000)
        })
        return
      } catch (err) {
        lastError = err as Error
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 300))
        }
      }
    }

    throw new Error(
      `Cannot connect to Electron app on port ${this.port} after ${maxRetries} attempts. ` +
      `Is the app running with --remote-debugging-port=${this.port}? ` +
      `(${lastError?.message})`
    )
  }

  ensureConnected(): void {
    if (!this.client) {
      throw new Error(
        'Not connected to an Electron app. ' +
        'Start the app with --remote-debugging-port and use the connect tool first.'
      )
    }
  }

  async evaluate(expression: string, awaitPromise = true): Promise<any> {
    this.ensureConnected()

    const { result, exceptionDetails } = await this.client!.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise,
    })

    if (exceptionDetails) {
      const errText =
        exceptionDetails.exception?.description ||
        exceptionDetails.text ||
        'Unknown evaluation error'
      throw new Error(`JS evaluation error: ${errText}`)
    }

    return result.value
  }

  getRawClient(): any {
    this.ensureConnected()
    return this.client!
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
    }
  }
}
