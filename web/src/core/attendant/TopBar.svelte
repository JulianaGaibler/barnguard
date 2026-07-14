<script lang="ts">
  import { theme } from '@src/core/theme'
</script>

<header class="topbar" aria-hidden="true">
  {#if $theme}
    <img
      class="topbar__logo topbar__logo--primary"
      src={$theme.assets.topBarPrimary}
      alt=""
    />
    {#if $theme.assets.topBarSecondary}
      <img
        class="topbar__logo topbar__logo--secondary"
        src={$theme.assets.topBarSecondary}
        alt=""
      />
    {/if}
  {/if}
</header>

<style lang="sass">
  .topbar
    position: fixed
    top: 0
    left: 0
    right: 0
    z-index: 100
    display: flex
    align-items: center
    justify-content: space-between
    padding: tint.$size-48
    pointer-events: none

  .topbar__logo
    display: block
    user-select: none
    -webkit-user-drag: none

  .topbar__logo--primary
    height: 3.5rem
    width: auto

  .topbar__logo--secondary
    height: 2.5rem
    width: auto
</style>
