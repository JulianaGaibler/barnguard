<script lang="ts" module>
  export interface TreeNode {
    id: string
    label: string
    depth: number
    hasChildren: boolean
    isExpanded: boolean
    metadata?: Record<string, unknown>
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    nodes: TreeNode[]
    onToggle: (id: string) => void
    indentSize?: number
    renderContent?: Snippet<[TreeNode]>
  }

  let { nodes, onToggle, indentSize = 12, renderContent }: Props = $props()

  function handleToggle(node: TreeNode): void {
    if (node.hasChildren) onToggle(node.id)
  }

  function handleKeydown(event: KeyboardEvent, node: TreeNode): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleToggle(node)
    }
  }
</script>

<div class="debug-tree">
  {#each nodes as node (node.id)}
    <!-- Whole row is the hit target, the ▼/▶ chevron is decorative. Only
         a leaf without children stays inert. Using a <div role="treeitem">
         (not a <button>) so the render-content snippet can host arbitrary
         markup (buttons, links) without nested-interactive complaints. The
         a11y_click_events_have_key_events warning is satisfied by the sibling
         `onkeydown` handler below. -->
    <div
      class="tree-node"
      class:clickable={node.hasChildren}
      style:padding-left="{node.depth * indentSize}px"
      role="treeitem"
      aria-expanded={node.hasChildren ? node.isExpanded : undefined}
      aria-selected="false"
      tabindex={node.hasChildren ? 0 : -1}
      onclick={() => handleToggle(node)}
      onkeydown={(e) => handleKeydown(e, node)}
    >
      {#if node.hasChildren}
        <span class="toggle-chevron" aria-hidden="true">
          {node.isExpanded ? '▼' : '▶'}
        </span>
      {:else}
        <span class="spacer"></span>
      {/if}

      <div class="node-content">
        {#if renderContent}
          {@render renderContent(node)}
        {:else}
          <span class="node-label">{node.label}</span>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style lang="sass">
  .debug-tree
    font-family: monospace
    font-size: 10px
    line-height: 1.4

  .tree-node
    display: flex
    align-items: flex-start
    gap: 4px
    padding: 2px 4px
    min-height: 16px
    border-radius: 2px

    &.clickable
      cursor: pointer

      &:hover
        background: rgba(255, 255, 255, 0.06)

    &:focus
      outline: 1px solid rgba(96, 165, 250, 0.5)
      outline-offset: -1px
      background: rgba(96, 165, 250, 0.1)

  .toggle-chevron
    flex-shrink: 0
    width: 12px
    height: 12px
    display: flex
    align-items: center
    justify-content: center
    color: rgba(255, 255, 255, 0.5)
    font-size: 8px
    line-height: 1

    .tree-node.clickable:hover &
      color: rgba(255, 255, 255, 0.9)

  .spacer
    flex-shrink: 0
    width: 12px
    height: 12px

  .node-content
    flex: 1
    min-width: 0
    display: contents

  .node-label
    color: rgba(255, 255, 255, 0.9)
    word-break: break-word
</style>
