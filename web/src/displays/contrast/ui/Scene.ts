/**
 * The whole display as one scene on the engine: the banner, the splash, the
 * cards, the vote buttons and the game over. It owns the nodes and the animated
 * numbers, and it positions every node from the layout and those numbers once a
 * frame. Nothing is positioned by a tween directly, so a window that resizes
 * halfway through a zoom lands the card in the right place.
 *
 * The rules live in {@link Session}. The scene reacts to its phases: a new round
 * brings a card in, an answer shows the scale, and the end of the run lines the
 * cards up in the strip.
 */
import {
  AbortScope,
  ignoreAbort,
  Node2D,
  type Engine,
  type Easing,
  type PointerEvent2D,
} from 'stargazer'
import { cssColor, LEVELS, type Level, type Rgb } from '../game/contrast'
import { EXAMPLES, newExample } from '../game/examples'
import { needsOutline } from '../game/outline'
import { ROUND_SECONDS, type Session } from '../game/session'
import type { ContrastMessages } from '../i18n'
import { AnswerNode, type Verdict } from './nodes/AnswerNode'
import { BannerNode } from './nodes/BannerNode'
import { ButtonNode } from './nodes/ButtonNode'
import { GameOverNode } from './nodes/GameOverNode'
import { HudNode } from './nodes/HudNode'
import { SplashCardNode } from './nodes/SplashCardNode'
import {
  measureSplash,
  PLAY_LOOK,
  SplashTextNode,
} from './nodes/SplashTextNode'
import { LEVEL_COLORS } from './nodes/thumbs'
import { VoteScaleNode } from './nodes/VoteScaleNode'
import {
  blendKey,
  fullKey,
  layoutFor,
  maxStripScroll,
  restKey,
  segmentsAt,
  stripKey,
  type Layout,
  type Size,
} from './layout'
import { clamp01, EASE, lerp, MOTION } from './motion'
import { RoundCard } from './RoundCard'
import type { Insets } from './safeArea'
import { headlineFont, textFont } from './text'
import { PALETTE } from '../theme'

/**
 * How far the splash and the parts that enter from below travel, in design
 * pixels.
 */
const SLIDE = 160
const HUD_RISE = 40
/** How far the strip's cards sink as they leave toward the splash. */
const LEAVE_DROP = 140
/** How much of the exit the cards share out, so they go one after another. */
const LEAVE_SPREAD = 0.4
const VOTES_RISE = 80
/** How far to the right a card waits before it slides in, in card pitches. */
const OFFSTAGE = 1.7
/** The banner dims to this while the answer shows between rounds. */
const BANNER_DIM = 0.5
/** The pull of the strip's friction, per second. */
const STRIP_FRICTION = 3.2
/** A finger further past the end than this moves the strip this much less. */
const OVERSCROLL_DRAG = 0.45
/** The spring that pulls an overscrolled strip back, and its damping. */
const SPRING = 220
const SPRING_DAMPING = 2 * Math.sqrt(SPRING)
/** Only the last stretch of a drag counts as the speed of the flick. */
const FLICK_WINDOW_MS = 100

/** The numbers every animation moves. All are 0 to 1 unless a name says more. */
interface Motion {
  /** 1 while the splash shows. */
  splash: number
  /** Each example card's entrance. */
  examples: Array<{ v: number }>
  /** Which card is centered, as an index into the deck. */
  focus: number
  /** How far the card in play has zoomed to full screen. */
  zoom: number
  hud: number
  votes: number
  /** 0 for three buttons and 1 for the scale. */
  morph: number
  labels: number
  /** How far the deck has lined up as the strip. */
  strip: number
  result: number
  buttons: number
  /** How far the game over screen has left, 0 to 1. */
  out: number
  /** Along the pulse that points at the answer on the scale, 0 to 1. */
  pulse: number
  /** How much of the timer's ring shows, 0 to 1. */
  ring: number
}

function initialMotion(): Motion {
  return {
    splash: 0,
    examples: EXAMPLES.map(() => ({ v: 0 })),
    focus: 0,
    zoom: 0,
    hud: 0,
    votes: 0,
    morph: 0,
    labels: 0,
    strip: 0,
    result: 0,
    buttons: 0,
    out: 0,
    pulse: 0,
    ring: 1,
  }
}

export interface SceneOptions {
  engine: Engine
  /** The node at the visible area's top left. The scene is built under it. */
  parent: Node2D
  session: Session
  messages: ContrastMessages
  size: Size
  insets: Insets
  /** What the splash's example cards draw their next colors from. */
  colors: readonly Rgb[]
}

/** Runs `onUpdate` as the engine updates the tree. */
class Driver extends Node2D {
  readonly #update: (dt: number) => void

  constructor(update: (dt: number) => void) {
    super('contrast-driver')
    this.#update = update
  }

  override onUpdate(dt: number): void {
    this.#update(dt)
  }
}

export class Scene {
  readonly #engine: Engine
  readonly #session: Session
  readonly #messages: ContrastMessages
  readonly #root = new Node2D('contrast-scene')
  readonly #scope = new AbortScope()
  readonly #unsubscribe: () => void
  readonly #unbind: Array<() => void> = []

  #layout: Layout
  readonly #m: Motion = initialMotion()

  readonly #bannerBase: BannerNode
  readonly #bannerOverlay: BannerNode
  readonly #splash = new Node2D('splash')
  readonly #splashText: SplashTextNode
  readonly #examples: SplashCardNode[]
  readonly #play: ButtonNode
  readonly #deck = new Node2D('deck')
  readonly #votes: VoteScaleNode
  readonly #voteHit = new Node2D('vote-hit')
  readonly #answer: AnswerNode
  readonly #hud: HudNode
  readonly #head: GameOverNode
  readonly #gameOver = new Node2D('game-over')
  readonly #close: ButtonNode
  readonly #retry: ButtonNode
  readonly #stripHit = new Node2D('strip-hit')

  #cards: RoundCard[] = []
  /**
   * The index of the card the session's round is on, which is also the last one
   * answered.
   */
  #current = 0
  #phase: string = 'splash'
  #pressed = -1
  #lastMorph = NaN
  #lastLayout: Layout | null = null

  /** What each splash card was showing, what it blends to, and how far. */
  readonly #exampleColors: Array<{ background: Rgb; text: Rgb }>
  readonly #exampleFrom: Array<{ background: Rgb; text: Rgb }>
  readonly #exampleMix: number[] = EXAMPLES.map(() => 1)
  readonly #palette: readonly Rgb[]
  #exampleClock = 0
  #exampleNext = 0

  /** Which way the game over cards leave: off to the left, or down and out. */
  #leaving: 'left' | 'down' = 'down'

  #scroll = 0
  #scrollVelocity = 0
  #dragging = false
  #dragLast = 0
  #dragSamples: { x: number; t: number }[] = []

  constructor(options: SceneOptions) {
    this.#engine = options.engine
    this.#session = options.session
    this.#messages = options.messages
    this.#layout = layoutFor(options.size, options.insets)
    this.#palette = options.colors
    this.#exampleColors = EXAMPLES.map((e) => ({
      background: e.background,
      text: e.text,
    }))
    this.#exampleFrom = this.#exampleColors.map((c) => ({ ...c }))
    const m = options.messages
    const l = this.#layout

    this.#bannerBase = new BannerNode(
      l,
      m.banner.left,
      m.banner.right,
      PALETTE.white,
    )
    this.#bannerOverlay = new BannerNode(
      l,
      m.banner.left,
      m.banner.right,
      PALETTE.ink,
    )
    this.#bannerOverlay.visible = false

    this.#splashText = new SplashTextNode(
      l,
      m.splash.title,
      m.splash.premise,
      m.splash.play,
    )
    this.#examples = EXAMPLES.map((e) => {
      const node = new SplashCardNode(
        e.level,
        cssColor(e.background),
        cssColor(e.text),
        needsOutline(e.background),
      )
      node.transform.alpha = 0
      return node
    })
    this.#play = new ButtonNode({
      label: m.splash.play,
      font: headlineFont(PLAY_LOOK.size),
      size: PLAY_LOOK.size,
      fill: PALETTE.white,
      pressedFill: PALETTE.cream,
      textColor: PALETTE.ink,
      edge: null,
      onClick: () => this.#onPlay(),
      enabled: () => this.#m.splash > 0.9 && this.#session.phase === 'splash',
    })
    this.#splash.add(this.#splashText, ...this.#examples, this.#play)

    this.#votes = new VoteScaleNode()
    this.#votes.transform.alpha = 0
    this.#answer = new AnswerNode(l, m.game.actual, m.game.yourPick)
    this.#answer.transform.alpha = 0
    this.#hud = new HudNode(l)
    this.#hud.transform.alpha = 0

    this.#head = new GameOverNode(l, m.gameOver.words)
    this.#head.transform.alpha = 0
    const look = {
      font: textFont(24),
      size: 24,
      fill: PALETTE.ink,
      pressedFill: '#2b2b2b',
      textColor: PALETTE.white,
      edge: 'rgba(255, 255, 255, 0.75)',
    }
    this.#close = new ButtonNode({
      ...look,
      label: m.gameOver.close,
      onClick: () => this.#session.reset(),
      enabled: () =>
        this.#m.buttons > 0.9 && this.#session.phase === 'gameover',
    })
    this.#retry = new ButtonNode({
      ...look,
      label: m.gameOver.retry,
      onClick: () => this.#session.start(),
      enabled: () =>
        this.#m.buttons > 0.9 && this.#session.phase === 'gameover',
    })
    this.#gameOver.add(this.#head, this.#close, this.#retry, this.#stripHit)
    this.#gameOver.visible = false

    this.#addVoteTargets()
    this.#addStripDrag()

    // Under the cards: the banner in the screen's color. Over them: the clipped one.
    this.#root.add(
      this.#bannerBase,
      this.#splash,
      this.#deck,
      this.#votes,
      this.#voteHit,
      this.#answer,
      this.#hud,
      this.#gameOver,
      this.#bannerOverlay,
      new Driver((dt) => this.update(dt)),
    )
    options.parent.add(this.#root)

    this.#unsubscribe = this.#session.subscribe(() => this.#onSession())
    this.#apply()
  }

  /** Lays the scene out again for a new visible area. */
  resize(size: Size, insets: Insets): void {
    this.#layout = layoutFor(size, insets)
    const l = this.#layout
    const m = this.#messages
    this.#bannerBase.setLayout(l)
    this.#bannerOverlay.setLayout(l)
    this.#hud.setLayout(l)
    this.#answer.setLayout(l)
    this.#head.setLayout(l)
    this.#splashText.setLayout(
      l,
      m.splash.title,
      m.splash.premise,
      m.splash.play,
    )
    this.#scroll = Math.min(this.#scroll, maxStripScroll(l, this.#cards.length))
  }

  /**
   * Brings the splash in. Call once the engine is running, and after a reset.
   * From the game over screen, that screen leaves first and the splash comes in
   * while its last cards are still going.
   */
  showSplash(): void {
    const signal = this.#scope.reset()
    const fromGameOver = this.#gameOver.visible
    this.#bannerOverlay.visible = false
    if (fromGameOver) {
      this.#m.splash = 0
      for (const example of this.#m.examples) example.v = 0
    } else {
      this.#clearCards()
      Object.assign(this.#m, initialMotion())
      this.#gameOver.visible = false
    }
    void this.#sequence(signal, async () => {
      const leaving = fromGameOver
        ? this.#leaveGameOver(signal, 'down')
        : Promise.resolve()
      if (fromGameOver) await this.#engine.wait(MOTION.leave * 0.75, signal)
      this.#m.splash = 1
      await Promise.all([
        leaving,
        ...this.#m.examples.map((example, i) =>
          this.#tween(
            signal,
            example,
            { v: 1 },
            MOTION.splashCard,
            EASE.arrive,
            0.15 + i * MOTION.stagger,
          ),
        ),
      ])
    })
  }

  /**
   * The game over screen goes: the score rises away, the buttons sink, and the
   * strip's cards leave one after another, `toward` the left or down. Ends with
   * the screen cleared and every number back at rest, except the splash's.
   */
  async #leaveGameOver(
    signal: AbortSignal,
    toward: 'left' | 'down',
  ): Promise<void> {
    const m = this.#m
    this.#leaving = toward
    this.#scrollVelocity = 0
    await Promise.all([
      this.#tween(signal, m, { out: 1 }, MOTION.leave, EASE.leave),
      this.#tween(signal, m, { result: 0 }, MOTION.leave * 0.8, EASE.leave),
      this.#tween(signal, m, { buttons: 0 }, MOTION.leave * 0.6, EASE.leave),
    ])
    this.#clearCards()
    this.#gameOver.visible = false
    const keep = { splash: m.splash, examples: m.examples }
    Object.assign(m, initialMotion(), keep)
  }

  update(dt: number): void {
    const session = this.#session
    if (session.phase === 'playing') {
      session.tick(dt)
      this.#m.ring = clamp01(session.remaining / ROUND_SECONDS)
    }
    if (!this.#dragging) this.#coast(Math.min(dt, 1 / 20))
    this.#cycleExamples(dt)
    this.#apply()
  }

  /**
   * While the splash rests, one example card at a time blends to a new random
   * pair of its level.
   */
  #cycleExamples(dt: number): void {
    const m = this.#m
    const resting =
      this.#session.phase === 'splash' &&
      m.splash > 0.99 &&
      m.examples.every((e) => e.v > 0.99)
    if (!resting) {
      this.#exampleClock = 0
      return
    }
    this.#exampleMix.forEach((mix, i) => {
      if (mix < 1) {
        this.#exampleMix[i] = Math.min(1, mix + dt / MOTION.exampleSwap)
      }
    })
    this.#exampleClock += dt
    if (this.#exampleClock < MOTION.exampleEvery) return
    this.#exampleClock = 0
    const i = this.#exampleNext++ % EXAMPLES.length
    const next = newExample(this.#palette, EXAMPLES[i]!.level, Math.random)
    this.#exampleFrom[i] = { ...this.#exampleColors[i]! }
    this.#exampleColors[i] = { background: next.background, text: next.text }
    this.#exampleMix[i] = 0
  }

  /**
   * Carries the strip on after a flick, slowing with friction. Past either end
   * a spring takes over and eases it back.
   */
  #coast(dt: number): void {
    const max = maxStripScroll(this.#layout, this.#cards.length)
    const over =
      this.#scroll < 0 ? this.#scroll : Math.max(this.#scroll - max, 0)
    if (over === 0) {
      if (Math.abs(this.#scrollVelocity) < 1) {
        this.#scrollVelocity = 0
        return
      }
      this.#scrollVelocity *= Math.exp(-STRIP_FRICTION * dt)
    } else {
      const pull = -SPRING * over - SPRING_DAMPING * this.#scrollVelocity
      this.#scrollVelocity += pull * dt
      if (Math.abs(over) < 0.3 && Math.abs(this.#scrollVelocity) < 4) {
        this.#scroll = Math.min(Math.max(this.#scroll, 0), max)
        this.#scrollVelocity = 0
        return
      }
    }
    this.#scroll += this.#scrollVelocity * dt
  }

  destroy(): void {
    this.#scope.abort()
    this.#unsubscribe()
    for (const unbind of this.#unbind) unbind()
    this.#root.destroy()
  }

  // --- the session ---------------------------------------------------------

  #onPlay(): void {
    this.#session.start()
  }

  #onSession(): void {
    const phase = this.#session.phase
    if (phase === this.#phase) return
    this.#phase = phase
    if (phase === 'splash') this.showSplash()
    else if (phase === 'entering') this.#enter()
    else if (phase === 'reveal') this.#reveal()
    else if (phase === 'gameover') this.#end()
  }

  /** A new round: its card slides in from the right, takes its colors and zooms. */
  #enter(): void {
    const session = this.#session
    const first = session.results.length === 0
    const fromGameOver = first && this.#gameOver.visible
    if (first && !fromGameOver) this.#clearCards()
    const signal = this.#scope.reset()
    const index = session.results.length
    const m = this.#m
    void this.#sequence(signal, async () => {
      // A retry first sends the last run's cards off to the left.
      if (fromGameOver) await this.#leaveGameOver(signal, 'left')
      // After a right answer the card is already waiting, outlined, at the right.
      let card = this.#cards[index]
      if (!card || card.round !== session.round) {
        card?.destroy()
        card = new RoundCard(session.round!, this.#messages)
        this.#cards[index] = card
        this.#deck.add(card.root)
      }
      this.#current = index
      // The next card waited under this one while it zoomed out. It takes the top
      // now, since it is the one that will fill the screen.
      this.#deck.addAt(card.root, Number.MAX_SAFE_INTEGER)
      m.strip = 0
      m.result = 0
      m.buttons = 0
      this.#gameOver.visible = false
      // The first card waits off the right edge, a later one just beyond it.
      if (first) m.focus = index - OFFSTAGE
      const entering: Array<Promise<void>> = [
        this.#tween(
          signal,
          m,
          { focus: index },
          MOTION.slide,
          EASE.move,
          first ? 0.1 : 0.15,
        ),
        this.#tween(signal, m, { labels: 0 }, MOTION.labels, EASE.leave),
        this.#tween(signal, m, { ring: 1 }, MOTION.slide, EASE.move),
        // The card takes its colors on the way in, not once it has arrived.
        this.#tween(
          signal,
          card,
          { reveal: 1 },
          MOTION.slide,
          EASE.move,
          first ? 0.1 : 0.15,
        ),
      ]
      if (first)
        entering.push(
          this.#tween(signal, m, { splash: 0 }, MOTION.splashOut, EASE.leave),
        )
      await Promise.all(entering)
      if (first)
        await this.#tween(signal, m, { hud: 1 }, MOTION.hud, EASE.arrive)
      await Promise.all([
        this.#tween(signal, m, { zoom: 1 }, MOTION.zoom, EASE.move),
        this.#tween(signal, m, { votes: 1 }, MOTION.zoom, EASE.arrive),
        this.#tween(signal, m, { morph: 0 }, MOTION.zoom, EASE.move),
      ])
      session.beginRound()
    })
  }

  /** The answer: the buttons become the scale and the card zooms back out. */
  #reveal(): void {
    const session = this.#session
    const last = session.last!
    const signal = this.#scope.reset()
    const m = this.#m
    this.#pressed = -1
    const verdict: Verdict =
      last.pick === null ? 'timeout' : last.correct ? 'correct' : 'incorrect'
    const text =
      this.#messages.game[
        verdict === 'correct'
          ? 'correct'
          : verdict === 'incorrect'
            ? 'incorrect'
            : 'timeout'
      ]
    this.#answer.answer = {
      verdict,
      text,
      actual: last.round.level,
      pick: last.pick,
    }
    const names = this.#messages.game.levels
    this.#engine.a11y.announce(
      verdict === 'correct'
        ? this.#messages.game.announceCorrect
        : verdict === 'incorrect'
          ? this.#messages.game.announceWrong(names[last.round.level])
          : this.#messages.game.announceTimeout(names[last.round.level]),
      'assertive',
    )
    this.#cards[this.#current]?.setResult(
      {
        text,
        pick: last.pick,
        actual: last.round.level,
        correct: last.correct,
      },
      this.#messages,
    )
    const upcoming = session.upcoming
    if (upcoming) {
      const waiting = new RoundCard(upcoming, this.#messages)
      this.#cards[this.#current + 1]?.destroy()
      this.#cards[this.#current + 1] = waiting
      // Under the card that is zooming out, so it comes out from behind it.
      const at = this.#deck.children.indexOf(this.#cards[this.#current]!.root)
      this.#deck.addAt(waiting.root, at)
    }
    void this.#sequence(signal, async () => {
      await Promise.all([
        this.#tween(signal, m, { morph: 1 }, MOTION.morph, EASE.move),
        this.#tween(signal, m, { zoom: 0 }, MOTION.morph, EASE.move),
      ])
      // The scale is in place: it pulses to show where the answer is, while the
      // answer stays up for its hold.
      m.pulse = 0
      const pulsing = this.#tween(
        signal,
        m,
        { pulse: 1 },
        MOTION.pulse,
        EASE.linear,
      )
      await this.#tween(signal, m, { labels: 1 }, MOTION.labels, EASE.arrive)
      await Promise.all([pulsing, this.#engine.wait(MOTION.hold, signal)])
      session.finishReveal()
    })
  }

  /** The end: the deck lines up as the strip and the result comes in. */
  #end(): void {
    const session = this.#session
    const signal = this.#scope.reset()
    const m = this.#m
    this.#head.score = session.score
    this.#head.best = session.record
      ? this.#messages.gameOver.newBest
      : this.#messages.gameOver.best(session.best)
    // The strip opens on its last cards, where the round that ended it is.
    this.#scroll = maxStripScroll(this.#layout, this.#cards.length)
    this.#scrollVelocity = 0
    this.#gameOver.visible = true
    this.#engine.a11y.announce(
      this.#messages.gameOver.announce(session.score),
      'assertive',
    )
    void this.#sequence(signal, async () => {
      await Promise.all([
        this.#tween(signal, m, { strip: 1 }, MOTION.strip, EASE.move),
        this.#tween(signal, m, { labels: 0 }, MOTION.labels, EASE.leave),
        this.#tween(signal, m, { votes: 0 }, MOTION.labels, EASE.leave),
        this.#tween(signal, m, { hud: 0 }, MOTION.labels, EASE.leave),
        this.#tween(
          signal,
          m,
          { result: 1 },
          MOTION.result,
          EASE.arrive,
          MOTION.strip * 0.5,
        ),
      ])
      await this.#tween(signal, m, { buttons: 1 }, MOTION.result, EASE.arrive)
    })
  }

  // --- animation helpers ---------------------------------------------------

  #tween<T extends object>(
    signal: AbortSignal,
    target: T,
    to: Partial<T>,
    duration: number,
    easing: Easing,
    delay = 0,
  ): Promise<void> {
    return this.#engine.tween(target, to, { duration, easing, delay, signal })
  }

  /** Runs `body` and lets an abort end it quietly. */
  #sequence(signal: AbortSignal, body: () => Promise<void>): Promise<void> {
    void signal
    return body().catch(ignoreAbort)
  }

  #clearCards(): void {
    for (const card of this.#cards) card.destroy()
    this.#cards = []
  }

  // --- input ---------------------------------------------------------------

  /**
   * The three vote buttons are one target, so a press between two goes to the
   * nearer.
   */
  #addVoteTargets(): void {
    const hit = this.#voteHit
    const pick = (x: number): number => {
      let best = 0
      let bestDistance = Infinity
      this.#layout.buttons.forEach((b, i) => {
        const d = Math.abs(x - (b.x + b.width / 2))
        if (d < bestDistance) {
          best = i
          bestDistance = d
        }
      })
      return best
    }
    // The button a press started on, and whether the finger is still over it.
    // Sliding off un-presses it, and letting go off it votes for nothing.
    let from = -1
    const over = (e: PointerEvent2D): boolean => {
      const box = this.#layout.buttons[from]
      if (!box) return false
      const p = e.localTo(hit)
      return (
        p.x >= box.x &&
        p.x <= box.x + box.width &&
        p.y >= box.y &&
        p.y <= box.y + box.height
      )
    }
    this.#unbind.push(
      hit.bindPointer({
        singlePointer: true,
        down: (e) => {
          if (!this.#canVote()) return
          from = pick(e.localTo(hit).x)
          this.#pressed = from
        },
        move: (e) => {
          if (from >= 0) this.#pressed = over(e) ? from : -1
        },
        up: (e) => {
          const pressed = from
          const inside = pressed >= 0 && over(e)
          from = -1
          this.#pressed = -1
          if (inside && this.#canVote())
            this.#session.vote(LEVELS[pressed] as Level)
        },
        cancel: () => {
          from = -1
          this.#pressed = -1
        },
      }),
    )
    // The screen reader's way in, since its proxies are not where the buttons are drawn.
    LEVELS.forEach((level) => {
      const proxy = new Node2D(`vote-${level}`)
      proxy.a11y({
        role: 'button',
        label: this.#messages.game.levels[level],
        onActivate: () => {
          if (this.#canVote()) this.#session.vote(level)
        },
      })
      hit.add(proxy)
    })
  }

  #canVote(): boolean {
    return (
      this.#session.phase === 'playing' &&
      this.#m.zoom > 0.95 &&
      this.#m.morph < 0.05
    )
  }

  /**
   * The strip scrolls with a drag and keeps going a little after the finger
   * lifts.
   */
  #addStripDrag(): void {
    const hit = this.#stripHit
    const end = () => {
      if (!this.#dragging) return
      this.#dragging = false
      const now = performance.now()
      const recent = this.#dragSamples.filter(
        (p) => now - p.t <= FLICK_WINDOW_MS,
      )
      const first = recent[0]
      const last = recent[recent.length - 1]
      // A finger that rested before it lifted leaves no flick behind.
      if (!first || !last || last === first || now - last.t > 60) {
        this.#scrollVelocity = 0
      } else {
        const seconds = Math.max((last.t - first.t) / 1000, 1 / 120)
        this.#scrollVelocity = -(last.x - first.x) / seconds
      }
      this.#dragSamples = []
    }
    this.#unbind.push(
      hit.bindPointer({
        singlePointer: true,
        down: (e) => {
          if (this.#m.strip < 0.99) return
          this.#dragging = true
          this.#scrollVelocity = 0
          this.#dragLast = e.localTo(hit).x
          this.#dragSamples = [{ x: this.#dragLast, t: performance.now() }]
        },
        move: (e) => {
          if (!this.#dragging) return
          const x = e.localTo(hit).x
          const dx = x - this.#dragLast
          const max = maxStripScroll(this.#layout, this.#cards.length)
          // The strip gives way less the further past an end it is pulled.
          const outside = this.#scroll < 0 || this.#scroll > max
          this.#scroll -= outside ? dx * OVERSCROLL_DRAG : dx
          this.#dragLast = x
          this.#dragSamples.push({ x, t: performance.now() })
          if (this.#dragSamples.length > 24) this.#dragSamples.shift()
        },
        up: end,
        cancel: end,
      }),
    )
  }

  // --- placement -----------------------------------------------------------

  /** Sets every node from the layout and the animated numbers. */
  #apply(): void {
    const l = this.#layout
    const m = this.#m
    const session = this.#session

    this.#applySplash(l)
    this.#applyDeck(l)

    const voteVisible = m.votes > 0.001
    this.#votes.visible = voteVisible
    this.#votes.transform.alpha = m.votes
    this.#votes.transform.y = (1 - m.votes) * VOTES_RISE
    if (
      voteVisible &&
      (m.morph !== this.#lastMorph || l !== this.#lastLayout)
    ) {
      this.#votes.segments = segmentsAt(l, m.morph)
      this.#votes.morph = m.morph
      this.#lastMorph = m.morph
      this.#lastLayout = l
    }
    this.#votes.pressed = this.#pressed
    const actual = this.#answer.answer?.actual
    this.#votes.pulseAt = actual ? actual - 1 : -1
    this.#votes.pulseColor = actual ? LEVEL_COLORS[actual] : PALETTE.white
    this.#votes.pulse = m.pulse

    const hit = this.#voteHit
    const first = l.buttons[0]!
    const last = l.buttons[l.buttons.length - 1]!
    hit.boundsOverride = {
      x: first.x,
      y: first.y,
      width: last.x + last.width - first.x,
      height: first.height,
    }
    hit.hitEnabled = this.#canVote()

    this.#answer.visible = m.labels > 0.001
    this.#answer.transform.alpha = m.labels

    this.#hud.visible = m.hud > 0.001
    this.#hud.transform.alpha = m.hud
    this.#hud.transform.y = (1 - m.hud) * HUD_RISE
    this.#hud.score = session.score
    this.#hud.ring = m.ring
    this.#hud.seconds = Math.ceil(m.ring * ROUND_SECONDS - 1e-6)

    this.#applyGameOver(l)
    this.#bannerBase.transform.alpha = lerp(
      1,
      BANNER_DIM,
      m.morph * (1 - m.strip) * m.votes,
    )
  }

  #applySplash(l: Layout): void {
    const m = this.#m
    const visible = m.splash > 0.001
    this.#splash.visible = visible
    if (!visible) return
    this.#splash.transform.alpha = m.splash
    this.#splash.transform.x = -(1 - m.splash) * SLIDE

    const block = measureSplash(
      l,
      this.#messages.splash.title,
      this.#messages.splash.premise,
      this.#messages.splash.play,
    )
    this.#play.setShape(block.button.width, block.button.height, [
      block.button.height / 2,
    ])
    this.#play.transform.x = block.button.x
    this.#play.transform.y = block.button.y

    this.#examples.forEach((node, i) => {
      const box = l.splash.cards[i]!
      node.setSize(box.width, box.height)
      const entrance = m.examples[i]?.v ?? 0
      node.transform.x = box.x + (1 - entrance) * 480
      node.transform.y = box.y
      node.transform.alpha = entrance
      this.#paintExample(node, i)
    })
  }

  /** Sets a splash card's colors, part way between its two pairs mid-swap. */
  #paintExample(node: SplashCardNode, i: number): void {
    const to = this.#exampleColors[i]!
    const mix = this.#exampleMix[i]!
    const t = mix * mix * (3 - 2 * mix)
    const from = this.#exampleFrom[i]!
    const blend = (a: Rgb, b: Rgb): Rgb => [
      Math.round(lerp(a[0], b[0], t)),
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t)),
    ]
    const background =
      mix >= 1 ? to.background : blend(from.background, to.background)
    node.fill = cssColor(background)
    node.ink = cssColor(mix >= 1 ? to.text : blend(from.text, to.text))
    node.edge = needsOutline(background)
  }

  #applyDeck(l: Layout): void {
    const m = this.#m
    const cards = this.#cards
    const current = this.#current
    const full = fullKey(l)
    let overlay: {
      card: RoundCard
      box: RoundCard['box']
      radius: number
    } | null = null

    cards.forEach((card, i) => {
      const center = l.restCenter.x + (i - m.focus) * l.pitch
      let key = restKey(l, center)
      if (i === current && m.zoom > 0) key = blendKey(key, full, m.zoom)
      if (m.strip > 0)
        key = blendKey(key, stripKey(l, i, this.#scroll), m.strip)
      // Only the card right after the one in play waits in view, at its rest
      // place under the one that is zooming, so it is there as that one shrinks.
      let entrance = i > current + 1 ? 0 : 1
      if (m.out > 0) {
        // Leaving, the cards go one after another from the left.
        const share = cards.length > 1 ? i / (cards.length - 1) : 0
        const gone = clamp01(
          (m.out - share * LEAVE_SPREAD) / (1 - LEAVE_SPREAD),
        )
        if (this.#leaving === 'left') {
          key.box.x -= gone * (key.box.x + key.box.width + 40)
        } else {
          key.box.y += gone * LEAVE_DROP
          entrance *= 1 - gone
        }
      }
      card.root.transform.alpha = entrance
      const onScreen =
        entrance > 0.001 && key.box.x < l.width && key.box.x + key.box.width > 0
      card.root.visible = onScreen
      if (!onScreen) return
      const fade = i === current ? m.zoom * (1 - m.strip) : 0
      // The card in play keeps both ends of its zoom rasterized.
      card.warm = i === current && m.strip === 0 && m.out === 0
      card.place(key, fade, m.strip)
      if (i === current && m.zoom > 0.001 && m.strip === 0) {
        overlay = { card, box: key.box, radius: key.radius }
      }
    })

    const banner = this.#bannerOverlay
    const found = overlay as {
      card: RoundCard
      box: RoundCard['box']
      radius: number
    } | null
    const bandBottom = l.banner.logo.y + l.banner.logo.height + 8
    if (found && found.box.y < bandBottom) {
      banner.visible = true
      banner.color = found.card.ink
      banner.clip2 = {
        x: found.box.x,
        y: found.box.y,
        width: found.box.width,
        height: found.box.height,
        radius: found.radius,
      }
    } else {
      banner.visible = false
    }
  }

  #applyGameOver(l: Layout): void {
    const m = this.#m
    if (!this.#gameOver.visible) return
    this.#head.transform.alpha = m.result
    this.#head.transform.y = (1 - m.result) * -HUD_RISE

    const [close, retry] = l.gameOver.buttons
    const h = close!.height
    const outer = Math.min(128, h / 2)
    this.#close.setShape(close!.width, h, [outer, 16, 16, outer])
    this.#retry.setShape(retry!.width, h, [16, outer, outer, 16])
    for (const [node, box] of [
      [this.#close, close!],
      [this.#retry, retry!],
    ] as const) {
      node.transform.x = box.x
      node.transform.y = box.y + (1 - m.buttons) * HUD_RISE
      node.transform.alpha = m.buttons
    }

    const stripTop = l.gameOver.stripY - 30
    this.#stripHit.boundsOverride = {
      x: 0,
      y: stripTop,
      width: l.width,
      height: 254 + 130,
    }
    this.#stripHit.hitEnabled = m.strip > 0.99 && m.out === 0
  }
}
