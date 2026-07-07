<script lang="ts">
  import enterpriseLogo from '@src/assets/enterprise-logo.svg?url'
  import mozillaLogo from '@src/assets/mozilla-logo.svg?url'
</script>

<header class="topbar" aria-hidden="true">
  <img
    class="topbar__logo topbar__logo--enterprise"
    src={enterpriseLogo}
    alt=""
  />
  <img class="topbar__logo topbar__logo--mozilla" src={mozillaLogo} alt="" />
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

  .topbar__logo--enterprise
    height: 3.5rem
    width: auto

  .topbar__logo--mozilla
    height: 2.5rem
    width: auto
</style>
