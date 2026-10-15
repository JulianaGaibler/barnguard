// Shared debug UI primitives. Reused across every engine debug HUD so the
// visual language stays consistent. Adapted from
// `mozilla/fx-retro/src/components/debugui/`.

export { default as DebugPanel } from './DebugPanel.svelte'
export { default as DraggableWindow } from './DraggableWindow.svelte'
export { default as DebugSection } from './DebugSection.svelte'
export { default as DebugRow } from './DebugRow.svelte'
export { default as ProgressBar } from './ProgressBar.svelte'
export { default as DebugTree } from './DebugTree.svelte'
export { default as FrameGraph } from './FrameGraph.svelte'
export { default as TextureInspector } from './TextureInspector.svelte'
export { default as ToggleButton } from './ToggleButton.svelte'
export { default as DebugToggleGroup } from './DebugToggleGroup.svelte'
export { default as HoldButton } from './HoldButton.svelte'
export { default as StageSelector } from './StageSelector.svelte'
export { default as DebugSelect } from './DebugSelect.svelte'
export { default as DebugSlider } from './DebugSlider.svelte'
export { default as StatCard } from './StatCard.svelte'
export { default as StatGrid } from './StatGrid.svelte'
export { default as Gauge } from './Gauge.svelte'
export { default as MetricRow } from './MetricRow.svelte'
export { default as Sparkline } from './Sparkline.svelte'
export { default as Pill } from './Pill.svelte'
export { default as HealthChip } from './HealthChip.svelte'
export { default as QualityKnob } from './QualityKnob.svelte'
export { default as Tooltip } from './Tooltip.svelte'
export type { TipSpec, TipScale, TipTable } from './tip'
export type { KnobOption, KnobImpact } from './QualityKnob.svelte'
export type { StageChipOption } from './StageSelector.svelte'
export type { TreeNode } from './DebugTree.svelte'
export type {
  DebugSelectOption,
  DebugSelectDivider,
  DebugSelectItem,
} from './DebugSelect.svelte'
