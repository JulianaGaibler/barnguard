/**
 * The first game over card, drawn by the engine: a black rounded card with the
 * title at the top, the reason at the bottom, and the loss animation playing in
 * an inset view between them, clipped to the card's corners.
 *
 * The nodes are built under a card's animated child (from `gameOverLayout`), in
 * the card's own design pixels with the top left at the origin. The animation
 * waits for {@link LossCard.start}, so it plays once the card is on screen.
 */
import {
  InsetViewNode,
  ShapeNode,
  TextNode,
  wrapText,
  type EngineHost,
  type Node2D,
} from '@src/stargazer'
import { FAMILIES } from '@src/core/theme/fonts'
import { loadGameAssets } from '../game/assets'
import { GameOverScene } from '../game/gameOver/GameOverScene'
import type { GameOverReason } from '../game/session'
import { CARD_HEIGHT, CARD_WIDTH } from './gameOverLayout'

const RADIUS = 40
const FILL = '#010612'
const TITLE_TOP = 44
const TITLE_SIZE = 38.4
const REASON_SIZE = 25.6
const REASON_WIDTH = 299.2
/** Where the reason's last line ends, from the card's top. */
const REASON_BOTTOM = 483.6
const LINE_HEIGHT = 1.2

export interface LossCardOptions {
  host: EngineHost
  reason: GameOverReason
  escapeHeadingRad?: number
  title: string
  message: string
}

export class LossCard {
  readonly #scenePromise: Promise<GameOverScene | null>
  #scene: GameOverScene | null = null
  #startWanted = false
  #destroyed = false
  readonly #nodes: Node2D[] = []
  /** The nodes that draw, which take the card's opacity. */
  readonly #drawn: Node2D[] = []
  #alpha = 1

  constructor(parent: Node2D, opts: LossCardOptions) {
    const background = new ShapeNode({
      id: 'loss-card-background',
      geometry: {
        kind: 'rect',
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        centered: false,
        radii: RADIUS,
      },
      fill: FILL,
    })
    const inset = new InsetViewNode(
      { width: CARD_WIDTH, height: CARD_HEIGHT, radius: RADIUS },
      'loss-card-view',
    )
    const title = new TextNode({
      id: 'loss-card-title',
      text: opts.title,
      x: CARD_WIDTH / 2,
      y: TITLE_TOP,
      fontFamily: FAMILIES.mozillaText,
      fontWeight: 700,
      fontSize: TITLE_SIZE,
      sizeSpace: 'world',
      color: '#ffffff',
      align: 'center',
      baseline: 'top',
    })
    const font = `500 ${REASON_SIZE}px ${FAMILIES.mozillaText}`
    const lines = wrapText(opts.message, font, REASON_WIDTH, 3)
    const reason = new TextNode({
      id: 'loss-card-reason',
      text: lines.join('\n'),
      x: CARD_WIDTH / 2,
      y: REASON_BOTTOM - lines.length * REASON_SIZE * LINE_HEIGHT,
      fontFamily: FAMILIES.mozillaText,
      fontWeight: 500,
      fontSize: REASON_SIZE,
      sizeSpace: 'world',
      color: '#ffffff',
      align: 'center',
      baseline: 'top',
      lineHeight: LINE_HEIGHT,
    })
    for (const node of [background, inset, title, reason]) {
      parent.add(node)
      this.#nodes.push(node)
    }
    this.#drawn.push(background, title, reason)

    this.#scenePromise = loadGameAssets()
      .then((assets) => {
        if (this.#destroyed) return null
        const scene = new GameOverScene(opts.host, inset, {
          reason: opts.reason,
          escapeHeadingRad: opts.escapeHeadingRad,
          eyeOutlineParts: Array.from(assets.eye.paths.values()),
          impactFlashPath: assets.impactFlashPath,
        })
        this.#scene = scene
        if (this.#startWanted) scene.start()
        return scene
      })
      .catch((err: unknown) => {
        console.error('[loss-card] loading the loss scene failed', err)
        return null
      })
  }

  /**
   * The card's opacity, from 0 to 1. The engine does not pass a parent's alpha
   * down to what it draws, so the card sets it on its own drawn nodes. The loss
   * animation inside starts only once the card is in, so it needs no fade.
   */
  get alpha(): number {
    return this.#alpha
  }

  set alpha(value: number) {
    this.#alpha = value
    for (const node of this.#drawn) node.transform.alpha = value
  }

  /** Play the loss animation. Safe to call before the scene has loaded. */
  start(): void {
    this.#startWanted = true
    this.#scene?.start()
  }

  /** Resolves once the scene is built, for a caller that has to wait on it. */
  get ready(): Promise<unknown> {
    return this.#scenePromise
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#scene?.destroy()
    this.#scene = null
    for (const node of this.#nodes) if (!node.isDestroyed) node.destroy()
    this.#nodes.length = 0
  }
}
