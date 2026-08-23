<script lang="ts">
  // Thin wrapper around `DraggableWindow` exposing the smaller prop set used
  // by the stargazer debug HUD (visible / side / title / onClose). The
  // `stargazer-debug-panel-*` localStorage key is derived from the title so
  // each panel's window position persists independently.
  import type { Snippet } from 'svelte'
  import DraggableWindow from './DraggableWindow.svelte'

  interface Props {
    visible: boolean
    side: 'left' | 'right'
    title: string
    children: Snippet
    onClose?: () => void
  }

  let { visible, side, title, children, onClose }: Props = $props()

  const storageId = $derived(
    `stargazer-debug-panel-${title.toLowerCase().replace(/\s+/g, '-')}`,
  )
</script>

<DraggableWindow {visible} {title} {side} {storageId} {onClose}>
  {@render children()}
</DraggableWindow>
