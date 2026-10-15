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
    StatCard,
    StatGrid,
    Gauge,
    MetricRow,
    Pill,
    HealthChip,
    type DebugSelectOption,
  } from '../ui'
  import type { MetricHistory } from '../MetricHistory'
  import type { FrameStats } from '../FrameStats'
  import { LABEL_CACHE_MAX } from '../../render/gfx/TextureManager'
  import { THRESHOLDS, toneFor, type MetricId, type Tone } from '../thresholds'
  import { thresholdTip } from '../tips'
  import {
    bytesQuantity,
    countQuantity,
    fmtBytes,
    fmtCount,
    fmtPct,
    MISSING,
  } from './format'

  interface Props {
    debug: DebugController
    stats: DebugStatsSnapshot
    /** Bumped by the hub's rAF tick; drives the live-state re-sync + previews. */
    revision: number
    /** Recent readings, for the sparklines. */
    history: MetricHistory
    /** Recent frame times, for the frame time sparkline. */
    frameStats: FrameStats
  }

  const { debug, stats, revision, history, frameStats }: Props = $props()

  let batchingOpen = $state(true)
  let picturesOpen = $state(false)
  let instancesOpen = $state(false)
  let cachesOpen = $state(false)
  let threeOpen = $state(false)
  let viewsOpen = $state(false)
  let texturesOpen = $state(false)

  const BACKEND_LABELS: Record<'webgpu' | 'webgl2', string> = {
    webgpu: 'WebGPU',
    webgl2: 'WebGL2',
  }

  // One render-mode control drives both pipelines: the 2D batch modes
  // (`DebugRenderMode`, GpuGfx) and the 3D mesh views (`MeshRenderMode`,
  // DebugController). Only one is active at a time, and picking one resets the
  // other to `normal`. `'normal'` is shared.
  type CombinedRenderMode = DebugRenderMode | Exclude<MeshRenderMode, 'normal'>
  let renderMode = $state<CombinedRenderMode>('normal')
  let perfMarks = $state(false)

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

  // Mirror the active stage's live values so an external toggle or a stage
  // switch stays in sync. Re-synced each tick.
  $effect(() => {
    void revision
    const active = debug.activeStage
    // The 3D mesh view wins the dropdown when non-normal, else the 2D mode.
    const live3d = debug.renderMode
    const live2d = active.getDebugRenderMode()
    const liveMode: CombinedRenderMode = live3d !== 'normal' ? live3d : live2d
    if (liveMode !== renderMode) renderMode = liveMode
    if (debug.perfMarks !== perfMarks) perfMarks = debug.perfMarks
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

  function handlePerfMarksToggle(): void {
    debug.setPerfMarks(!perfMarks)
    perfMarks = debug.perfMarks
  }

  // --- readings -----------------------------------------------------------

  const g = $derived(stats.gpu)
  const frameP95Ms = $derived(stats.p95 * 1000)

  const toneOf = (id: MetricId, value: number): Tone =>
    toneFor(THRESHOLDS[id], value)

  const labelPressure = $derived(g.labelEntries / LABEL_CACHE_MAX)
  const maskBudget = $derived(
    Math.max(1, debug.quality.vector.shadowMaskBudgetBytes),
  )
  const maskPressure = $derived(g.maskBytes / maskBudget)
  // What the frame streamed, by program, and the pictures that streamed most.
  const uploadTip = $derived.by(() => {
    const rows = Object.entries(g.streamedBytes)
      .filter(([, bytes]) => (bytes ?? 0) > 0)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([kind, bytes]) => [kind, fmtBytes(bytes ?? 0)])
    return {
      ...thresholdTip('bytesUploaded', g.bytesUploaded, fmtBytes),
      table:
        rows.length > 0 ? { head: ['Program', 'Per frame'], rows } : undefined,
      facts: stats.streamers.map(([name, bytes]) => ({
        label: name,
        value: fmtBytes(bytes),
      })),
    }
  })

  /** Fewer runs than this say nothing about how well they merge. */
  const MIN_RUNS_JUDGED = 8

  const mergeRatio = $derived(
    g.runsMerged / Math.max(1, g.drawCalls + g.runsMerged),
  )
  const restingRatio = $derived(
    1 -
      stats.composeTotals.framesPainted /
        Math.max(1, stats.composeTotals.frames),
  )
  const outlineLookups = $derived(g.outlineCacheHits + g.outlineTessellations)
  const outlineHitRate = $derived(
    outlineLookups > 0 ? g.outlineCacheHits / outlineLookups : null,
  )
  const poolLookups = $derived(g.poolHits + g.poolMisses)
  const poolHitRate = $derived(
    poolLookups > 0 ? g.poolHits / poolLookups : null,
  )
  const totalInstances = $derived(
    g.sdfInstances +
      g.strokeInstances +
      g.roundRectInstances +
      g.shadowInstances,
  )

  interface Reading {
    id: MetricId
    label: string
    value: number
    text: string
  }

  // What the status chip watches. Anything not in its good range is listed,
  // worst first, on hover.
  const readings = $derived<Reading[]>([
    {
      id: 'frameMs',
      label: 'Frame time',
      value: frameP95Ms,
      text: `${frameP95Ms.toFixed(1)} ms p95`,
    },
    {
      id: 'drawCalls',
      label: 'Draw calls',
      value: g.drawCalls,
      text: `${g.drawCalls} per frame`,
    },
    {
      id: 'picturesPainted',
      label: 'Repainting',
      value: stats.compose.paints,
      text: `${stats.compose.paints} pictures painted`,
    },
    {
      id: 'stalePictures',
      label: 'Stale pictures',
      value: stats.composeTotals.stale,
      text: `${stats.composeTotals.stale} found`,
    },
    {
      id: 'bytesUploaded',
      label: 'Upload',
      value: g.bytesUploaded,
      text: `${fmtBytes(g.bytesUploaded)} per frame`,
    },
    {
      id: 'offscreenBytes',
      label: 'Offscreen memory',
      value: g.offscreenBytes,
      text: fmtBytes(g.offscreenBytes),
    },
    {
      id: 'labelPressure',
      label: 'Label cache',
      value: labelPressure,
      text: fmtPct(labelPressure),
    },
    {
      id: 'maskPressure',
      label: 'Mask memory',
      value: maskPressure,
      text: fmtPct(maskPressure),
    },
    {
      id: 'labelPageResets',
      label: 'Label page resets',
      value: g.labelPageWipes,
      text: `${g.labelPageWipes} resets`,
    },
  ])

  const TONE_RANK: Record<Tone, number> = {
    neutral: 0,
    good: 1,
    warn: 2,
    bad: 3,
  }
  const issues = $derived(
    readings
      .map((r) => ({
        label: r.label,
        tone: toneOf(r.id, r.value),
        detail: `${r.text}. ${THRESHOLDS[r.id].tip}`,
      }))
      .filter((i) => i.tone === 'warn' || i.tone === 'bad')
      .sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone]),
  )

  const drawsQ = $derived(countQuantity(g.drawCalls))
  const uploadQ = $derived(bytesQuantity(g.bytesUploaded))
  const primsQ = $derived(countQuantity(g.primitives))
  const msaaLabel = $derived(
    g.msaaSamples > 1 ? `${g.msaaSamples}× MSAA` : 'MSAA off',
  )

  const pctOrMissing = (r: number | null): string =>
    r === null ? MISSING : fmtPct(r)
</script>

<div class="debug-summary">
  <div class="status-row">
    <Pill
      text={BACKEND_LABELS[stats.backend]}
      tip="The graphics backend in use. The preference under Display can differ if the preferred backend failed to start."
    />
    <Pill
      text={msaaLabel}
      tip="Multisample anti-aliasing for the 2D and 3D passes."
    />
    <HealthChip {issues} />
  </div>
  {#each stats.renderFailures as failure (failure.source + failure.message)}
    <DebugRow label={failure.source} value={failure.message} tone="error" />
  {/each}

  <StatGrid>
    <StatCard
      label="Draws / frame"
      value={drawsQ.text}
      unit={drawsQ.unit}
      tone={toneOf('drawCalls', g.drawCalls)}
      tip={thresholdTip('drawCalls', g.drawCalls, fmtCount)}
      series={history.drawCalls}
      {revision}
    />
    <StatCard
      label="Frame p95"
      value={frameP95Ms.toFixed(1)}
      unit="ms"
      tone={toneOf('frameMs', frameP95Ms)}
      tip={thresholdTip(
        'frameMs',
        frameP95Ms,
        (n: number) => `${n.toFixed(1)} ms`,
      )}
      note="{stats.fps > 0 ? Math.round(stats.fps) : MISSING} fps"
      series={frameStats}
      seriesScale={1000}
      seriesMax={50}
      {revision}
    />
    <StatCard
      label="Painted"
      value={stats.compose.paints}
      tone={toneOf('picturesPainted', stats.compose.paints)}
      tip={thresholdTip('picturesPainted', stats.compose.paints)}
      note="{fmtPct(restingRatio)} of frames at rest"
      series={history.paints}
      {revision}
    />
    <StatCard
      label="Uploaded"
      value={uploadQ.text}
      unit={uploadQ.unit}
      tone={toneOf('bytesUploaded', g.bytesUploaded)}
      tip={uploadTip}
      series={history.bytesUploaded}
      {revision}
    />
    <StatCard
      label="Primitives"
      value={primsQ.text}
      unit={primsQ.unit}
      tone={toneOf('primitives', g.primitives)}
      tip={thresholdTip('primitives', g.primitives, fmtCount)}
      series={history.primitives}
      {revision}
    />
    <StatCard
      label="Stale"
      value={stats.composeTotals.stale}
      tone={toneOf('stalePictures', stats.composeTotals.stale)}
      tip={thresholdTip('stalePictures', stats.composeTotals.stale)}
    />
  </StatGrid>

  <div class="gauges">
    <Gauge
      label="Label cache"
      reading="{g.labelEntries} / {LABEL_CACHE_MAX}"
      value={labelPressure}
      max={1}
      good={THRESHOLDS.labelPressure.good}
      warn={THRESHOLDS.labelPressure.warn}
      tone={toneOf('labelPressure', labelPressure)}
      tip={thresholdTip('labelPressure', labelPressure, fmtPct)}
    />
    <Gauge
      label="Mask memory"
      reading="{fmtBytes(g.maskBytes)} / {fmtBytes(maskBudget)}"
      value={maskPressure}
      max={1}
      good={THRESHOLDS.maskPressure.good}
      warn={THRESHOLDS.maskPressure.warn}
      tone={toneOf('maskPressure', maskPressure)}
      tip={thresholdTip('maskPressure', maskPressure, fmtPct)}
    />
    {#if g.surfaces > 0 || g.offscreenBytes > 0}
      <Gauge
        label="Offscreen memory"
        reading="{fmtBytes(g.offscreenBytes)} in {g.surfaces}"
        value={g.offscreenBytes}
        max={THRESHOLDS.offscreenBytes.warn * 1.5}
        good={THRESHOLDS.offscreenBytes.good}
        warn={THRESHOLDS.offscreenBytes.warn}
        tone={toneOf('offscreenBytes', g.offscreenBytes)}
        tip={thresholdTip('offscreenBytes', g.offscreenBytes, fmtBytes)}
      />
    {/if}
  </div>
</div>

<DebugSection title="Batching" bind:open={batchingOpen}>
  {#snippet summary()}
    <span class="section-summary">
      {Math.round(mergeRatio * 100)}% merged
    </span>
  {/snippet}
  <MetricRow
    label="Program switches"
    value={g.programSwitches}
    tone={toneOf('programSwitches', g.programSwitches)}
    tip={thresholdTip('programSwitches', g.programSwitches)}
    fill={g.programSwitches / THRESHOLDS.programSwitches.warn}
  />
  <MetricRow
    label="Texture binds"
    value={g.textureBinds}
    tone={toneOf('textureBinds', g.textureBinds)}
    tip={thresholdTip('textureBinds', g.textureBinds)}
    fill={g.textureBinds / THRESHOLDS.textureBinds.warn}
  />
  <MetricRow
    label="Blend switches"
    value={g.blendSwitches}
    tone={toneOf('blendSwitches', g.blendSwitches)}
    tip={thresholdTip('blendSwitches', g.blendSwitches)}
    fill={g.blendSwitches / THRESHOLDS.blendSwitches.warn}
  />
  <MetricRow
    label="Runs merged"
    value="{g.runsMerged} ({fmtPct(mergeRatio)})"
    tone={g.drawCalls + g.runsMerged < MIN_RUNS_JUDGED
      ? 'neutral'
      : toneOf('mergeRatio', mergeRatio)}
    tip={thresholdTip('mergeRatio', mergeRatio, fmtPct)}
    fill={mergeRatio}
  />
  <MetricRow
    label="Uniform slices"
    value={g.uboSlices}
    tone={toneOf('uboSlices', g.uboSlices)}
    tip={thresholdTip('uboSlices', g.uboSlices)}
    fill={g.uboSlices / THRESHOLDS.uboSlices.warn}
  />
  <MetricRow
    label="2D render passes"
    value={g.passCount}
    tone={toneOf('passCount', g.passCount)}
    tip={thresholdTip('passCount', g.passCount)}
    fill={g.passCount / THRESHOLDS.passCount.warn}
  />
  <MetricRow
    label="Passes, whole frame"
    value={g.framePasses}
    tip="Render passes of the whole frame, 2D, 3D, ambient occlusion and post effects together."
  />
  <MetricRow
    label="Queue submits"
    value={g.frameSubmits}
    tone={toneOf('submits', g.frameSubmits)}
    tip={thresholdTip('submits', g.frameSubmits)}
  />
  <MetricRow
    label="Bind groups created"
    value={g.frameBindGroupsCreated}
    tone={toneOf('bindGroupsCreated', g.frameBindGroupsCreated)}
    tip={thresholdTip('bindGroupsCreated', g.frameBindGroupsCreated)}
  />
  <MetricRow
    label="Bind group switches"
    value={g.frameBindGroupSwitches}
    tip="Times a different bind group was set between draws."
  />
  <MetricRow
    label="Uniform writes"
    value={g.frameUniformWrites}
    tip="Uniform buffer writes issued during the frame."
  />
</DebugSection>

<DebugSection title="Pictures" bind:open={picturesOpen}>
  {#snippet summary()}
    <span class="section-summary">
      {stats.compose.replays} replayed
    </span>
  {/snippet}
  <MetricRow
    label="Painted"
    value={stats.compose.paints}
    tone={toneOf('picturesPainted', stats.compose.paints)}
    tip={thresholdTip('picturesPainted', stats.compose.paints)}
  />
  {#if stats.composePainters.length > 0}
    <MetricRow
      label="Painted by"
      value={stats.composePainters
        .slice(0, 3)
        .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
        .join(', ')}
      tip="The node classes that painted a picture last frame. A scene that should be at rest names here what keeps it from being."
    />
  {/if}
  <MetricRow
    label="Replayed"
    value={stats.compose.replays}
    tip="Pictures drawn from their recorded calls, without painting again."
  />
  <MetricRow
    label="Nodes culled"
    value={stats.compose.culled}
    tip="Nodes skipped because their bounds lie outside the view."
  />
  <MetricRow
    label="Frames at rest"
    value={fmtPct(restingRatio)}
    tip="Share of frames, since the stage started, in which no picture needed painting."
    fill={restingRatio}
    note="{stats.composeTotals.framesPainted} / {stats.composeTotals
      .frames} painted"
  />
  <MetricRow
    label="Stale pictures"
    value={stats.composeTotals.stale}
    tone={toneOf('stalePictures', stats.composeTotals.stale)}
    tip={thresholdTip('stalePictures', stats.composeTotals.stale)}
  />
</DebugSection>

<DebugSection title="Instances" bind:open={instancesOpen}>
  {#snippet summary()}
    <span class="section-summary">{fmtCount(totalInstances)}</span>
  {/snippet}
  <MetricRow
    label="SDF circles"
    value={fmtCount(g.sdfInstances)}
    fill={g.sdfInstances / Math.max(1, totalInstances)}
    tip="Circle instances drawn by the shape program, as a share of all instances."
  />
  <MetricRow
    label="Strokes"
    value={fmtCount(g.strokeInstances)}
    fill={g.strokeInstances / Math.max(1, totalInstances)}
    tip="Stroke segment instances."
  />
  <MetricRow
    label="Round rects"
    value={fmtCount(g.roundRectInstances)}
    fill={g.roundRectInstances / Math.max(1, totalInstances)}
    tip="Rounded rectangle instances, fills and borders."
  />
  <MetricRow
    label="Shadows"
    value={fmtCount(g.shadowInstances)}
    fill={g.shadowInstances / Math.max(1, totalInstances)}
    tip="Analytic shadow instances. Each covers its shape plus the blur, so shadows are the most expensive instances per pixel."
  />
  <MetricRow
    label="Primitives"
    value={fmtCount(g.primitives)}
    tone={toneOf('primitives', g.primitives)}
    tip={thresholdTip('primitives', g.primitives, fmtCount)}
  />
</DebugSection>

<DebugSection title="Caches" bind:open={cachesOpen}>
  {#snippet summary()}
    <span class="section-summary">
      outline hit {pctOrMissing(outlineHitRate)}
    </span>
  {/snippet}
  {#each stats.caches as cache (cache.name)}
    <Gauge
      label={cache.name}
      reading="{fmtBytes(cache.bytes)} / {fmtBytes(cache.budget)}"
      value={cache.bytes / Math.max(1, cache.budget)}
      max={1}
      good={THRESHOLDS.retainedPressure.good}
      warn={THRESHOLDS.retainedPressure.warn}
      tone={toneOf('retainedPressure', cache.bytes / Math.max(1, cache.budget))}
      tip={{
        ...thresholdTip(
          'retainedPressure',
          cache.bytes / Math.max(1, cache.budget),
          fmtPct,
        ),
        facts: [
          { label: 'Entries', value: fmtCount(cache.entries) },
          { label: 'Drawn from the cache', value: `${cache.hits} last frame` },
          { label: 'Kept', value: `${cache.admitted} last frame` },
          { label: 'Freed', value: `${fmtCount(cache.evicted)} in all` },
        ],
      }}
    />
  {/each}
  {#if stats.streamers.length > 0}
    <div class="sub-head">Streaming every frame</div>
    {#each stats.streamers as [name, bytes] (name)}
      <MetricRow
        label={name}
        value={fmtBytes(bytes)}
        tip="Vertex and instance bytes this picture sent to the GPU last frame. Content the renderer keeps between frames sends nothing, so a large number here is a picture that repaints, moves, or draws something the renderer does not keep."
      />
    {/each}
  {/if}
  <!-- Counters here are cumulative since startup, not per frame: bursty
       cache and bake activity reads as mostly zero in a single frame. -->
  {#if outlineHitRate !== null}
    <Gauge
      label="Outline cache hit rate"
      reading={fmtPct(outlineHitRate)}
      value={outlineHitRate}
      max={1}
      good={THRESHOLDS.cacheHitRate.good}
      warn={THRESHOLDS.cacheHitRate.warn}
      lowIsBad
      tone={toneOf('cacheHitRate', outlineHitRate)}
      tip="Stroke outlines served from the cache against built from scratch. {THRESHOLDS
        .cacheHitRate.tip}"
    />
  {/if}
  <MetricRow
    label="Outline tessellations"
    value={fmtCount(g.outlineTessellations)}
    note="cumulative"
    tip="Stroke outlines built from scratch."
  />
  <MetricRow
    label="Outline cache hits"
    value={fmtCount(g.outlineCacheHits)}
    note="cumulative"
    tip="Stroke outlines reused from the cache."
  />
  <MetricRow
    label="Ramp rows written"
    value={fmtCount(g.rampRowsWritten)}
    note="cumulative"
    tip="Gradient ramp rows painted into the shared atlas."
  />
  <MetricRow
    label="Label rasters"
    value={fmtCount(g.labelRasters)}
    note="cumulative"
    tip="Text and small images rasterized into the label page. Many of these after startup means labels are being drawn again."
  />
  <MetricRow
    label="Label upload"
    value={fmtBytes(g.labelUploadBytes)}
    note="cumulative"
    tip="Bytes of label bitmaps sent to the GPU."
  />
  <MetricRow
    label="Label holds"
    value={fmtCount(g.labelHolds)}
    note="cumulative"
    tip="Label draws served by a nearby size's raster instead of a new one."
  />
  <MetricRow
    label="Dedicated label textures"
    value={fmtCount(g.labelDedicated)}
    note="cumulative"
    tip="Labels too large for the page, or drawn with no room in it, that took a texture of their own."
  />
  <MetricRow
    label="Label page resets"
    value={g.labelPageWipes}
    tone={toneOf('labelPageResets', g.labelPageWipes)}
    tip={thresholdTip('labelPageResets', g.labelPageWipes)}
  />
  <MetricRow
    label="Mask bakes"
    value={fmtCount(g.maskBakes)}
    note="cumulative"
    tip="Path-shadow masks rendered and blurred."
  />
  <MetricRow
    label="Mask bake work"
    value={fmtCount(g.maskBakeWork)}
    note="cumulative"
    tip="Blur tap-work spent on mask bakes, texels times taps."
  />
  {#if poolHitRate !== null}
    <Gauge
      label="Bake pool hit rate"
      reading="{fmtPct(poolHitRate)} ({fmtCount(g.poolHits)} / {fmtCount(
        g.poolMisses,
      )})"
      value={poolHitRate}
      max={1}
      good={THRESHOLDS.cacheHitRate.good}
      warn={THRESHOLDS.cacheHitRate.warn}
      lowIsBad
      tone={toneOf('cacheHitRate', poolHitRate)}
      tip="Render targets for mask bakes reused from the pool against created. {THRESHOLDS
        .cacheHitRate.tip}"
    />
  {/if}
</DebugSection>

{#if stats.world3d}
  {@const w3 = stats.world3d}
  <DebugSection title="3D" bind:open={threeOpen}>
    {#snippet summary()}
      <span class="section-summary">
        {fmtCount(w3.triangleCount)} tris
      </span>
    {/snippet}
    <StatGrid>
      <StatCard
        label="Draws / frame"
        value={w3.drawCalls}
        tip="Mesh draw calls last frame."
      />
      <StatCard
        label="Triangles"
        value={countQuantity(w3.triangleCount).text}
        unit={countQuantity(w3.triangleCount).unit}
        tip="Triangles submitted last frame, shadow passes included."
      />
      <StatCard
        label="Visible"
        value="{w3.visible} / {w3.meshCount}"
        tip="Meshes that passed culling, of all meshes in the scene."
      />
      <StatCard
        label="Nodes"
        value={w3.nodeCount}
        tip="Nodes in the 3D scene."
      />
    </StatGrid>
  </DebugSection>
{/if}

<DebugSection title="Debug views" bind:open={viewsOpen}>
  <div class="debug-controls">
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
</DebugSection>

<DebugSection title="Textures" bind:open={texturesOpen}>
  <TextureInspector {debug} open={texturesOpen} {revision} />
</DebugSection>

<style lang="sass">
  .status-row
    display: flex
    align-items: center
    flex-wrap: wrap
    gap: 6px
    padding: 2px 2px 0

    :global(.chip)
      margin-left: auto

  .sub-head
    margin: 6px 0 2px
    font-size: 9px
    text-transform: uppercase
    letter-spacing: 0.05em
    opacity: 0.55

  .gauges
    display: flex
    flex-direction: column
    gap: 3px
    padding: 0 2px
</style>
