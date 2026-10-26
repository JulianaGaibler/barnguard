<script lang="ts">
  /**
   * A small pill in the bottom right corner with the printer's state and the
   * queue's progress, so an attendant can follow prints without opening the
   * printer panel. Once the printer is ready again it lingers for a moment and
   * fades out, so it is only on screen while there is something to follow. It
   * takes no input, so taps pass through to the display. Labels are English,
   * like the rest of the attendant controls.
   */
  import { printerLive, mockPrintEnabled } from '@src/core/print/printerClient'
  import { summarizePrintStatus } from '@src/core/print/printStatus'

  const summary = $derived(
    summarizePrintStatus({
      connection: $printerLive.connection,
      printer: $printerLive.printer,
      active: $printerLive.active,
      pending: $printerLive.pending,
      recent: $printerLive.recent,
      mockPrinting: $mockPrintEnabled,
    }),
  )

  const LINGER_MS = 1000

  let visible = $state(true)

  $effect(() => {
    if (summary.tone !== 'ok') {
      visible = true
      return
    }
    const timer = setTimeout(() => (visible = false), LINGER_MS)
    return () => clearTimeout(timer)
  })
</script>

<div
  class="pill pill--{summary.tone}"
  class:pill--hidden={!visible}
  role="status"
  aria-live="polite"
>
  <span class="pill__dot" aria-hidden="true"></span>
  <span class="pill__label">{summary.label}</span>
  {#if summary.detail}
    <span class="pill__detail">{summary.detail}</span>
  {/if}
</div>

<style lang="sass">
  .pill
    position: fixed
    right: 16px
    bottom: 16px
    z-index: 100
    display: flex
    align-items: center
    gap: 8px
    padding: 6px 12px
    border-radius: 999px
    background: rgba(21, 20, 26, 0.72)
    backdrop-filter: blur(8px)
    color: #fff
    font-family: system-ui, sans-serif
    font-size: 13px
    font-weight: 600
    line-height: 1
    white-space: nowrap
    pointer-events: none
    user-select: none
    transition: opacity 0.3s ease-out

  .pill--hidden
    opacity: 0

  .pill__dot
    width: 8px
    height: 8px
    border-radius: 50%
    flex: none
    background: rgb(74, 222, 128)

  .pill--busy .pill__dot
    background: rgb(96, 165, 250)
    animation: pulse 1.2s ease-in-out infinite

  .pill--warn .pill__dot
    background: rgb(250, 204, 21)
    animation: pulse 1.2s ease-in-out infinite

  .pill--error .pill__dot
    background: rgb(248, 113, 113)

  .pill__detail
    font-weight: 400
    opacity: 0.7
    font-variant-numeric: tabular-nums

  @keyframes pulse
    50%
      opacity: 0.35
</style>
