<script lang="ts">
  /**
   * The print picker: the name for the label, three previews of the label to
   * pick from, and the way back or on to the printer. HTML anchored to the
   * slots of `printPickerLayout.ts`, so the engine tweens that move and fade
   * those slots move the HTML with them. The screen that hosts it owns every
   * value here and renders the previews, which arrive through {@link show}.
   */
  import { domAnchor, type Engine } from 'stargazer'
  import { displayName } from '@src/core/leaderboard/displayName'
  import { t } from '@src/displays/enterprise/i18n'
  import { LABEL_VARIANTS, type LabelVariant } from '../label'
  import {
    ACTIONS_HEIGHT,
    ACTIONS_WIDTH,
    NAME_FIELD_HEIGHT,
    NAME_FIELD_WIDTH,
    PREVIEW_SIZE,
    type PrintPickerLayout,
  } from './printPickerLayout'

  interface Props {
    engine: Engine
    layout: PrintPickerLayout
    /** Whether the picker takes taps. Off while it is hidden or leaving. */
    active: boolean
    name: string
    /** Whether the keyboard is typing into the name. */
    editing: boolean
    variant: LabelVariant
    printed: boolean
    canPrint: boolean
    onEditName: () => void
    onPick: (variant: LabelVariant) => void
    onBack: () => void
    onPrint: () => void
  }
  let {
    engine,
    layout,
    active,
    name,
    editing,
    variant,
    printed,
    canPrint,
    onEditName,
    onPick,
    onBack,
    onPrint,
  }: Props = $props()

  const canvases: Partial<Record<LabelVariant, HTMLCanvasElement>> = {}

  /** Draw a finished preview. Takes ownership of `bitmap`. */
  export function show(which: LabelVariant, bitmap: ImageBitmap): void {
    const canvas = canvases[which]
    const context = canvas?.getContext('bitmaprenderer')
    if (!canvas || !context) {
      bitmap.close()
      return
    }
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    context.transferFromImageBitmap(bitmap)
  }

  /** Blank every preview, releasing the bitmaps they hold. */
  export function clear(): void {
    for (const canvas of Object.values(canvases)) {
      canvas?.getContext('bitmaprenderer')?.transferFromImageBitmap(null)
    }
  }

  /** The pixel size a preview shows at on screen, for rendering it crisply. */
  export function previewPixelSize(): number {
    const canvas = canvases[LABEL_VARIANTS[0]]
    const width = canvas?.getBoundingClientRect().width ?? 0
    const size = width > 0 ? width : PREVIEW_SIZE
    return Math.max(1, Math.round(size * (window.devicePixelRatio || 1)))
  }

  /** The bottom of the preview row in client pixels, for clearing the keyboard. */
  export function previewsBottom(): number {
    return canvases[LABEL_VARIANTS[0]]?.getBoundingClientRect().bottom ?? 0
  }

  function registerCanvas(node: HTMLCanvasElement, which: LabelVariant) {
    canvases[which] = node
    return {
      destroy() {
        if (canvases[which] === node) delete canvases[which]
      },
    }
  }
</script>

<div class="picker" inert={!active}>
  <div
    class="picker__name-slot"
    use:domAnchor={{
      engine,
      node: layout.name,
      size: { width: NAME_FIELD_WIDTH, height: NAME_FIELD_HEIGHT },
      syncOpacity: true,
    }}
  >
    <button
      class="picker__name"
      class:picker__name--editing={editing}
      onclick={onEditName}
    >
      {#if name}
        <span>{displayName(name)}</span>
      {:else}
        <span class="picker__placeholder">{$t.game.labelNamePlaceholder}</span>
      {/if}
    </button>
  </div>

  {#each LABEL_VARIANTS as which, i (which)}
    <div
      class="picker__preview-slot"
      use:domAnchor={{
        engine,
        node: layout.previews[i],
        size: { width: PREVIEW_SIZE, height: PREVIEW_SIZE },
        syncOpacity: true,
      }}
    >
      <button
        class="picker__preview"
        class:picker__preview--selected={variant === which}
        aria-pressed={variant === which}
        aria-label={$t.game.labelVariants[which]}
        onclick={() => onPick(which)}
      >
        <canvas use:registerCanvas={which}></canvas>
      </button>
    </div>
  {/each}

  <div
    class="picker__actions"
    use:domAnchor={{
      engine,
      node: layout.actions,
      size: { width: ACTIONS_WIDTH, height: ACTIONS_HEIGHT },
      syncOpacity: true,
    }}
  >
    <button
      class="picker__button picker__button--round"
      aria-label={$t.game.backButton}
      onclick={onBack}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M20 12H5m6-7-7 7 7 7"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <button
      class="picker__button"
      disabled={printed || !canPrint}
      onclick={onPrint}
    >
      {printed ? $t.game.printedButton : $t.game.printButton}
    </button>
  </div>
</div>

<style lang="sass">
  @use './buttons'

  // The previews' corners, the comp's 32 on its 330 edge.
  $preview-radius: calc(32 / 330 * 100%)

  .picker
    position: absolute
    inset: 0
    pointer-events: none

  .picker__name-slot
    display: flex
    align-items: center
    justify-content: center

  .picker__name
    appearance: none
    border: 0
    cursor: pointer
    pointer-events: auto
    display: inline-flex
    align-items: center
    justify-content: center
    min-width: 360px
    max-width: 100%
    height: 100%
    padding: 0 48px
    border-radius: 999px
    background: #ffffff
    color: #010612
    font-family: var(--font-mozilla-headline-condensed)
    font-weight: 700
    font-size: 56px
    line-height: normal
    white-space: nowrap
    outline: 6px solid transparent
    outline-offset: 8px
    transition: outline-color 0.15s

  .picker__name--editing
    outline-color: #ffffff

  .picker__placeholder
    opacity: 0.4

  .picker__preview
    appearance: none
    border: 0
    padding: 0
    cursor: pointer
    pointer-events: auto
    display: block
    width: 100%
    height: 100%
    border-radius: $preview-radius
    background: rgba(255, 255, 255, 0.4)
    outline: 6px solid transparent
    outline-offset: 8px
    transition: outline-color 0.15s

    canvas
      display: block
      width: 100%
      height: 100%
      border-radius: $preview-radius

  .picker__preview--selected
    outline-color: #ffffff

  .picker__actions
    display: flex
    align-items: center
    justify-content: center
    gap: 12px

  .picker__button
    @include buttons.pill

  .picker__button--round
    width: 80px
    padding: 0
    display: inline-flex
    align-items: center
    justify-content: center

    svg
      width: 40px
      height: 40px
</style>
