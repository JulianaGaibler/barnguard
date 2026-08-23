<script lang="ts">
  import { DebugSection, DebugSlider } from '@src/stargazer/debug/ui'
  import { daemonConfig } from '@src/stores/daemonConfig'
  import { locationFromConfig, zonedClockMinutes } from '../background/dayCycle'
  import { skyTimeOverride } from '../uiState'

  const SLIDER_STEP = 5
  const LAST_STEP = 1440 - SLIDER_STEP

  const timeZone = $derived(locationFromConfig($daemonConfig).timeZone)
  const pinned = $derived($skyTimeOverride !== null)

  // The booth clock, so the thumb rests on the live time while the sky is
  // following the sun. Grabbing it from there is what pins the sky.
  let boothMinutes = $state(0)
  $effect(() => {
    const zone = timeZone
    const read = () => {
      boothMinutes = zonedClockMinutes(Date.now(), zone)
    }
    read()
    const id = setInterval(read, 30_000)
    return () => clearInterval(id)
  })

  function clock(minutes: number): string {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
</script>

<DebugSection title="Sky" open>
  <DebugSlider
    label="Time of day"
    value={$skyTimeOverride ?? boothMinutes}
    min={0}
    max={LAST_STEP}
    step={SLIDER_STEP}
    format={clock}
    hint={pinned ? 'pinned' : 'live'}
    onInput={(v) => skyTimeOverride.set(v)}
  />
  <button
    type="button"
    class="debug-btn"
    disabled={!pinned}
    onclick={() => skyTimeOverride.set(null)}
  >
    Follow the sun
  </button>
</DebugSection>

<style lang="sass">
  // The shared `.debug-btn` has no disabled state, and this one spends most of
  // its life disabled while the sky tracks the sun.
  .debug-btn:disabled
    opacity: 0.4
    cursor: default
</style>
