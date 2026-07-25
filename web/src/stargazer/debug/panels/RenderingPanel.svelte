<script lang="ts">
  import type { DebugController, DebugStatsSnapshot } from '../DebugController'
  import type { DebugRenderMode } from '../../render/gfx/GpuGfx'
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
    if (liveMode !== renderMode) renderMode = liveMode
    const liveSamples = active.getMsaaSamples()
    if (liveSamples !== msaaSamples) msaaSamples = liveSamples
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
</script>

<DebugSection title="Rendering" bind:open={renderOpen}>
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
    <ToggleButton
      active={perfMarks}
      onToggle={handlePerfMarksToggle}
      label="Perf marks (User Timing)"
    />
  </div>

  <DebugRow label="Draw calls / frame" value={stats.gpu.drawCalls} />
  <DebugRow label="Program switches" value={stats.gpu.programSwitches} />
  <DebugRow label="Texture binds" value={stats.gpu.textureBinds} />
  <DebugRow label="Blend switches" value={stats.gpu.blendSwitches} />
  <DebugRow label="SDF instances" value={stats.gpu.sdfInstances} />
  <DebugRow label="Stroke instances" value={stats.gpu.strokeInstances} />
  <DebugRow
    label="Round-rect instances"
    value={stats.gpu.roundRectInstances}
  />
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
</DebugSection>

<DebugSection title="Textures" bind:open={texturesOpen}>
  <TextureInspector {debug} open={texturesOpen} {revision} />
</DebugSection>
