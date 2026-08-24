/**
 * Public entry points for Buffer Overflow's engine layer. The Svelte component
 * builds sessions, scenes and input through these, so the stable import path
 * stays put as the internals move around.
 *
 * Deliberately only what the component needs. The pure rule modules are
 * imported directly wherever something else wants them, which keeps this from
 * becoming a second copy of every module's surface.
 */
export { Session } from './session'
export type { LockResult, SessionEvents, SessionState } from './session'
export { Match } from './match'
export type { MatchEvents, SeatResult } from './match'
export { bindBufferGestures } from './input'
export { computeControlRects, computeLayout } from './layout'
export type { Chrome, ControlId, Layout, SeatGeometry } from './layout'
export { COLS, VISIBLE_ROWS, VISIBLE_TOP } from './board'
export { pieceCells } from './pieces'
export { BufferNode } from './nodes/BufferNode'
export { PieceLayerNode } from './nodes/PieceLayerNode'
export { BannerNode } from './nodes/BannerNode'
export { ClearBurstNode } from './nodes/ClearBurstNode'
export { ControlClusterNode } from './nodes/ControlClusterNode'
export { ClockNode, HoldPanelNode, NextQueueNode } from './nodes/PanelNodes'
export { StatBadgeNode } from './nodes/StatBadgeNode'
export { HoldButtonNode } from './nodes/HoldButtonNode'
export { PaneNode } from './nodes/PaneNode'
export { EventLogNode } from './nodes/EventLogNode'
export { AddressGutterNode } from './nodes/AddressGutterNode'
export { HeaderBarNode, StatusBarNode } from './nodes/BarNodes'
export { ScanlineNode } from './nodes/ScanlineNode'
export { TelemetryPaneNode } from './nodes/TelemetryPaneNode'
export { GraphPaneNode } from './nodes/GraphPaneNode'
export { PauseCapNode } from './nodes/PauseCapNode'
export { FLUSH_LINES } from './scoring'
export { LINES_PER_LEVEL } from './gravity'
export { DAS } from './tuning'
export { accentForLevel, ACCENT_VS, ANIM, COLORS, GRADIENT } from './tuning'
export type { Action, Bounds, GameMode, ModeKind, PlayerId } from './types'
