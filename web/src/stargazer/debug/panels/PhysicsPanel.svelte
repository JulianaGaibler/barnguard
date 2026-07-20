<script lang="ts">
  import type { DebugController, DebugStatsSnapshot } from '../DebugController'
  import { DebugSection, DebugRow, ToggleButton } from '../ui'

  interface PhysicsOverlayFlags {
    colliders: boolean
    aabbs: boolean
    contacts: boolean
    velocities: boolean
  }

  interface Props {
    debug: DebugController
    stats: DebugStatsSnapshot
    /** Live overlay-flag state mirrored by the hub. */
    flags: PhysicsOverlayFlags
  }

  const { debug, stats, flags }: Props = $props()

  let overlaysOpen = $state(true)
  let statsOpen = $state(true)
</script>

<DebugSection title="Overlays" bind:open={overlaysOpen}>
  <div class="debug-controls">
    <ToggleButton
      active={flags.colliders}
      onToggle={() => debug.togglePhysics('colliders')}
      label="Colliders"
    />
    <ToggleButton
      active={flags.aabbs}
      onToggle={() => debug.togglePhysics('aabbs')}
      label="AABBs"
    />
    <ToggleButton
      active={flags.contacts}
      onToggle={() => debug.togglePhysics('contacts')}
      label="Contacts"
    />
    <ToggleButton
      active={flags.velocities}
      onToggle={() => debug.togglePhysics('velocities')}
      label="Velocities"
    />
  </div>
</DebugSection>

<DebugSection title="Stats" bind:open={statsOpen}>
  {#if stats.physics.length === 0}
    <div class="empty-state">This stage has no physics worlds.</div>
  {:else}
    {#each stats.physics as world (world.id)}
      <div class="world-block">
        <div class="world-head">
          <span class="world-swatch" style:background={world.accent}></span>
          <span class="world-label">{world.label}</span>
        </div>
        <DebugRow label="Bodies" value={world.bodyCount} tone="accent" />
        <DebugRow label="Sleeping" value={world.sleeping} />
        <DebugRow label="Static" value={world.static} />
        <DebugRow label="Dynamic" value={world.dynamic} />
        <DebugRow label="Kinematic" value={world.kinematic} />
        <DebugRow label="Contacts" value={world.contactCount} />
        <DebugRow label="At rest" value={world.atRest ? 'yes' : 'no'} />
        <DebugRow
          label="Gravity"
          value={`${world.gravity.x}, ${world.gravity.y}`}
        />
      </div>
    {/each}
  {/if}
</DebugSection>

<style lang="sass">
  .world-block
    &:not(:last-child)
      margin-bottom: 8px
      padding-bottom: 8px
      border-bottom: 1px solid rgba(148, 163, 184, 0.2)

  .world-head
    display: flex
    align-items: center
    gap: 6px
    margin-bottom: 4px

  .world-swatch
    width: 10px
    height: 10px
    border-radius: 2px
    flex: none

  .world-label
    font-weight: 600
</style>
