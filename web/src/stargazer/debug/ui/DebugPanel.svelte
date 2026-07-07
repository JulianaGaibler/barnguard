<script lang="ts">
  // Thin wrapper around `DraggableWindow` that preserves the pre-refactor
  // API used by the stargazer debug HUD (visible / side / title / onClose)
  // and its `stargazer-debug-panel-*` localStorage key so existing operator
  // window positions carry over.
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
