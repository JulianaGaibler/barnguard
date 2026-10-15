import { afterEach, describe, expect, it, vi } from 'vitest'
import { Camera } from '../camera/Camera'
import type { Engine } from '../engine/Engine'
import { ShapeNode } from '../nodes/ShapeNode'
import type { Stage } from '../render/Stage'
import { ButtonBehavior } from '../scene/ButtonBehavior'
import { DraggableBehavior } from '../scene/DraggableBehavior'
import { Layer } from '../scene/Layer'
import { Node2D } from '../scene/Node2D'
import { SceneTree } from '../scene/SceneTree'
import { InputSystem } from './InputSystem'
import type { PointerEvent2D } from './PointerState'

interface Rig {
  input: InputSystem
  tree: SceneTree
  camera: Camera
  canvas: HTMLCanvasElement
  stageEvents: { name: string; ev: PointerEvent2D }[]
  down(x: number, y: number, id?: number): void
  move(x: number, y: number, id?: number): void
  up(x: number, y: number, id?: number): void
  /** Frame the camera on `width` by `height` world units. */
  zoom(width: number, height: number): void
}

/** An input system over a 200 by 100 canvas with a camera framing all of it. */
function rig(): Rig {
  const canvas = document.createElement('canvas')
  const tree = new SceneTree(new Node2D('scene-root'))
  const camera = new Camera(
    { x: 0, y: 0, width: 200, height: 100 },
    { w: 200, h: 100 },
  )
  const stageEvents: { name: string; ev: PointerEvent2D }[] = []
  const stage = {
    canvas,
    tree,
    currentCamera2D: camera,
    currentCamera3D: null,
    renderer: { cssSize: { w: 200, h: 100 } },
    events: {
      emit: (name: string, ev: PointerEvent2D) =>
        stageEvents.push({ name, ev }),
    },
  } as unknown as Stage
  const engine = { debug: null } as unknown as Engine
  const input = new InputSystem(stage, engine)
  const fire = (type: string, x: number, y: number, id: number): void => {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        clientX: x,
        clientY: y,
        pointerType: 'mouse',
      }),
    )
  }
  return {
    input,
    tree,
    camera,
    canvas,
    stageEvents,
    down: (x, y, id = 1) => fire('pointerdown', x, y, id),
    move: (x, y, id = 1) => fire('pointermove', x, y, id),
    up: (x, y, id = 1) => fire('pointerup', x, y, id),
    zoom: (width, height) => camera.setViewport({ x: 0, y: 0, width, height }),
  }
}

/** A hit-enabled rectangle whose pointer events are recorded. */
function box(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  log: { name: string; ev: PointerEvent2D }[] = [],
): ShapeNode {
  const node = new ShapeNode({
    id,
    geometry: { kind: 'rect', width: w, height: h, centered: false },
    fill: '#fff',
  })
  node.transform.x = x
  node.transform.y = y
  node.hitEnabled = true
  node.onPointerDown = (ev) => log.push({ name: 'down', ev })
  node.onPointerMove = (ev) => log.push({ name: 'move', ev })
  node.onPointerUp = (ev) => log.push({ name: 'up', ev })
  return node
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('InputSystem with a Layer', () => {
  it('hits a screen layer node where the layer draws it, whatever the camera does', () => {
    const r = rig()
    const log: { name: string; ev: PointerEvent2D }[] = []
    const hud = new Layer({ space: 'screen' })
    hud.add(box('button', 10, 10, 40, 40, log))
    r.tree.root.add(hud)
    // The camera zooms in 4x, so world (10, 10) would sit at screen (40, 40).
    r.zoom(50, 25)
    r.down(20, 20)
    expect(log.map((l) => l.name)).toEqual(['down'])
    r.up(20, 20)
  })

  it('gives the node its own space and the stage the camera space', () => {
    const r = rig()
    const log: { name: string; ev: PointerEvent2D }[] = []
    const hud = new Layer({ space: 'screen' })
    hud.add(box('button', 10, 10, 40, 40, log))
    r.tree.root.add(hud)
    r.zoom(50, 25)
    r.down(20, 20)
    // The node sees layer space, one unit to a pixel. The stage sees the camera.
    expect(log[0].ev.pointer.world).toEqual({ x: 20, y: 20 })
    const stage = r.stageEvents.find((s) => s.name === 'pointerDown')!
    expect(stage.ev.pointer.world).toEqual({ x: 5, y: 5 })
    r.up(20, 20)
  })

  it('does not hit a world node where only its unzoomed position would be', () => {
    const r = rig()
    const log: { name: string; ev: PointerEvent2D }[] = []
    r.tree.root.add(box('world', 10, 10, 40, 40, log))
    r.zoom(50, 25)
    // World (10..50) is screen (40..200) at 4x, and the slop reaches 30 pixels
    // past it. Screen (5, 5) is world (1.25, 1.25), outside both.
    r.down(5, 5)
    expect(log).toHaveLength(0)
    r.up(5, 5)
    r.down(60, 60)
    expect(log.map((l) => l.name)).toEqual(['down'])
    r.up(60, 60)
  })

  it('lets the later node win whichever space it is in', () => {
    const r = rig()
    const worldLog: { name: string; ev: PointerEvent2D }[] = []
    const hudLog: { name: string; ev: PointerEvent2D }[] = []
    const hud = new Layer({ space: 'screen' })
    hud.add(box('hud', 0, 0, 200, 100, hudLog))
    r.tree.root.add(hud)
    r.tree.root.add(box('world', 0, 0, 200, 100, worldLog))
    r.down(50, 50)
    expect(worldLog.map((l) => l.name)).toEqual(['down'])
    expect(hudLog).toHaveLength(0)
    r.up(50, 50)

    const r2 = rig()
    const worldLog2: { name: string; ev: PointerEvent2D }[] = []
    const hudLog2: { name: string; ev: PointerEvent2D }[] = []
    r2.tree.root.add(box('world', 0, 0, 200, 100, worldLog2))
    const hud2 = new Layer({ space: 'screen' })
    hud2.add(box('hud', 0, 0, 200, 100, hudLog2))
    r2.tree.root.add(hud2)
    r2.down(50, 50)
    expect(hudLog2.map((l) => l.name)).toEqual(['down'])
    expect(worldLog2).toHaveLength(0)
    r2.up(50, 50)
  })

  it('measures the touch slop in the units of the view that places the node', () => {
    const r = rig()
    const hud = new Layer({ space: 'screen' })
    const inHud = box('hud', 0, 0, 10, 10)
    hud.add(inHud)
    const inWorld = box('world', 0, 0, 10, 10)
    r.tree.root.add(hud)
    r.tree.root.add(inWorld)
    r.zoom(50, 25)
    expect(r.input.touchSlopFor(inHud)).toBe(30)
    expect(r.input.touchSlopFor(inWorld)).toBe(7.5)
  })

  it('hits a node within the slop in its own space', () => {
    const r = rig()
    const log: { name: string; ev: PointerEvent2D }[] = []
    const hud = new Layer({ space: 'screen' })
    hud.add(box('button', 100, 50, 10, 10, log))
    r.tree.root.add(hud)
    r.zoom(50, 25)
    // 20 pixels left of the box is inside the 30 pixel slop.
    r.down(80, 55)
    expect(log.map((l) => l.name)).toEqual(['down'])
    r.up(80, 55)
  })

  it('sends no synthetic move to a node under a screen layer when the camera pans', () => {
    const r = rig()
    const hudLog: { name: string; ev: PointerEvent2D }[] = []
    const hud = new Layer({ space: 'screen' })
    hud.add(box('hud', 0, 0, 100, 100, hudLog))
    r.tree.root.add(hud)
    r.down(20, 20)
    r.stageEvents.length = 0
    r.camera.setViewport({ x: 30, y: 10, width: 200, height: 100 })
    r.input.beforeFrame()
    expect(hudLog.filter((l) => l.name === 'move')).toHaveLength(0)
    // The stage still hears that the world under the finger moved.
    expect(
      r.stageEvents.filter(
        (s) => s.name === 'pointerMove' && s.ev.source === 'synthetic',
      ),
    ).toHaveLength(1)
    r.up(20, 20)
  })

  it('sends a synthetic move to a world node when the camera pans', () => {
    const r = rig()
    const log: { name: string; ev: PointerEvent2D }[] = []
    r.tree.root.add(box('world', 0, 0, 100, 100, log))
    r.down(20, 20)
    r.camera.setViewport({ x: 30, y: 10, width: 200, height: 100 })
    r.input.beforeFrame()
    const moves = log.filter((l) => l.name === 'move')
    expect(moves).toHaveLength(1)
    expect(moves[0].ev.source).toBe('synthetic')
    expect(moves[0].ev.delta).toEqual({ x: 30, y: 10 })
    r.up(20, 20)
  })

  it('moves a node under a screen layer by pixels, not by camera units', () => {
    const r = rig()
    const log: { name: string; ev: PointerEvent2D }[] = []
    const hud = new Layer({ space: 'screen' })
    hud.add(box('drag', 0, 0, 100, 100, log))
    r.tree.root.add(hud)
    r.zoom(50, 25)
    r.down(20, 20)
    r.move(35, 28)
    const move = log.find((l) => l.name === 'move')!
    expect(move.ev.delta).toEqual({ x: 15, y: 8 })
    r.up(35, 28)
  })

  it('gives localTo the position in the node space under any camera', () => {
    const r = rig()
    const hudNode = box('button', 10, 10, 40, 40)
    const hud = new Layer({ space: 'screen' })
    hud.add(hudNode)
    const worldNode = box('world', 10, 10, 40, 40)
    r.tree.root.add(hud)
    r.tree.root.add(worldNode)
    r.zoom(50, 25)
    r.down(60, 60)
    const stage = r.stageEvents.find((s) => s.name === 'pointerDown')!
    // Screen (60, 60): layer space puts it 50 from the node origin. The camera
    // is at 4x, so the world node sees it at (15, 15) minus (10, 10).
    expect(stage.ev.localTo(hudNode)).toEqual({ x: 50, y: 50 })
    expect(stage.ev.localTo(worldNode)).toEqual({ x: 5, y: 5 })
    r.up(60, 60)
  })

  it('warns once when a stage position is passed to a layer node', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = rig()
    const hudNode = box('button', 0, 0, 40, 40)
    const hud = new Layer({ id: 'hud', space: 'screen' })
    hud.add(hudNode)
    r.tree.root.add(hud)
    r.zoom(50, 25)
    r.down(20, 20)
    const stage = r.stageEvents.find((s) => s.name === 'pointerDown')!
    const w = stage.ev.pointer.world
    hudNode.worldToLocal(w.x, w.y)
    hudNode.worldToLocal(w.x, w.y)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('localTo(button)')
    r.up(20, 20)
  })

  it('does not warn for a position taken through localTo', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = rig()
    const hudNode = box('button', 0, 0, 40, 40)
    const hud = new Layer({ space: 'screen' })
    hud.add(hudNode)
    r.tree.root.add(hud)
    r.zoom(50, 25)
    r.down(20, 20)
    const stage = r.stageEvents.find((s) => s.name === 'pointerDown')!
    stage.ev.localTo(hudNode)
    expect(warn).not.toHaveBeenCalled()
    r.up(20, 20)
  })

  it('clicks a button under a screen layer while the camera is zoomed', () => {
    const r = rig()
    let clicks = 0
    const button = box('button', 10, 10, 40, 40)
    button.addBehavior(new ButtonBehavior({ onClick: () => clicks++ }))
    const hud = new Layer({ space: 'screen' })
    hud.add(button)
    r.tree.root.add(hud)
    r.zoom(50, 25)
    r.down(20, 20)
    r.up(25, 25)
    expect(clicks).toBe(1)

    // Pressed on the button and released away from it is not a click.
    r.down(20, 20)
    r.up(150, 80)
    expect(clicks).toBe(1)
  })

  it('drags a node under a screen layer by pixels while the camera is zoomed', () => {
    const r = rig()
    const card = box('card', 0, 0, 100, 100)
    card.addBehavior(new DraggableBehavior({ threshold: 4 }))
    const hud = new Layer({ space: 'screen' })
    hud.add(card)
    r.tree.root.add(hud)
    r.zoom(50, 25)
    r.down(20, 20)
    r.move(60, 40)
    expect(card.transform.x).toBeCloseTo(40)
    expect(card.transform.y).toBeCloseTo(20)
    r.up(60, 40)
  })
})
