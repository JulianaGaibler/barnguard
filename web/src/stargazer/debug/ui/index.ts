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
export { default as ToggleButton } from './ToggleButton.svelte'
export { default as HoldButton } from './HoldButton.svelte'
export { default as StageSelector } from './StageSelector.svelte'
export { default as DebugSelect } from './DebugSelect.svelte'
export type { StageChipOption } from './StageSelector.svelte'
export type { TreeNode } from './DebugTree.svelte'
export type {
  DebugSelectOption,
  DebugSelectDivider,
  DebugSelectItem,
} from './DebugSelect.svelte'
