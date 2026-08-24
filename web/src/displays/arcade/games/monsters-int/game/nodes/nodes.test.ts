import { describe, expect, it } from 'vitest'
import {
  MeshNode,
  Node3D,
  type Node,
  type PointerEvent2D,
} from '@src/stargazer'
import { BlinkNode, ButtonNode } from './ButtonNode'
import { TableNode, createMouthNode, createWordNode } from './TableNode'
import { groundDepthForScreenHeight, layoutFromWorld } from '../project'
import { BLINK, BUTTONS, MOUTH, TABLE } from '../tuning'

// Construction only, with no device. Building geometry and composing a pose is
// where a bad quaternion or a degenerate radius throws, and finding that in a
// browser costs a reload per attempt.

/** A node's height including its parents, since the press moves a group. */
function worldY(node: Node3D): number {
  let y = 0
  let n: Node3D | null = node
  while (n) {
    y += n.transform.position.y
    n = n.parent instanceof Node3D ? n.parent : null
  }
  return y
}

/**
 * A pointer release that the input system reports as landing on `hit`.
 *
 * `null` for a release that landed on nothing, which is what happens when the
 * finger slides off the button before letting go.
 */
function release(hit: Node | null): PointerEvent2D {
  return {
    pointer: { screen: { x: 0, y: 0 } },
    stage: { input: { pick3D: () => hit } },
  } as unknown as PointerEvent2D
}

function meshes(node: Node3D): MeshNode[] {
  const found: MeshNode[] = []
  const walk = (n: Node3D): void => {
    if (n instanceof MeshNode) found.push(n)
    for (const c of n.children) if (c instanceof Node3D) walk(c)
  }
  walk(node)
  return found
}

describe('TableNode', () => {
  it('builds a table that projects back to where the art draws it', () => {
    const table = new TableNode()
    const [top] = meshes(table)
    expect(top).toBeDefined()
    const at = layoutFromWorld(top!.transform.position)
    expect(at.x).toBeCloseTo(TABLE.centerX, 6)
    expect(at.y).toBeCloseTo(TABLE.centerY, 6)
  })

  it('is painted flat, with no light on it', () => {
    const [top] = meshes(new TableNode())
    expect(top!.material.lit).toBe(false)
    expect(top!.material.pbr ?? false).toBe(false)
  })
})

/** Enough of a texture for a material. Nothing here touches a device. */
const fakeTexture = (): never => ({}) as never

/** Extent of a mesh along one axis of its own geometry. */
function extent(mesh: MeshNode, axis: 0 | 1 | 2): number {
  const v: number[] = []
  const p = mesh.geometry!.positions
  for (let i = axis; i < p.length; i += 3) v.push(p[i]!)
  return Math.max(...v) - Math.min(...v)
}

// Ground art is drawn in screen space and laid down in world space, and scale
// is applied before rotation, so a flat quad has to be BUILT at its finished
// depth. Scaling one afterwards moves its normal and leaves the art stretched
// over whatever height the geometry happened to have.
describe('art lying on the table', () => {
  it('builds the mouth at the depth its drawn height needs', () => {
    const mouth = createMouthNode(fakeTexture())
    expect(extent(mouth, 1)).toBeCloseTo(
      groundDepthForScreenHeight(MOUTH.radiusY * 2),
      6,
    )
    expect(mouth.transform.scale).toEqual({ x: 1, y: 1, z: 1 })
    // Zeroed, because the mouth is lifted a fraction to sit over the table and
    // that lift is worth a third of a pixel on screen.
    const on = { ...mouth.transform.position, y: 0 }
    expect(layoutFromWorld(on).y).toBeCloseTo(MOUTH.centerY, 6)
  })

  it('letters a word at its cap height, whatever shape the word is', () => {
    const word = (aspect: number): MeshNode =>
      createWordNode(
        { texture: fakeTexture(), aspect },
        BUTTONS.leftX,
        BUTTONS.labelY,
        BUTTONS.labelHeight,
      )
    const wide = word(4)
    const narrow = word(2)
    expect(extent(wide, 1)).toBeCloseTo(extent(narrow, 1), 6)
    expect(extent(wide, 0)).toBeCloseTo(extent(narrow, 0) * 2, 6)
  })
})

describe('BlinkNode', () => {
  it('shuts both eyes at the same moment and opens them again', () => {
    const hit = new ButtonNode(BUTTONS.leftX, () => {}, 'a')
    const stay = new ButtonNode(BUTTONS.rightX, () => {}, 'b')
    const blink = new BlinkNode([hit, stay])
    const eyeOf = (b: ButtonNode): MeshNode => meshes(b)[4]!

    // Run until it fires, then confirm both went at once.
    let fired = false
    for (let i = 0; i < 2000 && !fired; i++) {
      blink.onUpdate(1 / 60)
      fired = !eyeOf(hit).visible
    }
    expect(fired, 'blinked within 30s').toBe(true)
    expect(eyeOf(stay).visible).toBe(false)

    for (let i = 0; i < 60; i++) blink.onUpdate(1 / 60)
    expect(eyeOf(hit).visible).toBe(true)
    expect(eyeOf(stay).visible).toBe(true)
  })

  // A single blink on a fixed clock reads as a pulsing indicator. The rhythm
  // is what makes it read as a face instead.
  it('alternates a single blink with a double, on an uneven beat', () => {
    const hit = new ButtonNode(BUTTONS.leftX, () => {}, 'a')
    const blink = new BlinkNode([hit])
    const eye = meshes(hit)[4]!

    // Record how long the eye is shut for, and how long it is open between.
    const shuts: number[] = []
    const gaps: number[] = []
    let wasOpen = true
    let run = 0
    for (let i = 0; i < 60 * 60; i++) {
      blink.onUpdate(1 / 60)
      if (eye.visible === wasOpen) {
        run++
        continue
      }
      ;(wasOpen ? gaps : shuts).push(run / 60)
      wasOpen = eye.visible
      run = 1
    }
    expect(shuts.length).toBeGreaterThan(8)

    // A double blink is two shuts split by a gap far shorter than the wait
    // between blinks, so the short gaps mark the doubles. Checked against the
    // length it should be, not merely against being short: a missing hold is
    // also a very short gap, and it looks like one long blink.
    const short = gaps.filter((g) => g < BLINK.minGap / 2)
    expect(short.length).toBeGreaterThan(2)
    expect(short.length * 3).toBeLessThan(shuts.length * 2)
    for (const g of short) {
      expect(g).toBeCloseTo(BLINK.between, 1)
      // And long enough to see. A hold of a frame or two is not a double
      // blink, it is one long blink with a flicker in the middle.
      expect(g).toBeGreaterThan(0.05)
    }
    for (const s of shuts) expect(s).toBeCloseTo(BLINK.shut, 1)

    // Not a fixed clock. Measured in whole frames, so two waits landing on the
    // same one is ordinary. The spread across them is the property.
    const waits = gaps.filter((g) => g >= BLINK.minGap / 2)
    expect(new Set(waits).size).toBeGreaterThan(waits.length / 2)
    expect(Math.max(...waits) - Math.min(...waits)).toBeGreaterThan(
      (BLINK.maxGap - BLINK.minGap) / 3,
    )
    for (const w of waits) {
      expect(w).toBeGreaterThanOrEqual(BLINK.minGap - 0.05)
      expect(w).toBeLessThanOrEqual(BLINK.maxGap + 0.05)
    }
  })

  it('leaves a button that takes no taps shut through the blink', () => {
    const hit = new ButtonNode(BUTTONS.leftX, () => {}, 'a')
    hit.setEnabled(false)
    const blink = new BlinkNode([hit])
    for (let i = 0; i < 2000; i++) blink.onUpdate(1 / 60)
    expect(meshes(hit)[4]!.visible).toBe(false)
    expect(meshes(hit)[5]!.visible).toBe(true)
  })
})

describe('ButtonNode', () => {
  it('stands where the art draws it', () => {
    const button = new ButtonNode(BUTTONS.leftX, () => {}, 'test-hit')
    const at = layoutFromWorld(button.transform.position)
    expect(at.x).toBeCloseTo(BUTTONS.leftX, 6)
    expect(at.y).toBeCloseTo(BUTTONS.groundY, 6)
  })

  it('is a plate, a button and two eyes, each painted flat', () => {
    const parts = meshes(new ButtonNode(BUTTONS.leftX, () => {}, 't'))
    // A side band and a cap for each of the two discs, plus the open eye and
    // the shut one, which are both built and one hidden.
    expect(parts).toHaveLength(6)
    for (const part of parts) expect(part.material.lit).toBe(false)
  })

  // The table is read from a metre away and standing up, so a control that
  // takes no taps says so three ways at once.
  it('shuts its eye, dims and rests down while it takes no taps', () => {
    const button = new ButtonNode(BUTTONS.leftX, () => {}, 't')
    const eyes = meshes(button).slice(4)
    const cap = meshes(button)[3]!
    const lit = cap.material.color!
    const restY = worldY(button.body)

    expect(eyes.map((e) => e.visible)).toEqual([true, false])

    button.setEnabled(false)
    expect(eyes.map((e) => e.visible)).toEqual([false, true])
    expect(cap.material.color![0]).toBeLessThan(lit[0])
    expect(worldY(button.body)).toBeLessThan(restY)

    button.setEnabled(true)
    expect(eyes.map((e) => e.visible)).toEqual([true, false])
    expect(cap.material.color![0]).toBeCloseTo(lit[0], 9)
    expect(worldY(button.body)).toBeCloseTo(restY, 9)
  })

  it('blinks without looking like it went dead', () => {
    const button = new ButtonNode(BUTTONS.leftX, () => {}, 't')
    const [open, shut] = meshes(button).slice(4)
    const cap = meshes(button)[3]!
    const lit = cap.material.color![0]
    const restY = worldY(button.body)

    button.setBlinking(true)
    expect(open!.visible).toBe(false)
    expect(shut!.visible).toBe(true)
    // Only the eye. A blink that also dimmed and sank would read as the button
    // going away for a moment.
    expect(cap.material.color![0]).toBeCloseTo(lit, 9)
    expect(worldY(button.body)).toBeCloseTo(restY, 9)

    button.setBlinking(false)
    expect(open!.visible).toBe(true)
  })

  it('shuts its eye while a finger is on it', () => {
    const button = new ButtonNode(BUTTONS.leftX, () => {}, 't')
    const [open, shut] = meshes(button).slice(4)

    button.body.onPointerDown!(release(button.body))
    expect(open!.visible, 'poked in the eye').toBe(false)
    expect(shut!.visible).toBe(true)

    button.body.onPointerUp!(release(button.body))
    expect(open!.visible).toBe(true)
  })

  // The three overlapping reasons for a shut eye have to agree however they
  // interleave, which is why one method owns which eye shows.
  it('keeps the right eye whatever order the reasons arrive in', () => {
    const button = new ButtonNode(BUTTONS.leftX, () => {}, 't')
    const [open, shut] = meshes(button).slice(4)

    button.setBlinking(true)
    button.setEnabled(false)
    button.setBlinking(false)
    expect(open!.visible, 'still disabled').toBe(false)
    expect(shut!.visible).toBe(true)

    button.setBlinking(true)
    button.setEnabled(true)
    expect(open!.visible, 'still mid-blink').toBe(false)
    button.setBlinking(false)
    expect(open!.visible).toBe(true)

    // A blink that starts under a finger outlasts the release.
    button.body.onPointerDown!(release(button.body))
    button.setBlinking(true)
    button.body.onPointerUp!(release(button.body))
    expect(open!.visible, 'still mid-blink').toBe(false)
    button.setBlinking(false)
    expect(open!.visible).toBe(true)
  })

  it('comes back to its resting depth, not to the table, when disabled', () => {
    let fired = 0
    const button = new ButtonNode(BUTTONS.leftX, () => fired++, 't')
    button.setEnabled(false)
    const resting = worldY(button.body)

    // A tap on a shut button neither presses nor fires.
    button.body.onPointerDown!(release(button.body))
    button.body.onPointerUp!(release(button.body))
    expect(fired).toBe(0)
    expect(worldY(button.body)).toBeCloseTo(resting, 9)
  })

  it('stacks straight cylinders rather than tapering, and the eye sits on top', () => {
    const button = new ButtonNode(BUTTONS.leftX, () => {}, 't')
    const parts = meshes(button)
    const plate = parts[0]!
    const eye = parts.at(-1)!
    // The plate is wider than the button standing on it, giving the lip.
    expect(BUTTONS.baseRadius).toBeGreaterThan(BUTTONS.radius)
    expect(plate.transform.position.y).toBe(0)
    expect(button.body.transform.position.y).toBeGreaterThan(0)
    expect(worldY(eye)).toBeGreaterThan(worldY(button.body))
  })

  it('fires only while enabled, and once per press', () => {
    let fired = 0
    const button = new ButtonNode(BUTTONS.leftX, () => fired++, 't')
    const down = button.body.onPointerDown!
    const up = button.body.onPointerUp!
    const on = release(button.body)

    down(on)
    up(on)
    expect(fired).toBe(1)

    // A release with no press behind it is not a click.
    up(on)
    expect(fired).toBe(1)

    button.setEnabled(false)
    down(on)
    up(on)
    expect(fired).toBe(1)
  })

  // The pointer is captured by whatever it went down on, so the release lands
  // here whether or not the finger is still on the button.
  it('does not fire when the press is dragged off before release', () => {
    let fired = 0
    const button = new ButtonNode(BUTTONS.leftX, () => fired++, 't')
    const restY = worldY(button.body)

    button.body.onPointerDown!(release(button.body))
    button.body.onPointerUp!(release(null))
    expect(fired).toBe(0)
    // And it comes back up rather than sticking down.
    expect(worldY(button.body)).toBeCloseTo(restY, 9)
  })

  it('does not fire when the release lands on the other button', () => {
    let fired = 0
    const button = new ButtonNode(BUTTONS.leftX, () => fired++, 't')
    const other = new ButtonNode(BUTTONS.rightX, () => {}, 't2')
    button.body.onPointerDown!(release(button.body))
    button.body.onPointerUp!(release(other.body))
    expect(fired).toBe(0)
  })

  it('fires when the press wanders onto the plate and back', () => {
    let fired = 0
    const button = new ButtonNode(BUTTONS.leftX, () => fired++, 't')
    const plate = meshes(button)[0]!
    button.body.onPointerDown!(release(button.body))
    button.body.onPointerUp!(release(plate))
    expect(fired).toBe(1)
  })

  it('sinks the button into its plate, leaving the plate on the table', () => {
    const button = new ButtonNode(BUTTONS.leftX, () => {}, 't')
    const plate = meshes(button)[0]!
    const plateY = plate.transform.position.y
    const restY = worldY(button.body)

    button.body.onPointerDown!(release(button.body))
    expect(plate.transform.position.y, 'plate holds still').toBe(plateY)
    expect(worldY(button.body), 'button dips').toBeLessThan(restY)

    button.body.onPointerUp!(release(button.body))
    expect(worldY(button.body)).toBeCloseTo(restY, 9)
  })

  it('takes a tap on the plate as well as the button', () => {
    const button = new ButtonNode(BUTTONS.leftX, () => {}, 't')
    const [plate] = meshes(button)
    expect(plate!.hitEnabled).toBe(true)
    expect(button.body.hitEnabled).toBe(true)

    let fired = 0
    const b = new ButtonNode(BUTTONS.leftX, () => fired++, 't2')
    const lip = meshes(b)[0]!
    lip.onPointerDown!(release(lip))
    lip.onPointerUp!(release(lip))
    expect(fired).toBe(1)
  })
})
