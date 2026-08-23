<script lang="ts">
  /**
   * Bottom navigation for the demo stage: one chip per registered demo, the
   * active one highlighted. Dev-only chrome, so it is deliberately plain and
   * monospace, matching the debug HUD rather than any display's theme, and
   * shows the raw registry keys because those are also the `?demo=` values.
   */
  import { demos } from './demos'

  interface Props {
    /** Registry key of the demo currently on stage. `''` when none is. */
    current: string
    /** Switch the stage to `name`. */
    select: (name: string) => void
  }
  const { current, select }: Props = $props()

  const names = Object.keys(demos)
</script>

<nav class="demo-nav" aria-label="Demos">
  {#each names as name (name)}
    <button
      type="button"
      class="demo-nav__item"
      class:demo-nav__item--active={name === current}
      aria-current={name === current ? 'page' : undefined}
      onclick={() => select(name)}
    >
      {name}
    </button>
  {/each}
</nav>

<style lang="sass">
  .demo-nav
    position: fixed
    inset-inline: 0
    inset-block-end: 0
    // Under the debug HUD's windows (z 10000) so a panel dragged to the bottom
    // edge stays usable.
    z-index: 500
    display: flex
    flex-wrap: wrap
    justify-content: center
    gap: 4px
    padding: 8px 12px
    background: rgba(0, 0, 0, 0.72)
    border-block-start: 1px solid rgba(255, 255, 255, 0.14)
    backdrop-filter: blur(0.5rem)

  .demo-nav__item
    appearance: none
    padding: 4px 10px
    border: 1px solid rgba(255, 255, 255, 0.2)
    border-radius: 3px
    background: rgba(255, 255, 255, 0.05)
    color: #d8dee9
    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Courier New', monospace
    font-size: 11px
    line-height: 1.4
    cursor: pointer

    &:hover
      background: rgba(255, 255, 255, 0.12)
      color: #fff

    &:focus-visible
      outline: 2px solid #60a5fa
      outline-offset: 1px

  .demo-nav__item--active
    background: rgba(96, 165, 250, 0.35)
    border-color: rgba(96, 165, 250, 0.8)
    color: #fff
</style>
