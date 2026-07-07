import type { EngineHost } from '../engine/EngineHost'

export interface DemoContext {
  canvas: HTMLCanvasElement
  signal: AbortSignal
  /**
   * Optional: report the created `EngineHost` back to the DemoRouter so it can
   * mount the debug HUD if `host.debug !== null`. Demos should call this as
   * soon as their `createEngineHost(...)` returns.
   */
  attach?: (host: EngineHost) => void
}

export type DemoCleanup = void | (() => void)
export type DemoFn = (ctx: DemoContext) => DemoCleanup | Promise<DemoCleanup>
