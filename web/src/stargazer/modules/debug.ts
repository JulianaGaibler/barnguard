/**
 * Debugging tools. The controller is always constructed, and `?debug` only
 * decides whether the HUD starts open, so a menu can toggle it at runtime.
 * {@link DebugController} owns the HUD state, hotkeys, stats snapshot, and the
 * on-canvas overlays (grid, node outlines, pointer markers). {@link DebugCamera}
 * is a free-fly camera for inspecting a stage, and {@link FrameStats} is the
 * frame-time ring buffer behind the perf readout. {@link DebugRenderMode}
 * selects a GPU visualization (overdraw, batch coloring, clip mask).
 *
 * @module debug
 */
export { DebugController } from '../debug/DebugController'
export type {
  DebugEvents,
  DebugToggleState,
  DebugStatsSnapshot,
  DebugControllerOptions,
  DebugPanelSpec,
  ActivePointerReadout,
  StageChip,
  DebugGpuStatsReadout,
  PhysicsWorldReadout,
} from '../debug/DebugController'
export type { PhysicsOverlayFlags } from '../debug/DebugPhysicsRenderer'
export type { DebugRenderMode } from '../render/gfx/GpuGfx'
export { DebugCamera } from '../debug/DebugCamera'
export { FrameStats } from '../debug/FrameStats'
