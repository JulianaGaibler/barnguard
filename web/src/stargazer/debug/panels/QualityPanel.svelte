<script lang="ts">
  import { onMount } from 'svelte'
  import type { DebugController, DebugStatsSnapshot } from '../DebugController'
  import type { BackendPreference } from '../../render/gfx/selectBackend'
  import { SHADOW_SIGMA_BUDGETS } from '../../render/VectorQuality'
  import {
    QUALITY_PRESETS,
    type ManualQuality,
    type QualityPresetId,
  } from '../../render/QualityControl'
  import {
    type QualityGroup,
    type QualityValues,
  } from '../../render/qualityGroups'
  import { createGpuFrameTimer } from '../GpuFrameTimer'
  import { RingSeries } from '../RingSeries'
  import {
    headroom,
    impactOf,
    totalTargetBytes,
    type Impact,
    type ImpactContext,
  } from '../qualityImpact'
  import { TONE_COLORS, type Tone } from '../thresholds'
  import type { TipSpec } from '../ui/tip'
  import {
    DebugSection,
    DebugSelect,
    DebugSlider,
    DebugToggleGroup,
    Gauge,
    MetricRow,
    Pill,
    QualityKnob,
    StatCard,
    StatGrid,
    ToggleButton,
    type DebugSelectOption,
    type KnobImpact,
    type KnobOption,
  } from '../ui'
  import { fmtBytes, MISSING } from './format'

  interface Props {
    debug: DebugController
    stats: DebugStatsSnapshot
    /** Bumped by the hub's rAF tick; drives the live-state re-sync. */
    revision: number
  }

  const { debug, stats, revision }: Props = $props()

  const control = (() => debug.engine.qualityControl)()

  let manualOpen = $state(false)
  let lookOpen = $state(false)
  let inertOpen = $state(false)

  // --- GPU time -------------------------------------------------------------

  const gpuSeries = new RingSeries(120)
  let gpuKind = $state<'elapsed' | 'none'>('none')
  const gpuScratch = new Float32Array(120)

  onMount(() => {
    const timer = createGpuFrameTimer(
      debug.engine,
      debug.engine.canvas,
      gpuSeries,
    )
    gpuKind = timer.kind
    return () => timer.dispose()
  })

  /** The median of the recent GPU frames, in ms, or `null` when unmeasured. */
  const gpuMs = $derived.by((): number | null => {
    void revision
    if (gpuKind === 'none') return null
    const n = gpuSeries.readOrdered(gpuScratch)
    if (n < 5) return null
    const recent = gpuScratch.slice(Math.max(0, n - 30), n).sort()
    return recent[recent.length >> 1]
  })

  // --- readings -------------------------------------------------------------

  const values = $derived.by((): QualityValues => {
    void revision
    return control.readAll()
  })
  const manual = $derived.by((): ManualQuality => {
    void revision
    return control.readManual()
  })
  const preset = $derived.by((): QualityPresetId | null => {
    void revision
    return control.matchingPreset()
  })
  const saved = $derived.by(() => {
    void revision
    return control.saved
  })
  const pinnedCount = $derived.by(() => {
    void revision
    return control.pinned().length
  })

  const ctx = $derived<ImpactContext>({
    pixelW: stats.canvasDevice.w,
    pixelH: stats.canvasDevice.h,
    scale: values.scale,
    samples: values.msaa,
    backend: stats.backend,
    has3D: stats.world3d !== null,
    aoResolution: values.aoResolution,
  })

  const room = $derived(
    headroom({
      interval50: stats.fps > 0 ? 1 / stats.fps : 0,
      work50: stats.p50,
      work95: stats.p95,
      gpuMs,
      maxFps: manual.maxFps,
    }),
  )

  const roomTone = $derived<Tone>(
    room.behind ? 'bad' : room.limiter === 'none' ? 'good' : 'warn',
  )
  const shareTone = (share: number): Tone =>
    share < 0.5 ? 'good' : share < 0.85 ? 'warn' : 'bad'
  const targetMemory = $derived(totalTargetBytes(values, ctx))

  // --- the five auto settings ---------------------------------------------

  interface GroupDef {
    group: QualityGroup
    label: string
    tip: string
    values: readonly (string | number)[]
    format: (v: string | number) => string
  }

  const sampleValues = $derived(
    stats.backend === 'webgpu' ? [1, 4] : [1, 2, 4, 8],
  )

  const GROUPS: readonly GroupDef[] = [
    {
      group: 'scale',
      label: 'Render scale',
      tip: 'The share of the display’s pixel density the canvas renders at. Lowering it is the biggest single saving on a GPU-bound frame, and the picture gets softer.',
      values: [1, 0.85, 0.75, 0.6, 0.5],
      format: (v) => `${v}×`,
    },
    {
      group: 'msaa',
      label: 'MSAA',
      tip: 'Multisample anti-aliasing. It smooths shape edges and multiplies the memory and bandwidth of the render target.',
      values: [],
      format: (v) => (v === 1 ? 'Off' : `${v}×`),
    },
    {
      group: 'shadows',
      label: '3D shadows',
      tip: 'Shadow filtering for 3D meshes, in taps per lit pixel. Off removes the shadow pass.',
      values: [16, 9, 4, 1, 0],
      format: (v) => (v === 0 ? 'Off' : v === 1 ? 'Hard' : `${v} taps`),
    },
    {
      group: 'aoPreset',
      label: 'Ambient occlusion',
      tip: 'Contact shadowing in 3D scenes. It renders extra full-screen passes.',
      values: ['high', 'medium', 'low', 'off'],
      format: (v) => (v === 'off' ? 'Off' : String(v)),
    },
    {
      group: 'aoResolution',
      label: 'AO resolution',
      tip: 'The resolution ambient occlusion renders at. Half resolution uses a quarter of the pixels and looks the same.',
      values: ['full', 'half'],
      format: (v) => String(v),
    },
  ]

  function valuesFor(def: GroupDef): readonly (string | number)[] {
    return def.group === 'msaa' ? sampleValues : def.values
  }

  function memoryText(i: Impact): string | null {
    return i.memory === null ? null : fmtBytes(i.memory)
  }

  function toKnobImpact(i: Impact): KnobImpact {
    return {
      look: i.look,
      memory: memoryText(i),
      pixelShare: i.pixelShare,
      reference: i.reference,
      inert: i.inert,
    }
  }

  function optionLabel(def: GroupDef, v: string | number): string {
    const i = impactOf(def.group, v as never, ctx)
    const bits: string[] = [def.format(v)]
    if (i.pixelShare !== null && def.group === 'scale') {
      bits.push(`${Math.round(i.pixelShare * 100)}% px`)
    }
    if (i.memory !== null && i.memory > 0) bits.push(fmtBytes(i.memory))
    if (i.inert) bits.push('no effect')
    return bits.join(' · ')
  }

  function optionsFor(def: GroupDef): KnobOption[] {
    const now = control.read(def.group)
    const nowText = now === null ? 'n/a' : def.format(now)
    return [
      { value: 'auto', label: `Auto (now ${nowText})` },
      ...valuesFor(def).map((v) => ({
        value: String(v),
        label: optionLabel(def, v),
      })),
    ]
  }

  function nowText(def: GroupDef): string {
    const now = control.read(def.group)
    return now === null ? 'n/a' : def.format(now)
  }

  function loweredText(def: GroupDef): string | null {
    const from = control.loweredFrom(def.group)
    return from === undefined ? null : def.format(from)
  }

  function impactFor(def: GroupDef): KnobImpact {
    const now = control.read(def.group)
    if (now === null) {
      return {
        look: '',
        memory: null,
        pixelShare: null,
        reference: null,
        inert: 'Ambient occlusion has not been turned on by the scene yet.',
      }
    }
    return toKnobImpact(impactOf(def.group, now as never, ctx))
  }

  /** A setting that changes nothing in this scene is listed apart. */
  function isInert(def: GroupDef): boolean {
    const now = control.read(def.group)
    if (now === null) return true
    return impactOf(def.group, now as never, ctx).inert !== null
  }

  const activeGroups = $derived.by(() => {
    void revision
    return GROUPS.filter((d) => !isInert(d))
  })
  const inertGroups = $derived.by(() => {
    void revision
    return GROUPS.filter((d) => isInert(d))
  })

  /** A tooltip for a setting: what it does, and every option side by side. */
  function knobTip(def: GroupDef): TipSpec {
    const now = control.read(def.group)
    const vals = valuesFor(def)
    return {
      title: def.label,
      value: now === null ? undefined : def.format(now),
      body: def.tip,
      table: {
        head: ['Value', 'Pixels', 'Memory', 'Look'],
        rows: vals.map((v) => {
          const i = impactOf(def.group, v as never, ctx)
          return [
            def.format(v),
            i.pixelShare === null ? '·' : `${Math.round(i.pixelShare * 100)}%`,
            i.memory === null || i.memory === 0 ? '·' : fmtBytes(i.memory),
            i.inert ? 'no effect here' : i.look,
          ]
        }),
        current: now === null ? undefined : vals.findIndex((v) => v === now),
      },
    }
  }

  function handleKnob(def: GroupDef, value: string): void {
    if (value === 'auto') {
      control.setAuto(def.group)
      return
    }
    const v = valuesFor(def).find((x) => String(x) === value)
    if (v !== undefined) control.setFixed(def.group, v as never)
  }

  function applyPreset(id: QualityPresetId): void {
    control.applyPreset(id)
  }

  const presetNote = $derived(
    QUALITY_PRESETS.find((p) => p.id === preset)?.summary ??
      'A mix of settings that matches none of the presets.',
  )

  // --- manual settings ------------------------------------------------------

  const SHADOW_SIZE_OPTIONS: readonly DebugSelectOption<number>[] = [
    256, 512, 1024, 2048, 4096,
  ].map((v) => ({
    value: v,
    label: `${v} · ${fmtBytes(v * v * 4)}`,
  }))
  const ANISO_OPTIONS: readonly DebugSelectOption<number>[] = [
    { value: 1, label: 'Off' },
    { value: 2, label: '2×' },
    { value: 4, label: '4×' },
    { value: 8, label: '8×' },
    { value: 16, label: '16×' },
  ]
  const SIGMA_OPTIONS: readonly DebugSelectOption<number>[] =
    SHADOW_SIGMA_BUDGETS.map((v) => ({
      value: v,
      label: v === SHADOW_SIGMA_BUDGETS[0] ? `${v} (cheap)` : `${v}`,
    }))
  const FPS_CAP_OPTIONS: readonly DebugSelectOption<number>[] = [
    { value: 0, label: 'Uncapped' },
    { value: 30, label: '30' },
    { value: 60, label: '60' },
    { value: 90, label: '90' },
    { value: 120, label: '120' },
    { value: 144, label: '144' },
  ]

  const BACKEND_OPTIONS: readonly DebugSelectOption<BackendPreference>[] = [
    { value: 'auto', label: 'Auto (prefer WebGPU)' },
    { value: 'webgpu', label: 'WebGPU' },
    { value: 'webgl2', label: 'WebGL2' },
  ]
  const backendPref: BackendPreference = (() => {
    const g = new URLSearchParams(location.search).get('gfx')
    return g === 'webgpu' || g === 'webgl2' ? g : 'auto'
  })()

  // Switching backend re-keys the canvas from scratch (the context type is
  // fixed once acquired), so it goes through a reload with the app's `?gfx`
  // parameter rather than a live device swap.
  function handleBackend(pref: BackendPreference): void {
    if (pref === backendPref) return
    const url = new URL(location.href)
    if (pref === 'auto') url.searchParams.delete('gfx')
    else url.searchParams.set('gfx', pref)
    location.href = url.toString()
  }

  let smoothTimestep = $state(true)
  let aoIntensity = $state(1)
  let aoRadius = $state(0.6)
  let aoDirect = $state(0)

  $effect(() => {
    void revision
    if (debug.smoothTimestep !== smoothTimestep)
      smoothTimestep = debug.smoothTimestep
    const ao = debug.ambientOcclusionPeek
    if (ao) {
      if (ao.intensity !== aoIntensity) aoIntensity = ao.intensity
      if (ao.radius !== aoRadius) aoRadius = ao.radius
      if (ao.directStrength !== aoDirect) aoDirect = ao.directStrength
    }
  })

  const has3D = $derived(stats.world3d !== null)
</script>

<div class="debug-summary">
  <div class="status-row">
    <Pill text={stats.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} />
    {#if saved}
      <Pill
        text="saved for this screen"
        tone="warn"
        tip="The settings you pinned are kept for this screen size and pixel density, and applied when the page loads. Reset clears them."
      />
    {/if}
  </div>

  <div class="room" style:--tone={TONE_COLORS[roomTone]}>{room.advice}</div>

  <StatGrid>
    <StatCard
      label="CPU p95"
      value={(stats.p95 * 1000).toFixed(1)}
      unit="ms"
      tone={shareTone(room.cpuShare)}
      tip={{
        title: 'CPU time per frame',
        value: `${(stats.p95 * 1000).toFixed(1)} ms`,
        tone: shareTone(room.cpuShare),
        body: 'The slowest 5% of CPU work per frame, against a budget of about 16.7 ms at 60 Hz. Lowering GPU quality does not help when this is the larger share.',
        scale: {
          value: stats.p95 * 1000,
          good: 8,
          warn: 14,
          max: 24,
          format: (n) => `${n.toFixed(0)} ms`,
        },
      }}
    />
    <StatCard
      label="GPU"
      value={gpuMs === null ? MISSING : gpuMs.toFixed(1)}
      unit={gpuMs === null ? '' : 'ms'}
      tone={gpuMs === null ? 'neutral' : shareTone(room.gpuShare ?? 0)}
      tip={gpuKind === 'none'
        ? 'GPU time can only be measured on WebGL2 in a browser that offers timer queries. WebGPU and Firefox cannot.'
        : 'Median GPU time per frame over the last 30 frames.'}
      note={gpuKind === 'none' ? 'not measurable here' : undefined}
    />
  </StatGrid>
  <div class="gauges">
    <Gauge
      label="CPU of frame budget"
      reading="{Math.round(room.cpuShare * 100)}%"
      value={room.cpuShare}
      max={1.2}
      good={0.5}
      warn={0.85}
      tone={shareTone(room.cpuShare)}
      tip="CPU work, slowest 5%, as a share of one frame."
    />
    {#if room.gpuShare !== null}
      <Gauge
        label="GPU of frame budget"
        reading="{Math.round(room.gpuShare * 100)}%"
        value={room.gpuShare}
        max={1.2}
        good={0.5}
        warn={0.85}
        tone={shareTone(room.gpuShare)}
        tip="GPU time as a share of one frame."
      />
    {/if}
    <MetricRow
      label="Render targets"
      value={fmtBytes(targetMemory)}
      tip="Memory of the colour, depth and ambient occlusion targets at the current settings, estimated from the canvas size."
    />
  </div>
</div>

<DebugSection title="Presets" open={true}>
  {#snippet summary()}
    <span class="section-summary">{preset ?? 'custom'}</span>
  {/snippet}
  <div class="presets">
    {#each QUALITY_PRESETS as p (p.id)}
      <button
        type="button"
        class="debug-btn"
        class:active={preset === p.id}
        title={p.summary}
        onclick={() => applyPreset(p.id)}
      >
        {p.label}
      </button>
    {/each}
  </div>
  <div class="preset-note">{presetNote}</div>
  <div class="footer">
    <button
      type="button"
      class="debug-btn danger"
      title="Give every setting back to the engine and forget what was saved for this screen."
      onclick={() => control.reset()}
    >
      Reset to auto
    </button>
  </div>
</DebugSection>

<DebugSection title="Auto or fixed" open={true}>
  {#snippet summary()}
    <span class="section-summary">
      {pinnedCount === 0 ? 'all auto' : `${pinnedCount} fixed`}
    </span>
  {/snippet}
  <p class="intro">
    A setting on Auto starts where the scene put it and is lowered when the GPU
    falls behind. A fixed setting stays put.
  </p>
  {#each activeGroups as def (def.group)}
    <QualityKnob
      label={def.label}
      options={optionsFor(def)}
      selected={control.mode(def.group) === 'auto'
        ? 'auto'
        : String(values[def.group])}
      onChange={(v) => handleKnob(def, v)}
      now={nowText(def)}
      loweredFrom={loweredText(def)}
      impact={impactFor(def)}
      tip={knobTip(def)}
    />
  {/each}
</DebugSection>

{#if inertGroups.length > 0}
  <DebugSection title="Not used by this scene" bind:open={inertOpen}>
    {#snippet summary()}
      <span class="section-summary">{inertGroups.length}</span>
    {/snippet}
    {#each inertGroups as def (def.group)}
      <QualityKnob
        label={def.label}
        options={optionsFor(def)}
        selected={control.mode(def.group) === 'auto'
          ? 'auto'
          : String(values[def.group])}
        onChange={(v) => handleKnob(def, v)}
        now={nowText(def)}
        loweredFrom={loweredText(def)}
        impact={impactFor(def)}
        tip={knobTip(def)}
      />
    {/each}
  </DebugSection>
{/if}

<DebugSection title="Fixed settings" bind:open={manualOpen}>
  {#snippet summary()}
    <span class="section-summary">
      {manual.maxFps === 0 ? 'uncapped' : `${manual.maxFps} fps cap`}
    </span>
  {/snippet}
  <p class="intro">These are never lowered on their own.</p>
  <div class="debug-controls">
    <DebugSelect
      label="FPS cap"
      value={manual.maxFps}
      options={FPS_CAP_OPTIONS}
      onChange={(v) => control.setManual({ maxFps: v })}
    />
    <ToggleButton
      active={smoothTimestep}
      onToggle={() => {
        debug.setSmoothTimestep(!smoothTimestep)
        smoothTimestep = debug.smoothTimestep
      }}
      label="Smooth timestep (timer-jitter filter)"
    />
    {#if has3D}
      <DebugSelect
        label="Shadow map"
        value={manual.shadowMapSize}
        options={SHADOW_SIZE_OPTIONS}
        onChange={(v) => control.setManual({ shadowMapSize: v })}
      />
    {/if}
    <DebugSelect
      label="Anisotropy"
      value={manual.anisotropy}
      options={ANISO_OPTIONS}
      onChange={(v) => control.setManual({ anisotropy: v })}
    />
    <DebugToggleGroup
      label="Path shadows (cached blurred masks)"
      active={manual.pathShadows}
      onToggle={() => control.setManual({ pathShadows: !manual.pathShadows })}
    >
      <DebugSelect
        label="Sigma budget"
        value={manual.pathShadowSigma}
        options={SIGMA_OPTIONS}
        onChange={(v) => control.setManual({ pathShadowSigma: v })}
      />
    </DebugToggleGroup>
    <ToggleButton
      active={manual.analyticShadowFrame}
      onToggle={() =>
        control.setManual({ analyticShadowFrame: !manual.analyticShadowFrame })}
      label="Analytic shadow border-frame optimization"
    />
    <ToggleButton
      active={manual.dither}
      onToggle={() => control.setManual({ dither: !manual.dither })}
      label="Dither (gradients, analytic + path shadows)"
    />
    <DebugSelect
      label="Backend"
      value={backendPref}
      options={BACKEND_OPTIONS}
      onChange={handleBackend}
    />
  </div>
</DebugSection>

{#if has3D}
  <DebugSection title="Ambient occlusion look" bind:open={lookOpen}>
    <DebugSlider
      label="Intensity"
      value={aoIntensity}
      min={0}
      max={16}
      step={0.1}
      format={(v) => `${v.toFixed(1)}×`}
      onInput={(v) => {
        debug.ambientOcclusion.intensity = v
        aoIntensity = debug.ambientOcclusion.intensity
      }}
    />
    <DebugSlider
      label="Radius"
      value={aoRadius}
      min={0.1}
      max={3}
      step={0.05}
      format={(v) => v.toFixed(2)}
      onInput={(v) => {
        debug.ambientOcclusion.radius = v
        aoRadius = debug.ambientOcclusion.radius
      }}
    />
    <DebugSlider
      label="On direct light"
      value={aoDirect}
      min={0}
      max={1}
      step={0.05}
      format={(v) => (v === 0 ? 'off' : v.toFixed(2))}
      onInput={(v) => {
        debug.ambientOcclusion.directStrength = v
        aoDirect = debug.ambientOcclusion.directStrength
      }}
    />
  </DebugSection>
{/if}

<style lang="sass">
  .status-row
    display: flex
    align-items: center
    flex-wrap: wrap
    gap: 6px
    padding: 2px 2px 0

  .room
    padding: 4px 8px
    border-left: 3px solid var(--tone)
    background: rgba(255, 255, 255, 0.04)
    font-size: 10px
    line-height: 1.4

  .gauges
    display: flex
    flex-direction: column
    gap: 3px
    padding: 0 2px

  .presets
    display: flex
    flex-wrap: wrap
    gap: 4px

    .debug-btn
      padding: 5px 9px

  .preset-note
    margin-top: 6px
    font-size: 10px
    opacity: 0.7
    line-height: 1.4

  .intro
    margin: 0 0 4px
    font-size: 10px
    opacity: 0.6
    line-height: 1.4

  .footer
    display: flex
    justify-content: flex-end
    margin-top: 6px
</style>
