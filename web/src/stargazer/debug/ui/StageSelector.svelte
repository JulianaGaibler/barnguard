<script lang="ts">
  export interface StageChipOption {
    id: string
    label: string
    isActive: boolean
    isPrimary: boolean
  }

  interface Props {
    stages: StageChipOption[]
    onSelect: (id: string) => void
  }

  let { stages, onSelect }: Props = $props()

  // Same touch-friendly patterns as ToggleButton: preventDefault on
  // pointerdown suppresses focus theft (so WASD keyboard control keeps
  // working after tapping a chip), and blur on click covers browsers that
  // ignore that suppression.
  function suppressFocus(e: PointerEvent): void {
    e.preventDefault()
  }
  function handleClick(e: MouseEvent, id: string): void {
    onSelect(id)
    ;(e.currentTarget as HTMLButtonElement).blur()
  }
</script>

<div class="stage-selector">
  <span class="stage-selector__label">Stage</span>
  <div class="stage-selector__chips">
    {#each stages as stage (stage.id)}
      <button
        type="button"
        class="stage-chip"
        class:active={stage.isActive}
        class:primary={stage.isPrimary}
        onpointerdown={suppressFocus}
        onclick={(e) => handleClick(e, stage.id)}
        aria-pressed={stage.isActive}
      >
        {stage.label}
      </button>
    {/each}
  </div>
</div>

<style lang="sass">
  .stage-selector
    display: flex
    align-items: center
    gap: 6px
    padding: 4px 6px
    background: rgba(0, 0, 0, 0.9)
    border: 1px solid rgba(255, 255, 255, 0.2)
    border-radius: 3px
    box-sizing: border-box

  .stage-selector__label
    font-size: 10px
    text-transform: uppercase
    letter-spacing: 0.06em
    color: rgba(255, 255, 255, 0.5)
    flex-shrink: 0

  .stage-selector__chips
    display: flex
    flex-wrap: wrap
    gap: 4px
    flex: 1
    min-width: 0

  .stage-chip
    padding: 3px 8px
    background: rgba(255, 255, 255, 0.05)
    border: 1px solid rgba(255, 255, 255, 0.18)
    border-radius: 3px
    color: rgba(255, 255, 255, 0.85)
    font-family: inherit
    font-size: 10px
    font-weight: 600
    cursor: pointer
    user-select: none
    -webkit-user-select: none
    touch-action: manipulation
    min-height: 26px
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap

    &:hover
      background: rgba(255, 255, 255, 0.1)
      border-color: rgba(255, 255, 255, 0.35)

    &.primary
      color: rgba(255, 255, 255, 0.95)

    &.active
      background: rgba(96, 165, 250, 0.32)
      border-color: rgba(96, 165, 250, 0.8)
      color: #fff
</style>
