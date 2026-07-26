<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import type { DebugController, DebugStatsSnapshot } from '../DebugController'
  import type { Node, NodeKind } from '../../scene/Node'
  import type { Node2D, RenderLayer } from '../../scene/Node2D'
  import type { Node3D } from '../../scene/Node3D'
  import { MeshNode } from '../../nodes/MeshNode'
  import { Viewport2DNode } from '../../nodes/Viewport2DNode'
  import { CameraNode2D } from '../../camera/CameraNode2D'
  import { CameraNode3D } from '../../camera/CameraNode3D'
  import { PhysicsWorldBehavior } from '../../physics/PhysicsWorldBehavior'
  import { RigidBodyBehavior } from '../../physics/RigidBodyBehavior'
  import { DebugSection, DebugRow, DebugTree, type TreeNode } from '../ui'
  import { isMeasurable } from '../../layout/LayoutNode'
  import { fmtCoord } from './format'

  interface Props {
    debug: DebugController
    stats: DebugStatsSnapshot
    /** Bumped by the hub's rAF tick; drives the throttled tree refresh. */
    revision: number
  }

  const { debug, stats, revision }: Props = $props()

  let cameraOpen = $state(false)
  let sceneOpen = $state(false)
  let treeOpen = $state(true)
  let selectedOpen = $state(true)

  /** Metadata attached to each tree row, read by the row snippet. */
  interface NodeMeta {
    node: Node
    /**
     * What the overlay highlights when this row is selected. Usually `node`,
     * but for a node inside a `Viewport2DNode`'s embedded scene it's the
     * containing viewport quad — that node lives in an offscreen texture space,
     * so its own outline can't be drawn in the main overlay.
     */
    highlightTarget: Node
    type: string
    kind: NodeKind
    dot: string
    visible: boolean
    /** 2D render layer, or `null` for 3D/group nodes. */
    layer: RenderLayer | null
    /** Alive particles (2D emitters); 0 otherwise. */
    particleCount: number
    /** Triangle count (3D meshes); 0 otherwise. */
    tris: number
    isWorldHost: boolean
    hasRigidBody: boolean
    behaviors: string[]
    accent: string | null
    /** True for a `CameraNode2D` / `CameraNode3D`. */
    isCamera: boolean
    /** True when this camera is the current one on its stage. */
    isCurrentCamera: boolean
    // Index signature so a NodeMeta satisfies TreeNode's `metadata` bag.
    [key: string]: unknown
  }

  // Dot color per built-in node type.
  const TYPE_COLORS: Record<string, string> = {
    Node2D: '#94a3b8',
    ShapeNode: '#38bdf8',
    Path2DNode: '#a78bfa',
    PolylineNode: '#34d399',
    TextNode: '#fbbf24',
    ParticleEmitterNode: '#fb7185',
    // 3D node types read as a purple/violet family.
    Node3D: '#c4b5fd',
    MeshNode: '#c084fc',
    Viewport2DNode: '#e879f9',
    // Cameras read as amber, distinct from content.
    CameraNode2D: '#f59e0b',
    CameraNode3D: '#f59e0b',
    // Neutral grouping.
    GroupNode: '#64748b',
    // Layout containers read as a teal/green family, apart from the primitives.
    LayoutRoot: '#059669',
    Box: '#10b981',
    SizedBox: '#10b981',
    Padding: '#14b8a6',
    Align: '#2dd4bf',
    Center: '#2dd4bf',
    Row: '#22d3ee',
    Column: '#06b6d4',
    Flex: '#0891b2',
    Stack: '#84cc16',
    Scaffold: '#4ade80',
    Expanded: '#6ee7b7',
    Flexible: '#6ee7b7',
    Spacer: '#a7f3d0',
  }
  // Custom (game) node types get a stable color hashed from their name, so they
  // stand apart from the built-ins and from each other rather than all reading
  // as one neutral.
  const CUSTOM_TYPE_COLORS = [
    '#f472b6',
    '#fb923c',
    '#2dd4bf',
    '#c084fc',
    '#a3e635',
    '#f59e0b',
  ]

  /** Human-readable ortho<->perspective blend for the 3D camera readout. */
  function fmtProjection(t: number): string {
    if (t <= 0.001) return 'orthographic'
    if (t >= 0.999) return 'perspective'
    return `blend ${Math.round(t * 100)}%`
  }

  function colorForType(type: string): string {
    const known = TYPE_COLORS[type]
    if (known) return known
    let h = 0
    for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) | 0
    return CUSTOM_TYPE_COLORS[Math.abs(h) % CUSTOM_TYPE_COLORS.length]
  }

  // Expanded set survives the ~1 Hz refresh; `SvelteSet` is reactive without a
  // fresh allocation per toggle.
  const treeExpanded = new SvelteSet<string>()
  let treeNodes = $state<TreeNode[]>([])
  let lastTreeUpdate = 0
  let selectedId = $state<string | null>(null)

  /**
   * Build one flat, depth-tagged list from the whole tree (2D, 3D, and group
   * nodes together). A `Viewport2DNode`'s embedded 2D scene is shown nested
   * under it (the SubViewport bridge). Rows are keyed by tree path, not
   * `node.id` (ids aren't unique; a duplicate key would cross-link
   * expansion/selection).
   */
  function buildTree(root: Node, expanded: Set<string>): TreeNode[] {
    const out: TreeNode[] = []
    const roots = root.children
    for (let i = 0; i < roots.length; i++) visit(roots[i], 0, `r${i}`, null)
    return out

    // `embeddedIn` is the containing Viewport2DNode when walking its embedded 2D
    // scene, so those rows highlight the viewport quad instead of themselves.
    function visit(
      node: Node,
      depth: number,
      key: string,
      embeddedIn: Node | null,
    ): void {
      const type = node.constructor.name
      const is2d = node.kind === '2d'
      const n2 = is2d ? (node as Node2D) : null
      const isWorldHost = n2
        ? n2.getBehavior(PhysicsWorldBehavior) !== null
        : false
      const stage = debug.activeStage
      const isCamera =
        node instanceof CameraNode2D || node instanceof CameraNode3D
      const isCurrentCamera =
        (node instanceof CameraNode2D && stage.currentCamera2D === node) ||
        (node instanceof CameraNode3D && stage.currentCamera3D === node)
      const meta: NodeMeta = {
        node,
        highlightTarget: embeddedIn ?? node,
        type,
        kind: node.kind,
        dot: colorForType(type),
        visible: node.visible,
        layer: n2 ? n2.renderLayer : null,
        particleCount: n2 ? n2.particleCount : 0,
        tris:
          node instanceof MeshNode && node.geometry
            ? node.geometry.indices.length / 3
            : 0,
        isWorldHost,
        hasRigidBody: n2 ? n2.getBehavior(RigidBodyBehavior) !== null : false,
        behaviors: node.behaviors.map((b) => b.constructor.name),
        accent: isWorldHost && n2 ? debug.overlayAccentForNode(n2) : null,
        isCamera,
        isCurrentCamera,
      }
      // Regular children, plus a Viewport2DNode's embedded 2D scene root.
      const kids = node.children
      const innerKids =
        node instanceof Viewport2DNode ? node.scene.root.children : []
      const hasChildren = kids.length > 0 || innerKids.length > 0
      const isExpanded = expanded.has(key)
      out.push({
        id: key,
        label: node.id,
        depth,
        hasChildren,
        isExpanded,
        metadata: meta,
      })
      if (hasChildren && isExpanded) {
        for (let i = 0; i < kids.length; i++) {
          visit(kids[i], depth + 1, `${key}.${i}`, embeddedIn)
        }
        // Descendants of a Viewport2DNode's embedded scene highlight the viewport.
        const innerOwner = node instanceof Viewport2DNode ? node : embeddedIn
        for (let i = 0; i < innerKids.length; i++) {
          visit(innerKids[i], depth + 1, `${key}.s${i}`, innerOwner)
        }
      }
    }
  }

  function rebuild(): void {
    treeNodes = buildTree(debug.activeStage.tree.root, treeExpanded)
  }

  function nodeOf(id: string | null): Node | null {
    if (!id) return null
    const row = treeNodes.find((n) => n.id === id)
    return row ? (row.metadata as NodeMeta).node : null
  }

  function toggleTreeNode(id: string): void {
    if (treeExpanded.has(id)) treeExpanded.delete(id)
    else treeExpanded.add(id)
    lastTreeUpdate = 0 // force refresh on next tick
    rebuild()
  }

  function selectNode(id: string): void {
    selectedId = selectedId === id ? null : id
    const row = selectedId ? treeNodes.find((n) => n.id === selectedId) : null
    const target = row ? (row.metadata as NodeMeta).highlightTarget : null
    debug.setHighlighted(target)
  }

  function clearSelection(): void {
    selectedId = null
    debug.setHighlighted(null)
  }

  // Live properties of the selected node, refreshed on the hub tick. Shape
  // varies by kind: 2D nodes show affine transform + layer, 3D nodes show the
  // 3D transform, group nodes just identity + visibility.
  const selected = $derived.by(() => {
    void revision
    const node = nodeOf(selectedId)
    if (!node) return null
    const type = node.constructor.name
    const stage = debug.activeStage
    const isCamera =
      node instanceof CameraNode2D || node instanceof CameraNode3D
    const isCurrentCamera =
      (node instanceof CameraNode2D && stage.currentCamera2D === node) ||
      (node instanceof CameraNode3D && stage.currentCamera3D === node)
    const makeCurrent = (): void => {
      if (node instanceof CameraNode2D || node instanceof CameraNode3D) {
        node.makeCurrent()
        rebuild()
      }
    }
    const base = {
      id: node.id,
      type,
      dot: colorForType(type),
      visible: node.visible,
      behaviors: node.behaviors.map((b) => b.constructor.name),
      isCamera,
      isCurrentCamera,
      makeCurrent,
    }
    if (node.kind === '2d') {
      const n = node as Node2D
      const t = n.transform
      return {
        ...base,
        kind: '2d' as const,
        x: t.x,
        y: t.y,
        rotation: t.rotation,
        rotationDeg: (t.rotation * 180) / Math.PI,
        scaleX: t.scaleX,
        scaleY: t.scaleY,
        alpha: t.alpha,
        layer: n.renderLayer,
        bounds: n.debugBounds,
        measured: isMeasurable(n)
          ? { w: n.measuredSize.w, h: n.measuredSize.h }
          : null,
      }
    }
    if (node.kind === '3d') {
      const t = (node as Node3D).transform
      return {
        ...base,
        kind: '3d' as const,
        pos: t.position,
        scale3: t.scale,
        alpha: t.alpha,
      }
    }
    return { ...base, kind: 'group' as const }
  })

  // Live camera registry for the active stage (node-based camera model). Each
  // stage tracks a current 2D + 3D camera; `make` switches it.
  const cameras = $derived.by(() => {
    void revision
    const stage = debug.activeStage
    return {
      list2d: stage.cameras2d.map((c) => ({
        id: c.id,
        current: stage.currentCamera2D === c,
        intrinsic: c.intrinsic,
        make: () => {
          c.makeCurrent()
          rebuild()
        },
      })),
      list3d: stage.cameras3d.map((c) => ({
        id: c.id,
        current: stage.currentCamera3D === c,
        intrinsic: c.intrinsic,
        make: () => {
          c.makeCurrent()
          rebuild()
        },
      })),
    }
  })

  // Throttled (~1 Hz) tree rebuild, only while the tree section is open. The
  // walk is O(nodes), so it stays off the hot path otherwise.
  $effect(() => {
    void revision
    if (!treeOpen) return
    const now = performance.now()
    if (now - lastTreeUpdate <= 1000) return
    lastTreeUpdate = now
    rebuild()
    // Drop a selection whose node left the tree (collapsed away or destroyed).
    if (selectedId && !treeNodes.some((n) => n.id === selectedId)) {
      clearSelection()
    }
  })

  onMount(() => {
    // Retarget the tree when the active stage changes (explicit switch or the
    // auto-revert on detach): drop stale expansion + selection, force a rebuild.
    const offStage = debug.events.on('stageChanged', () => {
      treeExpanded.clear()
      clearSelection()
      lastTreeUpdate = 0
      if (treeOpen) rebuild()
    })
    return () => {
      offStage()
      debug.setHighlighted(null)
    }
  })
</script>

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

  <!-- Current 2D camera + the registry (click a non-current one to make it current). -->
  <div class="cam-list">
    {#each cameras.list2d as c (c.id)}
      <button
        type="button"
        class="cam-item"
        class:current={c.current}
        disabled={c.current}
        title={c.current ? 'Current camera' : `Make "${c.id}" current`}
        onclick={c.make}
      >
        <span class="cam-mark">{c.current ? '●' : '○'}</span>
        <span class="cam-name">{c.id}</span>
        {#if c.intrinsic}<span class="chip muted">default</span>{/if}
      </button>
    {/each}
  </div>

  <DebugRow label="Viewport x" value={fmtCoord(stats.viewport.x)} />
  <DebugRow label="Viewport y" value={fmtCoord(stats.viewport.y)} />
  <DebugRow label="Viewport w" value={fmtCoord(stats.viewport.width)} />
  <DebugRow label="Viewport h" value={fmtCoord(stats.viewport.height)} />
  <DebugRow label="px / world" value={stats.screenPxPerWorldUnit.toFixed(3)} />

  {#if stats.world3d}
    <div class="cam-sub">3D</div>
    <DebugRow
      label="Mode"
      value={stats.world3d.cameraMode}
      tone={stats.world3d.cameraMode === 'debug' ? 'accent' : 'default'}
    />
    <div class="cam-list">
      {#each cameras.list3d as c (c.id)}
        <button
          type="button"
          class="cam-item"
          class:current={c.current}
          disabled={c.current}
          title={c.current ? 'Current camera' : `Make "${c.id}" current`}
          onclick={c.make}
        >
          <span class="cam-mark">{c.current ? '●' : '○'}</span>
          <span class="cam-name">{c.id}</span>
          {#if c.intrinsic}<span class="chip muted">default</span>{/if}
        </button>
      {/each}
    </div>
    <DebugRow
      label="Projection"
      value={fmtProjection(stats.world3d.camera.projectionness)}
    />
    <DebugRow label="FOV" value={`${stats.world3d.camera.fovY.toFixed(0)}°`} />
    <DebugRow
      label="Near / Far"
      value={`${stats.world3d.camera.near} / ${stats.world3d.camera.far}`}
    />
    <DebugRow
      label="Focal dist"
      value={stats.world3d.camera.focalDistance.toFixed(1)}
    />
    <DebugRow
      label="Eye"
      value={`${stats.world3d.camera.position.x.toFixed(1)}, ${stats.world3d.camera.position.y.toFixed(1)}, ${stats.world3d.camera.position.z.toFixed(1)}`}
    />
  {/if}
</DebugSection>

<DebugSection title="Scene" bind:open={sceneOpen}>
  <DebugRow label="Total nodes" value={stats.nodeCounts.total} />
  <DebugRow label="Static" value={stats.nodeCounts.static} />
  <DebugRow label="Above-static" value={stats.nodeCounts.aboveStatic} />
  <DebugRow label="Dynamic" value={stats.nodeCounts.dynamic} />
  <DebugRow label="Particles" value={stats.aliveParticles} tone="accent" />
</DebugSection>

{#snippet nodeRow(node: TreeNode)}
  {@const meta = node.metadata as NodeMeta}
  <span class="row" class:selected={node.id === selectedId}>
    <!-- The dot is the select target; the rest of the row toggles expand. -->
    <button
      type="button"
      class="dot"
      style:background={meta.dot}
      title="Select {node.label}"
      aria-pressed={node.id === selectedId}
      onclick={(e) => {
        e.stopPropagation()
        selectNode(node.id)
      }}
    ></button>
    <span class="node-id">{node.label}</span>
    <span class="node-type">{meta.type}</span>
    {#if meta.isCamera}
      <span class="chip cam">cam {meta.kind === '3d' ? '3D' : '2D'}</span>
      {#if meta.isCurrentCamera}
        <span class="chip current">current</span>
      {/if}
    {:else if meta.kind !== '2d'}
      <span class="chip kind">{meta.kind === '3d' ? '3D' : 'group'}</span>
    {/if}
    {#if meta.layer && meta.layer !== 'dynamic'}
      <span class="chip">{meta.layer}</span>
    {/if}
    {#if !meta.visible}
      <span class="chip muted">hidden</span>
    {/if}
    {#if meta.isWorldHost}
      <span
        class="chip world"
        style:border-color={meta.accent ?? 'currentColor'}
        style:color={meta.accent ?? 'currentColor'}>world</span
      >
    {/if}
    {#if meta.hasRigidBody}
      <span class="chip">body</span>
    {/if}
    {#if meta.particleCount > 0}
      <span class="chip">{meta.particleCount}p</span>
    {/if}
    {#if meta.tris > 0}
      <span class="chip">{meta.tris}▲</span>
    {/if}
  </span>
{/snippet}

<DebugSection title="Scene tree" bind:open={treeOpen}>
  {#if treeNodes.length === 0}
    <div class="empty-state">Empty</div>
  {:else}
    <DebugTree
      nodes={treeNodes}
      onToggle={toggleTreeNode}
      renderContent={nodeRow}
    />
  {/if}
</DebugSection>

<DebugSection title="Selected node" bind:open={selectedOpen}>
  {#if selected}
    <div class="sel-head">
      <span class="head-dot" style:background={selected.dot}></span>
      <span class="head-name">{selected.id}</span>
      <span class="head-type">{selected.type}</span>
    </div>

    {#if selected.kind === '2d'}
      <DebugRow
        label="Position"
        value={`${fmtCoord(selected.x)}, ${fmtCoord(selected.y)}`}
        tone={selected.x === 0 && selected.y === 0 ? 'muted' : 'default'}
      />
      <DebugRow
        label="Scale"
        value={`${selected.scaleX.toFixed(2)}, ${selected.scaleY.toFixed(2)}`}
        tone={selected.scaleX === 1 && selected.scaleY === 1
          ? 'muted'
          : 'default'}
      />
      <div class="info-row">
        <span class="label">Rotation:</span>
        <span class="value rot-value" class:muted={selected.rotation === 0}>
          <svg class="dial" viewBox="0 0 24 24" width="16" height="16">
            <circle class="dial-ring" cx="12" cy="12" r="10" />
            <line
              class="dial-needle"
              x1="12"
              y1="12"
              x2={12 + 9 * Math.cos(selected.rotation)}
              y2={12 + 9 * Math.sin(selected.rotation)}
            />
          </svg>
          {selected.rotationDeg.toFixed(1)}°
        </span>
      </div>
      <DebugRow
        label="Alpha"
        value={selected.alpha.toFixed(2)}
        tone={selected.alpha === 1 ? 'muted' : 'default'}
      />
      {#if selected.measured}
        <DebugRow
          label="Measured"
          value={`${selected.measured.w.toFixed(0)} × ${selected.measured.h.toFixed(0)}`}
          tone="accent"
        />
      {/if}
      <div class="info-row">
        <span class="label">Layer:</span>
        <span class="badge layer">{selected.layer}</span>
      </div>
      {#if selected.bounds}
        <DebugRow
          label="Bounds"
          value={`${fmtCoord(selected.bounds.width)} × ${fmtCoord(selected.bounds.height)}`}
        />
      {/if}
    {:else if selected.kind === '3d'}
      <DebugRow
        label="Position"
        value={`${selected.pos.x.toFixed(2)}, ${selected.pos.y.toFixed(2)}, ${selected.pos.z.toFixed(2)}`}
      />
      <DebugRow
        label="Scale"
        value={`${selected.scale3.x.toFixed(2)}, ${selected.scale3.y.toFixed(2)}, ${selected.scale3.z.toFixed(2)}`}
      />
      <DebugRow
        label="Alpha"
        value={selected.alpha.toFixed(2)}
        tone={selected.alpha === 1 ? 'muted' : 'default'}
      />
    {/if}

    <div class="info-row">
      <span class="label">Visible:</span>
      <span
        class="badge"
        class:on={selected.visible}
        class:off={!selected.visible}
      >
        {selected.visible ? 'visible' : 'hidden'}
      </span>
    </div>
    {#if selected.behaviors.length > 0}
      <DebugRow label="Behaviors" value={selected.behaviors.join(', ')} />
    {/if}
    {#if selected.isCamera}
      <div class="info-row">
        <span class="label">Camera:</span>
        <span class="badge" class:on={selected.isCurrentCamera}>
          {selected.isCurrentCamera ? 'current' : 'inactive'}
        </span>
      </div>
      {#if !selected.isCurrentCamera}
        <button
          type="button"
          class="deselect"
          onclick={() => selected?.makeCurrent()}
        >
          Make current
        </button>
      {/if}
    {/if}
    <button type="button" class="deselect" onclick={clearSelection}>
      Deselect
    </button>
  {:else}
    <div class="empty-state">Click a node's dot in the tree to select it.</div>
  {/if}
</DebugSection>

<style lang="sass">
  .row
    display: inline-flex
    align-items: center
    flex-wrap: wrap
    gap: 4px
    padding: 0 2px
    border-radius: 2px

    &.selected
      background: rgba(255, 255, 255, 0.16)

  .dot
    width: 12px
    height: 12px
    padding: 0
    border-radius: 50%
    border: 1px solid rgba(15, 23, 42, 0.6)
    flex: none
    cursor: pointer

    &:hover
      outline: 1px solid rgba(255, 255, 255, 0.6)

    &[aria-pressed='true']
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85)

  .cam-sub
    margin: 4px 0 2px
    padding-top: 4px
    border-top: 1px solid rgba(148, 163, 184, 0.25)
    font-size: 9px
    font-weight: 600
    letter-spacing: 0.06em
    color: rgba(192, 132, 252, 0.9)

  .node-id
    color: rgba(226, 232, 240, 0.95)

  .node-type
    color: rgba(148, 163, 184, 0.9)

  .chip
    padding: 0 4px
    border: 1px solid rgba(148, 163, 184, 0.5)
    border-radius: 3px
    font-size: 9px
    line-height: 1.4
    color: rgba(148, 163, 184, 0.9)

    &.muted
      opacity: 0.6

    &.world
      font-weight: 600

    &.kind
      color: rgba(196, 181, 253, 0.95)
      border-color: rgba(196, 181, 253, 0.55)

    &.cam
      color: rgba(245, 158, 11, 0.95)
      border-color: rgba(245, 158, 11, 0.55)

    &.current
      font-weight: 600
      color: rgb(110, 231, 183)
      border-color: rgba(52, 211, 153, 0.6)

  .cam-list
    display: flex
    flex-direction: column
    gap: 2px
    margin: 2px 0 4px

  .cam-item
    display: flex
    align-items: center
    gap: 6px
    padding: 2px 4px
    background: rgba(148, 163, 184, 0.1)
    border: 1px solid rgba(148, 163, 184, 0.3)
    border-radius: 3px
    color: inherit
    font: inherit
    text-align: left
    cursor: pointer

    &:hover:not(:disabled)
      background: rgba(148, 163, 184, 0.24)

    &.current
      border-color: rgba(52, 211, 153, 0.5)
      cursor: default

    .cam-mark
      color: rgba(245, 158, 11, 0.95)
      flex: none

    &.current .cam-mark
      color: rgb(110, 231, 183)

    .cam-name
      color: rgba(226, 232, 240, 0.95)
      overflow: hidden
      text-overflow: ellipsis
      white-space: nowrap

  .deselect
    margin-top: 6px
    padding: 2px 8px
    background: rgba(148, 163, 184, 0.15)
    border: 1px solid rgba(148, 163, 184, 0.4)
    border-radius: 3px
    color: inherit
    font: inherit
    cursor: pointer

    &:hover
      background: rgba(148, 163, 184, 0.28)

  .sel-head
    display: flex
    align-items: center
    gap: 6px
    padding: 2px 0 4px

  .head-dot
    width: 12px
    height: 12px
    border-radius: 50%
    border: 1px solid rgba(15, 23, 42, 0.6)
    flex: none

  .head-name
    color: rgba(226, 232, 240, 0.95)
    font-weight: 600

  .head-type
    color: rgba(148, 163, 184, 0.85)

  .rot-value
    display: inline-flex
    align-items: center
    justify-content: flex-end
    gap: 5px

  .dial
    flex: none

    .dial-ring
      fill: none
      stroke: rgba(148, 163, 184, 0.45)
      stroke-width: 1.5

    .dial-needle
      stroke: rgb(251, 191, 36)
      stroke-width: 1.5
      stroke-linecap: round

  .badge
    padding: 0 5px
    border-radius: 3px
    font-weight: 600
    background: rgba(148, 163, 184, 0.2)
    color: rgba(203, 213, 225, 0.9)

    &.on
      background: rgba(52, 211, 153, 0.22)
      color: rgb(110, 231, 183)

    &.off
      background: rgba(248, 113, 113, 0.22)
      color: rgb(252, 165, 165)

    &.layer
      text-transform: uppercase
      letter-spacing: 0.04em
</style>
