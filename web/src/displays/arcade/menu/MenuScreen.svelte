<!--
  Reusable Valve-style game menu: a left rail with the game title, an optional
  running score under it, and a navigable stack of buttons. Submenus (e.g. an AI
  difficulty picker) swap the button panel in place with a slide/fade, keeping
  the title. Rendered inside a game's camera-anchored overlay wrapper, so it
  scales with the game region; the right side of the region is left for the
  game's in-engine menu preview.

  Structure is menu-specific but everything visual comes from the shared system:
  `core/ui/Button` (primary=dark, surface=white), the `--color-*`/`--space-*`/
  `--radius-*` tokens, and the `display` type-class for the title.
-->
<script lang="ts">
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Button from '@src/core/ui/Button.svelte'
  import IconButton from '@src/core/ui/IconButton.svelte'
  import MatchScore from './MatchScore.svelte'
  import type { MenuAction, MenuItem, MenuScore, MenuSubmenu, MenuVariant } from './types'
  import type { Component } from 'svelte'

  interface Props {
    title: string
    items: MenuItem[]
    /** Optional running score; shown under the title only when past 0:0. */
    score?: MenuScore
    /** Side that just scored (pulses its score tile). */
    bump?: 'left' | 'right' | null
    /** Label for the auto Back button in submenus. */
    backLabel?: string
  }
  const {
    title,
    items,
    score,
    bump = null,
    backLabel = 'Back',
  }: Props = $props()

  /** The open submenu, or null at the root panel. */
  let openSubmenu = $state<MenuSubmenu | null>(null)

  interface PanelButton {
    label: string
    variant: MenuVariant
    icon?: Component
    onClick: () => void
    trailing?: MenuAction['trailing']
  }

  const showScore = $derived(!!score && (score.left > 0 || score.right > 0))
  const panelId = $derived(openSubmenu ? openSubmenu.label : '__root')
  const heading = $derived(openSubmenu?.heading ?? null)

  const buttons = $derived<PanelButton[]>(
    openSubmenu
      ? [
          ...openSubmenu.items.map((a) => ({
            label: a.label,
            variant: a.variant ?? 'primary',
            icon: a.icon,
            onClick: a.onSelect,
            trailing: a.trailing,
          })),
          {
            label: backLabel,
            variant: 'surface' as const,
            onClick: () => (openSubmenu = null),
          },
        ]
      : items.map((it) =>
          it.kind === 'submenu'
            ? {
                label: it.label,
                variant: it.variant ?? 'primary',
                onClick: () => (openSubmenu = it),
              }
            : {
                label: it.label,
                variant: it.variant ?? 'primary',
                icon: it.icon,
                onClick: it.onSelect,
                trailing: it.trailing,
              },
        ),
  )
</script>

<div class="menu" transition:fade={{ duration: 200 }}>
  <div class="menu__rail">
    <div class="menu__head">
      <h1 class="menu__title">{title}</h1>
      {#if showScore && score}
        <MatchScore
          left={score.left}
          right={score.right}
          leftColor={score.leftColor}
          rightColor={score.rightColor}
          {bump}
        />
      {/if}
    </div>

    <div class="menu__panels">
      {#key panelId}
        <div
          class="menu__panel"
          in:fly={{ x: 32, duration: 220, easing: cubicOut }}
          out:fly={{ x: -24, duration: 160, easing: cubicOut }}
        >
          {#if heading}<h2 class="menu__heading">{heading}</h2>{/if}
          {#each buttons as b (b.label)}
            <div class="menu__row">
              {#if b.icon}
                {@const Icon = b.icon}
                <Button variant={b.variant} onclick={b.onClick}>
                  {#snippet leadingIcon()}<Icon />{/snippet}
                  {b.label}
                </Button>
              {:else}
                <Button variant={b.variant} onclick={b.onClick}>{b.label}</Button>
              {/if}
              {#if b.trailing}
                {@const TrailingIcon = b.trailing.icon}
                <IconButton
                  label={b.trailing.ariaLabel}
                  tone="surface"
                  onclick={b.trailing.onSelect}
                >
                  <TrailingIcon />
                </IconButton>
              {/if}
            </div>
          {/each}
        </div>
      {/key}
    </div>
  </div>
</div>

<style lang="sass">
  // Menu-specific layout metrics (in the region's 1920×1080 space). Everything
  // else pulls from the shared token system.
  .menu
    position: absolute
    inset: 0
    pointer-events: none
    --menu-inset-x: 9.5rem
    --menu-top: 8.5rem
    --menu-bottom: 8rem

  .menu__rail
    position: absolute
    inset-block: var(--menu-top) var(--menu-bottom)
    inset-inline-start: var(--menu-inset-x)
    display: flex
    flex-direction: column
    // Leave the right side for the in-engine preview.
    max-width: 42%

  .menu__head
    display: flex
    flex-direction: column
    align-items: flex-start
    gap: var(--space-24)

  .menu__title
    margin: 0
    @include tint.type-class(display)
    // Games can tint their title via the `title` theme token; falls back to the
    // body text color when unset, so other menus are unaffected.
    color: var(--color-title, var(--color-text))

  // Panels swap in the same grid cell so the outgoing + incoming overlap
  // cleanly during the slide/fade. `align-items: end` bottom-aligns every panel
  // so the button stack stays put when switching to a taller/shorter panel
  // (e.g. a submenu adds a heading above) — the extra content grows upward.
  .menu__panels
    margin-block-start: auto
    display: grid
    align-items: end

  .menu__panel
    grid-area: 1 / 1
    display: flex
    flex-direction: column
    align-items: flex-start
    gap: var(--space-16)
    // Buttons capture input; the rail/menu is otherwise click-through.
    pointer-events: auto

  .menu__row
    display: flex
    align-items: center
    gap: var(--space-8)

  .menu__heading
    margin: 0 0 var(--space-8)
    @include tint.type-class(headline-sm)
    color: var(--color-text)
</style>
