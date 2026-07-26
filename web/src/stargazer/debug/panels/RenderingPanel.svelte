<script lang="ts">
  import type {
    DebugController,
    DebugStatsSnapshot,
    DebugRenderMode as MeshRenderMode,
  } from '../DebugController'
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
  let threeOpen = $state(true)
  let texturesOpen = $state(false)

  // Render-mode / MSAA / perf-marks are per-stage engine state; mirror the
  // active stage's live values so an external toggle or a stage switch stays in
  // sync. Re-synced each tick (see the `revision` effect below).
  // One render-mode control drives both pipelines: the 2D batch modes
  // (`DebugRenderMode`, GpuGfx) and the 3D mesh views (`MeshRenderMode`,
  // DebugController). Only one is active at a time; picking one resets the
  // other to `normal`. `'normal'` is shared.
  type CombinedRenderMode = DebugRenderMode | Exclude<MeshRenderMode, 'normal'>
  let renderMode = $state<CombinedRenderMode>('normal')
  let msaaSamples = $state<number>(4)
  let perfMarks = $state(false)
  let fpsCap = $state(0)
  let smoothTimestep = $state(true)

  const RENDER_MODE_OPTIONS_2D: readonly DebugSelectOption<CombinedRenderMode>[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'polygons', label: '2D polygon outlines' },
    { value: 'overdraw', label: '2D overdraw heatmap' },
    { value: 'batch-color', label: '2D batch coloring' },
    { value: 'clip-mask', label: '2D clip mask' },
  ]
  const RENDER_MODE_OPTIONS_3D: readonly DebugSelectOption<CombinedRenderMode>[] = [
    { value: 'wireframe', label: '3D wireframe' },
    { value: 'unshaded', label: '3D unshaded (albedo)' },
    { value: 'normals', label: '3D normals' },
  ]
  // 3D views only offered when the scene has 3D content.
  const renderModeOptions = $derived(
    stats.world3d
      ? [...RENDER_MODE_OPTIONS_2D, ...RENDER_MODE_OPTIONS_3D]
      : RENDER_MODE_OPTIONS_2D,
  )
  const MESH_MODES = new Set<CombinedRenderMode>(['wireframe', 'unshaded', 'normals'])

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
    // The 3D mesh view wins the dropdown when non-normal, else the 2D mode.
    const live3d = debug.renderMode
    const live2d = active.getDebugRenderMode()
    const liveMode: CombinedRenderMode = live3d !== 'normal' ? live3d : live2d
    if (liveMode !== renderMode) renderMode = liveMode
    const liveSamples = active.getMsaaSamples()
    if (liveSamples !== msaaSamples) msaaSamples = liveSamples
    if (debug.perfMarks !== perfMarks) perfMarks = debug.perfMarks
    const liveCap = Math.round(debug.maxFps)
    if (liveCap !== fpsCap) fpsCap = liveCap
    if (debug.smoothTimestep !== smoothTimestep)
      smoothTimestep = debug.smoothTimestep
  })

  function handleRenderModeChange(mode: CombinedRenderMode): void {
    renderMode = mode
    if (MESH_MODES.has(mode)) {
      // A 3D mesh view; leave the 2D pipeline normal.
      debug.setRenderMode(mode as MeshRenderMode)
      debug.activeStage.setDebugRenderMode('normal')
    } else {
      // A 2D batch mode (or 'normal'); leave the 3D pass normal.
      debug.activeStage.setDebugRenderMode(mode as DebugRenderMode)
      debug.setRenderMode('normal')
    }
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
      options={renderModeOptions}
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

{#if stats.world3d}
  <DebugSection title="3D" bind:open={threeOpen}>
    <DebugRow label="Nodes" value={stats.world3d.nodeCount} />
    <DebugRow label="Meshes" value={stats.world3d.meshCount} />
    {#if stats.world3d.rttSurfaces > 0}
      <DebugRow label="RTT surfaces" value={stats.world3d.rttSurfaces} />
    {/if}
    <DebugRow label="Draw calls / frame" value={stats.world3d.drawCalls} />
    <DebugRow label="Visible / frame" value={stats.world3d.visible} />
    <DebugRow label="Triangles" value={stats.world3d.triangleCount} />
  </DebugSection>
{/if}

<DebugSection title="Textures" bind:open={texturesOpen}>
  <TextureInspector {debug} open={texturesOpen} {revision} />
</DebugSection>
