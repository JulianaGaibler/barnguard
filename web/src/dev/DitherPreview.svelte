<script lang="ts">
  /**
   * Dev surface for the dither effect: a few source images, every setting, and
   * a switch between the backends. Mounted by `main.ts` for a `?dither` run,
   * bypassing the booth chrome. The address takes `preset`, `source`, `motion`,
   * `cache`, `gfx` (`webgpu` or `webgl2`) and `panel=off` so a setup can be
   * linked.
   */
  import {
    CameraNode2D,
    Layer,
    Node2D,
    ShapeNode,
    mountEngine,
    type EngineHost,
  } from 'stargazer'
  import {
    DebugSelect,
    DebugSlider,
    ToggleButton,
  } from 'stargazer/debug-ui'
  import { Dither } from '@src/core/render/dither/Dither'
  import {
    DITHER_PRESETS,
    ditherPreset,
    type DitherPresetName,
  } from '@src/core/render/dither/presets'
  import type {
    DitherAnchor,
    DitherDot,
    DitherPalette,
    DitherPattern,
    DitherSettings,
  } from '@src/core/render/dither/params'

  const FRAME = { x: 0, y: 0, width: 1920, height: 1080 }

  type SourceName = 'blob' | 'sphere' | 'flower'
  type Backend = 'auto' | 'webgpu' | 'webgl2'

  const query = new URLSearchParams(location.search)
  const presetNames = Object.keys(DITHER_PRESETS) as DitherPresetName[]
  const startPreset = presetNames.includes(query.get('preset') as never)
    ? (query.get('preset') as DitherPresetName)
    : 'stageMountain'
  const startSource = (['blob', 'sphere', 'flower'] as const).includes(
    query.get('source') as never,
  )
    ? (query.get('source') as SourceName)
    : 'blob'
  const startBackend = (['webgpu', 'webgl2'] as const).includes(
    query.get('gfx') as never,
  )
    ? (query.get('gfx') as Backend)
    : 'auto'

  const dither = new Dither(ditherPreset(startPreset))
  let settings = $state<DitherSettings>({ ...dither.settings })
  let preset = $state<DitherPresetName>(startPreset)
  let source = $state<SourceName>(startSource)
  let backend = $state<Backend>(startBackend)
  let motion = $state(query.get('motion') === 'on')
  let cache = $state(query.get('cache') === 'on')
  let renderScale = $state(1)
  const showPanel = query.get('panel') !== 'off'
  const onStage = query.get('target') === 'stage'

  $effect(() => {
    Object.assign(dither.settings, settings)
  })

  function choosePreset(name: DitherPresetName): void {
    preset = name
    settings = ditherPreset(name)
  }

  const SOURCE_CLEAR: Record<SourceName, string> = {
    blob: '#000000',
    sphere: '#ffffff',
    flower: '#000000',
  }

  /** The frame plus room on every side for the image to move through. */
  const MARGIN = { x: 240, y: 210 }

  // One round shape on a flat ground, shaded the way the brand art is. It is a
  // rect with a radial gradient, which ends on the ground color so the circle's
  // edge comes from the stops.
  function buildSource(name: SourceName): ShapeNode {
    const ground = SOURCE_CLEAR[name]
    const stops: Record<SourceName, [number, string][]> = {
      blob: [
        [0, '#ffffff'],
        [1, '#000000'],
      ],
      sphere: [
        [0, '#f2f2f2'],
        [0.5, '#8c8c8c'],
        [0.97, '#101010'],
        [1, ground],
      ],
      flower: [
        [0, '#ff9bea'],
        [0.3, '#b27cf0'],
        [0.6, '#5a0ba6'],
        [1, '#000000'],
      ],
    }
    const radius = name === 'sphere' ? 380 : 420
    const centerX = FRAME.width / 2 + MARGIN.x
    const centerY = FRAME.height / 2 + MARGIN.y
    const focus = name === 'sphere' ? -130 : 0
    const node = new ShapeNode({
      geometry: {
        kind: 'rect',
        width: FRAME.width + MARGIN.x * 2,
        height: FRAME.height + MARGIN.y * 2,
        centered: false,
      },
      fill: {
        kind: 'radial',
        cx: centerX,
        cy: centerY,
        r: radius,
        fx: centerX + focus,
        fy: centerY + focus,
        stops: stops[name].map(([offset, color]) => ({ offset, color })),
      },
    })
    node.transform.x = -MARGIN.x
    node.transform.y = -MARGIN.y
    return node
  }

  let host: EngineHost | null = null
  let layer: Layer | null = null
  let shape: ShapeNode | null = null

  function rebuild(): void {
    if (!host) return
    layer?.destroy()
    layer = new Layer({
      id: 'dither',
      space: { frame: FRAME },
      region: 'view',
      cache: cache ? 'raster' : 'none',
      clearColor: SOURCE_CLEAR[source],
      effects: onStage ? [] : [dither],
    })
    const holder = new Node2D('source')
    shape = buildSource(source)
    holder.add(shape)
    layer.add(holder)
    host.engine.tree.root.add(layer)
  }

  $effect(() => {
    void source
    void cache
    rebuild()
  })

  function onReady(ready: EngineHost): void {
    host = ready
    const camera = new CameraNode2D()
    camera.setViewport(FRAME)
    ready.engine.tree.root.add(camera)
    camera.makeCurrent()
    if (onStage) ready.engine.postProcess.add(dither)
    rebuild()
    let time = 0
    ready.engine.ticker.onFrame((dt) => {
      if (!motion || !shape) return
      time += dt
      shape.transform.x = -MARGIN.x + Math.cos(time * 0.8) * 220
      shape.transform.y = -MARGIN.y + Math.sin(time * 0.8) * 120
    })
    ready.start()
  }

  const patterns: DitherPattern[] = [
    'bayer2',
    'bayer4',
    'bayer8',
    'blue-noise',
    'white-noise',
    'gradient-noise',
    'diffusion',
    'none',
  ]
  const dots: DitherDot[] = [
    'square',
    'square-inset',
    'circle',
    'circle-am',
    'square-am',
  ]
  const palettes: DitherPalette[] = ['mono', 'ramp', 'nearest', 'source']
  const anchors: DitherAnchor[] = ['screen', 'layer']
  const options = <V extends string>(values: readonly V[]) =>
    values.map((value) => ({ value, label: value }))
</script>

<div class="dither-preview">
  {#key backend + renderScale}
    <canvas
      use:mountEngine={{
        backend,
        options: { clearColor: '#101010', renderScale },
        onReady,
      }}
    ></canvas>
  {/key}

  {#if showPanel}
    <div class="panel">
      <h2>Source</h2>
      <DebugSelect
        label="Preset"
        options={options(presetNames)}
        value={preset}
        onChange={choosePreset}
      />
      <DebugSelect
        label="Image"
        options={options(['blob', 'sphere', 'flower'] as const)}
        value={source}
        onChange={(v) => (source = v)}
      />
      <ToggleButton
        label="Move the image"
        active={motion}
        onToggle={() => (motion = !motion)}
      />
      <ToggleButton
        label="Cache the layer"
        active={cache}
        onToggle={() => (cache = !cache)}
      />

      <h2>Grid</h2>
      <DebugSlider
        label="Cell size"
        value={settings.cellSize}
        min={2}
        max={24}
        step={0.5}
        onInput={(v) => (settings.cellSize = v)}
      />
      <DebugSelect
        label="Anchor"
        options={options(anchors)}
        value={settings.anchor}
        onChange={(v) => (settings.anchor = v)}
      />
      <ToggleButton
        label="Snap to pixels"
        active={settings.snap}
        onToggle={() => (settings.snap = !settings.snap)}
      />

      <h2>Pattern and dots</h2>
      <DebugSelect
        label="Pattern"
        options={options(patterns)}
        value={settings.pattern}
        onChange={(v) => (settings.pattern = v)}
      />
      <DebugSelect
        label="Dot"
        options={options(dots)}
        value={settings.dot}
        onChange={(v) => (settings.dot = v)}
      />
      <DebugSlider
        label="Dot scale"
        value={settings.dotScale}
        min={0.5}
        max={1.2}
        step={0.01}
        onInput={(v) => (settings.dotScale = v)}
      />
      <DebugSlider
        label="Smallest dot"
        value={settings.dotMin}
        min={0}
        max={0.2}
        step={0.01}
        onInput={(v) => (settings.dotMin = v)}
      />
      <DebugSlider
        label="Softness"
        value={settings.softness}
        min={0}
        max={1.5}
        step={0.01}
        onInput={(v) => (settings.softness = v)}
      />
      <DebugSlider
        label="Levels"
        value={settings.levels}
        min={0}
        max={6}
        step={1}
        onInput={(v) => (settings.levels = v)}
      />
      <ToggleButton
        label="Reseed every frame"
        active={settings.temporal}
        onToggle={() => (settings.temporal = !settings.temporal)}
      />

      <h2>Tone</h2>
      <DebugSlider
        label="Gamma"
        value={settings.gamma}
        min={0.5}
        max={2.5}
        step={0.01}
        onInput={(v) => (settings.gamma = v)}
      />
      <DebugSlider
        label="Contrast"
        value={settings.contrast}
        min={0.5}
        max={2}
        step={0.01}
        onInput={(v) => (settings.contrast = v)}
      />
      <DebugSlider
        label="Brightness"
        value={settings.brightness}
        min={-0.3}
        max={0.3}
        step={0.01}
        onInput={(v) => (settings.brightness = v)}
      />
      <ToggleButton
        label="Invert"
        active={settings.invert}
        onToggle={() => (settings.invert = !settings.invert)}
      />
      <DebugSlider
        label="Alpha cutoff"
        value={settings.alphaThreshold}
        min={0}
        max={1}
        step={0.01}
        onInput={(v) => (settings.alphaThreshold = v)}
      />

      <h2>Color</h2>
      <DebugSelect
        label="Palette"
        options={options(palettes)}
        value={settings.palette}
        onChange={(v) => (settings.palette = v)}
      />
      <DebugSlider
        label="Palette spread"
        value={settings.paletteSpread}
        min={0}
        max={0.6}
        step={0.01}
        onInput={(v) => (settings.paletteSpread = v)}
      />
      <label class="color">
        Paper
        <input type="color" bind:value={settings.paper} />
      </label>
      <label class="color">
        Ink
        <input type="color" bind:value={settings.ink} />
      </label>

      <h2>Stage</h2>
      <DebugSelect
        label="Backend"
        options={options(['auto', 'webgpu', 'webgl2'] as const)}
        value={backend}
        onChange={(v) => (backend = v)}
      />
      <DebugSlider
        label="Render scale"
        value={renderScale}
        min={0.25}
        max={2}
        step={0.05}
        onChange={(v) => (renderScale = v)}
      />
    </div>
  {/if}
</div>

<style lang="sass">
  .dither-preview
    position: fixed
    inset: 0
    background: #000

  canvas
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    display: block

  .panel
    position: absolute
    top: 12px
    right: 12px
    width: 280px
    max-height: calc(100% - 24px)
    overflow-y: auto
    display: flex
    flex-direction: column
    gap: 4px
    padding: 10px
    background: rgba(10, 12, 18, 0.85)
    border: 1px solid rgba(255, 255, 255, 0.15)
    border-radius: 6px

  h2
    margin: 8px 0 2px
    font-size: 11px
    font-weight: 600
    text-transform: uppercase
    letter-spacing: 0.04em
    color: rgba(255, 255, 255, 0.6)

    &:first-child
      margin-top: 0

  .color
    display: flex
    align-items: center
    justify-content: space-between
    font-size: 12px
    color: rgba(255, 255, 255, 0.8)
</style>
