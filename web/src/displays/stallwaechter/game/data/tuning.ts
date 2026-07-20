/**
 * Gameplay pacing / feel constants, centralised for playtesting. World-space
 * distances are in SVG-viewBox units (Germany is 661 × 888).
 */
export const TUNING = {
  packet: {
    /** Hexagon inradius in world units, the visible size. */
    radius: 8,
    /** Extra hit-target padding beyond `radius`. ~4.5 mm at kiosk fit scale. */
    hitPadding: 18,
    /** Duration of the scale 0 → 1 grow before travel starts. */
    spawnGrowSec: 1.0,
    /**
     * Delay before the grow tween starts. `spawnBurst` particles are already
     * streaming inward, so a positive value here reads as "energy gathers, THEN
     * forms into a packet".
     */
    preGrowDelaySec: 0.5,
    /**
     * Quick scale pop on pointerdown so the hex reacts before the finger starts
     * producing path samples. Total = `upSec + downSec`, kept short so drawing
     * feels immediate.
     */
    pressFeedback: {
      /** Peak scale multiplier at the top of the pop. */
      scaleTo: 1.4,
      /** 1 → scaleTo grow phase (seconds). */
      upSec: 0.05,
      /** ScaleTo → 1 settle phase (seconds). */
      downSec: 0.25,
    },
    /** Time to accelerate from stationary to current travel speed. */
    accelToSpeedSec: 0.35,
    /**
     * Max steering turn rate. At regular speed (~75 wu/s) the minimum turn
     * radius is ~9 wu, tight enough for finger drawing without pinning the
     * packet to the epicenter on hard turns.
     */
    turnRateRadPerSec: 8,
    /**
     * Waypoint consume radius. Larger than the visual radius so a packet that
     * curves past its target still counts as reached, prevents endless orbits.
     */
    consumeRadius: 12,
    /** Shooting-star ribbon behind each travelling packet. */
    trail: {
      /** Ring-buffer capacity (samples). */
      sampleCapacity: 22,
      /**
       * Minimum world dist between samples. Below this, `sample()` is a no-op
       * so a stationary packet doesn't overwrite history with duplicates.
       */
      minSampleDistWorld: 4,
      /**
       * Half-width at the head (world units). Flush with the packet's visible
       * radius so the trail attaches to the back edge.
       */
      halfWidthWorld: 6,
      /** Opaque near head, fades to transparent at the tail via linear grad. */
      color: '#2E1CFF',
    },
    /**
     * Subtler second trail: pink hexagons dropped in the packet's wake,
     * decaying over their short lifespan.
     */
    hexParticles: {
      /** Max simultaneous alive hexes. */
      capacity: 40,
      /** Spawn rate while travelling (hex/s). */
      ratePerSec: 10,
      /** Per-hex lifespan range (seconds). */
      lifetimeSec: [0.8, 1.3] as readonly [number, number],
      /** Per-hex radius range (world units). */
      sizeWorld: [3, 5] as readonly [number, number],
      /**
       * Fallback speed. `PacketBehavior` overrides each fixed step to match the
       * packet's live velocity so spawned hexes peel off with the packet.
       */
      speedWorld: [40, 40] as readonly [number, number],
      /** Cone half-angle around velocity direction. */
      spreadRad: Math.PI * 0.12,
      /**
       * Exponential drag. A hex at packet speed decays to ~5 % within ~0.6 s so
       * the wake distance matches the shooting-star ribbon.
       */
      dampingPerSec: 5,
      /** Alpha over life, spawn opaque, fade to zero. */
      alphaOverLife: [1, 0] as readonly [number, number],
      /** Scale over life, hexes shrink to a remnant while fading. */
      scaleOverLife: [1, 0.25] as readonly [number, number],
      /** Matches the packet's stroke. */
      color: '#D84EFF',
    },
    /**
     * Grow-in emitter: hex particles spawn on a ring around the spawn point,
     * ease inward while ramping alpha up, then quick-fade partway between the
     * ring and centre. Reads as the packet being "assembled" from converging
     * energy.
     */
    spawnBurst: {
      /** Particles per second while active. */
      ratePerSec: 32,
      /**
       * How long the emitter spawns, measured from packet creation. Extends
       * past `preGrowDelaySec` into the grow tween, stops before it completes
       * so the emergence pulse fires into a stream already winding down.
       */
      spawnDurationSec: 1.2,
      /** Per-particle lifespan (seconds). */
      particleLifetimeSec: 0.55,
      /** Emitter ring radius (world units). */
      ringRadiusWorld: 26,
      /**
       * Where the particle dies as a fraction of `ringRadiusWorld`. `0.18`
       * kills it before reaching the centre so the grow tween owns the middle
       * of the animation.
       */
      radiusEndFraction: 0.18,
      /** Peak world size at end of life. Particles start at scale 0. */
      sizeMaxWorld: 2.7,
      /**
       * Fraction of life spent ramping alpha 0 → 1. After this, quick-fades to
       * 0 for the remainder.
       */
      alphaGrowFraction: 0.72,
      /** Matches packet stroke so the ring reads as the same object. */
      color: '#D84EFF',
    },
    /**
     * Emergence pulse fired when grow-in completes. Big translucent hex scales
     * up and fades out, same visual grammar as `lossAnim.impactFlash`.
     */
    spawnPulse: {
      /** Total duration (seconds). */
      durationSec: 0.55,
      /** Scale at t=0 → t=1. */
      scaleFrom: 0.6,
      scaleTo: 4.0,
      /** Alpha at t=0. Fades to 0 over `durationSec`. */
      alphaFrom: 0.45,
      /** Base hex radius (world units). */
      worldRadius: 14,
      /** Matches the shooting-star trail. */
      color: '#2E1CFF',
    },
  },
  difficulty: {
    // Speed mix: every packet is EITHER regular OR slow (two discrete tiers).
    // Slow packets are the difficulty knob, they hang around long enough that
    // regulars must route around them. Slow share grows over the round but
    // caps below 50 % so regulars always dominate.
    /** Regular travel speed (wu/s). First spawn is always regular. */
    regularSpeedWorld: 75,
    /**
     * Slow packets travel at this fraction of regular. 40 % is behind enough to
     * require routing without reading as stalled.
     */
    slowSpeedFactor: 0.4,
    /**
     * Chance a new spawn rolls slow. Starts at `slowChanceStart`, grows by
     * `slowChanceGrowthPer` per spawn, caps at `slowChanceCap`.
     */
    slowChanceStart: 0,
    slowChanceGrowthPer: 0.03,
    slowChanceCap: 0.45,
    // Cadence
    /** First interval after `spawn.firstDelaySec`. */
    startIntervalSec: 2.8,
    /** Floor on the inter-spawn interval. */
    intervalFloorSec: 2.5,
    /** Interval *= this per spawn. Settles around spawn 6 with current bounds. */
    intervalDecayPer: 0.98,
  },
  spawn: {
    /** Delay from `roundStarted` to the first spawn. */
    firstDelaySec: 1.5,
    /**
     * Rejection-sampling constraints. Reroll any candidate that fails:
     *
     * - Too close to border (mask.contains fails at `minDistFromBorderWorld`)
     * - Too close to epicenter
     * - Within `pairThreshold + minDistFromPacketWorld` of an active packet
     */
    minDistFromEpicenterWorld: 220,
    minDistFromBorderWorld: 45,
    /**
     * Buffer around each active packet at spawn-sample time. Added on top of
     * `collision.pairThresholdWorld`. Sized so a fast packet (~220 wu/s)
     * doesn't run over an emerging hex during its `preGrowDelaySec`.
     */
    minDistFromPacketWorld: 90,
    /** Retries per spawn slot before skipping. */
    maxRetries: 20,
    /**
     * Ample-runway probe for the initial heading. `pickInitialHeading` sweeps
     * the candidate ray in small steps up to this distance, tracking how long
     * it stays inside the mask. Longest surviving ray wins, a full sweep is
     * accepted immediately. Bump higher if late-round wall crashes feel
     * unfair.
     */
    initialHeadingProbeWorld: 250,
    /** Step size for the ray sweep. Smaller = finer but more mask samples. */
    initialHeadingProbeStepWorld: 12,
    /**
     * Border clearance the sweep enforces. Larger = safer but harder to find
     * headings in cramped spots like the Baltic coast.
     */
    initialHeadingClearInsetWorld: 20,
    /** Random headings to try before falling back to the deepest so far. */
    initialHeadingMaxTries: 32,
  },
  epicenter: {
    /**
     * Capture radius. Packet must be inside AND heading into the cone. The
     * drawn trail no longer has to terminate at the apex.
     */
    captureRadius: 20,
    /** Visual outer bound of the cone / pulse. */
    visualRadius: 22,
    /** Breathing pulse period on the outer ring alpha. */
    pulsePeriodSec: 2.1,
    /**
     * Cone geometry. Apex at the state capital, axis points toward Germany's
     * geographic centre, wedge opens in that direction.
     */
    coneSweepRad: Math.PI / 3, // 60°
    coneRadiusWorld: 40,
    /**
     * Angular slack beyond ±(coneSweep / 2) that still counts as valid.
     * Approaches outside this band get auto-routed via two inserted waypoints
     * (entry point + apex) so the packet U-turns into the cone.
     */
    approachForgivenessRad: (Math.PI * 3) / 40, // 13.5°
  },
  path: {
    /**
     * `PolylineNode.pushIfFar` threshold. Above `consumeRadius` so the packet
     * doesn't skip queued points, tight enough that the curve reads smooth.
     */
    minPointDistWorld: 10,
    /** Drawing inside this radius snaps the polyline to the epicenter centre. */
    snapRadiusWorld: 55,
    /** How long a consumed segment lingers. Short so the tail feels snappy. */
    fadeSec: 0.3,
  },
  borderTurnaround: {
    /**
     * Angular velocity applied when the packet hits the viewport edge inside
     * Germany. Higher = sharper turn.
     */
    steerRad: Math.PI / 6,
    angularVelRadPerSec: Math.PI * 1.4,
    /** Viewport-edge buffer, start steering this early. */
    edgeBufferWorld: 12,
  },
  collision: {
    /**
     * Center-to-center collision distance. Slightly under `2 × packet.radius`
     * so contact requires real overlap, not touching edges.
     */
    pairThresholdWorld: 11,
  },
  /**
   * BFS ripple through the states from an origin. Fired on selection,
   * collision, and border breach. Each state rises over `riseSec`, falls over
   * `fallSec`, staggered by `delayPerLayerSec` per BFS depth.
   */
  stateRipple: {
    /** Delay between BFS layers. Origin fires at t=0. */
    delayPerLayerSec: 0.1,
    /** Fade-in on each state. */
    riseSec: 0.1,
    /** Fade-out on each state. */
    fallSec: 0.5,
    /** Peak alpha of the overlay. */
    peakAlpha: 0.1,
    /**
     * Overlay fill. Bright / warm so the ripple reads against dim state fills
     * without shifting toward game-over red.
     */
    color: '#fdf6e3',
    /**
     * Delay after `endRound` before the session clears its highlight. Must
     * exceed the ripple's wall-clock duration or the "unify state colours"
     * tween lands mid-ripple over a splotchy map.
     */
    settleClearDelaySec: 1.3,
  },
  /**
   * Grid overlay clipped to Germany. Owns each cell's alpha buffer and hosts
   * two effects:
   *
   * - Pulse, event-driven ripple that spreads outward from a world point.
   * - Warn, continuous yellow tint on cells near a packet in danger.
   */
  wahlkreise: {
    grid: {
      /**
       * Cell edge length. `12` gives ~2600 cells inside Germany after outline
       * filtering. Smaller cells push the LIT-cell count under a full pulse
       * into thousands of state changes per frame on the kiosk.
       */
      cellSizeWorld: 12,
    },
    pulse: {
      /** Wave speed. 400 wu/s covers Germany's 888 wu height in ~2.2 s. */
      propagationSpeedWorld: 400,
      /** Rise on each cell. */
      riseSec: 0.12,
      /** Fall on each cell. */
      fallSec: 0.5,
      /** Peak alpha per cell. */
      peakAlpha: 0.275,
      /** Warm cream, reads against dim state fills without clashing with red. */
      color: '#fdf6e3',
      /** Max concurrent pulses. Extras overwrite the oldest. */
      maxConcurrent: 4,
    },
    warn: {
      /** Yellow tint colour. */
      color: '#f2c94c',
      /** Mask inset for danger 1.0 (very close to border). */
      insetNearWorld: 22,
      /** Mask inset for danger 0.5 (getting close). */
      insetFarWorld: 48,
      /** Two packets closer than this ramp pair-danger 0 → 1. */
      pairRadiusWorld: 55,
      /**
       * How far a packet's warn contribution spreads. Alpha falls linearly with
       * distance to the cell centroid.
       */
      spreadRadiusWorld: 70,
      /**
       * Ceiling on final warn alpha per cell. Every contribution is scaled by
       * this before max-blending in.
       */
      peakAlpha: 0.5,
      /** Warn integrator response rate. 8 → ~125 ms to reach 63 % of a step. */
      smoothingRatePerSec: 8,
    },
  },
  lossAnim: {
    /**
     * Grace between collision and the game-over card sliding in. Session flips
     * to `'gameOver'` immediately (spawning + physics halt) but the outward
     * event fires only after this so the player sees the impact flash + debris
     *
     * - Shockwave settle first.
     */
    endScreenGraceSec: 3,
    /** Delay between adjacency layers in the shockwave pulse. */
    shockwaveStageDelaySec: 0.11,
    /** Duration of a single state's alpha pulse. */
    shockwaveDurationSec: 0.55,
    /** BFS depth cap for shockwave propagation. */
    shockwaveDepth: 3,
    /**
     * White sparkle-star at the collision point. SVG pre-scaled at load so its
     * max dim equals `worldSize`, then this tweens scale from `scaleFrom` →
     * `scaleTo` in parallel with alpha 1 → 0.
     */
    impactFlash: {
      durationSec: 0.25,
      scaleFrom: 0.5,
      scaleTo: 1.7,
      worldSize: 130,
      color: '#ffffff',
    },
    /**
     * Debris ring: magenta triangles + lines that fly outward, decelerate under
     * drag, settle into a permanent ring with slow residual rotation. Never
     * self-destroys, cleared by `session.reset()`.
     */
    debris: {
      /** Total pieces. */
      count: 20,
      /** Fraction rendered as triangles (rest are lines). */
      triangleFraction: 0.35,
      /**
       * Random outward speed range. Under `dampingPerSec: 4.4`, settle
       * distances span ~30 → ~45 world units.
       */
      initialSpeedWorld: [130, 200] as readonly [number, number],
      /** Translational drag. Pieces coast noticeably before settling. */
      dampingPerSec: 4.4,
      /**
       * Evenly-spaced angular slots (with jitter) instead of pure random. No
       * clumps, no visible gaps.
       */
      equidistantEmission: true,
      /**
       * Transient spin range at spawn. Decays exponentially at
       * `angInitialDampingPerSec`, then combines with `angBaseAbsRadPerSec`.
       */
      angInitialRadPerSec: [-9, 9] as readonly [number, number],
      /** Damping of the transient spin. */
      angInitialDampingPerSec: 3.5,
      /** Permanent slow spin. Magnitude range with random ± sign per piece. */
      angBaseAbsRadPerSec: [0.2, 1.35] as readonly [number, number],
      /** Equilateral fill. */
      triangleSideWorld: 4,
      lineLengthWorld: 3,
      /** CSS px, screen-space scaled at draw. */
      lineWidthCssPx: 1.5,
      color: '#D84EFF',
    },
    /**
     * Border-breach variant. Lines only, cone fired along exit velocity,
     * coloured to match the country outline so pieces read as broken border.
     */
    borderBreach: {
      count: 24,
      triangleFraction: 0,
      /**
       * Wide range so pieces settle at clearly different distances. Under
       * `dampingPerSec: 4`, travelled distance ≈ speed / damping, giving ~14 →
       * ~54 wu spread.
       */
      initialSpeedWorld: [20, 280] as readonly [number, number],
      dampingPerSec: 4,
      /**
       * Cone half-angle around velocity direction. Broader than a tight
       * shrapnel cone so the breach reads as a real puncture.
       */
      emitSpreadRad: Math.PI * 0.2,
      /**
       * Wall-shard pose: each line launches perpendicular (90°) to its own
       * flight direction, as if broadside-shattered by a projectile.
       */
      initialAngleOffsetRad: Math.PI / 2,
      angInitialRadPerSec: [-5, 5] as readonly [number, number],
      angInitialDampingPerSec: 3,
      angBaseAbsRadPerSec: [0.08, 1.2] as readonly [number, number],
      /** Unused when triangleFraction is 0, but the type requires it. */
      triangleSideWorld: 0,
      lineLengthWorld: 2.8,
      lineWidthCssPx: 1.5,
      /** Country-outline colour, reads as border shrapnel. */
      color: '#fdf6e3',
    },
  },
} as const
