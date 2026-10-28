<!--
  The screen after every ending: a short sign-up form built from `signupForm`,
  then a thank you. The text is on the left and the form on the right, or one
  above the other on a portrait screen. Laid out in design pixels against the
  region's visible area, by `layoutIn`, like the story.

  Each entrance starts the form over, so a visitor never sees what the one
  before them typed. Sent entries stay on the device, see `signup/entries.ts`.

  The fields are real inputs and bring up the device's own keyboard: the booth
  runs this display on an iPad, where that keyboard is reliable. Nothing is
  autofilled, so a visitor isn't offered what the one before them typed.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { domAnchor, ignoreAbort, type Engine } from 'stargazer'
  import { Reveal } from '@src/core/ui/reveal.svelte'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import { t } from '../i18n'
  import {
    cleanValues,
    emptyValues,
    fieldValid,
    formValid,
    signupForm,
    type TextField,
  } from '../signup/form'
  import { saveSignup } from '../signup/entries'
  import { layoutIn, tapHeight } from './layout'
  import { MOTION, slideOffset } from './motion'
  import NavBar from './NavBar.svelte'

  /** The thank you goes back to the splash on its own after this long. */
  const THANKS_SEC = 10
  /** The least height of a field or a box to tick, in design pixels. */
  const FIELD_HEIGHT = 96

  interface Props {
    engine: Engine
    /** The visible area the screen is laid out in. */
    region: UiRegion
    /** Whether the screen is showing. Flipping it plays the entrance or exit. */
    active: boolean
    /** Back to the ending the visitor came from. */
    onBack: () => void
    /** Leave for the splash screen, sent or not. */
    onDone: () => void
  }
  const { engine, region, active, onBack, onDone }: Props = $props()

  const fields = signupForm.fields

  let values = $state(emptyValues(fields))
  /** The id of the field being typed into, if any. */
  let editing = $state<string | null>(null)
  let form = $state<HTMLFormElement | null>(null)
  let sent = $state(false)
  let failed = $state(false)
  /** True while the screen changes, so a second tap can't send twice. */
  let busy = $state(false)

  const valid = $derived(formValid(fields, values))
  const layout = $derived(layoutIn(region, 'choice'))

  // The text, the form and the buttons come in one after another.
  /* svelte-ignore state_referenced_locally */
  const reveal = new Reveal(engine, 3)
  const part = (i: number): string => {
    const v = reveal.items[i]!.v
    return `opacity: ${v}; transform: translateX(${slideOffset(1, v, MOTION.slideDistance)}px)`
  }

  // Every entrance is a new visitor. The story leaves first, so the form waits
  // for it to clear. Only `active` drives this: the resets read the form, and
  // the form going away for the thank you must not start it over.
  let thanksTimer: ReturnType<typeof setTimeout> | null = null
  $effect(() => {
    const waiting = new AbortController()
    if (active) {
      untrack(() => {
        values = emptyValues(fields)
        dropFocus()
        sent = false
        failed = false
        busy = false
      })
      engine
        .wait(MOTION.handoff, waiting.signal)
        .then(() => reveal.show())
        .catch(ignoreAbort)
    } else {
      untrack(dropFocus)
      void reveal.hide()
    }
    return () => {
      waiting.abort()
      if (thanksTimer) clearTimeout(thanksTimer)
      thanksTimer = null
    }
  })

  onDestroy(() => reveal.destroy())

  /** Puts the keyboard away. */
  function dropFocus(): void {
    editing = null
    if (form?.contains(document.activeElement)) {
      ;(document.activeElement as HTMLElement).blur()
    }
  }

  const textFields = fields.filter((f): f is TextField => f.kind === 'text')

  /** Return moves on to the next field, and puts the keyboard away on the last. */
  function onKeydown(e: KeyboardEvent, field: TextField): void {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = textFields[textFields.indexOf(field) + 1]
    if (next)
      form?.querySelector<HTMLInputElement>(`#signup-${next.id}`)?.focus()
    else dropFocus()
  }

  function text(field: TextField): string {
    const value = values[field.id]
    return typeof value === 'string' ? value : ''
  }

  /** A field that holds something it shouldn't, once the visitor moves on. */
  function flagged(field: TextField): boolean {
    return (
      editing !== field.id && !!text(field).trim() && !fieldValid(field, values)
    )
  }

  function toggle(id: string): void {
    values[id] = values[id] !== true
  }

  async function submit(): Promise<void> {
    if (busy || !valid || !active) return
    busy = true
    dropFocus()
    failed = !saveSignup(cleanValues(fields, values))
    if (failed) {
      busy = false
      return
    }
    await reveal.hide()
    // The visitor's details are kept now, and need not stay on screen.
    values = emptyValues(fields)
    sent = true
    busy = false
    reveal.show()
    thanksTimer = setTimeout(() => {
      if (active) onDone()
    }, THANKS_SEC * 1000)
  }
</script>

<section
  class="signup"
  class:signup--hidden={!reveal.visible}
  aria-hidden={!active}
  inert={!active}
  use:domAnchor={{
    engine,
    node: region.anchor,
    size: { width: region.rect.width, height: region.rect.height },
  }}
  style:--row-x="{layout.rowX}px"
  style:--row-width="{layout.rowWidth}px"
  style:--content-x="{layout.content.x}px"
  style:--content-y="{layout.content.y}px"
  style:--content-width="{layout.content.width}px"
  style:--content-height="{layout.content.height}px"
  style:--nav-y="{layout.navY}px"
  style:--nav-height="{layout.navHeight}px"
  style:--field-height="{tapHeight(FIELD_HEIGHT, region.cssPxInWorld)}px"
>
  <div
    class="signup__content"
    class:signup__content--stacked={layout.stacked}
    class:signup__content--sent={sent}
  >
    <div class="signup__text" style={part(0)}>
      {#if sent}
        <h1 class="signup__title">{$t.signup.thanksTitle}</h1>
        <p class="signup__paragraph">{$t.signup.thanksBody}</p>
      {:else}
        <h1 class="signup__title">{signupForm.title}</h1>
        {#each signupForm.body as paragraph, i (i)}
          <p class="signup__paragraph">{paragraph}</p>
        {/each}
      {/if}
    </div>

    {#if !sent}
      <form
        class="signup__form"
        style={part(1)}
        bind:this={form}
        onsubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {#each fields as field (field.id)}
          {#if field.kind === 'text'}
            <div class="signup__field">
              <label class="signup__label" for="signup-{field.id}">
                {field.label}
              </label>
              <input
                id="signup-{field.id}"
                class="signup__input"
                class:signup__input--flagged={flagged(field)}
                type={field.input === 'email' ? 'email' : 'text'}
                inputmode={field.input === 'email' ? 'email' : 'text'}
                enterkeyhint={field === textFields.at(-1) ? 'done' : 'next'}
                autocomplete="off"
                autocapitalize={field.input === 'email' ? 'none' : 'words'}
                autocorrect="off"
                spellcheck="false"
                placeholder={field.placeholder}
                maxlength={field.maxLength}
                required={field.required}
                aria-invalid={flagged(field)}
                bind:value={
                  () => text(field), (next) => (values[field.id] = next)
                }
                onfocus={() => (editing = field.id)}
                onblur={() => {
                  if (editing === field.id) editing = null
                }}
                onkeydown={(e) => onKeydown(e, field)}
              />
              {#if flagged(field) && field.input === 'email'}
                <span class="signup__error">{$t.signup.invalidEmail}</span>
              {/if}
            </div>
          {:else}
            <button
              type="button"
              class="signup__check"
              role="checkbox"
              aria-checked={values[field.id] === true}
              onclick={() => toggle(field.id)}
            >
              <span class="signup__box" aria-hidden="true">
                {#if values[field.id] === true}
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="square"
                    />
                  </svg>
                {/if}
              </span>
              <span class="signup__check-label">{field.label}</span>
            </button>
          {/if}
        {/each}
        {#if failed}
          <p class="signup__error" role="alert">{$t.signup.saveFailed}</p>
        {/if}
      </form>
    {/if}
  </div>

  <div class="signup__nav" style={part(2)}>
    {#if sent}
      <NavBar
        disabled={busy || !active}
        forward={{ label: $t.story.startOver, onPress: onDone }}
      />
    {:else}
      <NavBar
        disabled={busy || !active}
        back={{ label: $t.story.back, onPress: onBack }}
        forward={{
          label: $t.signup.submit,
          onPress: () => void submit(),
          disabled: !valid,
        }}
        home={{ label: $t.signup.skip, onPress: onDone }}
      />
    {/if}
  </div>
</section>

<style lang="sass">
  @use './type'

  // The engine sizes and places the section on the canvas.
  .signup
    position: absolute
    inset-block-start: 0
    inset-inline-start: 0
    color: var(--color-text)
    user-select: none
    -webkit-user-select: none

  .signup--hidden
    visibility: hidden

  // Two columns, the form at the top of its own so the device's keyboard, which
  // rises over the bottom of the screen, leaves the fields in view.
  .signup__content
    position: absolute
    inset-inline-start: var(--content-x)
    inset-block-start: var(--content-y)
    width: var(--content-width)
    height: var(--content-height)
    display: grid
    grid-template-columns: 1fr 1fr
    column-gap: 128px
    align-items: start

  .signup__content--stacked
    grid-template-columns: minmax(0, 1fr)
    row-gap: 64px
    align-content: start

  // The thank you is text alone, in the middle of the left column's height.
  .signup__content--sent
    align-items: center

  .signup__text
    display: flex
    flex-direction: column
    gap: 1.2em
    font-size: 44px
    will-change: opacity, transform

  .signup__title
    @include type.letter
    font-size: 2.2em
    margin: 0

  .signup__paragraph
    @include type.body
    font-size: 1em
    margin: 0

  .signup__form
    display: flex
    flex-direction: column
    gap: 40px
    margin: 0
    will-change: opacity, transform

  .signup__field
    display: flex
    flex-direction: column
    gap: 16px

  .signup__label
    @include type.option
    font-size: 32px

  // Not trimmed like the other type: a field needs its whole line box for the
  // caret and the selection.
  .signup__input
    appearance: none
    box-sizing: border-box
    width: 100%
    height: var(--field-height)
    margin: 0
    padding: 0 32px
    border: 3px solid var(--color-text)
    border-radius: 0
    background: var(--color-surface)
    color: var(--color-text)
    font-family: var(--font-mozilla-text)
    font-weight: 600
    font-size: 40px
    letter-spacing: -0.02em
    pointer-events: auto
    // The screens turn selection off. A field has to have it back.
    user-select: text
    -webkit-user-select: text
    -webkit-tap-highlight-color: transparent

    &::placeholder
      color: var(--color-text)
      opacity: 0.35

    &:focus
      border-color: var(--color-accent)
      outline: 3px solid var(--color-accent)
      outline-offset: 0

  .signup__input--flagged
    border-color: var(--color-accent)

  .signup__error
    @include type.option
    font-size: 28px
    margin: 0
    color: var(--color-accent)

  .signup__check
    @include type.option
    display: flex
    align-items: center
    gap: 24px
    min-height: var(--field-height)
    padding: 0
    border: 0
    background: transparent
    color: var(--color-text)
    font-size: 32px
    text-align: start
    cursor: pointer
    pointer-events: auto
    -webkit-tap-highlight-color: transparent

  .signup__box
    flex: none
    display: flex
    align-items: center
    justify-content: center
    width: 56px
    height: 56px
    border: 3px solid var(--color-text)
    box-sizing: border-box
    color: var(--color-action-primary-text)

    svg
      width: 40px
      height: 40px

  .signup__check[aria-checked='true'] .signup__box
    border-color: var(--color-accent)
    background: var(--color-accent)

  .signup__nav
    will-change: opacity, transform
    position: absolute
    inset-inline-start: var(--row-x)
    inset-block-start: var(--nav-y)
    width: var(--row-width)
</style>
