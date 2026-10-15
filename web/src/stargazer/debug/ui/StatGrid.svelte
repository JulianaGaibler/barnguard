<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    columns?: number
    children: Snippet
  }

  const { columns = 2, children }: Props = $props()
</script>

<div
  class="stat-grid"
  style:grid-template-columns="repeat({columns}, minmax(0, 1fr))"
>
  {@render children()}
</div>

<style lang="sass">
  .stat-grid
    display: grid
    gap: 4px
</style>
