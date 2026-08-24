/**
 * Builds the table, its lighting and its camera, and hands back a handle the
 * Svelte layer drives.
 *
 * @remarks
 *   Everything here is engine-only. The component owns the mode and the overlays,
 *   the rules layer owns the game, and this owns what is on the table.
 * @example
 *   const scene = await buildScene(host, camera, view)
 *   scene.setSeats(4)
 *   scene.destroy()
 */
import { Node3D, type EngineHost, type Rect } from '@src/stargazer'
import { loadCardTextures } from './art/cardTextures'
import { loadBannerArt } from './art/bannerArt'
import { loadMouthTexture, loadWordArt } from './art/tableTextures'
import { BlinkNode, ButtonNode } from './nodes/ButtonNode'
import { ConfettiNode } from './nodes/ConfettiNode'
import { CameraRigNode, type CameraSource } from './nodes/CameraRigNode'
import { TableNode, createMouthNode, createWordNode } from './nodes/TableNode'
import type { SeatCount } from './seats'
import { FogNode } from './nodes/FogNode'
import { HudNode } from './nodes/HudNode'
import { burstFor } from './flourish'
import { createTableView, type TableView } from './tableView'
import { BUTTONS, COLORS } from './tuning'

export interface SceneHandle {
  /** Lay out markers for this many players, and open a table for them. */
  setSeats(count: SeatCount): void
  /** The card table, once `setSeats` has opened one. Null before that. */
  readonly cards: TableView | null
  /** The 2D readouts over the table. */
  readonly hud: HudNode
  /** Take the readouts down, for the menu. */
  hideHud(): void
  /**
   * Whether the buttons take taps. Stay is gated separately, because staying
   * with nothing in front of you is not a legal move.
   */
  setControlsEnabled(enabled: boolean, canStay?: boolean): void
  /** Take a new canvas size. */
  resize(view: Rect): void
  destroy(): void
}

export interface SceneOptions {
  host: EngineHost
  camera: CameraSource
  view: Rect
  onHit: () => void
  onStay: () => void
}

/**
 * Synchronous on purpose. The table is what the game IS, so gating it on a
 * texture load means one failed decode leaves a blank region with the shared
 * sky already leased away. The mouth arrives late and attaches itself.
 */
export function buildScene(opts: SceneOptions): SceneHandle {
  const { host, camera, view } = opts

  const root = new Node3D('monsters-int-scene')
  host.engine.tree.root.add(root)

  const rig = new CameraRigNode(camera, view.height)
  root.add(rig)
  rig.makeCurrent()

  root.add(new TableNode())

  void Promise.all([
    loadMouthTexture(),
    loadWordArt('HIT', COLORS.ink),
    loadWordArt('STAY', COLORS.ink),
  ])
    .then(([mouth, hitWord, stayWord]) => {
      if (root.isDestroyed) return
      root.add(createMouthNode(mouth))
      root.add(
        createWordNode(
          hitWord,
          BUTTONS.labelLeftX,
          BUTTONS.labelY,
          BUTTONS.labelHeight,
        ),
        createWordNode(
          stayWord,
          BUTTONS.labelRightX,
          BUTTONS.labelY,
          BUTTONS.labelHeight,
        ),
      )
    })
    .catch((err: unknown) => {
      // Missing lettering is a cosmetic loss, not a reason to have no table.
      console.warn('[monsters-int] table artwork failed to load', err)
    })

  const hit = new ButtonNode(BUTTONS.leftX, opts.onHit, 'monsters-int-hit')
  const stay = new ButtonNode(BUTTONS.rightX, opts.onStay, 'monsters-int-stay')
  root.add(hit, stay, new BlinkNode([hit, stay]))

  // Particles are 2D and live in plain layout coordinates, which is the same
  // space the table is built in, so a burst placed at a card's own position
  // lands on that card. Added ahead of the HUD: both draw in `dynamic`, order
  // within a layer is tree order, and the lip has to cover anything that falls
  // to the bottom of the frame.
  const confetti = new ConfettiNode()
  host.engine.tree.root.add(confetti)

  // 2D, so it draws over the whole 3D pass. Added to the tree root rather than
  // under the 3D subtree, since the two kinds do not share a transform.
  const hud = new HudNode()
  hud.setViewport(view)
  host.engine.tree.root.add(hud)

  // The lip is chrome rather than table, so a failed parse costs the bottom
  // band and nothing else. It arrives long before anyone picks a mode.
  void loadBannerArt()
    .then((art) => {
      if (!hud.isDestroyed) hud.setArt(art)
    })
    .catch((err: unknown) => {
      console.warn('[monsters-int] banner artwork failed to load', err)
    })

  // Haze toward the table's own color, raised only while the table is holding
  // something up. The hand being decided on and the card being drawn both float
  // toward the camera, so what the haze actually fades is the seats behind them.
  const fog = new FogNode(host.engine.fog)
  root.add(fog)

  let cards: TableView | null = null

  // The card faces load behind the menu. A round cannot start before the player
  // picks a mode, so this is never on the critical path.
  const cardTextures = loadCardTextures()

  return {
    hud,
    hideHud() {
      hud.visible = false
      confetti.clear()
    },
    get cards() {
      return cards
    },
    setSeats(count) {
      hud.setSeatCount(count)
      hud.visible = true
      cards?.destroy()
      cards = null
      void cardTextures
        .then((textures) => {
          if (root.isDestroyed) return
          cards = createTableView(root, textures, count, {
            onForeground: (active) => fog.setRaised(active),
            onFocus: (seat) => hud.setFocusedSeat(seat),
            onFlourish: (f) => {
              for (const spec of burstFor(f)) confetti.play(spec)
            },
            onSpotlight: (on) => fog.setSpotlight(on),
          })
        })
        .catch((err: unknown) => {
          console.warn('[monsters-int] card artwork failed to load', err)
        })
    },
    setControlsEnabled(enabled, canStay = true) {
      hit.setEnabled(enabled)
      stay.setEnabled(enabled && canStay)
    },
    resize(next) {
      rig.setVisibleHeight(next.height)
      hud.setViewport(next)
    },
    destroy() {
      // `FogNode` puts the stage's fog back as it destroys, which `root` does
      // for it here.
      cards?.destroy()
      cards = null
      if (!confetti.isDestroyed) confetti.destroy()
      if (!hud.isDestroyed) hud.destroy()
      if (!root.isDestroyed) root.destroy()
    },
  }
}
