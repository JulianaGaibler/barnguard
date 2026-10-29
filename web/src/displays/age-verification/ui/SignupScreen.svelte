<!--
  The screen after every ending: a short sign-up form built from `signupForm`,
  and beside it QR codes to read on, one at a time. The text, the form and its
  button are on the left and the codes on the right, or all in one column on a
  portrait screen. Laid out in design pixels against the region's visible area,
  by `layoutIn`, like the story. The story's progress row isn't shown here, so
  the content takes its room at the top.

  The form starts with the email alone. The fields that wait for it come in
  once it looks like an address, and stay for the rest of the visit.

  Each entrance starts the form over, so a visitor never sees what the one
  before them typed. Sent entries stay on the device, see `signup/entries.ts`.

  The fields are real inputs and bring up the device's own keyboard: the booth
  runs this display on an iPad, where that keyboard is reliable. Nothing is
  autofilled, so a visitor isn't offered what the one before them typed.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { slide } from 'svelte/transition'
  import { domAnchor, ignoreAbort, type Engine } from 'stargazer'
  import { Reveal } from '@src/core/ui/reveal.svelte'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import { t } from '../i18n'
  import {
    cleanValues,
    emptyValues,
    fieldReady,
    fieldValid,
    formValid,
    signupForm,
    type SignupField,
  } from '../signup/form'
  import { saveSignup } from '../signup/entries'
  import { layoutIn, tapHeight } from './layout'
  import { MOTION, slideOffset } from './motion'
  import NavBar from './NavBar.svelte'

  /** How long each QR code shows before the next one comes in. */
  const READING_SEC = 8
  /** The least height of a field or a button, in design pixels. */
  const FIELD_HEIGHT = 88

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
  const reading = signupForm.reading
  /** The fields shown from the start, and the ones that wait for another. */
  const first = fields.filter((f) => !f.after)
  const later = fields.filter((f) => !!f.after)

  let values = $state(emptyValues(fields))
  /** The ids of the waiting fields that have come in. They stay once in. */
  let shown = $state<string[]>([])
  /** The id of the field being typed into, if any. */
  let editing = $state<string | null>(null)
  let form = $state<HTMLFormElement | null>(null)
  let sent = $state(false)
  let failed = $state(false)
  /** True while the screen changes, so a second tap can't send twice. */
  let busy = $state(false)
  /** The QR code showing. */
  let code = $state(0)
  /** True once the visitor picks a code, which stops them taking turns. */
  let picked = $state(false)

  const valid = $derived(formValid(fields, values))
  const layout = $derived(layoutIn(region, 'choice'))
  const showing = $derived(later.filter((f) => shown.includes(f.id)))
  /** Every text field on screen, in order, for Return to step through. */
  const inputs = $derived([...first, ...showing])

  $effect(() => {
    const ready = later.filter(
      (f) => !shown.includes(f.id) && fieldReady(f, fields, values),
    )
    if (ready.length) shown = [...shown, ...ready.map((f) => f.id)]
  })

  // The text, the form, the codes and the buttons come in one after another.
  /* svelte-ignore state_referenced_locally */
  const reveal = new Reveal(engine, 4)
  const part = (i: number): string => {
    const v = reveal.items[i]!.v
    return `opacity: ${v}; transform: translateX(${slideOffset(1, v, MOTION.slideDistance)}px)`
  }

  // Every entrance is a new visitor. The story leaves first, so the form waits
  // for it to clear. Only `active` drives this: the resets read the form, and
  // the form going away for the thank you must not start it over.
  $effect(() => {
    const waiting = new AbortController()
    if (active) {
      untrack(() => {
        values = emptyValues(fields)
        shown = []
        dropFocus()
        sent = false
        failed = false
        busy = false
        // Each visitor sees a different code first, so every link gets its
        // share of the people who scan only the first.
        code = Math.floor(Math.random() * reading.length)
        picked = false
      })
      engine
        .wait(MOTION.handoff, waiting.signal)
        .then(() => reveal.show())
        .catch(ignoreAbort)
    } else {
      untrack(dropFocus)
      void reveal.hide()
    }
    return () => waiting.abort()
  })

  // The codes take turns while the screen shows, until the visitor picks one:
  // after that they stay on what was picked.
  $effect(() => {
    void code
    if (!active || picked || reading.length < 2) return
    const timer = setTimeout(
      () => (code = (code + 1) % reading.length),
      READING_SEC * 1000,
    )
    return () => clearTimeout(timer)
  })

  onDestroy(() => reveal.destroy())

  /** Shows code `i`, and keeps it there. */
  function pick(i: number): void {
    picked = true
    code = i
  }

  /** Puts the keyboard away. */
  function dropFocus(): void {
    editing = null
    if (form?.contains(document.activeElement)) {
      ;(document.activeElement as HTMLElement).blur()
    }
  }

  function text(field: SignupField): string {
    return values[field.id] ?? ''
  }

  /** A field that holds something it shouldn't, once the visitor moves on. */
  function flagged(field: SignupField): boolean {
    return (
      editing !== field.id && !!text(field).trim() && !fieldValid(field, values)
    )
  }

  /** Return moves on to the next field, and sends the form from the last. */
  function onKeydown(e: KeyboardEvent, field: SignupField): void {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = inputs[inputs.indexOf(field) + 1]
    if (next) {
      form?.querySelector<HTMLInputElement>(`#signup-${next.id}`)?.focus()
    } else if (valid) void submit()
    else dropFocus()
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
    shown = []
    sent = true
    busy = false
    reveal.show()
  }
</script>

{#snippet input(field: SignupField)}
  <div class="signup__field">
    <label class="signup__label" for="signup-{field.id}">{field.label}</label>
    <input
      id="signup-{field.id}"
      class="signup__input"
      class:signup__input--flagged={flagged(field)}
      type={field.input === 'email' ? 'email' : 'text'}
      inputmode={field.input === 'email' ? 'email' : 'text'}
      enterkeyhint={field === inputs.at(-1) ? 'send' : 'next'}
      autocomplete="off"
      autocapitalize={field.input === 'email' ? 'none' : 'words'}
      autocorrect="off"
      spellcheck="false"
      placeholder={field.placeholder}
      maxlength={field.maxLength}
      required={field.required}
      aria-invalid={flagged(field)}
      bind:value={() => text(field), (next) => (values[field.id] = next)}
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
{/snippet}

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
  style:--content-y="{layout.trailY}px"
  style:--content-height="{layout.content.y +
    layout.content.height -
    layout.trailY}px"
  style:--nav-y="{layout.navY}px"
  style:--nav-height="{layout.navHeight}px"
  style:--field-height="{tapHeight(FIELD_HEIGHT, region.cssPxInWorld)}px"
>
  <div class="signup__content" class:signup__content--stacked={layout.stacked}>
    <div class="signup__main">
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
          {#each first as field (field.id)}
            {@render input(field)}
          {/each}
          {#if showing.length}
            <div class="signup__more" transition:slide={{ duration: 300 }}>
              {#each showing as field (field.id)}
                {@render input(field)}
              {/each}
            </div>
          {/if}
          {#if failed}
            <p class="signup__error" role="alert">{$t.signup.saveFailed}</p>
          {/if}
          <button
            type="submit"
            class="signup__submit"
            disabled={!valid || busy}
          >
            {$t.signup.submit}
          </button>
        </form>
      {/if}
    </div>

    <aside class="signup__reading" style={part(2)}>
      <h2 class="signup__reading-title">{signupForm.readingTitle}</h2>
      <button
        type="button"
        class="signup__codes"
        aria-label={$t.signup.nextCode}
        onclick={() => pick((code + 1) % reading.length)}
      >
        {#each reading as link, i (link.url)}
          <figure class="signup__code" class:signup__code--on={i === code}>
            <img src={link.qr} alt={link.url} draggable="false" />
            <figcaption>
              <span class="signup__link-title">{link.title}</span>
            </figcaption>
          </figure>
        {/each}
      </button>
      {#if reading.length > 1}
        <div class="signup__tabs">
          {#each reading as link, i (link.url)}
            <button
              type="button"
              class="signup__tab"
              class:signup__tab--on={i === code}
              aria-label={$t.signup.showCode(i + 1, link.source)}
              aria-pressed={i === code}
              onclick={() => pick(i)}
            >
              {link.source}
              {#if i === code && active && !picked}
                {#key code}
                  <span
                    class="signup__timer"
                    style:animation-duration="{READING_SEC}s"
                  ></span>
                {/key}
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </aside>
  </div>

  <div class="signup__nav" style={part(3)}>
    <NavBar
      disabled={busy || !active}
      back={sent ? undefined : { label: $t.story.back, onPress: onBack }}
      home={{ label: $t.signup.done, onPress: onDone }}
    />
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

  // The form on the left, the codes on the right, both centered in the height.
  .signup__content
    position: absolute
    inset-inline-start: var(--row-x)
    inset-block-start: var(--content-y)
    width: var(--row-width)
    height: var(--content-height)
    display: grid
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)
    column-gap: 128px
    align-items: center

  // On a portrait screen everything is one column, which scrolls when it runs
  // long. The anchor container ignores pointers, so the column takes them.
  .signup__content--stacked
    grid-template-columns: minmax(0, 1fr)
    row-gap: 64px
    align-content: start
    overflow-y: auto
    overscroll-behavior: contain
    pointer-events: auto
    scrollbar-width: none

  .signup__main
    display: flex
    flex-direction: column
    gap: 48px

  .signup__text
    display: flex
    flex-direction: column
    gap: 40px
    will-change: opacity, transform

  .signup__title
    @include type.letter
    font-size: 72px
    margin: 0

  .signup__paragraph
    @include type.body
    font-size: 32px
    margin: 0

  .signup__form
    display: flex
    flex-direction: column
    gap: 24px
    margin: 0
    will-change: opacity, transform

  // The fields that come in later share a row, so the form grows by only one.
  .signup__more
    display: grid
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)
    gap: 24px

  .signup__field
    display: flex
    flex-direction: column
    gap: 12px

  .signup__label
    @include type.option
    font-size: 26px

  // Not trimmed like the other type: a field needs its whole line box for the
  // caret and the selection.
  .signup__input
    appearance: none
    box-sizing: border-box
    width: 100%
    height: var(--field-height)
    margin: 0
    padding: 0 28px
    border: 3px solid var(--color-text)
    border-radius: 0
    background: var(--color-surface)
    color: var(--color-text)
    font-family: var(--font-mozilla-text)
    font-weight: 600
    font-size: 36px
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
    font-size: 24px
    margin: 0
    color: var(--color-accent)

  .signup__submit
    @include type.button
    align-self: flex-start
    display: flex
    align-items: center
    height: var(--field-height)
    padding: 0 48px
    border: 0
    color: var(--color-action-primary-text)
    background: var(--color-action-primary)
    cursor: pointer
    pointer-events: auto
    -webkit-tap-highlight-color: transparent

    &:active
      background: var(--color-action-primary-active)

    &:disabled
      opacity: 0.4
      cursor: default

  // On a card of its own, so the background's dots keep clear of the codes,
  // which a phone reads best with a quiet margin around them.
  .signup__reading
    display: flex
    flex-direction: column
    align-items: center
    gap: 32px
    padding: 48px 48px 16px
    background: var(--color-surface)
    will-change: opacity, transform

  .signup__reading-title
    @include type.option
    font-size: 36px
    margin: 0
    text-align: center

  // The codes lie on top of each other and cross-fade. A tap moves on.
  .signup__codes
    display: grid
    width: 100%
    padding: 0
    border: 0
    background: transparent
    color: inherit
    cursor: pointer
    pointer-events: auto
    -webkit-tap-highlight-color: transparent

  .signup__code
    grid-area: 1 / 1
    display: flex
    flex-direction: column
    align-items: center
    gap: 24px
    margin: 0
    opacity: 0
    transition: opacity 0.6s ease

    img
      display: block
      width: 400px
      height: 400px
      image-rendering: pixelated

    figcaption
      display: flex
      flex-direction: column
      align-items: center
      gap: 12px
      max-width: 560px
      text-align: center

  .signup__code--on
    opacity: 1

  .signup__link-title
    @include type.option
    font-size: 28px

  // One button per link, named for who published it, styled like the buttons
  // along the bottom. The one showing is filled, and while the codes take
  // turns a bar along its foot runs down the time until the next one.
  .signup__tabs
    display: flex
    gap: 16px

  .signup__tab
    @include type.button
    position: relative
    display: flex
    align-items: center
    height: var(--nav-height, 64px)
    padding: 0 28px
    border: 2px solid var(--color-accent)
    color: var(--color-accent)
    background: transparent
    font-size: 28px
    overflow: hidden
    cursor: pointer
    pointer-events: auto
    -webkit-tap-highlight-color: transparent

    &:active
      background: var(--color-action-secondary-active)

  .signup__tab--on
    color: var(--color-action-primary-text)
    background: var(--color-action-primary)

    &:active
      background: var(--color-action-primary-active)

  .signup__timer
    position: absolute
    inset-inline: 0
    inset-block-end: 0
    height: 6px
    background: var(--color-action-primary-text)
    opacity: 0.6
    transform-origin: left
    animation: signup-timer linear forwards

  @keyframes signup-timer
    from
      transform: scaleX(0)
    to
      transform: scaleX(1)

  .signup__nav
    will-change: opacity, transform
    position: absolute
    inset-inline-start: var(--row-x)
    inset-block-start: var(--nav-y)
    width: var(--row-width)
</style>
