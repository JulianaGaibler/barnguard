/**
 * One card on the table.
 *
 * @remarks
 *   Two rounded quads back to back, because a single plane is one-sided: culled
 *   it vanishes when seen from behind, and double-sided it shows its own face
 *   mirrored. The rounding is geometry rather than an alpha cutout, so the card
 *   is `OPAQUE`, depth-sorts for free and casts a correctly shaped shadow.
 *
 *   Cards are pooled and never destroyed mid-match. That keeps their GPU buffers
 *   uploaded once, and it sidesteps the renderer holding destroyed meshes.
 */
import {
  ignoreAbort,
  MeshNode,
  moveToward,
  Node3D,
  createRoundedQuadGeometry,
  easings,
  quat,
  quatFromAxisAngle,
  quatMultiply,
  type MaterialTexture,
  type MeshGeometry,
  type Quat,
} from '@src/stargazer'
import { ELEVATION, PX_TO_M } from '../project'
import { ANIM, CARD, DIM, FOCUS } from '../tuning'

/** Shared by every card, so the shape uploads once per pooled node. */
let shape: MeshGeometry | null = null
function cardShape(): MeshGeometry {
  shape ??= createRoundedQuadGeometry({
    width: CARD.width * PX_TO_M,
    height: CARD.height * PX_TO_M,
    radius: CARD.radius * PX_TO_M,
    cornerSegments: 5,
  })
  return shape
}

/** Lying face up on the table. */
const FLAT = quatFromAxisAngle(quat(), 1, 0, 0, -Math.PI / 2)
/** Square to the camera, for the card being revealed. */
const UPRIGHT = quatFromAxisAngle(quat(), 1, 0, 0, -ELEVATION)
/** Part way between the two, for the hand whose turn it is. */
const TILTED = quatFromAxisAngle(
  quat(),
  1,
  0,
  0,
  -(Math.PI / 2) + ((FOCUS.tiltDeg * Math.PI) / 180 - ELEVATION),
)

/** How a card is angled. */
export type CardFacing = 'flat' | 'upright' | 'tilted'

/** Where and how a card sits. */
export interface CardPose {
  x: number
  y: number
  z: number
  facing: CardFacing
  scale?: number
  /** Turn about the card's own face, in radians. Zero is square to the frame. */
  spin?: number
}

/** The card's angle, turned about its own face by `spin`. */
function rotationFor(facing: CardFacing, spin: number): Quat {
  const base =
    facing === 'upright' ? UPRIGHT : facing === 'tilted' ? TILTED : FLAT
  if (spin === 0) return base
  return quatMultiply(quat(), base, quatFromAxisAngle(quat(), 0, 0, 1, spin))
}

/** Scratch for the spin, which builds a rotation every frame it runs. */
const SPIN_ABOUT = quat()
const SPIN_TO = quat()

/** Whether re-issuing this pose would move the card at all. */
function samePose(a: CardPose | null, b: CardPose): boolean {
  return (
    a !== null &&
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    a.facing === b.facing &&
    (a.scale ?? 1) === (b.scale ?? 1) &&
    (a.spin ?? 0) === (b.spin ?? 0)
  )
}

export class CardNode extends Node3D {
  readonly #front: MeshNode
  readonly #back: MeshNode
  /**
   * The pose last asked for, so an unchanged one is ignored.
   *
   * Every hand is re-placed whenever anything happens, which is what guarantees
   * no card is left stranded. Without this, that pass would restart the tween
   * on every settled card and the whole table would twitch each time one card
   * moved.
   */
  #target: CardPose | null = null
  /** How washed out the card is drawn, and what it is heading toward. */
  #dim = 1
  #dimTo = 1
  /**
   * The spin's interpolation target, one per node.
   *
   * The animator cancels a keyed tween by matching the key AND the object being
   * interpolated, so a fresh object per spin would make the key inert and let
   * two spins drive the same card at once.
   */
  readonly #spinP = { p: 0 }

  constructor(id: string) {
    super(id)
    const geometry = cardShape()
    // Unlit, so a card reads at the exact colors it was drawn in. The art is
    // flat vector work, and any shading at all makes two cards lying at
    // different angles look like two different inks.
    this.#front = new MeshNode(geometry, { lit: false, color: [1, 1, 1, 1] })
    this.#back = new MeshNode(geometry, { lit: false, color: [1, 1, 1, 1] })
    // A half turn about Y, so the two faces look opposite ways.
    const flip = quatFromAxisAngle(quat(), 0, 1, 0, Math.PI)
    this.#back.transform.setRotation(flip.x, flip.y, flip.z, flip.w)
    this.add(this.#front, this.#back)
  }

  setFace(front: MaterialTexture, back: MaterialTexture): void {
    this.#front.material.baseColorTex = front
    this.#back.material.baseColorTex = back
  }

  /**
   * Wash the card toward the table, for a seat that is out of the round.
   *
   * Faded over `ANIM.dimFade` rather than switched. A whole hand changing
   * colour between two frames reads as a drawing fault, where one that drains
   * reads as something that happened to it.
   */
  setDimmed(dimmed: boolean): void {
    this.#dimTo = dimmed ? DIM : 1
    // A card built but not added, which is what a test has, holds the value
    // outright since nothing will ever tick it there.
    if (!this.engine) this.#snapDim(this.#dimTo)
  }

  override onUpdate(dt: number): void {
    if (this.#dim === this.#dimTo) return
    // Stepped over the wash's own range rather than over 0 to 1, so the fade
    // takes `ANIM.dimFade` however far apart the two ends happen to be.
    const step = ((1 - DIM) * dt) / ANIM.dimFade
    this.#snapDim(moveToward(this.#dim, this.#dimTo, step))
  }

  #snapDim(value: number): void {
    this.#dim = value
    this.#front.material.color = [value, value, value, 1]
    this.#back.material.color = [value, value, value, 1]
  }

  /** Put the card somewhere with no animation. */
  snapTo(pose: CardPose): void {
    const s = pose.scale ?? 1
    this.transform.setPosition(pose.x, pose.y, pose.z)
    this.transform.setScale(s, s, s)
    const r = rotationFor(pose.facing, pose.spin ?? 0)
    this.transform.setRotation(r.x, r.y, r.z, r.w)
    this.#target = { ...pose }
  }

  /** Take the card off the table and forget where it was, for the pool. */
  park(): void {
    this.visible = false
    this.#target = null
    // A card that left by collapsing is sitting at zero scale, and one that
    // left a busted hand is grey. The pool hands nodes back without either, and
    // outright rather than faded, since nobody is watching a parked card
    // recover.
    this.transform.setScale(1, 1, 1)
    this.#dimTo = 1
    this.#snapDim(1)
  }

  /**
   * Shrink into nothing, for a card the round has finished with.
   *
   * The pieces that replace it spawn at full size on the frame it starts, so a
   * card that simply stopped being drawn would be gone before the burst had
   * visibly grown, leaving a hole where it stood. Resolves once the card is off
   * the table, which is when its node can go back to the pool.
   *
   * Keyed on the travel, so it cancels a move still running. That is correct
   * for a card that is leaving, and it is the reason the remembered pose is
   * dropped: the card no longer holds the one it was asked for.
   */
  collapse(): Promise<void> {
    this.#target = null
    if (!this.engine) return Promise.resolve()
    return this.tween(
      { scale: { x: 0, y: 0, z: 0 } },
      { duration: ANIM.collapse, easing: easings.inCubic, key: 'move' },
    )
  }

  /**
   * Travel to a pose. Keyed, so a re-issued move replaces rather than stacks.
   *
   * Eased to a soft stop and offered a delay. The delay is what stops a hand
   * reading as a diagram redrawing itself, and it does the work an overshoot
   * would: the table is a hard floor at `y = 0`, so any easing that undershoots
   * puts a card through it on the way in.
   */
  moveTo(pose: CardPose, duration: number = ANIM.move, delay = 0): void {
    if (samePose(this.#target, pose)) return
    const s = pose.scale ?? 1
    const r = rotationFor(pose.facing, pose.spin ?? 0)
    if (!this.engine) {
      this.snapTo(pose)
      return
    }
    this.#target = { ...pose }
    this.play(
      {
        position: { x: pose.x, y: pose.y, z: pose.z },
        rotation: r,
        scale: { x: s, y: s, z: s },
      },
      { duration, delay, easing: easings.outQuint, key: 'move' },
    )
  }

  /**
   * Turn the card about its own face, for a bust or a flourish.
   *
   * About the card's own vertical axis, so it turns like a revolving door and
   * shows its back on the way round. Turning about the face normal instead
   * spins it like a pinwheel, which is a flat gesture on a table that is not
   * flat.
   *
   * Driven as an angle rather than as a rotation to tween toward, because a
   * whole number of turns lands on the orientation it started from: the tween
   * would slerp between two quaternions describing the same pose and hold
   * perfectly still.
   *
   * The turn is measured from the pose the card was last ASKED for rather than
   * the one it is holding, so a spin issued while a move is still running does
   * not take a mid-flight angle as its base. The two still write the same field
   * under different keys, so a card is meant to be settled before it spins.
   */
  spin(turns = 1, duration: number = ANIM.move, delay = 0): void {
    const engine = this.engine
    if (!engine) return
    const pose = this.#target
    const base = pose
      ? rotationFor(pose.facing, pose.spin ?? 0)
      : this.transform.rotation
    const baseX = base.x
    const baseY = base.y
    const baseZ = base.z
    const baseW = base.w
    const total = Math.PI * 2 * turns
    this.#spinP.p = 0
    void engine.animation
      .tween(
        this.#spinP,
        { p: 1 },
        {
          duration,
          delay,
          easing: easings.outCubic,
          key: 'spin',
          signal: this.abortSignal,
          onUpdate: () => {
            quatFromAxisAngle(SPIN_ABOUT, 0, 1, 0, total * this.#spinP.p)
            const r = quatMultiply(
              SPIN_TO,
              { x: baseX, y: baseY, z: baseZ, w: baseW },
              SPIN_ABOUT,
            )
            this.transform.setRotation(r.x, r.y, r.z, r.w)
          },
        },
      )
      .catch(ignoreAbort)
  }
}
