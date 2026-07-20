<script lang="ts">
  import type { DebugController, DebugStatsSnapshot } from '../DebugController'
  import { DebugSection, DebugRow, ToggleButton } from '../ui'
  import { fmtPair } from './format'

  interface Props {
    debug: DebugController
    stats: DebugStatsSnapshot
    /** Live toggle state mirrored by the hub (for the pointer-overlay button). */
    pointerOverlay: boolean
  }

  const { debug, stats, pointerOverlay }: Props = $props()

  let controlsOpen = $state(true)
  let coordsOpen = $state(true)
  let pointersOpen = $state(true)
</script>

<DebugSection title="Controls" bind:open={controlsOpen}>
  <div class="debug-controls">
    <ToggleButton
      active={pointerOverlay}
      onToggle={() => debug.togglePointerOverlay()}
      label="Pointer overlay"
      hint="T"
    />
  </div>
</DebugSection>

<DebugSection title="Coordinates" bind:open={coordsOpen}>
  <DebugRow label="Pointer (px)" value={fmtPair(stats.pointerScreen)} />
  <DebugRow
    label="Pointer (world)"
    value={fmtPair(stats.pointerWorld)}
    tone="accent"
  />
  <DebugRow
    label="Canvas CSS"
    value={`${stats.canvasCss.w.toFixed(0)} × ${stats.canvasCss.h.toFixed(0)}`}
  />
  <DebugRow
    label="Canvas device"
    value={`${stats.canvasDevice.w} × ${stats.canvasDevice.h}`}
  />
  <DebugRow label="DPR" value={stats.dpr.toFixed(2)} />
</DebugSection>

<DebugSection
  title={`Pointers (${stats.activePointers.length})`}
  bind:open={pointersOpen}
>
  {#if !stats.activeHasInput}
    <div class="scope-hint">
      No input on this stage, attach it with <code>interactive: true</code> to receive
      pointer events here.
    </div>
  {:else if stats.activePointers.length === 0}
    <div class="empty-state">No active pointers</div>
  {:else}
    {#each stats.activePointers as p (p.id)}
      <div class="pointer-item">
        <div class="pointer-item__head">
          <span class="pointer-item__id">#{p.id}</span>
          <span class="pointer-item__kind">{p.kind}</span>
          {#if p.capturedByNodeId}
            <span class="pointer-item__cap">→ {p.capturedByNodeId}</span>
          {/if}
        </div>
        <DebugRow label="screen" value={fmtPair(p.screen)} />
        <DebugRow label="world" value={fmtPair(p.world)} tone="accent" />
      </div>
    {/each}
  {/if}
  <DebugRow
    label="slop"
    value={`${stats.touchSlopScreen.toFixed(0)}px / ${stats.touchSlopWorld.toFixed(2)}w`}
  />
</DebugSection>

<style lang="sass">
  .pointer-item
    padding: 4px 0
    border-top: 1px solid rgba(255, 255, 255, 0.05)

    &:first-child
      border-top: none

  .pointer-item__head
    display: flex
    gap: 6px
    align-items: baseline

  .pointer-item__id
    font-weight: 600
    color: #60a5fa

  .pointer-item__kind
    color: rgba(255, 255, 255, 0.5)
    text-transform: uppercase
    font-size: 9px

  .pointer-item__cap
    color: #c084fc
    font-size: 10px
    margin-left: auto
    overflow: hidden
    text-overflow: ellipsis

  .scope-hint
    padding: 6px 8px
    font-size: 10px
    color: rgba(255, 255, 255, 0.55)
    font-style: italic
</style>
