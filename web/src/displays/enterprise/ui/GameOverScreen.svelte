<script lang="ts">
  /**
   * The game over screen: an optional "new high score" banner, three cards (the
   * loss, the score, the leaderboard) and the buttons, laid out by stargazer on
   * the UI layer. Card 1 is drawn by the engine. The banner, cards 2 and 3 and
   * the buttons are HTML anchored to their layout nodes, so the engine tweens
   * that move, scale and fade those nodes move the HTML with them.
   *
   * Anything the engine draws here sits under the HTML, so the choreography
   * keeps the confetti to the moment the banner is alone on screen.
   *
   * A name typed on the leaderboard is saved when the screen leaves, by any
   * route, and discarded when none was typed.
   *
   * Print opens the print picker in place of the cards: a name for the label,
   * which starts as the leaderboard name, and three label variants to pick
   * from. The label name never flows back to the leaderboard. The chosen
   * variant and name are saved on the round's record, once it has one, so a
   * reprint matches.
   *
   * A round that ended while the server was down shows without its record. If
   * the record lands while the screen is up, the payload for the same round
   * comes again with it, and a new high score raises the banner in place.
   * Nothing replays.
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
  } from 'stargazer'
  import OnScreenKeyboardField from '@src/core/ui/OnScreenKeyboardField.svelte'
  import { NameEntry } from '@src/core/leaderboard/nameEntry.svelte'
  import { printerLive } from '@src/core/print/printerClient'
  import { t, mapCopy } from '@src/displays/enterprise/i18n'
  import { mapHigh, regionHigh } from '@src/displays/enterprise/game-log'
  import { EU_REGION_META } from '@src/displays/enterprise/game/maps/eu/regionMeta'
  import type { GameEvents } from '@src/displays/enterprise/game'
  import { printLabel } from '@src/displays/enterprise/overlays/printLabel'
  import {
    DEFAULT_LABEL_VARIANT,
    LABEL_VARIANTS,
    renderLabelPreview,
    type LabelInput,
    type LabelVariant,
  } from '@src/displays/enterprise/label'
  import { setEnterpriseGameLabel } from '@src/displays/enterprise/game-log'
  import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
  import {
    BANNER_HEIGHT,
    BANNER_WIDTH,
    BUTTONS_HEIGHT,
    BUTTONS_WIDTH,
    CARD_HEIGHT,
    CARD_WIDTH,
    buildGameOverLayout,
  } from './gameOverLayout'
  import { buildPrintPickerLayout } from './printPickerLayout'
  import { LabelPreviewQueue } from './labelPreviewQueue'
  import { LossCard } from './LossCardNode'
  import { ConfettiBurst } from './ConfettiBurst'
  import { boardDisplay, leaderboardRows, mapBest } from './leaderboardRows'
  import { nameSuggestions } from './nameSuggestions'
  import { flagFor } from './flags'
  import ScoreCard from './ScoreCard.svelte'
  import LeaderboardCard from './LeaderboardCard.svelte'
  import PrintPicker from './PrintPicker.svelte'

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
  /** How far a card or button sits below its place before it flies in. */
  const RISE = 140
  const CARD_STAGGER = 0.14
  /** The size a card grows from, about its own centre. */
  const CARD_START_SCALE = 0.85
  const BANNER_HOLD = 1.1
  /** How long after the banner starts rising the first card follows. */
  const CARDS_AFTER_RISE = 0.18
  /** Space kept between the previews and the keyboard, in client pixels. */
  const KEYBOARD_CLEARANCE = 24

  // The layouts read the region live, so a resize re-lays them.
  const bounds = () => ({
    x: 0,
    y: 0,
    width: region.rect.width,
    height: region.rect.height,
  })
  const layout = buildGameOverLayout(bounds)
  layout.root.visible = false
  const picker = buildPrintPickerLayout(bounds)
  picker.lift.visible = false
  // The engine and region are fixed for the screen's life.
  /* svelte-ignore state_referenced_locally */
  region.anchor.add(layout.root, picker.lift)
  // The region refits on the engine's resize, which can run after the layout
  // has already seen it, so relayout on the region's own resize too.
  /* svelte-ignore state_referenced_locally */
  const offRegionResize = region.onResize(() => {
    layout.root.requestLayout()
    picker.root.requestLayout()
  })
  const keyboardNode = new Node2D('game-over-keyboard')
  /* svelte-ignore state_referenced_locally */
  region.anchor.add(keyboardNode)

  const scope = new AbortScope()
  /** The round on screen, held through the exit after `payload` moves on. */
  let shown = $state<GameOverPayload | null>(null)
  let entry = $state<NameEntry | null>(null)
  /** Which name the keyboard types into, if it is open. */
  let focus = $state<'leaderboard' | 'label' | null>(null)
  let printed = $state(false)
  /** Whether the entrance has finished, which is when Print opens the picker. */
  let revealed = $state(false)
  let view = $state<'summary' | 'picker'>('summary')
  let variant = $state<LabelVariant>(DEFAULT_LABEL_VARIANT)
  let labelName = $state('')
  /** Set once the player types into the label name, which stops the copy. */
  let labelNameEdited = false
  /** A printed label waiting for the round's record, to be saved on it. */
  let pendingLabel: { variant: LabelVariant; name: string } | null = null
  let pickerUi = $state<ReturnType<typeof PrintPicker> | null>(null)
  let keyboardBox = $state<HTMLElement | null>(null)
  let labelKeyboardBox = $state<HTMLElement | null>(null)
  /** The name the previews were last asked to show. */
  let previewedName: string | null = null

  const previews = new LabelPreviewQueue<LabelInput, LabelVariant>({
    render: (input, which) =>
      renderLabelPreview(
        engine,
        { ...input, variant: which },
        $t,
        pickerUi?.previewPixelSize() ?? 392,
      ),
    show: (which, bitmap) => {
      if (pickerUi) pickerUi.show(which, bitmap)
      else bitmap.close()
    },
    pause: () => engine.wait(0),
  })
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
  const best = $derived(shown ? mapBest(shown.highScores, mapId) : null)
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
    base(layout.buttons, BUTTONS_WIDTH, BUTTONS_HEIGHT)
    layout.buttons.transform.y += RISE / 3
    layout.buttons.transform.alpha = 0
  }

  /** The picker's parts, in the order they rise in. */
  function pickerParts(): Node2D[] {
    return [picker.name, ...picker.previews, picker.actions]
  }

  /** Put the picker's parts where they wait, a little low and unseen. */
  function hidePicker(): void {
    for (const node of pickerParts()) {
      node.transform.x = node.transform.originX
      node.transform.y = node.transform.originY + RISE / 3
      node.transform.alpha = 0
      node.transform.scaleX = 1
      node.transform.scaleY = 1
    }
  }

  /** Fade `nodes` out, shrinking them a touch, as the screen leaving does. */
  function fadeOut(nodes: Node2D[], signal: AbortSignal): Promise<unknown> {
    return Promise.all(
      nodes.map((node) =>
        engine.tween(
          node.transform,
          { alpha: 0, scaleX: 0.96, scaleY: 0.96 },
          { duration: 0.25, easing: easings.inCubic, signal },
        ),
      ),
    )
  }

  /** Hide the picker at once and forget its previews. */
  function resetPicker(): void {
    view = 'summary'
    picker.lift.visible = false
    picker.lift.transform.y = 0
    previews.cancel()
    pickerUi?.clear()
    previewedName = null
  }

  $effect(() => {
    const on = active
    const next = payload
    untrack(() => {
      if (on && next && next !== shown) {
        if (shown && next.round === shown.round) catchUp(next)
        else void enter(next)
      } else if (!on && shown) void leave()
    })
  })

  async function enter(next: GameOverPayload): Promise<void> {
    const signal = scope.reset()
    shown = next
    printed = false
    revealed = false
    focus = null
    resetPicker()
    variant = DEFAULT_LABEL_VARIANT
    labelName = ''
    labelNameEdited = false
    pendingLabel = null
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
      revealed = true
    } catch (err) {
      ignoreAbort(err)
    }
  }

  /**
   * Take in the record for the round already on screen. A high score that was
   * not known at the entrance raises the banner where it rests, with confetti,
   * since the cards already hold the middle of the screen.
   */
  function catchUp(next: GameOverPayload): void {
    const wasHigh = high
    shown = next
    if (pendingLabel) saveLabel(next, pendingLabel)
    // The picker covers the banner. Back brings it in at rest.
    if (view !== 'summary') return
    if (wasHigh || !(next.isOverallHigh || next.isStateHigh)) return
    const banner = layout.banner
    const centre = banner.localToWorld(BANNER_WIDTH / 2, BANNER_HEIGHT / 2)
    const at = region.anchor.worldToLocal(centre.x, centre.y)
    region.anchor.add(new ConfettiBurst(at))
    engine
      .tween(
        banner.transform,
        { alpha: 1, scaleX: 1, scaleY: 1 },
        { duration: 0.5, easing: easings.outBack, signal: scope.signal },
      )
      .catch(ignoreAbort)
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
      await grow
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
    focus = null
    void entry?.save()
    const parts =
      view === 'picker'
        ? pickerParts()
        : [layout.banner, layout.buttons, ...layout.cards]
    try {
      await fadeOut(parts, signal)
    } catch (err) {
      ignoreAbort(err)
      return
    }
    lossCard?.destroy()
    lossCard = null
    layout.root.visible = false
    resetPicker()
    shown = null
  }

  /** The label for `round`, with the player's picks. */
  function labelInput(round: GameOverPayload): Omit<LabelInput, 'printedAt'> {
    return {
      reason: round.reason,
      stateId: round.stateId,
      mapId,
      score: round.score,
      isOverallHigh: round.isOverallHigh,
      isStateHigh: round.isStateHigh,
      highScores: round.highScores,
      escapeHeadingRad: round.escapeHeadingRad,
      variant,
      name: labelName,
    }
  }

  /** Render the three previews, the selected one first. */
  function renderPreviews(debounce: boolean): void {
    if (!shown) return
    previewedName = labelName
    const order = [variant, ...LABEL_VARIANTS.filter((v) => v !== variant)]
    previews.request(labelInput(shown), order, { debounce })
  }

  // Typing into the label name renders the previews again once it pauses.
  $effect(() => {
    const name = labelName
    untrack(() => {
      if (view === 'picker' && name !== previewedName) renderPreviews(true)
    })
  })

  /** The cards make way for the print picker. */
  async function openPicker(): Promise<void> {
    if (!shown || view === 'picker' || !revealed || printed) return
    const signal = scope.reset()
    view = 'picker'
    focus = null
    if (!labelNameEdited) labelName = entry?.name ?? ''
    hidePicker()
    picker.lift.transform.y = 0
    picker.lift.visible = true
    picker.root.requestLayout()
    try {
      await fadeOut([layout.banner, layout.buttons, ...layout.cards], signal)
      layout.root.visible = false
      // The previews measure themselves, which needs a laid out frame.
      await engine.wait(0, signal)
      renderPreviews(false)
      await Promise.all(
        pickerParts().map(async (node, i) => {
          await engine.wait(Math.min(i, 3) * CARD_STAGGER, signal)
          await engine.tween(
            node.transform,
            { y: node.transform.originY, alpha: 1 },
            { duration: 0.45, easing: easings.outCubic, signal },
          )
        }),
      )
    } catch (err) {
      ignoreAbort(err)
    }
  }

  /** The picker makes way for the cards, which come back as they were. */
  async function closePicker(): Promise<void> {
    if (view !== 'picker') return
    const signal = scope.reset()
    focus = null
    try {
      await fadeOut(pickerParts(), signal)
    } catch (err) {
      ignoreAbort(err)
      return
    }
    resetPicker()
    // The count-up and the banner's entrance have run, so the parts return
    // straight to rest.
    count.v = shown?.score ?? 0
    base(layout.banner, BANNER_WIDTH, BANNER_HEIGHT)
    base(layout.buttons, BUTTONS_WIDTH, BUTTONS_HEIGHT)
    for (const card of layout.cards) base(card, CARD_WIDTH, CARD_HEIGHT)
    layout.root.visible = true
    const parts: [Node2D, number][] = [
      [layout.banner, high ? 1 : 0],
      [layout.buttons, 1],
      ...layout.cards.map((card): [Node2D, number] => [card, 1]),
    ]
    await Promise.all(
      parts.map(([node, alpha]) =>
        engine.tween(
          node.transform,
          { alpha, scaleX: 1, scaleY: 1 },
          { duration: 0.35, easing: easings.outCubic, signal },
        ),
      ),
    ).catch(ignoreAbort)
  }

  function pickVariant(which: LabelVariant): void {
    if (which === variant) return
    variant = which
  }

  /** Print the picked label, save the pick, and go back to the cards. */
  async function print(): Promise<void> {
    const round = shown
    if (!round || printed || !printerReady || view !== 'picker') return
    printed = true
    focus = null
    const choice = { variant, name: labelName.trim() }
    void printLabel({ ...labelInput(round), ...choice })
    saveLabel(round, choice)
    const signal = scope.signal
    await engine.wait(0.8, signal).catch(ignoreAbort)
    if (!signal.aborted) void closePicker()
  }

  /**
   * Save the printed label on the round's record. A round without a record yet
   * keeps it until the record lands.
   */
  function saveLabel(
    round: GameOverPayload,
    choice: { variant: LabelVariant; name: string },
  ): void {
    const id = round.record?.id
    if (!id) {
      pendingLabel = choice
      return
    }
    pendingLabel = null
    setEnterpriseGameLabel(id, choice.variant, choice.name).catch(
      (err: unknown) => console.warn('[print] saving the label failed:', err),
    )
  }

  // The label keyboard docks over the bottom of the screen, so the picker lifts
  // until the previews clear it, and settles back once it closes.
  $effect(() => {
    const typing = focus === 'label'
    untrack(() => void liftForKeyboard(typing))
  })

  async function liftForKeyboard(typing: boolean): Promise<void> {
    let target = 0
    if (typing) {
      // The sheet slides in with a transform, which leaves its height alone.
      await engine.wait(0)
      const sheet = labelKeyboardBox?.firstElementChild
      const box = keyboardBox?.getBoundingClientRect()
      const bottom = pickerUi?.previewsBottom() ?? 0
      if (!sheet || !box || box.height <= 0 || bottom <= 0) return
      const sheetTop = box.bottom - sheet.getBoundingClientRect().height
      const overlap = bottom + KEYBOARD_CLEARANCE - sheetTop
      const designPerClient = region.rect.height / box.height
      target = picker.lift.transform.y - Math.max(0, overlap) * designPerClient
    }
    if (typing && focus !== 'label') return
    await engine
      .tween(
        picker.lift.transform,
        { y: target },
        { duration: 0.3, easing: easings.outCubic, signal: scope.signal },
      )
      .catch(ignoreAbort)
  }

  onDestroy(() => {
    offRegionResize()
    void entry?.save()
    scope.dispose()
    previews.dispose()
    pickerUi?.clear()
    lossCard?.destroy()
    layout.root.destroy()
    picker.lift.destroy()
    keyboardNode.destroy()
  })
</script>

<div class="over" inert={view !== 'summary'}>
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
        editing={focus === 'leaderboard'}
        onEdit={() => (focus = 'leaderboard')}
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
      disabled={!active || printed || !printerReady || !revealed}
      onclick={openPicker}
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
</div>

<PrintPicker
  bind:this={pickerUi}
  {engine}
  layout={picker}
  active={active && view === 'picker'}
  name={labelName}
  editing={focus === 'label'}
  {variant}
  {printed}
  canPrint={active && printerReady}
  onEditName={() => (focus = 'label')}
  onPick={pickVariant}
  onBack={() => void closePicker()}
  onPrint={() => void print()}
/>

<div
  class="over__keyboard"
  bind:this={keyboardBox}
  use:domAnchor={{
    engine,
    node: keyboardNode,
    size: { width: region.rect.width, height: region.rect.height },
  }}
>
  {#if focus}
    <!-- A tap anywhere outside the sheet closes the keyboard. -->
    <button
      class="over__dismiss"
      aria-label={$t.game.closeKeyboard}
      onclick={() => (focus = null)}
    ></button>
  {/if}
  {#if entry}
    <OnScreenKeyboardField
      bind:value={entry.name}
      maxLength={entry.maxLength}
      open={focus === 'leaderboard'}
      onOpenChange={(open) => {
        if (open) focus = 'leaderboard'
        else if (focus === 'leaderboard') focus = null
      }}
      showTrigger={false}
      mode="name"
      suggestions={nameSuggestions(entry.entries, entry.name)}
      onSuggestion={(word) => {
        if (entry) entry.name = word.slice(0, entry.maxLength)
      }}
      onSubmit={() => (focus = null)}
    />
  {/if}
  <!-- Its own box, so the open sheet is this box's only element. -->
  <div class="over__keyboard-box" bind:this={labelKeyboardBox}>
    <OnScreenKeyboardField
      bind:value={
        () => labelName,
        (name) => {
          labelName = name
          labelNameEdited = true
        }
      }
      maxLength={NAME_MAX}
      open={focus === 'label'}
      onOpenChange={(open) => {
        if (open) focus = 'label'
        else if (focus === 'label') focus = null
      }}
      showTrigger={false}
      mode="name"
      onSubmit={() => (focus = null)}
    />
  </div>
</div>

<style lang="sass">
  @use './buttons'

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
    @include buttons.pill

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

  .over__keyboard-box
    position: absolute
    inset: 0
    pointer-events: none

  .over__dismiss
    position: absolute
    inset: 0
    appearance: none
    border: 0
    padding: 0
    background: transparent
    cursor: default
</style>
