import type { AppConfig, ScreenshotConfig } from '../index.js'
import type { CdpBridge } from '../server/cdp-bridge.js'
import type { CdpTool, ToolContext } from './types.js'

import { createBatchTools } from './batch.js'
import { createDevtoolsTools } from './devtools.js'
import { createDomQueryTools } from './dom-query.js'
import { createInteractionTools } from './interaction.js'
import { createLifecycleTools } from './lifecycle.js'
import { createNavigationTools } from './navigation.js'
import { createStateTools } from './state.js'
import { createVisualTools } from './visual.js'

export type { CdpTool, CdpToolDefinition } from './types.js'

export function getCdpTools(
  bridge: CdpBridge,
  appConfig: AppConfig,
  screenshotConfig?: ScreenshotConfig,
): CdpTool[] {
  const ctx: ToolContext = {
    bridge,
    appConfig,
    screenshotDir: screenshotConfig?.dir || '.screenshots',
    screenshotFormat: screenshotConfig?.format || 'png',
    state: {
      screenshotCounter: 0,
      electronProcess: null,
      devtoolsStore: null,
      mainProcessLogs: [],
    },
  }

  return [
    ...createLifecycleTools(ctx),
    ...createDomQueryTools(ctx),
    ...createInteractionTools(ctx),
    ...createStateTools(ctx),
    ...createNavigationTools(ctx),
    ...createVisualTools(ctx),
    ...createDevtoolsTools(ctx),
    ...createBatchTools(ctx),
  ]
}
