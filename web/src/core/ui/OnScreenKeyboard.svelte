<!--
  A QWERTY on-screen keyboard for short name entry on kiosk touchscreens,
  where a real `<input>` would trigger the OS's own virtual keyboard on top of
  this one. Letters and backspace, plus any `extraKeys` on a row of their own,
  and an optional strip of suggestions above the keys. Also responds to a
  physical keyboard, accepting exactly the keys it shows.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import Surface from './Surface.svelte'
  import Key from './OnScreenKeyboardKey.svelte'
  import chevronDownIconRaw from '@src/assets/icons/chevron-down-16.svg?raw'

  interface Props {
    value: string
    maxLength: number
    onSubmit?: () => void
    /** Leading key, bottom row, that closes the keyboard. */
    onClose?: () => void
    /**
     * Names what is being typed. Two players entering names on one screen share
     * a single keyboard, and this is what tells them whose turn it is at.
     */
    caption?: string
    closeLabel?: string
    submitLabel?: string
    /**
     * Characters beyond a to z, on a row below the letters. A space becomes a
     * wide space bar at the end of that row. Empty by default.
     */
    extraKeys?: string
    spaceLabel?: string
    /**
     * Words offered above the keys. Tapping one hands it to `onSuggestion`. The
     * strip keeps its height while empty, so the keys do not jump as it fills.
     * Omit to show no strip at all.
     */
    suggestions?: readonly string[]
    onSuggestion?: (word: string) => void
  }
  let {
    value = $bindable(),
    maxLength,
    onSubmit,
    onClose,
    caption,
    closeLabel = 'Close',
    submitLabel = 'Enter',
    extraKeys = '',
    spaceLabel = 'Space',
    suggestions,
    onSuggestion,
  }: Props = $props()

  const extraChars = $derived(Array.from(extraKeys).filter((ch) => ch !== ' '))
  const hasSpace = $derived(extraKeys.includes(' '))

  const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  const LAST = ROWS.length - 1

  function typeChar(ch: string): void {
    if (value.length >= maxLength) return
    // A space never leads and never doubles, so a name cannot pick up stray
    // gaps a reader would not see.
    if (ch === ' ' && (value === '' || value.endsWith(' '))) return
    value += ch
  }

  function accepts(key: string): boolean {
    return (
      /^[a-zA-Z]$/.test(key) || (key.length === 1 && extraKeys.includes(key))
    )
  }
  function backspace(): void {
    value = value.slice(0, -1)
  }

  // A real keyboard's rows cascade right going down, by half a key's pitch
  // each row. On the bottom row, that cascade is absorbed by its own leading
  // close key instead of blank margin, when one is rendered.
  function rowOffset(i: number, hasLeadingKey: boolean): string {
    const steps = i * 0.5 - (hasLeadingKey ? 1 : 0)
    return `calc((var(--space-48) + var(--space-8)) * ${steps})`
  }

  onMount(() => {
    function onKeydown(e: KeyboardEvent): void {
      if (accepts(e.key)) {
        typeChar(e.key.toLowerCase())
      } else if (e.key === 'Backspace') {
        backspace()
      } else if (e.key === 'Enter') {
        onSubmit?.()
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  })
</script>

<Surface tone="light" radius="panel" blur>
  <div class="keyboard">
    {#if caption}
      <p class="caption">{caption}</p>
    {/if}
    {#if suggestions}
      <div class="suggestions">
        {#each suggestions as word (word)}
          <button
            type="button"
            class="suggestion"
            onpointerdown={(e) => {
              e.preventDefault()
              onSuggestion?.(word)
            }}>{word}</button
          >
        {/each}
      </div>
    {/if}
    {#each ROWS as row, i (row)}
      <div
        class="row"
        style:margin-inline-start={rowOffset(i, i === LAST && !!onClose)}
      >
        {#if i === LAST && onClose}
          <Key
            label=""
            ariaLabel={closeLabel}
            icon={chevronDownIconRaw}
            onTap={onClose}
          />
        {/if}
        {#each row as ch (ch)}
          <Key
            label={ch}
            onTap={() => typeChar(ch)}
            disabled={value.length >= maxLength}
          />
        {/each}
        {#if i === LAST}
          <Key label="⌫" onTap={backspace} disabled={value.length === 0} />
          {#if onSubmit}
            <Key label="⏎" ariaLabel={submitLabel} onTap={onSubmit} />
          {/if}
        {/if}
      </div>
    {/each}
    {#if extraChars.length > 0 || hasSpace}
      <div class="row row--extra">
        {#each extraChars as ch (ch)}
          <Key
            label={ch}
            onTap={() => typeChar(ch)}
            disabled={value.length >= maxLength}
          />
        {/each}
        {#if hasSpace}
          <Key
            label=""
            ariaLabel={spaceLabel}
            wide
            onTap={() => typeChar(' ')}
            disabled={value.length >= maxLength}
          />
        {/if}
      </div>
    {/if}
  </div>
</Surface>

<style lang="sass">
  .keyboard
    display: flex
    flex-direction: column
    gap: var(--space-8)
    padding: var(--space-24)

  .row
    display: flex
    gap: var(--space-8)

  .row--extra
    justify-content: center

  // One line, as tall as a key's label, whether or not it holds any words.
  .suggestions
    display: flex
    justify-content: center
    gap: var(--space-8)
    min-height: var(--space-48)

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

  .caption
    margin: 0 0 var(--space-4)
    text-align: center
    @include tint.type-class(ui-small-bold)
    color: var(--color-text-secondary)
</style>
