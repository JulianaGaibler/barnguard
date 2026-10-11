<script lang="ts">
  /**
   * Dev surface for the brand background composite: Dual Kawase blur, slice
   * shift, film grain, over a placeholder backdrop. Mounted directly by
   * `main.ts` for a `?backdrop` run, bypassing the booth chrome. Proves the
   * custom-shader path end to end and gives a place to tune parameters visually
   * before the real display adopts them.
   */
  import {
    mountEngine,
    ShapeNode,
    CameraNode2D,
    DualKawaseBlur,
    FilmGrain,
    type EngineHost,
  } from '@src/stargazer'
  import { DebugSlider } from '@src/stargazer/debug/ui'
  import { SliceShift } from './SliceShift'

  const blur = new DualKawaseBlur()
  const slice = new SliceShift()
  const grain = new FilmGrain()

  // A canvas remount is the only way to apply a new `renderScale`, since the
  // backing-store size it drives is fixed at `Stage` construction. The
  // `{#key}` block below forces that remount on change.
  let renderScale = $state(1)

  let levels = $state(blur.levels)
  let offset = $state(blur.offset)
  let shift = $state(slice.shift)
  let angle = $state(slice.angle)
  let centerX = $state(slice.centerX)
  let centerY = $state(slice.centerY)
  let barWidth = $state(slice.barWidth)
  let cellPx = $state(grain.cellPx)
  let density = $state(grain.density)
  let opacity = $state(grain.opacity)
  let hz = $state(grain.hz)

  $effect(() => {
    blur.levels = levels
  })
  $effect(() => {
    blur.offset = offset
  })
  $effect(() => {
    slice.shift = shift
  })
  $effect(() => {
    slice.angle = angle
  })
  $effect(() => {
    slice.centerX = centerX
  })
  $effect(() => {
    slice.centerY = centerY
  })
  $effect(() => {
    slice.barWidth = barWidth
  })
  $effect(() => {
    grain.cellPx = cellPx
  })
  $effect(() => {
    grain.density = density
  })
  $effect(() => {
    grain.opacity = opacity
  })
  $effect(() => {
    grain.hz = hz
  })

  const BLOBS: { x: number; y: number; r: number; fill: string }[] = [
    { x: -90, y: -30, r: 55, fill: '#ffd34d' },
    { x: 70, y: 15, r: 75, fill: '#fb2872' },
    { x: 0, y: -45, r: 40, fill: '#36ffb9' },
    { x: -30, y: 55, r: 35, fill: '#f60' },
  ]

  function onReady(host: EngineHost): void {
    const cam = new CameraNode2D()
    cam.setViewport({ x: -160, y: -90, width: 320, height: 180 })
    host.engine.tree.root.add(cam)
    cam.makeCurrent()

    for (const b of BLOBS) {
      const node = new ShapeNode({
        geometry: { kind: 'circle', radius: b.r },
        fill: b.fill,
      })
      node.transform.x = b.x
      node.transform.y = b.y
      host.engine.tree.root.add(node)
    }

    host.engine.postProcess.add(blur)
    host.engine.postProcess.add(slice)
    host.engine.postProcess.add(grain)
    host.engine.postProcess.warm()
    host.start()
  }
</script>

<div class="backdrop-preview">
  {#key renderScale}
    <canvas
      use:mountEngine={{
        options: { clearColor: '#223663', renderScale },
        onReady,
      }}
    ></canvas>
  {/key}

  <div class="panel">
    <h2>Dual Kawase blur</h2>
    <DebugSlider
      label="Levels"
      value={levels}
      min={1}
      max={6}
      step={1}
      onInput={(v) => (levels = v)}
    />
    <DebugSlider
      label="Offset"
      value={offset}
      min={0.5}
      max={8}
      step={0.1}
      onInput={(v) => (offset = v)}
    />

    <h2>Slice shift</h2>
    <DebugSlider
      label="Shift"
      value={shift}
      min={-200}
      max={200}
      step={1}
      onInput={(v) => (shift = v)}
    />
    <DebugSlider
      label="Angle"
      value={angle}
      min={-180}
      max={180}
      step={1}
      onInput={(v) => (angle = v)}
    />
    <DebugSlider
      label="Center X"
      value={centerX}
      min={0}
      max={100}
      step={1}
      onInput={(v) => (centerX = v)}
    />
    <DebugSlider
      label="Center Y"
      value={centerY}
      min={0}
      max={100}
      step={1}
      onInput={(v) => (centerY = v)}
    />
    <DebugSlider
      label="Bar width"
      value={barWidth}
      min={4}
      max={400}
      step={1}
      onInput={(v) => (barWidth = v)}
    />

    <h2>Film grain</h2>
    <DebugSlider
      label="Cell px"
      value={cellPx}
      min={1}
      max={8}
      step={0.5}
      onInput={(v) => (cellPx = v)}
    />
    <DebugSlider
      label="Density"
      value={density}
      min={0}
      max={1}
      step={0.01}
      onInput={(v) => (density = v)}
    />
    <DebugSlider
      label="Opacity"
      value={opacity}
      min={0}
      max={1}
      step={0.01}
      onInput={(v) => (opacity = v)}
    />
    <DebugSlider
      label="Hz"
      value={hz}
      min={0}
      max={60}
      step={1}
      onInput={(v) => (hz = v)}
    />

    <h2>Stage</h2>
    <DebugSlider
      label="Render scale"
      value={renderScale}
      min={0.1}
      max={2}
      step={0.05}
      onChange={(v) => (renderScale = v)}
    />
  </div>
</div>

<style lang="sass">
  .backdrop-preview
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
    width: 260px
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
</style>
