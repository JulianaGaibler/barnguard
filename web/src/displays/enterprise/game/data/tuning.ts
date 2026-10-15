/**
 * Gameplay pacing / feel constants, centralised for playtesting. World-space
 * distances are in map units. Every map loads at the scale that makes them read
 * the same size on screen (see `maps/playScale`), and Germany is 661 × 888.
 */
export const TUNING = {
  packet: {
    /** Hexagon inradius in world units, the visible size. */
    radius: 8,
    /**
     * Extra hit-target padding beyond `radius`. ~4.5 mm at kiosk fit scale.
     * Sized for a finger, so it scales with `maps/playScale`'s
     * `PLAY_VIEW_HEIGHT` to keep that physical size.
     */
    hitPadding: 22.5,
    /** Duration of the scale 0 -> 1 grow before travel starts. */
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
      /** 1 -> scaleTo grow phase (seconds). */
      upSec: 0.05,
      /** ScaleTo -> 1 settle phase (seconds). */
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
    /**
     * Comet tail behind each travelling packet: a halo hex around the packet
     * that stretches back along its recent path. Colours follow the data-comet
     * artwork.
     */
    trail: {
      /** Ring-buffer capacity (samples). */
      sampleCapacity: 18,
      /**
       * Minimum world dist between samples. Below this, `sample()` is a no-op
       * so a stationary packet doesn't overwrite history with duplicates.
       * `sampleCapacity × minSampleDistWorld` is the full tail length, about
       * nine packet radii.
       */
      minSampleDistWorld: 4,
      /**
       * Radius of the halo hex at the head as a multiple of `packet.radius`.
       * The tail starts as wide as this hex and tapers to a point.
       */
      glowScale: 1.45,
      /** Fill ramp, head to tail. */
      fillStops: [
        { offset: 0, color: '#FD7444' },
        { offset: 0.5, color: '#FEAE51' },
        { offset: 1, color: 'rgba(255, 221, 171, 0)' },
      ],
      /** Outline ramp, head to tail. */
      strokeStops: [
        { offset: 0.317, color: '#FD4444' },
        { offset: 1, color: 'rgba(255, 221, 171, 0)' },
      ],
      /** Outline width (world units). */
      strokeWidthWorld: 1.2,
      /**
       * How sharply the tail may bend (radians per world unit). It starts at
       * `bendHeadRadPerWorld` and loosens with the square of the distance along
       * the tail to `bendTipRadPerWorld` at `stiffLengthWorld`, staying there
       * for the rest. So the first stretch keeps its shape behind the packet
       * and the rest follows the path freely.
       */
      bendHeadRadPerWorld: 0.02,
      bendTipRadPerWorld: 0.6,
      stiffLengthWorld: 16,
    },
    /**
     * Subtler second trail: white hexagons dropped in the packet's wake,
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
       * the wake distance matches the comet tail.
       */
      dampingPerSec: 5,
      /** Alpha over life, spawn opaque, fade to zero. */
      alphaOverLife: [1, 0] as readonly [number, number],
      /** Scale over life, hexes shrink to a remnant while fading. */
      scaleOverLife: [1, 0.25] as readonly [number, number],
      color: '#ffffff',
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
       * Fraction of life spent ramping alpha 0 -> 1. After this, quick-fades to
       * 0 for the remainder.
       */
      alphaGrowFraction: 0.72,
      /** Matches `spawnPulse` so the ring reads as the same object. */
      color: '#7543E3',
    },
    /**
     * Emergence pulse fired when grow-in completes. Big translucent hex scales
     * up and fades out, same visual grammar as `lossAnim.impactFlash`.
     */
    spawnPulse: {
      /** Total duration (seconds). */
      durationSec: 0.55,
      /** Scale at t=0 -> t=1. */
      scaleFrom: 0.6,
      scaleTo: 4.0,
      /** Alpha at t=0. Fades to 0 over `durationSec`. */
      alphaFrom: 0.45,
      /** Base hex radius (world units). */
      worldRadius: 14,
      /** The epicenter's colour, so new packets read as part of the system. */
      color: '#7543E3',
    },
  },
  difficulty: {
    // Speed mix: every packet travels at one of three discrete tiers. Mixed
    // speeds are the difficulty knob, since a packet at another speed must be
    // routed around rather than alongside. Tiers unlock with the score, and
    // regular keeps whatever share the unlocked tiers leave.
    /** Regular travel speed (wu/s). Every spawn is regular until slow unlocks. */
    regularSpeedWorld: 75,
    /**
     * Slow packets travel at 40 % of regular, behind enough to require routing
     * without reading as stalled. Their share of the board grows per point past
     * `unlockScore`.
     */
    slow: {
      speedFactor: 0.4,
      unlockScore: 3,
      shareStart: 0.15,
      shareGrowthPerPoint: 0.02,
      shareCap: 0.4,
    },
    /**
     * Medium packets sit between slow and regular, close enough to regular that
     * timing a path around one is hard. Kept a small, fixed share.
     */
    medium: {
      speedFactor: 0.7,
      unlockScore: 15,
      share: 0.12,
    },
    /**
     * How strongly a tier's chance follows its shortfall on the board. At 0
     * every spawn rolls the target shares. At 1.5 a tier holding 0.1 more of
     * the board than its share has its chance cut by 0.15.
     */
    mixBiasGain: 1.5,
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
    /** Positions tried per spawn slot. Each is tried with every heading. */
    maxRetries: 20,
    /**
     * Spacing of the grid of spawnable points, built once per view. The spacing
     * widens past `gridMaxCells` so a wide view stays cheap to scan.
     */
    gridStepWorld: 8,
    gridMaxCells: 20000,
    /**
     * Ample-runway probe for the initial heading. `probeRunway` sweeps the
     * candidate ray in small steps up to this distance, tracking how long it
     * stays inside the mask. A full sweep with a clear path is accepted
     * immediately. Bump higher if late-round wall crashes feel unfair.
     */
    initialHeadingProbeWorld: 250,
    /** Step size for the ray sweep. Smaller = finer but more mask samples. */
    initialHeadingProbeStepWorld: 12,
    /**
     * Border clearance the sweep enforces. Larger = safer but harder to find
     * headings in cramped spots like the Baltic coast.
     */
    initialHeadingClearInsetWorld: 20,
    /** Random headings tried per position. */
    initialHeadingMaxTries: 32,
    /**
     * Trajectory check for each spawn candidate. Every live packet's path and
     * the candidate's are predicted over `horizonSec`, and the candidate must
     * stay `collision.pairThresholdWorld + marginWorld` from each at every
     * step. When no candidate passes, the one with the most separation spawns.
     */
    safety: {
      horizonSec: 6,
      /**
       * Two packets close at most twice the regular speed, so a pass-through
       * between steps is caught while `stepSec × 2 × regularSpeedWorld` stays
       * under `pairThresholdWorld + marginWorld`.
       */
      stepSec: 0.1,
      marginWorld: 35,
    },
  },
  epicenter: {
    /**
     * Capture radius. Packet must be inside AND heading into the cone. The
     * drawn trail no longer has to terminate at the apex.
     */
    captureRadius: 20,
    /** Visual outer bound of the cone / pulse. */
    visualRadius: 22,
    /**
     * Cone geometry. Apex at the state capital, axis points toward Germany's
     * geographic centre, wedge opens in that direction.
     */
    coneSweepRad: Math.PI / 3, // 60°
    coneRadiusWorld: 60,
    /**
     * Angular slack beyond ±(coneSweep / 2) that still counts as valid.
     * Approaches outside this band get auto-routed via two inserted waypoints
     * (entry point + apex) so the packet U-turns into the cone.
     */
    approachForgivenessRad: (Math.PI * 3) / 40, // 13.5°
    /**
     * The cone drawn as a field of dots that shrink away from the apex, with a
     * wave pulsing inward through them to show where to drag.
     */
    dots: {
      /** Lattice pitch (world units). */
      pitchWorld: 4,
      /** Largest resting dot, next to the apex, as a fraction of the pitch. */
      dotMax: 0.4,
      /**
       * Resting dot at the cone's far end as a fraction of `dotMax`. Below 0
       * the outer dots rest at nothing and only show while a crest passes.
       */
      minFrac: -0.4,
      /** Radius around the apex left free for the logo (world units). */
      innerRadiusWorld: 11,
      /** Distance between wave crests (world units). */
      wavelengthWorld: 60,
      /** How much a crest enlarges a dot, `1` doubles it. */
      waveAmp: 0.8,
      /**
       * Size a crest adds to every dot as a fraction of `dotMax`, so dots that
       * rest at nothing still light up as it passes.
       */
      waveFloor: 1.1,
      /**
       * Soft cap on a dot's diameter as a fraction of the pitch. Sizes ease
       * into it, so small dots keep growing almost linearly with the wave while
       * the largest level off short of touching. Keep it below 1.
       */
      ceiling: 0.8,
      /**
       * Width of the two lines marking the cone's edges, in CSS pixels. They
       * fade from full opacity at the logo to nothing at the cone's end.
       */
      edgeLineWidthPx: 1.5,
      /** Crest sharpness, higher gives a narrower band of grown dots. */
      waveSharpness: 3,
      /** Seconds for a crest to travel one wavelength toward the apex. */
      wavePeriodSec: 2.6,
      color: '#7543E3',
      /** Opacity of a dot. */
      alpha: 1,
    },
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
     * exceed the ripple's wall-clock duration or the "unify state colors" tween
     * lands mid-ripple over a splotchy map.
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
      /** Diameter of a fully grown dot as a fraction of its cell. */
      dotSize: 0.7,
    },
    pulse: {
      /** Wave speed. 400 wu/s covers Germany's 888 wu height in ~2.2 s. */
      propagationSpeedWorld: 400,
      /** Rise on each cell. */
      riseSec: 0.12,
      /** Fall on each cell. */
      fallSec: 0.5,
      /** Dot size a pulse reaches at its peak, where `1` is a full dot. */
      peakScale: 1,
      /** Opacity of a pulse dot. */
      dotAlpha: 0.55,
      /** Dot color. */
      color: '#15141A',
      /** Max concurrent pulses. Extras overwrite the oldest. */
      maxConcurrent: 4,
    },
    warn: {
      /** Dot color. */
      color: '#15141A',
      /** Mask inset for danger 1.0 (very close to border). */
      insetNearWorld: 22,
      /** Mask inset for danger 0.5 (getting close). */
      insetFarWorld: 48,
      /** Two packets closer than this ramp pair-danger 0 -> 1. */
      pairRadiusWorld: 55,
      /**
       * How far a packet's warn contribution spreads. Dot size falls linearly
       * with distance to the cell centroid.
       */
      spreadRadiusWorld: 70,
      /**
       * Ceiling on a warn dot's size, where `1` is a full dot. Every
       * contribution is scaled by this before max-blending in.
       */
      peakScale: 1,
      /** Opacity of a warn dot. */
      dotAlpha: 0.8,
      /** Warn integrator response rate. 8 -> ~125 ms to reach 63 % of a step. */
      smoothingRatePerSec: 8,
    },
  },
  lossAnim: {
    /**
     * Grace between collision and the game-over card sliding in. Session flips
     * to `'gameOver'` immediately (spawning + physics halt) but the outward
     * event fires only after this so the player sees the impact flash, debris,
     * and shockwave settle first.
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
     * max dim equals `worldSize`, then this tweens scale from `scaleFrom` ->
     * `scaleTo` in parallel with alpha 1 -> 0.
     */
    impactFlash: {
      durationSec: 0.25,
      scaleFrom: 0.5,
      scaleTo: 1.7,
      worldSize: 130,
      color: '#ffffff',
    },
    /**
     * Debris ring: orange triangles + lines that fly outward, decelerate under
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
       * distances span ~30 -> ~45 world units.
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
      /** Each piece picks one at random. */
      colors: ['#FE9F4E', '#FFC781'],
    },
    /**
     * Border-breach variant. Lines only, cone fired along exit velocity,
     * colored to match the country outline so pieces read as broken border.
     */
    borderBreach: {
      count: 24,
      triangleFraction: 0,
      /**
       * Wide range so pieces settle at clearly different distances. Under
       * `dampingPerSec: 4`, travelled distance ≈ speed / damping, giving ~14 ->
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
      /** Country-outline color, reads as border shrapnel. */
      color: '#fdf6e3',
    },
  },
} as const
