import { createEngineHost } from '../engine/EngineHost'
import { ShapeNode } from '../nodes/ShapeNode'
import { ParticleEmitterNode } from '../nodes/ParticleEmitterNode'
import { ignoreAbort } from '../anim/abortSignal'
import { inOutQuad, outCubic } from '../math/easings'
import type { Stage } from '../render/Stage'
import type { PointerEvent2D } from '../input/PointerState'
import type { DemoFn } from './types'

/**
 * Secondary-stage demo, now with interactive secondaries. Renders two canvases
 * driven by one Engine:
 *
 * Primary, a fullscreen hero circle tweening left↔right across the wide
 * viewport. Proves the primary input + render path is unaffected. Secondary
 * ("Loss Card"), a small overlay card (top-right, 30% × 30%) with its own
 * scene, camera, AND `InputSystem`. Contains: - Background auto-tweening hero
 * (shared-clock demo, unchanged). - Draggable "packet" (violet circle),
 * hit-enabled, capture-on- down, follows the finger, decides win/reset on
 * release. - Target "zone" (dashed rect), decorative; win check is a
 * point-in-rect against the packet's world position at up.
 *
 * Keys: [SPACE] Detach + re-attach the secondary stage. Confirms lifecycle
 * cascade through the InputSystem too, pending capture cleans up. [R] Restart
 * the shared tween on both heroes (packet position resets independently via its
 * own drop-outside path).
 *
 * The demo also logs a running count for `engine.events.on('pointerDown', ...)`
 * vs `secondaryStage.events.on('pointerDown', ...)` so the console shows the
 * cross-talk fix in action: tapping the secondary increments only the stage
 * counter; tapping the primary increments both.
 */
const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const host = createEngineHost({
    canvas,
    clearColor: '#0d1a2c',
    initialViewport: { x: -800, y: -450, width: 1600, height: 900 },
  })
  attach?.(host)

  const { engine } = host

  // --- Primary scene ---------------------------------------------------
  const primaryHero = new ShapeNode({
    id: 'primary-hero',
    geometry: { kind: 'circle', radius: 60 },
    fill: '#ffd34d',
    stroke: '#fdf6e3',
    lineWidth: 3,
  })
  await host.loadScene((scene) => {
    scene.root.add(primaryHero)
  })
  host.start()

  // --- Event-bus isolation counter -------------------------------------
  // Every tap on the PRIMARY increments both. Every tap on the SECONDARY
  // increments only the stage counter, verifying that secondary pointer
  // events never leak onto engine.events.
  let engineDowns = 0
  let stageDowns = 0
  engine.events.on('pointerDown', () => {
    engineDowns++
    console.log(
      `[demo-stages] engine.events pointerDown  →  engine=${engineDowns} stage=${stageDowns}`,
    )
  })

  // --- Secondary canvas + stage ----------------------------------------
  const secondaryCanvas = createSecondaryCanvas()
  document.body.appendChild(secondaryCanvas)

  const ZONE_RECT = { x: 20, y: -40, width: 70, height: 80 }
  const PACKET_HOME = { x: -70, y: 0 }

  let secondaryStage: Stage | null = null
  let secondaryHero: ShapeNode | null = null
  let secondaryEmitter: ParticleEmitterNode | null = null
  let packet: ShapeNode | null = null
  let packetDragOffset = { x: 0, y: 0 }
  let packetDragging = false
  let unsubStagePointerDown: (() => void) | null = null

  const buildSecondary = (): void => {
    secondaryStage = engine.attachStage(secondaryCanvas, {
      name: 'Loss Card',
      initialViewport: { x: -120, y: -80, width: 240, height: 160 },
      interactive: true,
    })

    // Subscribe the stage-scoped counter, only fires for taps on THIS canvas.
    unsubStagePointerDown = secondaryStage.events.on('pointerDown', () => {
      stageDowns++
      console.log(
        `[demo-stages] stage.events pointerDown   →  engine=${engineDowns} stage=${stageDowns}`,
      )
    })

    // Background hero (existing behavior, proves shared clock).
    secondaryHero = new ShapeNode({
      id: 'secondary-hero',
      geometry: { kind: 'circle', radius: 14 },
      fill: '#ffd34d',
      stroke: '#fdf6e3',
      lineWidth: 2,
    })
    secondaryHero.transform.y = -40
    secondaryStage.scene.root.add(secondaryHero)

    // Trail emitter tracks the background hero every frame.
    secondaryEmitter = new ParticleEmitterNode({
      config: {
        capacity: 200,
        ratePerSec: 40,
        lifetimeSec: [0.5, 1.0],
        speedWorld: [4, 10],
        spreadRad: Math.PI * 2,
        sizeWorld: [3, 6],
        palette: ['#ffd34d', '#ff8f6b'],
        dampingPerSec: 2.5,
        alphaOverLife: [1, 0],
      },
    })
    secondaryStage.scene.root.add(secondaryEmitter)

    // Target zone, dashed rectangle. Not hit-enabled; the drop test is a
    // point-in-rect check on release.
    const zone = new ShapeNode({
      id: 'zone',
      geometry: {
        kind: 'rect',
        width: ZONE_RECT.width,
        height: ZONE_RECT.height,
      },
      fill: 'rgba(74, 222, 128, 0.15)',
      stroke: 'rgba(74, 222, 128, 0.7)',
      lineWidth: 1.5,
    })
    zone.transform.x = ZONE_RECT.x + ZONE_RECT.width / 2
    zone.transform.y = ZONE_RECT.y + ZONE_RECT.height / 2
    zone.transform.originX = ZONE_RECT.width / 2
    zone.transform.originY = ZONE_RECT.height / 2
    secondaryStage.scene.root.add(zone)

    // Draggable "data packet", the actual tutorial element.
    packet = new ShapeNode({
      id: 'packet',
      geometry: { kind: 'circle', radius: 14 },
      fill: '#c084fc',
      stroke: '#fdf6e3',
      lineWidth: 2,
    })
    packet.hitEnabled = true
    packet.transform.x = PACKET_HOME.x
    packet.transform.y = PACKET_HOME.y
    packet.onPointerDown = onPacketDown
    packet.onPointerMove = onPacketMove
    packet.onPointerUp = onPacketUp
    packet.onPointerCancel = onPacketCancel
    secondaryStage.scene.root.add(packet)
  }

  function onPacketDown(e: PointerEvent2D): void {
    if (!packet) return
    packetDragging = true
    // Anchor offset so the packet doesn't jump to the finger's center on grab.
    packetDragOffset = {
      x: packet.transform.x - e.pointer.world.x,
      y: packet.transform.y - e.pointer.world.y,
    }
    // Cancel any in-flight ease-back so drag wins immediately.
    engine.animation.cancelAll()
    void runSharedTween() // relaunch bg tween, cancelAll killed it too
  }
  function onPacketMove(e: PointerEvent2D): void {
    if (!packet || !packetDragging) return
    packet.transform.x = e.pointer.world.x + packetDragOffset.x
    packet.transform.y = e.pointer.world.y + packetDragOffset.y
  }
  function onPacketUp(): void {
    if (!packet) return
    packetDragging = false
    const inZone =
      packet.transform.x >= ZONE_RECT.x &&
      packet.transform.x <= ZONE_RECT.x + ZONE_RECT.width &&
      packet.transform.y >= ZONE_RECT.y &&
      packet.transform.y <= ZONE_RECT.y + ZONE_RECT.height
    if (inZone) {
      // Success: burst particles at the drop point and reset after a beat.
      secondaryEmitter?.emitter.burst(
        60,
        packet.transform.x,
        packet.transform.y,
      )
      void engine
        .wait(0.35, packet.abortSignal)
        .then(() => easePacketHome())
        .catch(ignoreAbort)
    } else {
      easePacketHome()
    }
  }
  function onPacketCancel(): void {
    packetDragging = false
    easePacketHome()
  }
  function easePacketHome(): void {
    if (!packet) return
    engine
      .tween(
        packet.transform,
        { x: PACKET_HOME.x, y: PACKET_HOME.y },
        { duration: 0.35, easing: outCubic, signal: packet.abortSignal },
      )
      .catch(ignoreAbort)
  }

  buildSecondary()

  // --- Shared clock tween on both heroes -------------------------------
  const runSharedTween = async (): Promise<void> => {
    try {
      primaryHero.transform.x = -700
      if (secondaryHero) secondaryHero.transform.x = -100
      const kick = async (): Promise<void> => {
        await Promise.all([
          engine
            .tween(
              primaryHero.transform,
              { x: 700 },
              {
                duration: 2,
                easing: inOutQuad,
                signal: primaryHero.abortSignal,
              },
            )
            .catch(ignoreAbort),
          secondaryHero
            ? engine
                .tween(
                  secondaryHero.transform,
                  { x: 100 },
                  {
                    duration: 2,
                    easing: inOutQuad,
                    signal: secondaryHero.abortSignal,
                  },
                )
                .catch(ignoreAbort)
            : Promise.resolve(),
        ])
        await Promise.all([
          engine
            .tween(
              primaryHero.transform,
              { x: -700 },
              {
                duration: 2,
                easing: inOutQuad,
                signal: primaryHero.abortSignal,
              },
            )
            .catch(ignoreAbort),
          secondaryHero
            ? engine
                .tween(
                  secondaryHero.transform,
                  { x: -100 },
                  {
                    duration: 2,
                    easing: inOutQuad,
                    signal: secondaryHero.abortSignal,
                  },
                )
                .catch(ignoreAbort)
            : Promise.resolve(),
        ])
      }
      while (!primaryHero.isDestroyed) {
        await kick()
      }
    } catch (err) {
      ignoreAbort(err)
    }
  }
  void runSharedTween()

  // Secondary emitter follows its background hero every frame.
  const offFrame = engine.ticker.onFrame(() => {
    if (secondaryHero && secondaryEmitter) {
      secondaryEmitter.emitter.setOrigin(
        secondaryHero.transform.x,
        secondaryHero.transform.y,
      )
    }
  })

  const onKey = (e: KeyboardEvent): void => {
    const target = e.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      return
    }
    if (e.code === 'Space') {
      e.preventDefault()
      if (secondaryStage) {
        console.info('[demo-stages] detaching secondary stage')
        unsubStagePointerDown?.()
        unsubStagePointerDown = null
        engine.detachStage(secondaryStage)
        secondaryStage = null
        secondaryHero = null
        secondaryEmitter = null
        packet = null
      } else {
        console.info('[demo-stages] re-attaching secondary stage')
        buildSecondary()
      }
    } else if (e.code === 'KeyR') {
      engine.animation.cancelAll()
      void runSharedTween()
    }
  }
  window.addEventListener('keydown', onKey)

  const stop = (): void => {
    offFrame()
    window.removeEventListener('keydown', onKey)
    unsubStagePointerDown?.()
    host.destroy()
    if (secondaryCanvas.parentElement) {
      secondaryCanvas.parentElement.removeChild(secondaryCanvas)
    }
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

function createSecondaryCanvas(): HTMLCanvasElement {
  const el = document.createElement('canvas')
  Object.assign(el.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    width: '30%',
    height: '30%',
    background: '#1a1f2e',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    zIndex: '100',
    // The Stage sets touch-action / user-select on the element; we let the
    // canvas receive pointer events now that it's interactive.
  } satisfies Partial<CSSStyleDeclaration>)
  return el
}

export default runDemo
