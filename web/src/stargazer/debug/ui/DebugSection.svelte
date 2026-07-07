<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    open?: boolean
    maxHeight?: boolean
    summary?: Snippet
    children: Snippet
  }

  let {
    title,
    open = $bindable(false),
    maxHeight = false,
    summary,
    children,
  }: Props = $props()
</script>

<details bind:open>
  <summary>
    {title}
    {#if summary}
      {@render summary()}
    {/if}
  </summary>
  <div class="panel-content" class:max-height-300={maxHeight}>
    {@render children()}
  </div>
</details>
