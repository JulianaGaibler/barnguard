<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import type { DebugController, DebugStatsSnapshot } from './DebugController'
  import {
    DraggableWindow,
    DebugSection,
    DebugRow,
    FrameGraph,
    ToggleButton,
    HoldButton,
    StageSelector,
  } from './ui'
  import RenderingPanel from './panels/RenderingPanel.svelte'
  import InputPanel from './panels/InputPanel.svelte'
  import ScenePanel from './panels/ScenePanel.svelte'
  import PhysicsPanel from './panels/PhysicsPanel.svelte'
  import { fmtMs, MISSING } from './panels/format'

  interface Props {
    debug: DebugController
  }

  const { debug }: Props = $props()

  /**
   * Auto-subscribes to the controller's registered-panels store so any
   * `registerPanel(...)` call from a consumer immediately shows up (or
   * disappears on unregister). The IIFE silences Svelte's "prop read at module
   * scope" warning, `debug` lives for the component's lifetime.
   */
  const panels = (() => debug.panels)()

  /**
   * Hub window's persisted-position key. Matches the id `DebugPanel` derived
   * from the title "stargazer debug", so operator window positions carry over
   * from before the multi-panel refactor. Subpanels spawn relative to it.
   */
  const HUB_STORAGE_ID = 'stargazer-debug-panel-stargazer-debug'

  const EMPTY_PHYSICS_FLAGS = {
    colliders: false,
    aabbs: false,
    contacts: false,
    velocities: false,
  }

  const EMPTY_STATS: DebugStatsSnapshot = {
    p50: 0,
    p95: 0,
    p99: 0,
    max: 0,
    count: 0,
    fps: 0,
    nodeCounts: { static: 0, aboveStatic: 0, dynamic: 0, total: 0 },
    cameraMode: 'game',
    cameraFollowing: false,
    viewport: { x: 0, y: 0, width: 0, height: 0 },
    screenPxPerWorldUnit: 0,
    pointerScreen: null,
    pointerWorld: null,
    canvasCss: { w: 0, h: 0 },
    canvasDevice: { w: 0, h: 0 },
    dpr: 1,
    activePointers: [],
    touchSlopScreen: 0,
    touchSlopWorld: 0,
    aliveParticles: 0,
    staticBakesTotal: 0,
    staticBakesPerSecond: 0,
    renderScale: 1,
    activeBitmaps: 0,
    stages: [
      { id: 'primary', label: 'Primary', isActive: true, isPrimary: true },
    ],
    activeStageId: 'primary',
    activeIsPrimary: true,
    activeHasInput: true,
    gpu: null,
    physics: [],
  }

  let visible = $state(false)
  let stats = $state<DebugStatsSnapshot>(EMPTY_STATS)
  // Bumped every rAF tick so canvas children (FrameGraph, previews) and the
  // subpanels' live-state syncs redraw in step without their own loops.
  let frameRevision = $state(0)
  let toggleState = $state({
    hud: false,
    camera: false,
    outlines: false,
    follow: false,
    grid: false,
    paused: false,
    pointerOverlay: false,
    physics: { ...EMPTY_PHYSICS_FLAGS },
  })

  // Hub section open-state.
  let stageOpen = $state(true)
  let perfOpen = $state(true)
  let panelsOpen = $state(true)
  let controlsOpen = $state(true)
  let padOpen = $state(false)

  // Subpanel window open-state. Each is an independent DraggableWindow.
  let renderingOpen = $state(false)
  let inputOpen = $state(false)
  let sceneOpen = $state(false)
  let physicsOpen = $state(false)
  // Open consumer-registered panels, keyed by spec id.
  const consumerOpen = new SvelteSet<string>()

  // --- windowing ------------------------------------------------------

  function anyOpen(): boolean {
    return (
      visible ||
      renderingOpen ||
      inputOpen ||
      sceneOpen ||
      physicsOpen ||
      consumerOpen.size > 0
    )
  }

  let rafId: number | null = null

  /** Start the rAF poll if something is open and it isn't already running. */
  function ensureTicking(): void {
    if (rafId === null && anyOpen()) {
      rafId = requestAnimationFrame(tick)
    }
  }

  function toggleConsumer(id: string): void {
    if (consumerOpen.has(id)) consumerOpen.delete(id)
    else {
      consumerOpen.add(id)
      ensureTicking()
    }
  }

  // RAF poll: read engine state each frame without routing high-frequency
  // `frame` events through Svelte reactivity. Runs while any window is open;
  // stops (and does zero work) once everything is closed.
  function tick(): void {
    if (!anyOpen()) {
      rafId = null
      return
    }
    stats = debug.snapshotStats()
    frameRevision++
    rafId = requestAnimationFrame(tick)
  }

  function selectStage(id: string): void {
    const stage = debug.stageById(id)
    // stageById returns primaryStage for 'primary'; setActiveStage normalizes
    // that to null internally. Panels retarget via the `stageChanged` event.
    debug.setActiveStage(stage)
    stats = debug.snapshotStats()
  }

  onMount(() => {
    // Hydrate from the controller once; later updates arrive via `toggle`.
    visible = debug.hudVisible
    toggleState = {
      hud: debug.hudVisible,
      camera: debug.cameraActive,
      outlines: debug.outlinesVisible,
      follow: debug.followGameCamera,
      grid: debug.gridVisible,
      paused: debug.paused,
      pointerOverlay: debug.pointerOverlayVisible,
      physics: { ...debug.physicsFlags },
    }
    stats = debug.snapshotStats()

    const off = debug.events.on('toggle', (t) => {
      visible = t.hud
      toggleState = { ...t }
      ensureTicking()
    })
    ensureTicking()
    return () => {
      off()
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = null
    }
  })

  // --- camera pad -----------------------------------------------------

  // Auto-enable the debug camera on a pad press; the camera's step() only runs
  // when cameraActive, so without this a press would silently do nothing.
  function ensureDebugCamera(): void {
    if (!debug.cameraActive) debug.toggleCamera()
  }
  function pressPan(code: string): void {
    ensureDebugCamera()
    debug.camera.setKey(code, true)
  }
  function releasePan(code: string): void {
    debug.camera.setKey(code, false)
  }
  function resetPan(e: MouseEvent): void {
    ensureDebugCamera()
    debug.resetDebugCamera()
    ;(e.currentTarget as HTMLButtonElement).blur()
  }
  // Suppress focus-on-click so keyboard focus never lands on debug buttons,
  // WASD/QE keystrokes must reach DebugController, not a focused button.
  function noFocus(e: PointerEvent): void {
    e.preventDefault()
  }

  // --- derived --------------------------------------------------------

  const fpsTone = $derived(
    stats.fps <= 0
      ? 'default'
      : stats.fps < 15
        ? 'error'
        : stats.fps < 30
          ? 'warning'
          : 'default',
  )

  const p95Tone = $derived(
    stats.p95 * 1000 > 33
      ? 'error'
      : stats.p95 * 1000 > 16.7
        ? 'warning'
        : 'default',
  )

  function activeStageLabel(s: DebugStatsSnapshot): string {
    const found = s.stages.find((chip) => chip.isActive)
    return found?.label ?? 'Primary'
  }
</script>

<!-- Hub window -->
<DraggableWindow
  {visible}
  title="stargazer debug"
  storageId={HUB_STORAGE_ID}
  side="left"
  onClose={() => debug.toggleHud()}
>
  {#if stats.stages.length > 1}
    <DebugSection title="Stage" bind:open={stageOpen}>
      <StageSelector stages={stats.stages} onSelect={selectStage} />
    </DebugSection>
  {/if}

  <DebugSection title="Performance" bind:open={perfOpen}>
    <FrameGraph
      stats={debug.frameStats}
      revision={frameRevision}
      active={perfOpen && visible}
    />
    <DebugRow
      label="FPS"
      value={stats.fps > 0 ? Math.round(stats.fps).toString() : MISSING}
      tone={fpsTone}
    />
    <DebugRow label="CPU p50" value={fmtMs(stats.p50)} />
    <DebugRow label="CPU p95" value={fmtMs(stats.p95)} tone={p95Tone} />
    <DebugRow label="CPU p99" value={fmtMs(stats.p99)} />
    <DebugRow label="CPU max" value={fmtMs(stats.max)} />
    <DebugRow label="Samples" value={stats.count} />
  </DebugSection>

  <DebugSection title="Panels" bind:open={panelsOpen}>
    <div class="debug-controls">
      <ToggleButton
        active={renderingOpen}
        onToggle={() => {
          renderingOpen = !renderingOpen
          ensureTicking()
        }}
        label="Rendering"
      />
      <ToggleButton
        active={inputOpen}
        onToggle={() => {
          inputOpen = !inputOpen
          ensureTicking()
        }}
        label="Input"
      />
      <ToggleButton
        active={sceneOpen}
        onToggle={() => {
          sceneOpen = !sceneOpen
          ensureTicking()
        }}
        label="Scene"
      />
      {#if stats.physics.length > 0}
        <ToggleButton
          active={physicsOpen}
          onToggle={() => {
            physicsOpen = !physicsOpen
            ensureTicking()
          }}
          label="Physics"
        />
      {/if}
      {#each $panels as panel (panel.id)}
        <ToggleButton
          active={consumerOpen.has(panel.id)}
          onToggle={() => toggleConsumer(panel.id)}
          label={panel.title}
        />
      {/each}
    </div>
  </DebugSection>

  <DebugSection title="Controls" bind:open={controlsOpen}>
    <div class="debug-controls">
      <ToggleButton
        active={toggleState.paused}
        onToggle={() => debug.togglePause()}
        label="Pause"
        hint="P"
      />
      {#if stats.stages.length > 1}
        <div class="controls-scope">
          Stage-scoped toggles apply to <strong
            >{activeStageLabel(stats)}</strong
          >.
        </div>
      {/if}
      <ToggleButton
        active={toggleState.camera}
        onToggle={() => debug.toggleCamera()}
        label="Debug camera"
        hint="C"
      />
      <ToggleButton
        active={toggleState.follow}
        onToggle={() => debug.toggleFollow()}
        label="Follow game camera"
        hint="G"
        disabled={!toggleState.camera}
      />
      <ToggleButton
        active={toggleState.outlines}
        onToggle={() => debug.toggleOutlines()}
        label="Node outlines"
        hint="O"
      />
      <ToggleButton
        active={toggleState.grid}
        onToggle={() => debug.toggleGrid()}
        label="Coordinate grid"
        hint="X"
      />
    </div>
  </DebugSection>

  <DebugSection title="Camera pad" bind:open={padOpen}>
    <div class="camera-pad">
      <div class="pad-cell pad-zoom-out">
        <HoldButton
          ariaLabel="Zoom out"
          onPress={() => pressPan('KeyQ')}
          onRelease={() => releasePan('KeyQ')}
        >
          −
        </HoldButton>
      </div>
      <div class="pad-cell pad-up">
        <HoldButton
          ariaLabel="Pan up"
          onPress={() => pressPan('KeyW')}
          onRelease={() => releasePan('KeyW')}
        >
          ↑
        </HoldButton>
      </div>
      <div class="pad-cell pad-zoom-in">
        <HoldButton
          ariaLabel="Zoom in"
          onPress={() => pressPan('KeyE')}
          onRelease={() => releasePan('KeyE')}
        >
          +
        </HoldButton>
      </div>
      <div class="pad-cell pad-left">
        <HoldButton
          ariaLabel="Pan left"
          onPress={() => pressPan('KeyA')}
          onRelease={() => releasePan('KeyA')}
        >
          ←
        </HoldButton>
      </div>
      <div class="pad-cell pad-reset">
        <button
          type="button"
          class="pad-reset-btn"
          onpointerdown={noFocus}
          onclick={resetPan}
          aria-label="Reset debug camera to game viewport"
          title="Reset (R)"
        >
          ⌂
        </button>
      </div>
      <div class="pad-cell pad-right">
        <HoldButton
          ariaLabel="Pan right"
          onPress={() => pressPan('KeyD')}
          onRelease={() => releasePan('KeyD')}
        >
          →
        </HoldButton>
      </div>
      <div class="pad-cell pad-down">
        <HoldButton
          ariaLabel="Pan down"
          onPress={() => pressPan('KeyS')}
          onRelease={() => releasePan('KeyS')}
        >
          ↓
        </HoldButton>
      </div>
    </div>
    <div class="pad-hint">
      Press-and-hold. Any press auto-enables the debug camera.
    </div>
  </DebugSection>
</DraggableWindow>

<!-- Subpanel windows, spawned beside the hub. Each mounts only while open. -->
<DraggableWindow
  visible={renderingOpen}
  title="Rendering"
  storageId="stargazer-debug-panel-rendering"
  spawnedBy={HUB_STORAGE_ID}
  side="left"
  width={300}
  onClose={() => (renderingOpen = false)}
>
  <RenderingPanel {debug} {stats} revision={frameRevision} />
</DraggableWindow>

<DraggableWindow
  visible={inputOpen}
  title="Input"
  storageId="stargazer-debug-panel-input"
  spawnedBy={HUB_STORAGE_ID}
  side="left"
  onClose={() => (inputOpen = false)}
>
  <InputPanel {debug} {stats} pointerOverlay={toggleState.pointerOverlay} />
</DraggableWindow>

<DraggableWindow
  visible={sceneOpen}
  title="Scene"
  storageId="stargazer-debug-panel-scene"
  spawnedBy={HUB_STORAGE_ID}
  side="left"
  width={300}
  onClose={() => (sceneOpen = false)}
>
  <ScenePanel {debug} {stats} revision={frameRevision} />
</DraggableWindow>

<DraggableWindow
  visible={physicsOpen}
  title="Physics"
  storageId="stargazer-debug-panel-physics"
  spawnedBy={HUB_STORAGE_ID}
  side="left"
  onClose={() => (physicsOpen = false)}
>
  <PhysicsPanel {debug} {stats} flags={toggleState.physics} />
</DraggableWindow>

<!--
  Consumer-registered panels, each its own launchable window. The component
  receives `debug` plus whatever `props` its registerPanel call supplied.
-->
{#each $panels as panel (panel.id)}
  <DraggableWindow
    visible={consumerOpen.has(panel.id)}
    title={panel.title}
    storageId={`stargazer-debug-panel-consumer-${panel.id}`}
    spawnedBy={HUB_STORAGE_ID}
    side="left"
    onClose={() => consumerOpen.delete(panel.id)}
  >
    <panel.component {debug} {...panel.props ?? {}} />
  </DraggableWindow>
{/each}

<style lang="sass">
  .controls-scope
    padding: 4px 6px
    font-size: 10px
    color: rgba(255, 255, 255, 0.55)
    background: rgba(255, 255, 255, 0.03)
    border-left: 2px solid rgba(96, 165, 250, 0.6)
    border-radius: 2px
    line-height: 1.3

    strong
      color: rgba(255, 255, 255, 0.9)
      font-weight: 600

  .camera-pad
    display: grid
    grid-template-columns: repeat(3, 1fr)
    grid-template-rows: repeat(3, 44px)
    gap: 4px
    padding: 2px 0

  .pad-cell
    display: flex
    align-items: stretch
    justify-content: stretch

    :global(button)
      width: 100%
      height: 100%

  .pad-zoom-out
    grid-column: 1
    grid-row: 1

  .pad-up
    grid-column: 2
    grid-row: 1

  .pad-zoom-in
    grid-column: 3
    grid-row: 1

  .pad-left
    grid-column: 1
    grid-row: 2

  .pad-reset
    grid-column: 2
    grid-row: 2

  .pad-right
    grid-column: 3
    grid-row: 2

  .pad-down
    grid-column: 2
    grid-row: 3

  .pad-reset-btn
    background: rgba(192, 132, 252, 0.15)
    border: 1px solid rgba(192, 132, 252, 0.45)
    border-radius: 4px
    color: #e9d5ff
    font-family: inherit
    font-size: 15px
    font-weight: 600
    line-height: 1
    padding: 0
    cursor: pointer
    user-select: none
    -webkit-user-select: none
    touch-action: manipulation

    &:hover
      background: rgba(192, 132, 252, 0.25)
      border-color: rgba(192, 132, 252, 0.7)

    &:active
      transform: translateY(1px)

  .pad-hint
    margin-top: 4px
    font-size: 9px
    color: rgba(255, 255, 255, 0.45)
    text-align: center
</style>
