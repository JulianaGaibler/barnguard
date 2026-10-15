<script lang="ts">
  /**
   * The game over screen: an optional "new high score" banner, three cards (the
   * loss, the score, the leaderboard) and the buttons, laid out by stargazer on
   * the UI stage. Card 1 is drawn by the engine. The banner, cards 2 and 3 and
   * the buttons are HTML anchored to their layout nodes, so the engine tweens
   * that move, scale and fade those nodes move the HTML with them.
   *
   * Anything the engine draws here sits under the HTML, so the choreography
   * keeps the confetti to the moment the banner is alone on screen.
   *
   * A name typed on the leaderboard is saved when the screen leaves, by any
   * route, and discarded when none was typed.
   */
  import { onDestroy, untrack } from 'svelte'
  import {
    AbortScope,
    domAnchor,
    easings,
    ignoreAbort,
    Node2D,
    type Engine,
    type EngineHost,
  } from '@src/stargazer'
  import OnScreenKeyboardField from '@src/core/ui/OnScreenKeyboardField.svelte'
  import { NameEntry } from '@src/core/leaderboard/nameEntry.svelte'
  import { printerLive } from '@src/core/print/printerClient'
  import { t, mapCopy } from '@src/displays/enterprise/i18n'
  import { mapHigh, regionHigh } from '@src/displays/enterprise/game-log'
  import { EU_REGION_META } from '@src/displays/enterprise/game/maps/eu/regionMeta'
  import type { GameEvents } from '@src/displays/enterprise/game'
  import { printLabel } from '@src/displays/enterprise/overlays/printLabel'
  import type { UiRegion } from './uiRegion.svelte'
  import {
    BANNER_HEIGHT,
    BANNER_WIDTH,
    BUTTONS_HEIGHT,
    BUTTONS_WIDTH,
    CARD_HEIGHT,
    CARD_WIDTH,
    buildGameOverLayout,
  } from './gameOverLayout'
  import { LossCard } from './LossCardNode'
  import { ConfettiBurst } from './ConfettiBurst'
  import { boardDisplay, leaderboardRows } from './leaderboardRows'
  import { nameSuggestions } from './nameSuggestions'
  import { flagFor } from './flags'
  import ScoreCard from './ScoreCard.svelte'
  import LeaderboardCard from './LeaderboardCard.svelte'

  type GameOverPayload = GameEvents['gameOver']

  interface Props {
    engine: Engine
    host: EngineHost
    region: UiRegion
    /** Whether the screen is showing. Flipping it plays the entrance or exit. */
    active: boolean
    /** The round that ended, or `null` before one has. */
    payload: GameOverPayload | null
    mapId: string
    onPlayAgain: () => void
    onClose: () => void
  }
  let {
    engine,
    host,
    region,
    active,
    payload,
    mapId,
    onPlayAgain,
    onClose,
  }: Props = $props()

  /** Characters a leaderboard name may have, the server's cap. */
  const NAME_MAX = 12
  /** Keys beyond a to z a name may use. */
  const NAME_EXTRA_KEYS = '-. '
  /** How far a card or button sits below its place before it flies in. */
  const RISE = 140
  const CARD_STAGGER = 0.14
  /** The size a card grows from, about its own centre. */
  const CARD_START_SCALE = 0.85
  const BANNER_HOLD = 1.1
  /** How long after the banner starts rising the first card follows. */
  const CARDS_AFTER_RISE = 0.18

  // The layout reads the region live, so a resize re-lays it.
  const layout = buildGameOverLayout(() => ({
    x: 0,
    y: 0,
    width: region.rect.width,
    height: region.rect.height,
  }))
  layout.root.visible = false
  // The engine and region are fixed for the screen's life.
  /* svelte-ignore state_referenced_locally */
  region.anchor.add(layout.root)
  // The region's rect changes on the UI stage's own resize, which can land
  // after the engine-wide one the layout listens to, so relayout on it too.
  /* svelte-ignore state_referenced_locally */
  const offRegionResize = region.onResize(() => layout.root.requestLayout())
  const keyboardNode = new Node2D('game-over-keyboard')
  /* svelte-ignore state_referenced_locally */
  region.anchor.add(keyboardNode)

  const scope = new AbortScope()
  /** The round on screen, held through the exit after `payload` moves on. */
  let shown = $state<GameOverPayload | null>(null)
  let entry = $state<NameEntry | null>(null)
  let keyboardOpen = $state(false)
  let printed = $state(false)
  const count = $state({ v: 0 })
  const pop = $state({ v: 0 })
  let lossCard: LossCard | null = null

  const high = $derived(
    shown !== null && (shown.isOverallHigh || shown.isStateHigh),
  )
  const flag = $derived.by(() => {
    if (!shown || mapId !== 'eu') return null
    const meta = EU_REGION_META[shown.stateId]
    return meta ? flagFor(meta.iso2) : null
  })
  /** The map best and where it was set, which heads the board when unnamed. */
  const best = $derived.by(() => {
    if (!shown) return null
    const score = mapHigh(shown.highScores, mapId)
    if (score <= 0) return null
    const regions = shown.highScores.byState[mapId] ?? {}
    const region =
      Object.keys(regions).find((id) => regions[id] === score) ?? ''
    return { score, region }
  })
  const rows = $derived(
    entry && shown
      ? leaderboardRows(
          entry.entries,
          entry.stage === 'entering'
            ? { name: entry.name, score: shown.score, region: shown.stateId }
            : null,
          best,
        )
      : [],
  )
  const printerReady = $derived(
    $printerLive.connection === 'online' &&
      ($printerLive.printer?.reachable ?? false),
  )

  /** Each animated node's resting place, the centre of its slot. */
  function base(node: Node2D, width: number, height: number): void {
    node.transform.x = width / 2
    node.transform.y = height / 2
  }

  /** Put every part where it waits before its entrance. */
  function hideAll(): void {
    base(layout.banner, BANNER_WIDTH, BANNER_HEIGHT)
    layout.banner.transform.alpha = 0
    layout.banner.transform.scaleX = 0.6
    layout.banner.transform.scaleY = 0.6
    for (const card of layout.cards) {
      base(card, CARD_WIDTH, CARD_HEIGHT)
      card.transform.scaleX = CARD_START_SCALE
      card.transform.scaleY = CARD_START_SCALE
      card.transform.alpha = 0
    }
    if (lossCard) lossCard.alpha = 0
    base(layout.buttons, BUTTONS_WIDTH, BUTTONS_HEIGHT)
    layout.buttons.transform.y += RISE / 3
    layout.buttons.transform.alpha = 0
  }

  $effect(() => {
    const on = active
    const next = payload
    untrack(() => {
      if (on && next && next !== shown) void enter(next)
      else if (!on && shown) void leave()
    })
  })

  async function enter(next: GameOverPayload): Promise<void> {
    const signal = scope.reset()
    shown = next
    printed = false
    keyboardOpen = false
    count.v = 0
    pop.v = 0

    const nameEntry = new NameEntry({
      display: boardDisplay(mapId),
      score: next.score,
      maxLength: NAME_MAX,
      region: next.stateId,
    })
    nameEntry.start()
    entry = nameEntry

    lossCard?.destroy()
    lossCard = new LossCard(layout.cards[0], {
      host,
      reason: next.reason,
      escapeHeadingRad: next.escapeHeadingRad,
      title: $t.game.gameOverTitle,
      message:
        next.reason === 'collision'
          ? $t.game.gameOverCollision
          : mapCopy($t, mapId).lost,
    })

    hideAll()
    layout.root.visible = true
    // Lay out against the current rect before anything is measured.
    layout.root.requestLayout()
    await engine.wait(0, signal).catch(ignoreAbort)
    if (signal.aborted) return

    try {
      if (next.isOverallHigh || next.isStateHigh) {
        const rest = await celebrate(signal)
        // The banner rises while the cards come in, the cards a beat behind
        // so they never run into it.
        await Promise.all([
          engine.tween(
            layout.banner.transform,
            { y: rest },
            { duration: 0.6, easing: easings.inOutCubic, signal },
          ),
          revealCards(signal, CARDS_AFTER_RISE),
        ])
      } else {
        await revealCards(signal, 0)
      }
    } catch (err) {
      ignoreAbort(err)
    }
  }

  /**
   * The banner pops in at the middle of the screen with confetti and holds.
   * Resolves with the banner's resting place, for the rise that follows.
   */
  async function celebrate(signal: AbortSignal): Promise<number> {
    const banner = layout.banner
    // Measure the banner's slot against the region's middle, so it pops at the
    // centre of the screen whatever the window shape.
    const centre = banner.localToWorld(BANNER_WIDTH / 2, BANNER_HEIGHT / 2)
    const slotCentre = region.anchor.worldToLocal(centre.x, centre.y)
    const rest = banner.transform.y
    banner.transform.y = rest + (region.rect.height / 2 - slotCentre.y)
    region.anchor.add(
      new ConfettiBurst({
        x: region.rect.width / 2,
        y: region.rect.height / 2,
      }),
    )
    await engine.tween(
      banner.transform,
      { alpha: 1, scaleX: 1, scaleY: 1 },
      { duration: 0.5, easing: easings.outBack, signal },
    )
    await engine.wait(BANNER_HOLD, signal)
    return rest
  }

  /** After `delay`, the cards grow in one after another, then the buttons. */
  async function revealCards(
    signal: AbortSignal,
    delay: number,
  ): Promise<void> {
    await engine.wait(delay, signal)
    const landings = layout.cards.map(async (card, i) => {
      await engine.wait(i * CARD_STAGGER, signal)
      const grow = engine.tween(
        card.transform,
        { scaleX: 1, scaleY: 1, alpha: 1 },
        { duration: 0.5, easing: easings.outCubic, signal },
      )
      // The engine-drawn card fades through its own nodes, see `LossCard`.
      const fade =
        i === 0 && lossCard
          ? engine.tween(
              lossCard,
              { alpha: 1 },
              { duration: 0.5, easing: easings.outCubic, signal },
            )
          : null
      await Promise.all([grow, fade])
      if (i === 0) lossCard?.start()
      if (i === 1) await countUp(signal)
    })
    await engine.wait(CARD_STAGGER * 2 + 0.3, signal)
    await engine.tween(
      layout.buttons.transform,
      { y: BUTTONS_HEIGHT / 2, alpha: 1 },
      { duration: 0.45, easing: easings.outCubic, signal },
    )
    await Promise.all(landings)
  }

  /** The score counts up from zero, and the pills pop when it lands. */
  async function countUp(signal: AbortSignal): Promise<void> {
    const score = shown?.score ?? 0
    await engine.tween(
      count,
      { v: score },
      {
        duration: Math.min(1.4, 0.4 + score * 0.04),
        easing: easings.outCubic,
        signal,
      },
    )
    await engine.tween(
      pop,
      { v: 1 },
      { duration: 0.1, easing: easings.outCubic, signal },
    )
    await engine.tween(
      pop,
      { v: 0 },
      { duration: 0.3, easing: easings.outBack, signal },
    )
  }

  async function leave(): Promise<void> {
    const signal = scope.reset()
    keyboardOpen = false
    void entry?.save()
    const parts = [layout.banner, layout.buttons, ...layout.cards]
    try {
      await Promise.all([
        ...parts.map((node) =>
          engine.tween(
            node.transform,
            { alpha: 0, scaleX: 0.96, scaleY: 0.96 },
            { duration: 0.25, easing: easings.inCubic, signal },
          ),
        ),
        lossCard
          ? engine.tween(
              lossCard,
              { alpha: 0 },
              { duration: 0.25, easing: easings.inCubic, signal },
            )
          : null,
      ])
    } catch (err) {
      ignoreAbort(err)
      return
    }
    lossCard?.destroy()
    lossCard = null
    layout.root.visible = false
    shown = null
  }

  function print(): void {
    const round = shown
    if (!round || printed || !printerReady) return
    printed = true
    void printLabel({
      reason: round.reason,
      stateId: round.stateId,
      mapId,
      score: round.score,
      isOverallHigh: round.isOverallHigh,
      isStateHigh: round.isStateHigh,
      highScores: round.highScores,
      escapeHeadingRad: round.escapeHeadingRad,
    })
  }

  onDestroy(() => {
    offRegionResize()
    void entry?.save()
    scope.dispose()
    lossCard?.destroy()
    layout.root.destroy()
    keyboardNode.destroy()
  })
</script>

<div class="over">
  <div
    class="over__banner"
    use:domAnchor={{
      engine,
      node: layout.banner,
      size: { width: BANNER_WIDTH, height: BANNER_HEIGHT },
      syncOpacity: true,
    }}
  >
    {#if high}
      <span class="over__banner-pill">{$t.game.newHighScoreBanner}</span>
    {/if}
  </div>

  <div
    class="over__card"
    use:domAnchor={{
      engine,
      node: layout.cards[1],
      size: { width: CARD_WIDTH, height: CARD_HEIGHT },
      syncOpacity: true,
    }}
  >
    {#if shown}
      <ScoreCard
        shown={count.v}
        overall={mapHigh(shown.highScores, mapId)}
        regional={regionHigh(shown.highScores, mapId, shown.stateId)}
        {flag}
        regionLabel={shown.stateId}
        pop={pop.v}
      />
    {/if}
  </div>

  <div
    class="over__card"
    use:domAnchor={{
      engine,
      node: layout.cards[2],
      size: { width: CARD_WIDTH, height: CARD_HEIGHT },
      syncOpacity: true,
    }}
  >
    {#if entry}
      <LeaderboardCard
        {rows}
        {mapId}
        unavailable={entry.stage === 'unavailable'}
        editing={keyboardOpen}
        onEdit={() => (keyboardOpen = true)}
      />
    {/if}
  </div>

  <div
    class="over__buttons"
    use:domAnchor={{
      engine,
      node: layout.buttons,
      size: { width: BUTTONS_WIDTH, height: BUTTONS_HEIGHT },
      syncOpacity: true,
    }}
  >
    <button
      class="over__button"
      disabled={!active || printed || !printerReady}
      onclick={print}
    >
      {printed ? $t.game.printedButton : $t.game.printButton}
    </button>
    <button class="over__button" disabled={!active} onclick={onPlayAgain}>
      {$t.game.playAgainButton}
    </button>
    <button
      class="over__button over__button--light"
      disabled={!active}
      onclick={onClose}
    >
      {$t.game.closeButton}
    </button>
  </div>

  <div
    class="over__keyboard"
    use:domAnchor={{
      engine,
      node: keyboardNode,
      size: { width: region.rect.width, height: region.rect.height },
    }}
  >
    {#if keyboardOpen}
      <!-- A tap anywhere outside the sheet closes the keyboard. -->
      <button
        class="over__dismiss"
        aria-label={$t.game.closeKeyboard}
        onclick={() => (keyboardOpen = false)}
      ></button>
    {/if}
    {#if entry}
      <OnScreenKeyboardField
        bind:value={entry.name}
        maxLength={entry.maxLength}
        bind:open={keyboardOpen}
        showTrigger={false}
        closeLabel={$t.game.closeKeyboard}
        extraKeys={NAME_EXTRA_KEYS}
        spaceLabel={$t.game.spaceKey}
        suggestions={nameSuggestions(entry.entries, entry.name)}
        onSuggestion={(word) => {
          if (entry) entry.name = word.slice(0, entry.maxLength)
        }}
        onSubmit={() => (keyboardOpen = false)}
      />
    {/if}
  </div>
</div>

<style lang="sass">
  .over
    position: absolute
    inset: 0
    pointer-events: none

  .over__banner
    display: flex
    align-items: center
    justify-content: center

  .over__banner-pill
    display: inline-flex
    align-items: center
    padding: 16px 48px
    border-radius: 256px
    background: #ffffff
    color: #010612
    font-family: var(--font-mozilla-headline-condensed)
    font-weight: 700
    font-size: 88px
    line-height: normal
    text-transform: uppercase
    white-space: nowrap

  .over__buttons
    display: flex
    align-items: center
    justify-content: center
    gap: 12px

  .over__button
    appearance: none
    border: 0
    cursor: pointer
    pointer-events: auto
    height: 80px
    padding: 20px 32px
    border-radius: 999px
    background: #15141a
    color: #ffffff
    font-family: var(--font-mozilla-headline-condensed)
    font-weight: 600
    font-size: 40px
    line-height: 1.05
    letter-spacing: -0.8px
    white-space: nowrap
    text-box-trim: trim-both
    text-box-edge: cap alphabetic

    &:disabled
      pointer-events: none
      opacity: 0.5

  .over__button--light
    background: #fefdfe
    color: #15141a

  // The keyboard sheet docks to the bottom of this full-region box. White keys
  // on a lilac sheet, for contrast over the cards behind it.
  .over__keyboard
    --color-input-bg: #ffffff
    --color-surface-card: #d9cff3
    --color-text: #15141a

    :global(*)
      pointer-events: auto

  .over__dismiss
    position: absolute
    inset: 0
    appearance: none
    border: 0
    padding: 0
    background: transparent
    cursor: default
</style>
