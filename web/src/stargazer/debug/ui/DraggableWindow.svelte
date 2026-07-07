<script lang="ts">
  // Generic draggable window shell used by the stargazer debug HUD and by the
  // booth-side kiosk panels (booth menu, printer panel, and future score
  // panel). Handles pointer-drag on the header, viewport clamping, and
  // per-window position persistence in localStorage. Contents are supplied
  // as a Snippet so callers compose their own inner structure — typically a
  // stack of `<DebugSection>` collapsibles.
  //
  // The `storageId` prop is BOTH the localStorage key and the identifier
  // callers pass to `placeNextTo(parent, child)` when one window spawns
  // another. Namespacing is caller-owned (e.g. `stargazer-debug-panel-*` for
  // debug HUD windows, `barnguard-window-*` for booth-side panels), which
  // preserves existing saved positions when refactoring.

  import type { Snippet } from 'svelte'
  import { onMount } from 'svelte'
  import { registerWindow, unregisterWindow } from '@src/lib/window/spawn'

  interface Props {
    visible: boolean
    title: string
    storageId: string
    /** Default anchor when no saved position exists. Ignored once dragged. */
    side?: 'left' | 'right'
    /** Optional width override in CSS px. Default comes from debug-ui.sass. */
    width?: number
    onClose?: () => void
    children: Snippet
  }

  let {
    visible,
    title,
    storageId,
    side = 'left',
    width,
    onClose,
    children,
  }: Props = $props()

  let isDragging = $state(false)
  let dragStartX = 0
  let dragStartY = 0
  let panelElement = $state<HTMLDivElement | undefined>(undefined)
  let position = $state<{ x: number; y: number } | null>(null)

  // Load the saved position each time the window becomes visible (not just
  // on mount). This matters when another window seeds a position via
  // `placeNextTo` — that write may land AFTER our first mount, so a plain
  // onMount read would miss it. Once `position` is set in memory it wins
  // over storage until the operator closes (which clears both).
  $effect(() => {
    if (!visible) return
    if (position !== null) return
    const saved = localStorage.getItem(storageId)
    if (saved) {
      try {
        position = JSON.parse(saved)
      } catch {
        // ignore bad JSON
      }
    }
  })

  onMount(() => {
    const handleResize = (): void => {
      if (!position || !panelElement) return
      const padding = 10
      const maxX = window.innerWidth - panelElement.offsetWidth - padding
      const maxY = window.innerHeight - panelElement.offsetHeight - padding
      const needsAdjustment =
        position.x > maxX ||
        position.y > maxY ||
        position.x < padding ||
        position.y < padding
      if (needsAdjustment) {
        const boundedX = Math.max(padding, Math.min(position.x, maxX))
        const boundedY = Math.max(padding, Math.min(position.y, maxY))
        position = { x: boundedX, y: boundedY }
        localStorage.setItem(storageId, JSON.stringify(position))
      }
    }

    window.addEventListener('resize', handleResize)
    registerWindow(storageId, () => panelElement?.getBoundingClientRect() ?? null)
    return () => {
      window.removeEventListener('resize', handleResize)
      unregisterWindow(storageId)
    }
  })

  function handlePointerDown(e: PointerEvent): void {
    if (!panelElement) return
    isDragging = true
    const rect = panelElement.getBoundingClientRect()
    dragStartX = e.clientX - rect.left
    dragStartY = e.clientY - rect.top
    e.preventDefault()
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!isDragging || !panelElement) return
    const x = e.clientX - dragStartX
    const y = e.clientY - dragStartY
    const padding = 10
    const maxX = window.innerWidth - panelElement.offsetWidth - padding
    const maxY = window.innerHeight - panelElement.offsetHeight - padding
    position = {
      x: Math.max(padding, Math.min(x, maxX)),
      y: Math.max(padding, Math.min(y, maxY)),
    }
  }

  function handlePointerUp(): void {
    if (!isDragging) return
    isDragging = false
    if (position) {
      localStorage.setItem(storageId, JSON.stringify(position))
    }
  }

  function handleCloseAndReset(e: Event): void {
    e.stopPropagation()
    localStorage.removeItem(storageId)
    position = null
    onClose?.()
  }
</script>

<svelte:window
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
/>

{#if visible}
  <div
    bind:this={panelElement}
    class="debug-panel {side}"
    class:dragging={isDragging}
    data-draggable-window={storageId}
    style:width={width ? `${width}px` : undefined}
    style:left={position ? `${position.x}px` : undefined}
    style:top={position ? `${position.y}px` : undefined}
    style:right={position ? 'auto' : undefined}
    style:bottom={position ? 'auto' : undefined}
  >
    <!-- Drag handle; pointer events so touch drags too. -->
    <div class="header" role="banner" onpointerdown={handlePointerDown}>
      <span class="title">{title}</span>
      <button
        class="close-button"
        onclick={handleCloseAndReset}
        title="Close and reset position"
        aria-label="Close {title} window"
      >
        ×
      </button>
    </div>

    {@render children()}
  </div>
{/if}
