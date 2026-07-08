<script lang="ts">
  // Generic draggable window shell. Header drag, viewport clamping,
  // per-window localStorage position. `storageId` is both the storage key
  // and the identifier used by `placeNextTo(parent, child)`. Namespacing
  // is caller-owned.

  import type { Snippet } from 'svelte'
  import { onMount } from 'svelte'
  import {
    placeNextTo,
    registerWindow,
    resetChildrenOf,
    unregisterWindow,
  } from '@src/lib/window/spawn'

  interface Props {
    visible: boolean
    title: string
    storageId: string
    /**
     * Default anchor when no saved position exists. Changing at runtime
     * resets the saved position so "open on the other side" wins over an
     * earlier drag.
     */
    side?: 'left' | 'right'
    /** Optional width override in CSS px. Default comes from debug-ui.sass. */
    width?: number
    /**
     * StorageId of the spawning parent. First open with no saved position
     * auto-places adjacent via `placeNextTo`. Ignored once dragged.
     */
    spawnedBy?: string
    onClose?: () => void
    children: Snippet
  }

  let {
    visible,
    title,
    storageId,
    side = 'left',
    width,
    spawnedBy,
    onClose,
    children,
  }: Props = $props()

  let isDragging = $state(false)
  let dragStartX = 0
  let dragStartY = 0
  let panelElement = $state<HTMLDivElement | undefined>(undefined)
  let position = $state<{ x: number; y: number } | null>(null)
  // Timestamp of the most recent open. The close button ignores clicks that
  // land within CLOSE_COOLDOWN_MS of open so a stray double-tap (e.g. the
  // corner-tap gesture that opened the booth menu, or a fast toggle from a
  // parent window) can't immediately close what it just opened. Kept
  // invisible to the operator — no disabled styling or countdown; the
  // window simply behaves as if the first tap didn't happen.
  const CLOSE_COOLDOWN_MS = 250
  let openedAtMs = 0

  $effect(() => {
    if (visible) openedAtMs = performance.now()
  })

  // Local reset — clears both the persisted position and the in-memory
  // copy so the next reactive tick re-seeds from `side` / `spawnedBy`. Also
  // invoked by the registry when a parent window re-anchors (cascade
  // reset), so a stale "printer at old-booth-position" doesn't survive
  // moving the booth menu to the other side.
  function resetPosition(): void {
    localStorage.removeItem(storageId)
    position = null
  }

  // Reset saved position when the caller explicitly re-anchors us to a new
  // side (e.g. booth menu double-tapped from the opposite corner). Also
  // resets any child windows that declared us as their `spawnedBy` — their
  // previously-seeded positions were relative to our OLD anchor, so
  // they'd otherwise stay where they were, disconnected from us.
  // Non-reactive `prevSide` avoids re-triggering this effect on its own.
  let prevSide: 'left' | 'right' | undefined
  $effect(() => {
    if (prevSide !== undefined && prevSide !== side) {
      resetPosition()
      resetChildrenOf(storageId)
    }
    prevSide = side
  })

  // Seed position on open. Order: spawnedBy (auto-place, writes storage)
  // → localStorage (previous drag, wins because placeNextTo no-ops when
  // storage already has a value) → CSS `side` fallback. `placeNextTo` and
  // the storage read live in one effect so the write lands first.
  $effect(() => {
    if (!visible) return
    if (position !== null) return
    if (spawnedBy) {
      placeNextTo(spawnedBy, storageId, { childWidth: width })
    }
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
    registerWindow(
      storageId,
      () => panelElement?.getBoundingClientRect() ?? null,
      resetPosition,
      spawnedBy,
    )
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
    // Swallow taps that arrive too soon after open. See CLOSE_COOLDOWN_MS.
    if (performance.now() - openedAtMs < CLOSE_COOLDOWN_MS) return
    resetPosition()
    // Deliberately do NOT reset children here — closing the parent doesn't
    // move it, so a child spawned next to it is still in the right place
    // relative to where the parent WILL reappear. Also: at this point the
    // parent's panel element is about to unmount, so `placeNextTo` would
    // fail to measure it and the child would fall back to its default CSS
    // anchor (jumping across the screen). The cascade only fires on
    // actual re-anchoring (see the `side`-change effect above).
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
