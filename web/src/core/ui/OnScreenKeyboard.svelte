<!--
  A QWERTY on-screen keyboard for short name entry on kiosk touchscreens,
  where a real `<input>` would trigger the OS's own virtual keyboard on top of
  this one. Letters + backspace only. Also responds to a physical keyboard.
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
    closeLabel?: string
    submitLabel?: string
  }
  let {
    value = $bindable(),
    maxLength,
    onSubmit,
    onClose,
    closeLabel = 'Close',
    submitLabel = 'Enter',
  }: Props = $props()

  const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  const LAST = ROWS.length - 1

  function typeChar(ch: string): void {
    if (value.length >= maxLength) return
    value += ch
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
      if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
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
</style>
