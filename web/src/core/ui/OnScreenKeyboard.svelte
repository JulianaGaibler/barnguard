<!--
  An on-screen keyboard for short name entry on kiosk touchscreens, where a real
  `<input>` would trigger the OS's own keyboard on top of this one. Also
  responds to a physical keyboard, accepting exactly the characters it can type.

  `mode` sets what it offers: `letters` is a to z, `name` adds accents on press
  and hold plus space and `- ' .`, `full` adds a page of digits and symbols.
  `keyboard/layout.ts` builds the rows, `keyboard/gesture.ts` turns pointer
  events into key actions, and this file wires the two to the DOM. Keys type on
  release, so a letter can be slid off to cancel it.

  The surface lets the preview bubble and the accent strip stick out above the
  top row. Positions are measured on every pointer down, in the keyboard's own
  CSS pixels, so an ancestor's scale transform does not offset them.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import Surface from './Surface.svelte'
  import Key from './OnScreenKeyboardKey.svelte'
  import KeyPopup, { type Bubble, type Strip } from './keyboard/KeyPopup.svelte'
  import chevronDownIconRaw from '@src/assets/icons/chevron-down-16.svg?raw'
  import { locale, t } from '@src/i18n'
  import { displayName } from '@src/core/leaderboard/displayName'
  import {
    KeyboardGesture,
    type GestureHost,
    type GestureView,
    type Target,
  } from './keyboard/gesture'
  import { stripCellAt, stripLayout, type Box } from './keyboard/geometry'
  import {
    keyVariant,
    layoutFor,
    typableChars,
    type KeyAction,
    type KeyboardMode,
    type KeyboardPage,
  } from './keyboard/layout'
  import { physicalKeyAction } from './keyboard/physicalKey'
  import { variantsFor } from './keyboard/variants'

  interface Props {
    value: string
    /** Characters the value may hold, counted as code points. */
    maxLength: number
    mode?: KeyboardMode
    /** Shows an enter key, and runs on it and on a physical Enter. */
    onSubmit?: () => void
    /** Shows a close key, and runs on it and on a physical Escape. */
    onClose?: () => void
    /**
     * Names what is being typed. Two players entering names on one screen share
     * a single keyboard, and this is what tells them whose turn it is at.
     */
    caption?: string
    /**
     * Words offered above the keys. Tapping one hands it to `onSuggestion`. The
     * strip is only shown while there are words. The keyboard sits on the
     * bottom edge, so the keys stay put as the strip appears above them.
     */
    suggestions?: readonly string[]
    onSuggestion?: (word: string) => void
  }
  let {
    value = $bindable(),
    maxLength,
    mode = 'letters',
    onSubmit,
    onClose,
    caption,
    suggestions,
    onSuggestion,
  }: Props = $props()

  interface Measured {
    /** Keyboard origin in client px. */
    originX: number
    originY: number
    /** Client px per keyboard CSS px. */
    scale: number
    /** Where the key rows start and how wide they are, in keyboard CSS px. */
    rows: { left: number; width: number }
    /** Gap between keys, in the keyboard's own CSS px. */
    gap: number
    keys: Readonly<Record<string, Box>>
  }
  interface HitRect {
    id: string
    left: number
    top: number
    right: number
    bottom: number
  }

  let keyboard: HTMLDivElement
  let page = $state<KeyboardPage>('letters')
  let view = $state<GestureView>({ pressedIds: [], popup: null })
  let measured = $state.raw<Measured | null>(null)
  let hitRects: HitRect[] = []

  const layout = $derived(
    layoutFor(mode, page, { hasClose: !!onClose, hasEnter: !!onSubmit }),
  )
  const typable = $derived(typableChars(mode))
  const length = $derived(Array.from(value).length)
  const atLimit = $derived(length >= maxLength)

  const targets = $derived.by(() => {
    const map = new SvelteMap<string, Target>()
    for (const row of layout) {
      for (const item of row) {
        if (item.kind !== 'key') continue
        const { action } = item
        const accents =
          action.type === 'char' && mode !== 'letters'
            ? variantsFor(action.char, $locale)
            : undefined
        map.set(item.id, { id: item.id, action, accents })
      }
    }
    for (const word of suggestions ?? []) {
      const id = suggestionId(word)
      map.set(id, { id, action: { type: 'suggest', word } })
    }
    return map
  })

  const bubbles = $derived.by((): Bubble[] => {
    if (!measured) return []
    const out: Bubble[] = []
    for (const id of new Set(view.pressedIds)) {
      if (view.popup?.keyId === id || isDisabled(id)) continue
      const action = targets.get(id)?.action
      const box = measured.keys[id]
      if (action?.type !== 'char' || !box) continue
      out.push({
        id,
        char: displayName(action.char),
        x: box.left + box.width / 2,
        y: box.top,
      })
    }
    return out
  })

  const strip = $derived.by((): Strip | null => {
    const { popup } = view
    const key = popup && measured?.keys[popup.keyId]
    if (!popup || !measured || !key) return null
    const layout = stripLayout(
      key,
      measured.rows,
      popup.cells.length,
      measured.gap,
    )
    const cells = popup.cells
      .map((char, i) => ({
        char: displayName(char),
        left: layout.cellLefts[i],
        highlighted: i === popup.index,
      }))
      .sort((a, b) => a.left - b.left)
    return {
      x: layout.left,
      y: layout.top,
      width: layout.width,
      height: layout.height,
      cellWidth: layout.cellWidth,
      gap: layout.gap,
      cells,
    }
  })

  function suggestionId(word: string): string {
    return `suggest:${word}`
  }

  function isDisabled(id: string): boolean {
    const action = targets.get(id)?.action
    if (action?.type === 'char') return atLimit
    if (action?.type === 'space') {
      return atLimit || value === '' || value.endsWith(' ')
    }
    return action?.type === 'backspace' && value === ''
  }

  function typeChar(raw: string): void {
    const ch = raw.normalize('NFC').toLowerCase()
    if (atLimit) return
    // A space never leads and never doubles, so a name cannot pick up stray
    // gaps a reader would not see.
    if (ch === ' ' && (value === '' || value.endsWith(' '))) return
    value += ch
  }

  function backspace(): boolean {
    if (value === '') return false
    value = Array.from(value).slice(0, -1).join('')
    return true
  }

  function faceOf(action: KeyAction): {
    label: string
    ariaLabel: string
    icon?: string
  } {
    switch (action.type) {
      case 'char':
        return { label: displayName(action.char), ariaLabel: action.char }
      case 'space':
        return { label: '', ariaLabel: $t.keyboard.space }
      case 'backspace':
        return { label: '⌫', ariaLabel: $t.keyboard.backspace }
      case 'enter':
        return { label: '⏎', ariaLabel: $t.keyboard.enter }
      case 'close':
        return {
          label: '',
          ariaLabel: $t.keyboard.close,
          icon: chevronDownIconRaw,
        }
      case 'page': {
        const label =
          action.page === 'symbols' ? $t.keyboard.symbols : $t.keyboard.letters
        return { label, ariaLabel: label }
      }
    }
  }

  function measure(): void {
    const bounds = keyboard.getBoundingClientRect()
    const scale =
      keyboard.offsetWidth > 0 ? bounds.width / keyboard.offsetWidth : 1
    const gap = parseFloat(getComputedStyle(keyboard).rowGap) || 0
    // Each hit box grows by half a gap, so a touch between two keys goes to the
    // nearer one instead of to nothing.
    const slack = (gap * scale) / 2
    const keys: Record<string, Box> = {}
    const rects: HitRect[] = []
    for (const el of keyboard.querySelectorAll<HTMLElement>('[data-key-id]')) {
      const id = el.dataset.keyId!
      const r = el.getBoundingClientRect()
      keys[id] = {
        left: (r.left - bounds.left) / scale,
        top: (r.top - bounds.top) / scale,
        width: r.width / scale,
        height: r.height / scale,
      }
      rects.push({
        id,
        left: r.left - slack,
        top: r.top - slack,
        right: r.right + slack,
        bottom: r.bottom + slack,
      })
    }
    const row = keyboard.querySelector('.row')?.getBoundingClientRect()
    const rows = row
      ? { left: (row.left - bounds.left) / scale, width: row.width / scale }
      : { left: 0, width: keyboard.offsetWidth }
    hitRects = rects
    measured = {
      originX: bounds.left,
      originY: bounds.top,
      scale,
      rows,
      gap,
      keys,
    }
  }

  const host: GestureHost = {
    hitTest(x, y) {
      for (const r of hitRects) {
        if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
          return targets.get(r.id) ?? null
        }
      }
      return null
    },
    accentIndexAt(popup, x, y) {
      const m = measured
      const key = m?.keys[popup.keyId]
      if (!m || !key) return null
      const layout = stripLayout(key, m.rows, popup.cells.length, m.gap)
      return stripCellAt(
        layout,
        (x - m.originX) / m.scale,
        (y - m.originY) / m.scale,
      )
    },
    type: typeChar,
    backspace,
    submit: () => onSubmit?.(),
    close: () => onClose?.(),
    setPage: (next) => (page = next),
    suggest: (word) => onSuggestion?.(word),
    onChange: (next) => (view = next),
  }
  const gesture = new KeyboardGesture(host)

  // A press must not survive the layout, the limit or the mode it was made in.
  $effect(() => {
    if (mode !== 'full') page = 'letters'
    void page
    void maxLength
    gesture.reset()
  })

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    measure()
    if (!gesture.down(e.pointerId, e.clientX, e.clientY)) return
    try {
      keyboard.setPointerCapture(e.pointerId)
    } catch {
      // The pointer has already ended. Its release is handled on `window`.
    }
  }

  onMount(() => {
    const onMove = (e: PointerEvent): void =>
      gesture.move(e.pointerId, e.clientX, e.clientY, e.buttons)
    const onUp = (e: PointerEvent): void =>
      gesture.up(e.pointerId, e.clientX, e.clientY)
    const onCancel = (e: PointerEvent): void => gesture.cancel(e.pointerId)
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') gesture.reset()
    }
    const onBlur = (): void => gesture.reset()

    function onKeydown(e: KeyboardEvent): void {
      const action = physicalKeyAction(e, typable)
      if (!action) return
      e.preventDefault()
      if (action.type === 'char') typeChar(action.char)
      else if (action.type === 'backspace') backspace()
      else if (action.type === 'submit') onSubmit?.()
      else onClose?.()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('lostpointercapture', onCancel)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('lostpointercapture', onCancel)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('keydown', onKeydown)
      gesture.reset()
    }
  })
</script>

<Surface tone="light" radius="panel" blur class="kb-surface">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="keyboard"
    bind:this={keyboard}
    onpointerdown={onPointerDown}
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#if caption}
      <p class="caption">{caption}</p>
    {/if}
    {#if suggestions?.length}
      <div class="suggestions">
        {#each suggestions as word (word)}
          <button
            type="button"
            class="suggestion"
            class:pressed={view.pressedIds.includes(suggestionId(word))}
            data-key-id={suggestionId(word)}
            tabindex="-1">{word}</button
          >
        {/each}
      </div>
    {/if}
    {#each layout as row, r (r)}
      <div class="row">
        {#each row as item, i (item.kind === 'key' ? item.id : `gap:${i}`)}
          {#if item.kind === 'gap'}
            <div style:grid-column="span {item.span}"></div>
          {:else}
            {@const face = faceOf(item.action)}
            <Key
              id={item.id}
              label={face.label}
              ariaLabel={face.ariaLabel}
              icon={face.icon}
              variant={keyVariant(item.action)}
              span={item.span}
              pressed={view.pressedIds.includes(item.id)}
              disabled={isDisabled(item.id)}
            />
          {/if}
        {/each}
      </div>
    {/each}
    <KeyPopup {bubbles} {strip} />
  </div>
</Surface>

<style lang="sass">
  // The surface clips its content by default. The pop-ups above the top row
  // have to stick out of it.
  :global(div.surface.kb-surface)
    overflow: visible

  .keyboard
    // A letter is two columns and a gap wide, so a row of ten is as wide as ten
    // 3rem keys with 0.5rem between them.
    --kb-column: calc((var(--space-48) - var(--space-8)) / 2)
    position: relative
    display: flex
    flex-direction: column
    gap: var(--space-8)
    padding: var(--space-24)
    touch-action: none
    user-select: none
    -webkit-user-select: none
    -webkit-touch-callout: none

  .row
    display: grid
    grid-template-columns: repeat(20, var(--kb-column))
    column-gap: var(--space-8)

  // One line, as tall as a key's label.
  .suggestions
    display: flex
    justify-content: center
    gap: var(--space-8)
    min-height: var(--space-48)
    margin-block: calc(var(--space-8) * -1) var(--space-8)

  .suggestion
    appearance: none
    border: none
    cursor: pointer
    padding-inline: var(--space-16)
    border-radius: 999px
    background: var(--color-input-bg)
    color: var(--color-text)
    @include tint.type-class(ui-bold)
    text-transform: capitalize
    touch-action: none
    user-select: none
    -webkit-user-select: none

    &.pressed
      background: color-mix(in srgb, var(--color-text) 16%, var(--color-input-bg))

  .caption
    margin: 0 0 var(--space-4)
    text-align: center
    @include tint.type-class(ui-small-bold)
    color: var(--color-text-secondary)
</style>
