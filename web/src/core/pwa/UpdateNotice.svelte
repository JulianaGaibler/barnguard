<!--
  Shows the installed app's update as it happens, so staff can see a new
  version arrive instead of finding it changed. A small pill at the foot of the
  screen says while one downloads, and offers to restart into it once it's
  ready, which otherwise happens on its own when nobody is using the screen,
  and says so while it reloads into it. A check that finds nothing new shows
  nothing.

  The pill can be hidden. That only takes it off the screen: the update still
  takes over when the screen is idle, and the pill comes back to say so.

  Attendant UI, so in English whatever the display's language.
-->
<script lang="ts">
  import { fly } from 'svelte/transition'
  import { expoOut } from 'svelte/easing'
  import { appUpdate, applyUpdate } from './register'

  const status = $derived($appUpdate.status)
  let hidden = $state(false)

  // A hidden pill stays hidden for the rest of this update only.
  $effect(() => {
    if (status !== 'downloading' && status !== 'ready') hidden = false
  })
</script>

{#if (status === 'downloading' || status === 'ready' || status === 'applying') && !hidden}
  <div
    class="update"
    role="status"
    transition:fly={{ y: 120, duration: 320, easing: expoOut }}
  >
    {#if status === 'downloading'}
      <span class="update__spinner" aria-hidden="true"></span>
      <span>Downloading update…</span>
    {:else if status === 'applying'}
      <span class="update__spinner" aria-hidden="true"></span>
      <span>Updating…</span>
    {:else}
      <span>Update ready</span>
      <button type="button" class="update__button" onclick={applyUpdate}>
        Update now
      </button>
    {/if}
    {#if status !== 'applying'}
      <button
        type="button"
        class="update__hide"
        aria-label="Hide"
        onclick={() => (hidden = true)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </button>
    {/if}
  </div>
{/if}

<style lang="sass">
  // Small and at the foot of the screen, out of the way of the display, with a
  // little room under it.
  .update
    position: fixed
    inset-block-end: calc(12px + env(safe-area-inset-bottom))
    inset-inline-start: 50%
    transform: translateX(-50%)
    z-index: 1000
    display: inline-flex
    align-items: center
    gap: 8px
    height: 32px
    box-sizing: border-box
    padding: 3px 3px 3px 14px
    border-radius: 999px
    background: rgba(22, 22, 22, 0.88)
    color: #ffffff
    font-family: var(--font-mozilla-text, system-ui)
    font-size: 13px
    font-weight: 600
    white-space: nowrap
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15)

  .update:has(.update__spinner):not(:has(.update__hide))
    padding-inline-end: 14px

  .update__hide
    display: flex
    align-items: center
    justify-content: center
    width: 26px
    height: 26px
    padding: 0
    border: 0
    border-radius: 50%
    background: transparent
    color: rgba(255, 255, 255, 0.7)
    cursor: pointer
    -webkit-tap-highlight-color: transparent

    svg
      width: 12px
      height: 12px

    &:active
      background: rgba(255, 255, 255, 0.15)

  .update__button
    height: 26px
    padding: 0 12px
    border: 0
    border-radius: 999px
    background: #ffffff
    color: #161616
    font: inherit
    cursor: pointer
    -webkit-tap-highlight-color: transparent

    &:active
      background: #dddddd

  .update__spinner
    width: 12px
    height: 12px
    border: 2px solid rgba(255, 255, 255, 0.3)
    border-top-color: #ffffff
    border-radius: 50%
    animation: update-spin 0.8s linear infinite

  @keyframes update-spin
    to
      transform: rotate(360deg)
</style>
