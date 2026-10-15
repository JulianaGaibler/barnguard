import { RingSeries } from './RingSeries'
import type { DebugStatsSnapshot } from './DebugController'

/** The readings the HUD keeps a history of, for sparklines. */
export type SeriesId = 'drawCalls' | 'bytesUploaded' | 'primitives' | 'paints'

/**
 * Recent history of the renderer readings that have a sparkline. The hub
 * records one sample per poll while a window is open. Frame time is not here:
 * the frame graph already owns it in {@link FrameStats}, and its sparkline reads
 * that directly.
 */
export class MetricHistory {
  readonly drawCalls = new RingSeries(240)
  readonly bytesUploaded = new RingSeries(240)
  readonly primitives = new RingSeries(240)
  readonly paints = new RingSeries(240)

  record(stats: DebugStatsSnapshot): void {
    this.drawCalls.push(stats.gpu.drawCalls)
    this.bytesUploaded.push(stats.gpu.bytesUploaded)
    this.primitives.push(stats.gpu.primitives)
    this.paints.push(stats.compose.paints)
  }

  clear(): void {
    this.drawCalls.clear()
    this.bytesUploaded.clear()
    this.primitives.clear()
    this.paints.clear()
  }
}
