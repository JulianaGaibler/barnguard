<script lang="ts">
  import type { DebugController, DebugStatsSnapshot } from '../DebugController'
  import {
    DebugSection,
    MetricRow,
    Pill,
    StatCard,
    StatGrid,
    ToggleButton,
  } from '../ui'

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
        <StatGrid>
          <StatCard
            label="Bodies"
            value={world.bodyCount}
            tip="Every body in this world, awake or asleep."
          />
          <StatCard
            label="Contacts"
            value={world.contactCount}
            tip="Pairs of bodies touching this frame. The solver's cost grows with this number."
          />
        </StatGrid>
        <MetricRow
          label="Sleeping"
          value={world.sleeping}
          tip="Bodies at rest that the solver skips until something wakes them."
          fill={world.bodyCount > 0 ? world.sleeping / world.bodyCount : 0}
        />
        <MetricRow
          label="Dynamic"
          value={world.dynamic}
          tip="Bodies that forces and contacts move."
        />
        <MetricRow
          label="Static"
          value={world.static}
          tip="Bodies that never move, such as walls and floors."
        />
        <MetricRow
          label="Kinematic"
          value={world.kinematic}
          tip="Bodies that code moves directly and that push dynamic bodies."
        />
        <div class="world-state">
          <Pill
            text={world.atRest ? 'at rest' : 'simulating'}
            tone={world.atRest ? 'good' : 'neutral'}
            tip={world.atRest
              ? 'Every dynamic body is asleep, so the world costs almost nothing.'
              : 'At least one body is awake and being stepped.'}
          />
          <span class="gravity">g {world.gravity.x}, {world.gravity.y}</span>
        </div>
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

  .world-state
    display: flex
    align-items: center
    justify-content: space-between
    margin-top: 4px

  .gravity
    opacity: 0.6
</style>
