<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import type { DebugController, DebugStatsSnapshot } from './DebugController'
  import type { SceneNode } from '../scene/SceneNode'
  import {
    DebugPanel,
    DebugSection,
    DebugRow,
    FrameGraph,
    ToggleButton,
    HoldButton,
    DebugTree,
    DebugSelect,
    StageSelector,
    type TreeNode,
    type DebugSelectOption,
  } from './ui'
  import type { DebugRenderMode } from '../render/gfx/GpuGfx'

  interface Props {
    debug: DebugController
  }

  const { debug }: Props = $props()

  /**
   * Auto-subscribes to the controller's registered-panels store so any
   * `registerPanel(...)` call from a consumer immediately shows up (or
   * disappears on unregister) without a manual event bus. The IIFE silences
   * Svelte's "prop read at module scope" warning, `debug` lives for the
   * component's lifetime, so a one-time capture is intentional here.
   */
  const panels = (() => debug.panels)()

  const EMPTY_STATS: DebugStatsSnapshot = {
    p50: 0,
    p95: 0,
    p99: 0,
    max: 0,
    count: 0,
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
  }

  let visible = $state(false)
  let stats = $state<DebugStatsSnapshot>(EMPTY_STATS)
  // Bumped every rAF tick. Feeds FrameGraph so it redraws in step with the
  // stats snapshot without registering its own animation loop.
  let frameRevision = $state(0)
  let toggleState = $state({
    hud: false,
    camera: false,
    outlines: false,
    follow: false,
    grid: false,
    paused: false,
    pointerOverlay: false,
  })

  // Scene-tree state. Expanded set is preserved across ticks so drilling in
  // survives the ~1 Hz refresh. `SvelteSet` is inherently reactive — no need to
  // wrap in `$state`, and mutations (`.add` / `.delete` / `.clear`) fire
  // notifications without allocating a fresh Set on every toggle.
  const treeExpanded = new SvelteSet<string>()
  let treeNodes = $state<TreeNode[]>([])
  let lastTreeUpdate = 0

  let perfOpen = $state(true)
  let gpuOpen = $state(false)
  let coordsOpen = $state(false)
  let pointersOpen = $state(false)
  let cameraOpen = $state(false)
  let controlsOpen = $state(true)
  let padOpen = $state(false)
  let sceneOpen = $state(false)
  let treeOpen = $state(false)

  // GPU render-mode + MSAA are per-stage: reads and writes target
  // whichever stage the HUD is currently pointed at (see the stage chip
  // strip). Mirrors the active stage's live state every tick so external
  // toggles (URL flag, another panel, or a stage switch) stay in sync.
  // Perf marks are engine-wide, not stage-scoped.
  let renderMode = $state<DebugRenderMode>('normal')
  let msaaSamples = $state<number>(4)
  let perfMarks = $state(false)

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

  /**
   * Pull the active stage's GPU state into the dropdown-backing signals. Called
   * on mount and on every `stageChanged` event so a stage switch shows the
   * target stage's actual mode / MSAA, not the previous stage's.
   */
  function snapGpuControls(): void {
    const active = debug.activeStage
    const liveMode = active.getDebugRenderMode()
    if (liveMode !== null) renderMode = liveMode
    const liveSamples = active.getMsaaSamples()
    if (liveSamples !== null) msaaSamples = liveSamples
  }

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

  function reloadWithRenderer(mode: 'canvas2d' | 'gpu'): void {
    const url = new URL(window.location.href)
    url.searchParams.set('renderer', mode)
    window.location.href = url.toString()
  }

  let rafId: number | null = null

  // RAF polling, read engine state each frame without going through Svelte
  // reactivity on `frame` / `pointerMove`. See plan §"Engine ↔ app boundary".
  function tick(): void {
    if (!visible) {
      rafId = null
      return
    }
    stats = debug.snapshotStats()
    // Mirror the active stage's GPU state each frame so a stage switch
    // (or an external toggle) is reflected in the dropdowns without a
    // full re-hydrate.
    const active = debug.activeStage
    const liveMode = active.getDebugRenderMode()
    if (liveMode !== null && liveMode !== renderMode) renderMode = liveMode
    const liveSamples = active.getMsaaSamples()
    if (liveSamples !== null && liveSamples !== msaaSamples)
      msaaSamples = liveSamples
    if (debug.perfMarks !== perfMarks) perfMarks = debug.perfMarks
    frameRevision++
    // Scene-tree walk is O(nodes) and only useful when the section is open.
    // Throttled to ~1 Hz (plan §"debug UI component library"). Walks the
    // active stage's scene root so the tree retargets on chip-strip switch.
    if (treeOpen) {
      const now = performance.now()
      if (now - lastTreeUpdate > 1000) {
        lastTreeUpdate = now
        treeNodes = buildSceneTree(debug.activeStage.scene.root, treeExpanded)
      }
    }
    rafId = requestAnimationFrame(tick)
  }

  function buildSceneTree(root: SceneNode, expanded: Set<string>): TreeNode[] {
    const out: TreeNode[] = []
    visit(root, 0)
    function visit(node: SceneNode, depth: number): void {
      const type = node.constructor.name
      const layer = node.renderLayer
      const layerSuffix = layer === 'dynamic' ? '' : ` [${layer}]`
      const hiddenSuffix = node.visible ? '' : ' (hidden)'
      const particleSuffix =
        node.particleCount > 0 ? ` · ${node.particleCount}p` : ''
      const label = `${node.id} · ${type}${layerSuffix}${hiddenSuffix}${particleSuffix}`
      const hasChildren = node.children.length > 0
      const isExpanded = expanded.has(node.id)
      out.push({ id: node.id, label, depth, hasChildren, isExpanded })
      if (hasChildren && isExpanded) {
        for (const child of node.children) visit(child, depth + 1)
      }
    }
    return out
  }

  function toggleTreeNode(id: string): void {
    if (treeExpanded.has(id)) treeExpanded.delete(id)
    else treeExpanded.add(id)
    lastTreeUpdate = 0 // force refresh on next tick
    treeNodes = buildSceneTree(debug.activeStage.scene.root, treeExpanded)
  }

  function selectStage(id: string): void {
    const stage = debug.stageById(id)
    // stageById returns the primaryStage for 'primary', setActiveStage will
    // normalize that to null internally.
    debug.setActiveStage(stage)
    // Force an immediate tree refresh so the section reflects the new root
    // before the next 1 Hz throttle window closes.
    lastTreeUpdate = 0
    treeExpanded.clear()
    if (treeOpen) {
      treeNodes = buildSceneTree(debug.activeStage.scene.root, treeExpanded)
    }
    // Refresh stats immediately so section labels update this frame.
    stats = debug.snapshotStats()
  }

  onMount(() => {
    // Hydrate from the controller's current state once, subsequent updates
    // arrive via the `toggle` emitter.
    visible = debug.hudVisible
    toggleState = {
      hud: debug.hudVisible,
      camera: debug.cameraActive,
      outlines: debug.outlinesVisible,
      follow: debug.followGameCamera,
      grid: debug.gridVisible,
      paused: debug.paused,
      pointerOverlay: debug.pointerOverlayVisible,
    }
    stats = debug.snapshotStats()
    // Snap the GPU-section controls to whatever the active stage has now.
    snapGpuControls()
    perfMarks = debug.perfMarks

    const off = debug.events.on('toggle', (t) => {
      visible = t.hud
      toggleState = { ...t }
      if (visible && rafId === null) {
        rafId = requestAnimationFrame(tick)
      }
    })
    // Auto-refresh scene tree + stats + GPU controls when the active
    // stage changes. Covers both explicit selection and the auto-revert
    // on detach.
    const offStage = debug.events.on('stageChanged', () => {
      lastTreeUpdate = 0
      treeExpanded.clear()
      if (treeOpen) {
        treeNodes = buildSceneTree(debug.activeStage.scene.root, treeExpanded)
      }
      stats = debug.snapshotStats()
      snapGpuControls()
    })
    if (visible && rafId === null) {
      rafId = requestAnimationFrame(tick)
    }
    return () => {
      off()
      offStage()
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = null
    }
  })

  function fmtMs(sec: number): string {
    return `${(sec * 1000).toFixed(2)}ms`
  }

  function fmtFps(sec: number): string {
    if (sec <= 0) return ';'
    return Math.round(1 / sec).toString()
  }

  function fmtCoord(n: number): string {
    return n.toFixed(1)
  }

  function fmtPair(p: { x: number; y: number } | null): string {
    return p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}` : ';'
  }

  function activeStageLabel(s: DebugStatsSnapshot): string {
    const found = s.stages.find((chip) => chip.isActive)
    return found?.label ?? 'Primary'
  }

  const fpsTone = $derived(
    stats.p50 <= 0
      ? 'default'
      : 1 / stats.p50 < 15
        ? 'error'
        : 1 / stats.p50 < 30
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

  // Auto-enable the debug camera when a pad button is pressed. Without this,
  // pressing WASD/QE while cam is off would silently do nothing (the camera's
  // step() only runs when cameraActive), bad UX for a touch-only operator.
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
  // Suppress focus-on-click so keyboard focus never lands on debug buttons.  // WASD/QE keystrokes on desktop must reach DebugController without going
  // through a focused button first.
  function noFocus(e: PointerEvent): void {
    e.preventDefault()
  }
</script>

<DebugPanel
  {visible}
  side="left"
  title="stargazer debug"
  onClose={() => debug.toggleHud()}
>
  {#if stats.stages.length > 1}
    <StageSelector stages={stats.stages} onSelect={selectStage} />
  {/if}

  <DebugSection title="Performance" bind:open={perfOpen}>
    <FrameGraph
      stats={debug.frameStats}
      revision={frameRevision}
      active={perfOpen && visible}
    />
    <DebugRow label="FPS (p50)" value={fmtFps(stats.p50)} tone={fpsTone} />
    <DebugRow label="Frame p50" value={fmtMs(stats.p50)} />
    <DebugRow label="Frame p95" value={fmtMs(stats.p95)} tone={p95Tone} />
    <DebugRow label="Frame p99" value={fmtMs(stats.p99)} />
    <DebugRow label="Max" value={fmtMs(stats.max)} />
    <DebugRow label="Samples" value={stats.count} />
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
  </DebugSection>

  <DebugSection title="GPU" bind:open={gpuOpen}>
    <!-- Controls first, the operator's primary use of this section is
         toggling render modes / MSAA. Stats below are read-only diagnostics.
         `.with-divider` inserts a faint hairline between the two blocks. -->
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

  <DebugSection title="Camera" bind:open={cameraOpen}>
    <DebugRow
      label="Active"
      value={stats.cameraMode === 'debug'
        ? stats.cameraFollowing
          ? 'debug (follow)'
          : 'debug'
        : 'game'}
      tone={stats.cameraMode === 'debug' ? 'accent' : 'default'}
    />
    <DebugRow label="Viewport x" value={`${fmtCoord(stats.viewport.x)}`} />
    <DebugRow label="Viewport y" value={fmtCoord(stats.viewport.y)} />
    <DebugRow label="Viewport w" value={fmtCoord(stats.viewport.width)} />
    <DebugRow label="Viewport h" value={fmtCoord(stats.viewport.height)} />
    <DebugRow
      label="px / world"
      value={stats.screenPxPerWorldUnit.toFixed(3)}
    />
  </DebugSection>

  <DebugSection title="Scene" bind:open={sceneOpen}>
    <DebugRow label="Total nodes" value={stats.nodeCounts.total} />
    <DebugRow label="Static" value={stats.nodeCounts.static} />
    <DebugRow label="Above-static" value={stats.nodeCounts.aboveStatic} />
    <DebugRow label="Dynamic" value={stats.nodeCounts.dynamic} />
    <DebugRow label="Particles" value={stats.aliveParticles} tone="accent" />
    <DebugRow
      label="Static bakes/s"
      value={stats.staticBakesPerSecond}
      tone={stats.staticBakesPerSecond > 5 ? 'warning' : 'default'}
    />
    <DebugRow label="Static bakes total" value={stats.staticBakesTotal} />
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
      <ToggleButton
        active={toggleState.pointerOverlay}
        onToggle={() => debug.togglePointerOverlay()}
        label="Pointer overlay"
        hint="T"
      />
    </div>
  </DebugSection>

  <DebugSection title="Scene tree" bind:open={treeOpen}>
    {#if treeNodes.length === 0}
      <div class="empty-state">Empty</div>
    {:else}
      <DebugTree nodes={treeNodes} onToggle={toggleTreeNode} />
    {/if}
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

  <!--
    Consumer-registered panels, appended after every built-in section.
    Each panel gets `debug` plus whatever `props` its registerPanel call
    supplied. Keyed by the spec's stable id so re-registers reuse the
    same DOM node.
  -->
  {#each $panels as panel (panel.id)}
    <DebugSection title={panel.title}>
      <panel.component {debug} {...panel.props ?? {}} />
    </DebugSection>
  {/each}
</DebugPanel>

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

  .scope-hint
    padding: 6px 8px
    font-size: 10px
    color: rgba(255, 255, 255, 0.55)
    font-style: italic

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

  // Row 1: zoom out | up | zoom in
  .pad-zoom-out
    grid-column: 1
    grid-row: 1

  .pad-up
    grid-column: 2
    grid-row: 1

  .pad-zoom-in
    grid-column: 3
    grid-row: 1

  // Row 2: left | reset | right
  .pad-left
    grid-column: 1
    grid-row: 2

  .pad-reset
    grid-column: 2
    grid-row: 2

  .pad-right
    grid-column: 3
    grid-row: 2

  // Row 3: down centered; left/right cells stay empty.
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
