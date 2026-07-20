<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import type { DebugController, DebugStatsSnapshot } from '../DebugController'
  import type { SceneNode } from '../../scene/SceneNode'
  import { PhysicsWorldBehavior } from '../../physics/PhysicsWorldBehavior'
  import { RigidBodyBehavior } from '../../physics/RigidBodyBehavior'
  import { DebugSection, DebugRow, DebugTree, type TreeNode } from '../ui'
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
    node: SceneNode
    type: string
    dot: string
    layer: string
    visible: boolean
    particleCount: number
    isWorldHost: boolean
    hasRigidBody: boolean
    behaviors: string[]
    accent: string | null
    // Index signature so a NodeMeta satisfies TreeNode's `metadata` bag.
    [key: string]: unknown
  }

  // Dot color per built-in node type.
  const TYPE_COLORS: Record<string, string> = {
    SceneNode: '#94a3b8',
    ShapeNode: '#38bdf8',
    Path2DNode: '#a78bfa',
    PolylineNode: '#34d399',
    TextNode: '#fbbf24',
    ParticleEmitterNode: '#fb7185',
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

  function buildSceneTree(root: SceneNode, expanded: Set<string>): TreeNode[] {
    const out: TreeNode[] = []
    // Key rows by tree path, not node.id: ids aren't unique, and a duplicate
    // key breaks the keyed `{#each}` and cross-links expansion/selection.
    visit(root, 0, 'r')
    return out

    function visit(node: SceneNode, depth: number, key: string): void {
      const type = node.constructor.name
      const isWorldHost = node.getBehavior(PhysicsWorldBehavior) !== null
      const meta: NodeMeta = {
        node,
        type,
        dot: colorForType(type),
        layer: node.renderLayer,
        visible: node.visible,
        particleCount: node.particleCount,
        isWorldHost,
        hasRigidBody: node.getBehavior(RigidBodyBehavior) !== null,
        behaviors: node.behaviors.map((b) => b.constructor.name),
        accent: isWorldHost ? debug.overlayAccentForNode(node) : null,
      }
      const hasChildren = node.children.length > 0
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
        const children = node.children
        for (let i = 0; i < children.length; i++) {
          visit(children[i], depth + 1, `${key}.${i}`)
        }
      }
    }
  }

  function rebuild(): void {
    treeNodes = buildSceneTree(debug.activeStage.scene.root, treeExpanded)
  }

  function nodeOf(id: string | null): SceneNode | null {
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
    debug.setHighlightedNode(nodeOf(selectedId))
  }

  function clearSelection(): void {
    selectedId = null
    debug.setHighlightedNode(null)
  }

  // Live properties of the selected node, refreshed on the hub tick.
  const selected = $derived.by(() => {
    void revision
    const node = nodeOf(selectedId)
    if (!node) return null
    const t = node.transform
    const type = node.constructor.name
    return {
      id: node.id,
      type,
      dot: colorForType(type),
      x: t.x,
      y: t.y,
      rotation: t.rotation,
      rotationDeg: (t.rotation * 180) / Math.PI,
      scaleX: t.scaleX,
      scaleY: t.scaleY,
      alpha: t.alpha,
      visible: node.visible,
      layer: node.renderLayer,
      bounds: node.debugBounds,
      behaviors: node.behaviors.map((b) => b.constructor.name),
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
      debug.setHighlightedNode(null)
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
  <DebugRow label="Viewport x" value={fmtCoord(stats.viewport.x)} />
  <DebugRow label="Viewport y" value={fmtCoord(stats.viewport.y)} />
  <DebugRow label="Viewport w" value={fmtCoord(stats.viewport.width)} />
  <DebugRow label="Viewport h" value={fmtCoord(stats.viewport.height)} />
  <DebugRow label="px / world" value={stats.screenPxPerWorldUnit.toFixed(3)} />
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
    {#if meta.layer !== 'dynamic'}
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
    {#if selected.behaviors.length > 0}
      <DebugRow label="Behaviors" value={selected.behaviors.join(', ')} />
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
