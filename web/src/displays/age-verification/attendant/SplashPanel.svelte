<script lang="ts">
  import { DebugSection, ToggleButton } from 'stargazer/debug-ui'
  import { splashPlayback } from '../ui/splashPlayback'

  // The splash writes the frame it stopped at when it pauses, so this only
  // flips the switch. Turning it off plays on from that frame.
  function toggle(): void {
    splashPlayback.update((now) => ({ ...now, paused: !now.paused }))
  }
</script>

<DebugSection title="Splash" open>
  <ToggleButton
    active={$splashPlayback.paused}
    onToggle={toggle}
    label="Pause animation"
  />
</DebugSection>
