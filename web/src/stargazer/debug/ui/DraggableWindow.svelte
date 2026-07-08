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
     * Default anchor when no saved position exists. Changing this at runtime
     * (e.g. the booth menu re-opened from the opposite corner) resets any saved
     * position so the new anchor takes effect — the operator's intent "I want
     * this on the OTHER side" wins over their earlier drag.
     */
    side?: 'left' | 'right'
    /** Optional width override in CSS px. Default comes from debug-ui.sass. */
    width?: number
    /**
     * StorageId of the parent window that spawned this one. When the window
     * first becomes visible with no saved position, it's auto-placed adjacent
     * to that parent (via `placeNextTo`) so operator flows like "open booth →
     * open printer" don't stack windows in the same corner. Once dragged or
     * resized, the saved position wins and this is ignored — the seed only
     * applies to first-open. Leave undefined for windows that spawn standalone
     * (e.g. the booth menu itself).
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

  // On every open, seed a position if we don't already have one. This
  // covers three sources, in order:
  //   1. `spawnedBy` — auto-place adjacent to the named parent window.
  //      `placeNextTo` writes to localStorage; the read below picks it up.
  //   2. `localStorage` — the operator's previously-dragged position, if
  //      any. Wins over the spawnedBy seed by virtue of `placeNextTo`
  //      no-op'ing when a saved position already exists.
  //   3. Fallback — no position set; the side-based CSS anchor
  //      (`left: 10px` / `right: 10px`) takes over.
  // Merging (1) and (2) into a single effect matters: `placeNextTo` must
  // land its write BEFORE the storage read runs, otherwise we'd see stale
  // "empty" storage on the first open after a fresh spawn.
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
