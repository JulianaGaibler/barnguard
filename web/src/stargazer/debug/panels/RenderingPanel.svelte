<script lang="ts">
  import type { DebugController, DebugStatsSnapshot } from '../DebugController'
  import type { DebugRenderMode } from '../../render/gfx/gpu/GpuGfx'
  import {
    DebugSection,
    DebugRow,
    DebugSelect,
    ToggleButton,
    TextureInspector,
    type DebugSelectOption,
  } from '../ui'

  interface Props {
    debug: DebugController
    stats: DebugStatsSnapshot
    /** Bumped by the hub's rAF tick; drives the live-state re-sync + previews. */
    revision: number
  }

  const { debug, stats, revision }: Props = $props()

  let renderOpen = $state(true)
  let gpuOpen = $state(true)
  let texturesOpen = $state(false)

  // Render-mode / MSAA / perf-marks are per-stage engine state; mirror the
  // active stage's live values so an external toggle or a stage switch stays in
  // sync. Re-synced each tick (see the `revision` effect below).
  let renderMode = $state<DebugRenderMode>('normal')
  let msaaSamples = $state<number>(4)
  let perfMarks = $state(false)
  let fpsCap = $state(0)
  let smoothTimestep = $state(true)

  const RENDER_MODE_OPTIONS: readonly DebugSelectOption<DebugRenderMode>[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'polygons', label: 'Polygon outlines' },
    { value: 'overdraw', label: 'Overdraw heatmap' },
    { value: 'batch-color', label: 'Batch coloring' },
    { value: 'clip-mask', label: 'Show clip mask' },
  ]

  const MSAA_OPTIONS: readonly DebugSelectOption<number>[] = [
    { value: 0, label: 'Off (1×)' },
    { value: 2, label: '2×' },
    { value: 4, label: '4×' },
    { value: 8, label: '8×' },
  ]

  const FPS_CAP_OPTIONS: readonly DebugSelectOption<number>[] = [
    { value: 0, label: 'Uncapped' },
    { value: 30, label: '30' },
    { value: 60, label: '60' },
    { value: 90, label: '90' },
    { value: 120, label: '120' },
    { value: 144, label: '144' },
  ]

  $effect(() => {
    void revision
    const active = debug.activeStage
    const liveMode = active.getDebugRenderMode()
    if (liveMode !== null && liveMode !== renderMode) renderMode = liveMode
    const liveSamples = active.getMsaaSamples()
    if (liveSamples !== null && liveSamples !== msaaSamples)
      msaaSamples = liveSamples
    if (debug.perfMarks !== perfMarks) perfMarks = debug.perfMarks
    const liveCap = Math.round(debug.maxFps)
    if (liveCap !== fpsCap) fpsCap = liveCap
    if (debug.smoothTimestep !== smoothTimestep)
      smoothTimestep = debug.smoothTimestep
  })

  function handleRenderModeChange(mode: DebugRenderMode): void {
    renderMode = mode
    debug.activeStage.setDebugRenderMode(mode)
  }

  function handleMsaaChange(samples: number): void {
    msaaSamples = samples
    debug.activeStage.setMsaaSamples(samples)
  }

  function handlePerfMarksToggle(): void {
    debug.setPerfMarks(!perfMarks)
    perfMarks = debug.perfMarks
  }

  function handleFpsCapChange(v: number): void {
    fpsCap = v
    debug.setMaxFps(v)
  }

  function handleSmoothTimestepToggle(): void {
    debug.setSmoothTimestep(!smoothTimestep)
    smoothTimestep = debug.smoothTimestep
  }

  function reloadWithRenderer(mode: 'canvas2d' | 'gpu'): void {
    const url = new URL(window.location.href)
    url.searchParams.set('renderer', mode)
    window.location.href = url.toString()
  }

  function noFocus(e: PointerEvent): void {
    e.preventDefault()
  }
</script>

<DebugSection title="Rendering" bind:open={renderOpen}>
  <DebugRow
    label="Render scale"
    value={`${(stats.renderScale * 100).toFixed(0)}%`}
    tone={stats.renderScale < 1 ? 'accent' : 'default'}
  />
  <DebugRow
    label="Active bitmaps"
    value={stats.activeBitmaps}
    tone={stats.activeBitmaps > 2 ? 'error' : 'default'}
  />
  <div class="debug-controls">
    <DebugSelect
      label="FPS cap"
      value={fpsCap}
      options={FPS_CAP_OPTIONS}
      onChange={handleFpsCapChange}
    />
    <ToggleButton
      active={smoothTimestep}
      onToggle={handleSmoothTimestepToggle}
      label="Smooth timestep (timer-jitter filter)"
    />
  </div>
</DebugSection>

<DebugSection title="GPU" bind:open={gpuOpen}>
  <!-- Controls first (the operator's primary use), read-only stats below. -->
  <div class="debug-controls with-divider">
    {#if stats.gpu}
      <DebugSelect
        label="Render mode"
        value={renderMode}
        options={RENDER_MODE_OPTIONS}
        onChange={handleRenderModeChange}
      />
      <DebugSelect
        label="MSAA"
        value={msaaSamples}
        options={MSAA_OPTIONS}
        onChange={handleMsaaChange}
      />
    {/if}
    <ToggleButton
      active={perfMarks}
      onToggle={handlePerfMarksToggle}
      label="Perf marks (User Timing)"
    />
    <div class="renderer-swap">
      <span class="rs-label">Reload as</span>
      <button
        type="button"
        class="rs-btn"
        class:active={!stats.gpu}
        onpointerdown={noFocus}
        onclick={() => reloadWithRenderer('canvas2d')}
      >
        canvas2d
      </button>
      <button
        type="button"
        class="rs-btn"
        class:active={stats.gpu !== null}
        onpointerdown={noFocus}
        onclick={() => reloadWithRenderer('gpu')}
      >
        gpu
      </button>
    </div>
  </div>

  {#if stats.gpu}
    <DebugRow label="Draw calls / frame" value={stats.gpu.drawCalls} />
    <DebugRow label="Program switches" value={stats.gpu.programSwitches} />
    <DebugRow label="Texture binds" value={stats.gpu.textureBinds} />
    <DebugRow label="Blend switches" value={stats.gpu.blendSwitches} />
    <DebugRow label="SDF instances" value={stats.gpu.sdfInstances} />
    <DebugRow label="Stroke instances" value={stats.gpu.strokeInstances} />
    <DebugRow
      label="MSAA"
      value={stats.gpu.msaaSamples > 1 ? `${stats.gpu.msaaSamples}×` : 'off'}
      tone={stats.gpu.msaaSamples > 1 ? 'accent' : 'default'}
    />
    <DebugRow
      label="Overflow warns"
      value={stats.gpu.overflowWarns}
      tone={stats.gpu.overflowWarns > 0 ? 'error' : 'default'}
    />
  {:else}
    <DebugRow label="Backend" value="Canvas 2D" tone="accent" />
  {/if}
</DebugSection>

<DebugSection title="Textures" bind:open={texturesOpen}>
  <TextureInspector {debug} open={texturesOpen} {revision} />
</DebugSection>

<style lang="sass">
  .renderer-swap
    display: flex
    align-items: center
    gap: 6px
    padding: 6px 8px
    background: rgba(255, 255, 255, 0.03)
    border: 1px solid rgba(255, 255, 255, 0.12)
    border-radius: 4px

  .rs-label
    font-size: 11px
    color: rgba(255, 255, 255, 0.65)
    flex: 1

  .rs-btn
    background: rgba(255, 255, 255, 0.05)
    border: 1px solid rgba(255, 255, 255, 0.2)
    color: #fff
    font: inherit
    font-size: 10px
    padding: 3px 8px
    border-radius: 3px
    cursor: pointer
    touch-action: manipulation

    &:hover
      background: rgba(255, 255, 255, 0.12)
      border-color: rgba(255, 255, 255, 0.35)

    &.active
      background: rgba(96, 165, 250, 0.2)
      border-color: rgba(96, 165, 250, 0.55)
      color: #dbeafe
</style>
