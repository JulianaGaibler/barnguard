<script lang="ts">
  import type {
    DebugController,
    DebugStatsSnapshot,
    DebugRenderMode as MeshRenderMode,
  } from '../DebugController'
  import type { DebugRenderMode } from '../../render/gfx/GpuGfx'
  import type { BackendPreference } from '../../render/gfx/selectBackend'
  import { SHADOW_SIGMA_BUDGETS } from '../../render/VectorQuality'
  import {
    DebugSection,
    DebugRow,
    DebugSelect,
    DebugSlider,
    ToggleButton,
    DebugToggleGroup,
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

  let backendOpen = $state(true)
  let renderOpen = $state(true)
  let gpuOpen = $state(true)
  let threeOpen = $state(true)
  let vectorOpen = $state(true)
  let texturesOpen = $state(false)

  // Which backend the caller asked for, read from the app's `?gfx` convention.
  // The active backend (`stats.backend`) can differ: `auto` resolves to whatever
  // the device probe picked, and a forced pick that failed to boot falls back.
  function currentBackendPref(): BackendPreference {
    const g = new URLSearchParams(location.search).get('gfx')
    return g === 'webgpu' || g === 'webgl2' ? g : 'auto'
  }
  const backendPref = currentBackendPref()

  const BACKEND_LABELS: Record<'webgpu' | 'webgl2', string> = {
    webgpu: 'WebGPU',
    webgl2: 'WebGL2',
  }
  const BACKEND_PREF_OPTIONS: readonly DebugSelectOption<BackendPreference>[] =
    [
      { value: 'auto', label: 'Auto (prefer WebGPU)' },
      { value: 'webgpu', label: 'WebGPU' },
      { value: 'webgl2', label: 'WebGL2' },
    ]

  // Render-mode / MSAA / perf-marks are per-stage engine state. Mirror the
  // active stage's live values so an external toggle or a stage switch stays in
  // sync. Re-synced each tick (see the `revision` effect below).
  // One render-mode control drives both pipelines: the 2D batch modes
  // (`DebugRenderMode`, GpuGfx) and the 3D mesh views (`MeshRenderMode`,
  // DebugController). Only one is active at a time, and picking one resets the
  // other to `normal`. `'normal'` is shared.
  type CombinedRenderMode = DebugRenderMode | Exclude<MeshRenderMode, 'normal'>
  let renderMode = $state<CombinedRenderMode>('normal')
  let msaaSamples = $state<number>(4)
  let perfMarks = $state(false)
  let fpsCap = $state(0)
  let smoothTimestep = $state(true)
  // 3D quality overrides (engine.quality), mirrored live like the rest.
  let shadowsOn = $state(true)
  let shadowSize = $state(1024)
  let anisotropy = $state(8)
  let shadowSoftness = $state(4)
  // Ambient occlusion (primary stage's controller), mirrored live.
  let aoOn = $state(false)
  let aoPreset = $state<'low' | 'medium' | 'high'>('medium')
  let aoIntensity = $state(1)
  let aoRadius = $state(0.6)
  let aoDirect = $state(0)
  // 2D vector quality (engine.quality.vector), mirrored live like the rest.
  let pathShadowsOn = $state(true)
  let shadowSigmaBudget = $state<number>(SHADOW_SIGMA_BUDGETS[1])
  let analyticShadowFrameOn = $state(true)
  let ditherOn = $state(true)

  const RENDER_MODE_OPTIONS_2D: readonly DebugSelectOption<CombinedRenderMode>[] =
    [
      { value: 'normal', label: 'Normal' },
      { value: 'polygons', label: '2D polygon outlines' },
      { value: 'overdraw', label: '2D overdraw heatmap' },
      { value: 'batch-color', label: '2D batch coloring' },
      { value: 'clip-mask', label: '2D clip mask' },
    ]
  const RENDER_MODE_OPTIONS_3D: readonly DebugSelectOption<CombinedRenderMode>[] =
    [
      { value: 'wireframe', label: '3D wireframe' },
      { value: 'unshaded', label: '3D unshaded (albedo)' },
      { value: 'normals', label: '3D normals' },
      { value: 'ao', label: '3D ambient occlusion (raw)' },
    ]
  // 3D views only offered when the scene has 3D content.
  const renderModeOptions = $derived(
    stats.world3d
      ? [...RENDER_MODE_OPTIONS_2D, ...RENDER_MODE_OPTIONS_3D]
      : RENDER_MODE_OPTIONS_2D,
  )
  const MESH_MODES = new Set<CombinedRenderMode>([
    'wireframe',
    'unshaded',
    'normals',
    'ao',
  ])

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

  const SHADOW_SIZE_OPTIONS: readonly DebugSelectOption<number>[] = [
    { value: 256, label: '256' },
    { value: 512, label: '512' },
    { value: 1024, label: '1024' },
    { value: 2048, label: '2048' },
    { value: 4096, label: '4096' },
  ]
  const ANISO_OPTIONS: readonly DebugSelectOption<number>[] = [
    { value: 1, label: 'Off' },
    { value: 2, label: '2×' },
    { value: 4, label: '4×' },
    { value: 8, label: '8×' },
    { value: 16, label: '16×' },
  ]
  const SOFTNESS_OPTIONS: readonly DebugSelectOption<number>[] = [
    { value: 1, label: 'Hard' },
    { value: 4, label: 'Soft' },
    { value: 9, label: 'Softer' },
    { value: 16, label: 'Softest' },
  ]
  const AO_PRESET_OPTIONS: readonly DebugSelectOption<
    'low' | 'medium' | 'high'
  >[] = [
    { value: 'low', label: 'Low (2×3)' },
    { value: 'medium', label: 'Medium (3×4)' },
    { value: 'high', label: 'High (4×6)' },
  ]
  const SIGMA_BUDGET_OPTIONS: readonly DebugSelectOption<number>[] =
    SHADOW_SIGMA_BUDGETS.map((v) => ({
      value: v,
      label: v === SHADOW_SIGMA_BUDGETS[0] ? `${v} (cheap)` : `${v}`,
    }))
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
    const q = debug.quality
    if (q.meshShadowsEnabled !== shadowsOn) shadowsOn = q.meshShadowsEnabled
    if (q.shadowMapSize !== shadowSize) shadowSize = q.shadowMapSize
    if (q.anisotropy !== anisotropy) anisotropy = q.anisotropy
    if (q.shadowSoftness !== shadowSoftness) shadowSoftness = q.shadowSoftness
    // Read AO through the non-constructing peek so mirroring never warms the AO
    // pipelines on a 3D scene that never enabled it.
    const ao = debug.ambientOcclusionPeek
    const liveAoOn = ao?.enabled ?? false
    if (liveAoOn !== aoOn) aoOn = liveAoOn
    if (ao) {
      if (ao.preset !== aoPreset) aoPreset = ao.preset
      if (ao.intensity !== aoIntensity) aoIntensity = ao.intensity
      if (ao.radius !== aoRadius) aoRadius = ao.radius
      if (ao.directStrength !== aoDirect) aoDirect = ao.directStrength
    }
    const vq = q.vector
    if (vq.pathShadowsEnabled !== pathShadowsOn)
      pathShadowsOn = vq.pathShadowsEnabled
    if (vq.shadowSigmaBudget !== shadowSigmaBudget)
      shadowSigmaBudget = vq.shadowSigmaBudget
    if (vq.analyticShadowFrame !== analyticShadowFrameOn)
      analyticShadowFrameOn = vq.analyticShadowFrame
    if (vq.dither !== ditherOn) ditherOn = vq.dither
  })

  function handleRenderModeChange(mode: CombinedRenderMode): void {
    renderMode = mode
    if (MESH_MODES.has(mode)) {
      // A 3D mesh view, so leave the 2D pipeline normal.
      debug.setRenderMode(mode as MeshRenderMode)
      debug.activeStage.setDebugRenderMode('normal')
    } else {
      // A 2D batch mode (or 'normal'), so leave the 3D pass normal.
      debug.activeStage.setDebugRenderMode(mode as DebugRenderMode)
      debug.setRenderMode('normal')
    }
  }

  // Switching backend re-keys the canvas from scratch (context type is fixed
  // once acquired), so it goes through a reload with the app's `?gfx` param
  // rather than a live device swap. `auto` drops the param.
  function handleBackendPrefChange(pref: BackendPreference): void {
    if (pref === backendPref) return
    const url = new URL(location.href)
    if (pref === 'auto') url.searchParams.delete('gfx')
    else url.searchParams.set('gfx', pref)
    location.href = url.toString()
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

  function handleShadowsToggle(): void {
    debug.quality.meshShadowsEnabled = !shadowsOn
    shadowsOn = debug.quality.meshShadowsEnabled
  }

  function handleShadowSizeChange(v: number): void {
    debug.quality.shadowMapSize = v
    shadowSize = debug.quality.shadowMapSize
  }

  function handleAnisotropyChange(v: number): void {
    debug.quality.anisotropy = v
    anisotropy = debug.quality.anisotropy
  }

  function handleSoftnessChange(v: number): void {
    debug.quality.shadowSoftness = v
    shadowSoftness = debug.quality.shadowSoftness
  }

  // AO handlers use `debug.ambientOcclusion` (constructs on demand) since the
  // operator is actively turning it on / tuning it.
  function handleAoToggle(): void {
    debug.ambientOcclusion.enabled = !aoOn
    aoOn = debug.ambientOcclusion.enabled
  }

  function handleAoPresetChange(v: 'low' | 'medium' | 'high'): void {
    debug.ambientOcclusion.preset = v
    aoPreset = debug.ambientOcclusion.preset
  }

  function handleAoIntensityChange(v: number): void {
    debug.ambientOcclusion.intensity = v
    aoIntensity = debug.ambientOcclusion.intensity
  }

  function handleAoDirectChange(v: number): void {
    debug.ambientOcclusion.directStrength = v
    aoDirect = debug.ambientOcclusion.directStrength
  }

  function handleAoRadiusChange(v: number): void {
    debug.ambientOcclusion.radius = v
    aoRadius = debug.ambientOcclusion.radius
  }

  function handlePathShadowsToggle(): void {
    debug.quality.vector.pathShadowsEnabled = !pathShadowsOn
    pathShadowsOn = debug.quality.vector.pathShadowsEnabled
  }

  function handleSigmaBudgetChange(v: number): void {
    debug.quality.vector.shadowSigmaBudget = v
    shadowSigmaBudget = debug.quality.vector.shadowSigmaBudget
  }

  function handleAnalyticShadowFrameToggle(): void {
    debug.quality.vector.analyticShadowFrame = !analyticShadowFrameOn
    analyticShadowFrameOn = debug.quality.vector.analyticShadowFrame
  }

  function handleDitherToggle(): void {
    debug.quality.vector.dither = !ditherOn
    ditherOn = debug.quality.vector.dither
  }

  function formatMaskBytes(bytes: number): string {
    return bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : '0'
  }
</script>

<DebugSection title="Backend" bind:open={backendOpen}>
  <div class="debug-controls with-divider">
    <DebugSelect
      label="Preference"
      value={backendPref}
      options={BACKEND_PREF_OPTIONS}
      onChange={handleBackendPrefChange}
    />
    <DebugSelect
      label="MSAA"
      value={msaaSamples}
      options={MSAA_OPTIONS}
      onChange={handleMsaaChange}
    />
  </div>
  <DebugRow
    label="Active"
    value={BACKEND_LABELS[stats.backend]}
    tone="accent"
  />
</DebugSection>

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
  <DebugRow label="Round-rect instances" value={stats.gpu.roundRectInstances} />
  <DebugRow label="Shadow instances" value={stats.gpu.shadowInstances} />
  <DebugRow
    label="Overflow warns"
    value={stats.gpu.overflowWarns}
    tone={stats.gpu.overflowWarns > 0 ? 'error' : 'default'}
  />
</DebugSection>

<DebugSection title="Path shadows" bind:open={vectorOpen}>
  <!-- Controls first, read-only stats below (same layout as "GPU" above).
       Sigma budget, analytic-frame, and dither live under `quality.vector`
       alongside `pathShadowsEnabled`: see the path-shadows guide. -->
  <div class="debug-controls with-divider">
    <DebugToggleGroup
      label="Path shadows (cached blurred masks)"
      active={pathShadowsOn}
      onToggle={handlePathShadowsToggle}
    >
      <DebugSelect
        label="Sigma budget"
        value={shadowSigmaBudget}
        options={SIGMA_BUDGET_OPTIONS}
        onChange={handleSigmaBudgetChange}
      />
    </DebugToggleGroup>
    <ToggleButton
      active={analyticShadowFrameOn}
      onToggle={handleAnalyticShadowFrameToggle}
      label="Analytic shadow border-frame optimization"
    />
    <ToggleButton
      active={ditherOn}
      onToggle={handleDitherToggle}
      label="Dither (gradients, analytic + path shadows)"
    />
  </div>
  <!-- Cumulative since startup, not per-frame: see `GpuGfxStats`'s own doc
       for why (bursty cache/bake activity reads as mostly zero per frame). -->
  <DebugRow
    label="Outline tessellations (cumulative)"
    value={stats.gpu.outlineTessellations}
  />
  <DebugRow
    label="Outline cache hits (cumulative)"
    value={stats.gpu.outlineCacheHits}
  />
  <DebugRow
    label="Ramp rows written (cumulative)"
    value={stats.gpu.rampRowsWritten}
  />
  <DebugRow label="Mask bakes (cumulative)" value={stats.gpu.maskBakes} />
  <DebugRow
    label="Mask bake work (cumulative)"
    value={stats.gpu.maskBakeWork}
  />
  <DebugRow label="Mask bytes (live)" value={formatMaskBytes(stats.gpu.maskBytes)} />
  <DebugRow
    label="Bake pool hits / misses (cumulative)"
    value={`${stats.gpu.poolHits} / ${stats.gpu.poolMisses}`}
  />
</DebugSection>

{#if stats.world3d}
  <DebugSection title="3D" bind:open={threeOpen}>
    <div class="debug-controls with-divider">
      <DebugToggleGroup
        label="Shadows"
        active={shadowsOn}
        onToggle={handleShadowsToggle}
      >
        <DebugSelect
          label="Shadow resolution"
          value={shadowSize}
          options={SHADOW_SIZE_OPTIONS}
          onChange={handleShadowSizeChange}
        />
        <DebugSelect
          label="Shadow softness"
          value={shadowSoftness}
          options={SOFTNESS_OPTIONS}
          onChange={handleSoftnessChange}
        />
      </DebugToggleGroup>
      <!-- Anisotropy is texture filtering, independent of shadows, so it stays
           a standalone control rather than a shadow dependent. -->
      <DebugSelect
        label="Anisotropy"
        value={anisotropy}
        options={ANISO_OPTIONS}
        onChange={handleAnisotropyChange}
      />
      <DebugToggleGroup
        label="Ambient occlusion"
        active={aoOn}
        onToggle={handleAoToggle}
      >
        <DebugSelect
          label="AO preset"
          value={aoPreset}
          options={AO_PRESET_OPTIONS}
          onChange={handleAoPresetChange}
        />
        <DebugSlider
          label="AO intensity"
          value={aoIntensity}
          min={0}
          max={16}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onInput={handleAoIntensityChange}
        />
        <DebugSlider
          label="AO radius"
          value={aoRadius}
          min={0.1}
          max={3}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onInput={handleAoRadiusChange}
        />
        <DebugSlider
          label="AO on direct light"
          value={aoDirect}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v === 0 ? 'off' : v.toFixed(2))}
          onInput={handleAoDirectChange}
        />
      </DebugToggleGroup>
    </div>
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
