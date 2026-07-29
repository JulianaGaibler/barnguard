<script lang="ts">
  import type { Snippet } from 'svelte'
  import ToggleButton from './ToggleButton.svelte'

  interface Props {
    /** Main toggle label. */
    label: string
    /** Whether the group is enabled (its dependent controls show). */
    active: boolean
    onToggle: () => void
    /** Short keyboard hint chip on the toggle. */
    hint?: string
    disabled?: boolean
    /** The dependent controls, shown only while `active`. */
    children: Snippet
  }

  let {
    label,
    active,
    onToggle,
    hint,
    disabled = false,
    children,
  }: Props = $props()
</script>

<div class="debug-toggle-group" class:active>
  <ToggleButton {active} {onToggle} {label} {hint} {disabled} />
  {#if active}
    <!-- Dependent controls hang off an accent rail so it reads as "these
         belong to the toggle above". Hidden entirely while the group is off. -->
    <div class="deps">
      {@render children()}
    </div>
  {/if}
</div>

<style lang="sass">
  .debug-toggle-group
    display: flex
    flex-direction: column

    &:not(:last-child)
      margin-bottom: 4px

  // Nested controls: indented under the toggle with a left accent rail (blue,
  // matching the toggle's active state) marking the dependency.
  .deps
    display: flex
    flex-direction: column
    margin-inline-start: 6px
    padding-inline-start: 10px
    padding-block-start: 6px
    border-inline-start: 2px solid rgba(96, 165, 250, 0.45)

    // The nested controls carry their own 4px gaps, so drop the last one and
    // the rail ends flush with the group.
    > :global(*:last-child)
      margin-bottom: 0
</style>
