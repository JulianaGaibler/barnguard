import {
  SceneNode,
  ParticleEmitterNode,
  Path2DNode,
  easings,
  ignoreAbort,
  withAlpha,
  type EngineHost,
  type Vec2,
} from '@src/stargazer'
import { tessellateContours } from '@src/stargazer/assets/SvgPathContours'
import { registerPathTessellation } from '@src/stargazer/render/gfx/PathTessellationRegistry'
import { PacketNode } from './nodes/PacketNode'
import { PacketMotionTrailNode } from './nodes/PacketMotionTrailNode'
import { PacketSpawnConvergeNode } from './nodes/PacketSpawnConvergeNode'
import {
  PacketBehavior,
  type PacketSessionHooks,
} from './behaviors/PacketBehavior'
import {
  PathDrawBehavior,
  type PathDrawSessionHooks,
} from './behaviors/PathDrawBehavior'
import { TUNING } from './data/tuning'

export interface SpawnPacketOpts {
  host: EngineHost
  /** Where the packet's hex + trail + hex-particle emitter mount. */
  packetLayer: SceneNode
  /** Session-hook surface consumed by `PacketBehavior`. */
  hooks: PacketSessionHooks
  /** Session-hook surface consumed by `PathDrawBehavior`. */
  drawHooks: PathDrawSessionHooks
  /**
   * Unique-per-caller identifiers so the debug HUD's Scene panel stays
   * readable.
   */
  packetId: string
  hexParticleId: string
  /**
   * `false` disables auto-acceleration to `travelSpeed`. The packet sits at v=0
   * until the player draws a path, then follows the path exactly, and settles
   * back to v=0 whenever the path is fully consumed. Used by the tutorial
   * mini-stage; main game leaves this `true`.
   */
  autonomousDrift?: boolean
  /**
   * Fires when the packet's scene-graph `destroy` event runs, the helper uses
   * this internally to pair-destroy the motion trail + hex emitter, and the
   * caller can hook it to remove the packet from an `activePackets` array (main
   * game does; tutorial doesn't need to).
   */
  onDestroy?: (packet: PacketNode) => void
}

/**
 * Spawn one packet with the same visual and behavioral stack the live game
 * uses, hex node, shooting-star motion trail (`PacketMotionTrailNode`),
 * decaying-hex wake emitter, `PacketBehavior` (with configurable autonomous
 * drift), and, once travel-ready, `PathDrawBehavior` bound to the packet.
 *
 * Extracted from `session.ts::spawnPacket` so both the main `GameSession` and
 * the tutorial `TutorialSession` share one construction path, any visual or
 * dynamics tweak the main game gets carries over to the tutorial
 * automatically.
 *
 * The packet is added to `packetLayer` synchronously; the caller may push it
 * onto whatever active-packet list they keep. The returned reference stays
 * valid until its own `destroy` fires, subscribe via `onDestroy` for
 * bookkeeping.
 */
export function spawnPacketInSession(
  opts: SpawnPacketOpts,
  worldPos: Vec2,
  headingRad: number,
  travelSpeed: number,
): PacketNode {
  const {
    host,
    packetLayer,
    hooks,
    drawHooks,
    packetId,
    hexParticleId,
    autonomousDrift = true,
  } = opts

  const packet = new PacketNode({ id: packetId })
  packet.transform.x = worldPos.x
  packet.transform.y = worldPos.y
  // Pre-orient the hex to face its initial heading so the first physics
  // tick doesn't snap the visible rotation from 0. Mirrors the offset
  // `PacketBehavior.onFixedStep` applies (+π/2 so the hex's top vertex
  // aligns with the velocity vector).
  packet.transform.rotation = headingRad + Math.PI / 2
  // Start invisible, the convergent-particle emitter carries the visual
  // for the pre-grow phase; the hex only materialises once the grow tween
  // kicks in `preGrowDelaySec` later.
  packet.transform.scaleX = 0
  packet.transform.scaleY = 0

  // Shooting-star ribbon, added to the packet layer BEFORE the packet so
  // DFS draws it under the hex. Auto-destroyed with the packet below.
  const motionTrail = new PacketMotionTrailNode()
  packetLayer.add(motionTrail)

  // Wake of decaying magenta hexes, sits above the ribbon but under the
  // main packet. Origin is written per-frame from PacketBehavior so
  // hexes spawn at the packet's live position and stay in world space.
  // Constructed with `ratePerSec: 0` so no hexes emit during the packet's
  // grow-in animation (that would visibly leak hexes at the emitter's
  // default (0, 0) origin before `markTravelReady` flips it on). The
  // behavior restores the configured rate when travel begins.
  const hexCfg = TUNING.packet.hexParticles
  const hexParticles = new ParticleEmitterNode({
    id: hexParticleId,
    config: {
      capacity: hexCfg.capacity,
      ratePerSec: 0,
      lifetimeSec: hexCfg.lifetimeSec,
      sizeWorld: hexCfg.sizeWorld,
      speedWorld: hexCfg.speedWorld,
      spreadRad: hexCfg.spreadRad,
      // emitDirectionRad is set per-frame in PacketBehavior so the
      // wake fires opposite the current velocity; seed with 0 so the
      // config is valid until the first physics tick.
      emitDirectionRad: 0,
      palette: [hexCfg.color],
      spriteStyle: 'hexagon',
      blend: 'source-over',
      dampingPerSec: hexCfg.dampingPerSec,
      alphaOverLife: hexCfg.alphaOverLife,
      scaleOverLife: hexCfg.scaleOverLife,
    },
  })
  // Seed the origin at the spawn point so any pre-travel burst (there
  // shouldn't be any, but be defensive) still lands at the packet.
  hexParticles.emitter.setOrigin(worldPos.x, worldPos.y)
  packetLayer.add(hexParticles)

  packetLayer.add(packet)

  // Continuous convergent-particle emitter that plays alongside the grow-in
  // tween. Auto-destroys once emission ends and every live particle
  // finishes its own lifetime; no cleanup wiring needed.
  const spawnBurstCfg = TUNING.packet.spawnBurst
  const convergeNode = new PacketSpawnConvergeNode({
    center: worldPos,
    ratePerSec: spawnBurstCfg.ratePerSec,
    spawnDurationSec: spawnBurstCfg.spawnDurationSec,
    particleLifetimeSec: spawnBurstCfg.particleLifetimeSec,
    ringRadiusWorld: spawnBurstCfg.ringRadiusWorld,
    radiusEndFraction: spawnBurstCfg.radiusEndFraction,
    sizeMaxWorld: spawnBurstCfg.sizeMaxWorld,
    alphaGrowFraction: spawnBurstCfg.alphaGrowFraction,
    color: spawnBurstCfg.color,
  })
  packetLayer.add(convergeNode)

  const behavior = new PacketBehavior(hooks, headingRad, travelSpeed, {
    autonomousDrift,
  })
  packet.addBehavior(behavior)
  behavior.attachMotionTrail(motionTrail)
  behavior.attachHexParticles(hexParticles)

  // Wait for `preGrowDelaySec` so the convergent-particle emitter has a
  // head-start, then grow the packet in place, then flip to travelling mode.
  host.engine
    .wait(TUNING.packet.preGrowDelaySec, packet.abortSignal)
    .then(() => {
      if (packet.isDestroyed) return
      return packet.tween(
        { scaleX: 1, scaleY: 1 },
        {
          duration: TUNING.packet.spawnGrowSec,
          easing: easings.outCubic,
        },
      )
    })
    .then(() => {
      if (packet.isDestroyed) return
      behavior.markTravelReady()
      // Emergence pulse, big translucent hex that scales up and fades out
      // from the packet's spawn position, marking the transition into
      // travel mode. Same visual grammar as `lossAnim.impactFlash` but at
      // spawn instead of collision, and in the trail colour so the packet
      // reads as "arriving" from its own ribbon.
      spawnEmergencePulse(packetLayer, worldPos, packetId)
      // Attach the path-draw behavior only after travel starts, before
      // that, the packet has no meaningful "current world position" for
      // the player to grab.
      packet.addBehavior(new PathDrawBehavior(drawHooks))
    })
    .catch(ignoreAbort)

  // Pair-destroy the trail + hex-particle emitter with the packet so nothing
  // leaks after capture, exit, or a mid-round reset.
  const off = packet.events.on('destroy', () => {
    if (!motionTrail.isDestroyed) motionTrail.destroy()
    if (!hexParticles.isDestroyed) hexParticles.destroy()
    opts.onDestroy?.(packet)
    off()
  })

  // `host` is currently only used inside the closures above (via TUNING /
  // scene-attached tweens), but exposing it in `SpawnPacketOpts` keeps
  // future callers (e.g. tutorial variants that need `engine.wait`) from
  // having to plumb it separately.
  void host
  return packet
}

function spawnEmergencePulse(
  packetLayer: SceneNode,
  center: Vec2,
  packetId: string,
): void {
  const cfg = TUNING.packet.spawnPulse
  const pulse = new Path2DNode({
    id: `${packetId}-spawn-pulse`,
    path: buildHexagonPath(cfg.worldRadius),
    // Translucent to start, the pulse should read as a soft aura rather
    // than a solid overlay. Alpha then tweens to 0 over the duration.
    fill: withAlpha(cfg.color, cfg.alphaFrom),
    hitMode: 'none',
  })
  pulse.transform.x = center.x
  pulse.transform.y = center.y
  pulse.transform.scaleX = cfg.scaleFrom
  pulse.transform.scaleY = cfg.scaleFrom
  packetLayer.add(pulse)
  void pulse.autoDestroy(
    pulse.tween(
      { scaleX: cfg.scaleTo, scaleY: cfg.scaleTo, alpha: 0 },
      { duration: cfg.durationSec, easing: easings.outCubic },
    ),
  )
}

function buildHexagonPath(radius: number): Path2D {
  const p = new Path2D()
  const verts = new Float32Array(12)
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    const x = Math.cos(a) * radius
    const y = Math.sin(a) * radius
    verts[i * 2] = x
    verts[i * 2 + 1] = y
    if (i === 0) p.moveTo(x, y)
    else p.lineTo(x, y)
  }
  p.closePath()
  // Register a tessellation so `fillPath2D` renders under the GPU backend.
  // Canvas2D ignores the registry, so this is a no-op there.
  const contours = [verts]
  registerPathTessellation(p, tessellateContours(contours), contours)
  return p
}
