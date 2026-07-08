/**
 * Every gameplay-facing pacing / feel constant, in one place so playtesting can
 * twiddle without hunting. All world-space distances are in SVG-viewBox units
 * (Germany is 661 × 888).
 */
export const TUNING = {
  packet: {
    /** Hexagon "inradius" in world units, the visible size. */
    radius: 8,
    /**
     * Extra padding on the hit target beyond the visible radius. Keeps finger
     * targets generous on the 4K kiosk (~4.5 mm at fit scale).
     */
    hitPadding: 18,
    /** Duration of the scale 0 → 1 grow animation before travel starts. */
    spawnGrowSec: 1.0,
    /**
     * Delay between packet creation and the start of the scale grow tween. The
     * convergent-particle emitter (`spawnBurst`) begins immediately on
     * creation, so a positive `preGrowDelaySec` gives it a head-start. *
     * particles are already streaming inward before the hex begins to
     * materialise, reading as "energy gathers, THEN forms into a packet".
     */
    preGrowDelaySec: 0.5,
    /**
     * Two-phase scale pop played on every packet pointerdown, a quick "yes I
     * heard you" tactile bump so the player sees the hex react before their
     * finger starts producing path samples. Total wall- clock is `upSec +
     * downSec`, kept short so drawing feels immediate.
     */
    pressFeedback: {
      /** Peak scale multiplier at the top of the pop. */
      scaleTo: 1.4,
      /** Duration of the 1 → scaleTo grow phase (seconds). */
      upSec: 0.05,
      /** Duration of the scaleTo → 1 settle phase (seconds). */
      downSec: 0.25,
    },
    /** Time to accelerate from stationary to the current travel speed. */
    accelToSpeedSec: 0.35,
    /**
     * Maximum turn rate when steering along a drawn path. Caps how sharply the
     * packet can react to a new waypoint, sharp zig-zag inputs turn into tight
     * loops instead of instant reversals. At the mid-band starting speed (~62
     * wu/s) this gives a minimum turn radius of roughly `62 / 8 ≈ 8` world
     * units, comfortably tight for finger drawing without pinning the packet to
     * the epicenter on a hard turn.
     */
    turnRateRadPerSec: 8,
    /**
     * Consume-radius for waypoint hits. Larger than the visual radius so a
     * packet that curves past its target still counts as "reached" and moves on
     * to the next point, prevents endless orbits around a point the packet
     * can't quite tighten onto.
     */
    consumeRadius: 12,
    /** Shooting-star ribbon rendered behind each travelling packet. */
    trail: {
      /** Ring-buffer capacity, count of world-position samples retained. */
      sampleCapacity: 22,
      /**
       * Minimum distance between consecutive samples (world units). Below this,
       * `sample()` is a no-op so a stationary packet doesn't over- write its
       * history with duplicates.
       */
      minSampleDistWorld: 4,
      /**
       * Half-width of the ribbon at its head (world units). Sits flush with the
       * packet's visual `radius` (6) so the trail visually attaches to the
       * hex's back edge without over-outlining it.
       */
      halfWidthWorld: 6,
      /**
       * Trail fill colour, opaque near the head, fades to fully transparent at
       * the tail via a canvas linear gradient.
       */
      color: '#2E1CFF',
    },
    /**
     * A subtler second trail: small pink hexagons dropped in the packet's wake,
     * decaying over their short lifespan. Emitted from a per-packet
     * `ParticleEmitterNode` whose origin tracks the packet each frame.
     */
    hexParticles: {
      /** Maximum simultaneous alive hexes. */
      capacity: 40,
      /** Spawn rate, hexes per second while the packet is travelling. */
      ratePerSec: 10,
      /**
       * Per-hex lifespan range (seconds). Longer than the "hex reaches a near
       * stop under damping" time so the wake lingers as fading hexes sitting
       * behind the packet.
       */
      lifetimeSec: [0.8, 1.3] as readonly [number, number],
      /**
       * Per-hex radius range in world units, a touch larger than the earlier
       * baseline so the wake reads clearly against the ribbon, then shrunk to a
       * small remnant via `scaleOverLife` below.
       */
      sizeWorld: [3, 5] as readonly [number, number],
      /**
       * Fallback speed range; overridden each fixed step by `PacketBehaviour`
       * to match the packet's live velocity magnitude so a spawned hex "peels
       * off" moving with the packet before damping pulls it to rest.
       */
      speedWorld: [40, 40] as readonly [number, number],
      /**
       * Cone half-angle around the packet's velocity direction, tight so hexes
       * form a coherent stream instead of a spray.
       */
      spreadRad: Math.PI * 0.12,
      /**
       * Exponential drag, a hex at packet speed decays to ~5% within 0.6 s
       * (lifespan max), so the wake covers roughly the same distance as the
       * shooting-star ribbon before fading out.
       */
      dampingPerSec: 5,
      /** Alpha over life, spawn fully opaque, fade to zero. */
      alphaOverLife: [1, 0] as readonly [number, number],
      /**
       * Scale over life, hexes shrink to a small remnant while they fade,
       * compounding the visual "decay" alongside the alpha ramp.
       */
      scaleOverLife: [1, 0.25] as readonly [number, number],
      /** Palette, a single magenta so all wake hexes match the packet's stroke. */
      color: '#D84EFF',
    },
    /**
     * Continuous particle emitter that plays during the packet's grow-in
     * animation: individual hex particles spawn at random angles on a ring
     * around the spawn point at scale 0, ease inward while growing and ramping
     * alpha up (they become MORE opaque as they approach the centre), then
     * quick-fade + die partway between the ring and the centre, they never
     * reach the middle. Meanwhile the main hex scales from 0.1 → 1, so the
     * packet reads as being "assembled" from the ring's converging energy. Runs
     * for `spawnDurationSec`; after that, still-alive particles finish their
     * lives, then the node self-destroys.
     */
    spawnBurst: {
      /** Particles spawned per second while the emitter is active. */
      ratePerSec: 32,
      /**
       * How long the emitter keeps spawning (seconds), measured from packet
       * creation. Extends past `preGrowDelaySec` and into the hex's grow tween,
       * then stops well before `preGrowDelaySec + spawnGrowSec` so the
       * emergence pulse fires into a stream that has already stopped feeding
       * new particles, existing ones finish their lives naturally.
       */
      spawnDurationSec: 1.2,
      /** Each particle's individual lifespan (seconds). */
      particleLifetimeSec: 0.55,
      /** Radius of the emitter ring (world units). */
      ringRadiusWorld: 26,
      /**
       * Where the particle dies as a fraction of `ringRadiusWorld`. `0.18` =
       * the particle's final position is 18 % of the ring radius from the
       * centre, so it visibly dies BEFORE reaching the packet, the packet's own
       * grow tween owns the centre of the animation.
       */
      radiusEndFraction: 0.18,
      /** Peak world-space size at end of life. Particles start at scale 0. */
      sizeMaxWorld: 2.7,
      /**
       * Fraction of life spent ramping alpha 0 → 1. After this, alpha
       * quick-fades to 0 for the remainder of the life. `0.72` gives a long
       * ease-in glow followed by a fast fade at the end.
       */
      alphaGrowFraction: 0.72,
      /**
       * Hex fill colour, matches the packet stroke so the ring reads as
       * belonging to the same object.
       */
      color: '#D84EFF',
    },
    /**
     * Emergence pulse fired when the grow-in animation completes and the packet
     * becomes travel-ready. A big translucent trail-coloured hex scales up and
     * fades out from the spawn point, same visual grammar as
     * `lossAnim.impactFlash`, just at spawn instead of collision.
     */
    spawnPulse: {
      /** Total duration (seconds). */
      durationSec: 0.55,
      /** Scale at t=0 → t=1 (world units are baked in via `worldRadius`). */
      scaleFrom: 0.6,
      scaleTo: 4.0,
      /** Alpha at t=0. Fades to 0 over `durationSec`. */
      alphaFrom: 0.45,
      /** Base hex radius (world units), scaled by `scaleFrom → scaleTo`. */
      worldRadius: 14,
      /** Fill colour. Matches the shooting-star trail's colour. */
      color: '#2E1CFF',
    },
  },
  difficulty: {
    // ---- Speed mix -------------------------------------------------------
    //
    // Every new packet is EITHER regular-speed OR slow, two discrete
    // tiers, not a widening band. Regular flow is predictable; slow
    // packets are the difficulty knob: they hang around long enough
    // that the player has to route the faster regulars AROUND them to
    // avoid collisions. As the round progresses, more spawns roll slow,
    // diluting the steady flow of regulars and raising the management
    // effort, never more than half slow, so regulars always dominate.
    /**
     * Regular travel speed (world units / sec). First spawn is always regular,
     * and this doesn't ramp, it's the round's baseline.
     */
    regularSpeedWorld: 75,
    /**
     * Slow packets travel at this fraction of `regularSpeedWorld`. 40 % is far
     * enough behind to require routing around, without reading as "stalled".
     */
    slowSpeedFactor: 0.4,
    /**
     * Chance for a NEW spawn to roll slow. Starts at `slowChanceStart` (0 →
     * first spawn is always regular), grows linearly by `slowChanceGrowthPer`
     * each spawn, and caps at `slowChanceCap` so regulars stay the majority
     * forever.
     */
    slowChanceStart: 0,
    slowChanceGrowthPer: 0.03,
    slowChanceCap: 0.45,
    // ---- Cadence ---------------------------------------------------------
    /** First inter-spawn interval after `spawn.firstDelaySec`. */
    startIntervalSec: 2.8,
    /** Interval never falls below this, spawn rate has a ceiling. */
    intervalFloorSec: 2.5,
    /**
     * Interval *= this per spawn. `0.98` is gentle, the tempo tightens modestly
     * from `startIntervalSec` before flooring. With the current pair (2.8 →
     * 2.5) the ramp settles into its steady rhythm around spawn 6.
     */
    intervalDecayPer: 0.98,
  },
  spawn: {
    /** Delay from `roundStarted` to the first spawn. */
    firstDelaySec: 1.5,
    /**
     * Rejection-sampling constraints, retry a random pick that fails any:
     *
     * - `mask.contains(pt, inset=minDistFromBorderWorld)` false → too close to
     *   border
     * - Distance to epicenter < `minDistFromEpicenterWorld` → too near safe zone
     * - Distance to any active packet < `pairThreshold + minDistFromPacketWorld`
     *   → would spawn-kill (grow directly onto a travelling packet)
     */
    minDistFromEpicenterWorld: 220,
    minDistFromBorderWorld: 45,
    // Static buffer around every active packet's CURRENT position at the
    // moment we sample a spawn point. Added on top of
    // `collision.pairThresholdWorld`, total forbidden radius is
    // `pairThreshold + minDistFromPacketWorld` ≈ 100 wu. The larger
    // buffer accounts for dynamics: a packet travelling at the band's
    // upper edge (~220 wu/s) closes 100 wu in ~0.45 s, roughly matching
    // the pre-grow delay so the emerging hex isn't likely to be run
    // over mid-birth. Too big and busy fields exhaust `maxRetries` and
    // start skipping slots; too small and slow-moving veterans plough
    // straight through the birth of a new one.
    minDistFromPacketWorld: 90,
    /** Cap on rejection retries per spawn slot; on exhaustion, skip. */
    maxRetries: 20,
    /**
     * Ample-travel-time guard on the initial heading. `pickInitialHeading`
     * sweeps the candidate ray forward in small steps up to this distance,
     * tracking how far it stays inside the mask (with a border inset, see
     * `initialHeadingClearInsetWorld`). The candidate whose ray survives
     * longest wins; a full sweep to this distance is accepted immediately
     * without further tries.
     *
     * Sized against the fast edge of the speed band (~220 wu/s), a 250 wu
     * runway gives just over a second of clear flight even at top speed, and 4+
     * seconds at the low edge (~55 wu/s). Bump higher if late-round wall
     * crashes still feel unfair.
     */
    initialHeadingProbeWorld: 250,
    /**
     * Step size for the ray sweep. Smaller = finer resolution but more
     * `mask.contains` calls (currently one bitmap sample each). At 12 wu a 250
     * wu sweep is ~21 samples per candidate.
     */
    initialHeadingProbeStepWorld: 12,
    /**
     * Border clearance the sweep enforces. `mask.contains(x, y, inset)` treats
     * a point closer than `inset` to the boundary as "outside". Larger = safer
     * headings but harder to find in cramped spawn spots (e.g. near the Baltic
     * coast).
     */
    initialHeadingClearInsetWorld: 20,
    /**
     * How many random headings to try before falling back to the deepest-runway
     * candidate found so far.
     */
    initialHeadingMaxTries: 32,
  },
  epicenter: {
    /**
     * Apex-proximity tolerance for capture. Packet must sit within this radius
     * of the apex AND be heading INTO the cone (a valid entry angle) for the
     * capture to fire. The drawn trail no longer has to terminate at the apex.
     */
    captureRadius: 20,
    /** Visual outer bound of the cone / pulse. */
    visualRadius: 22,
    /** Breathing pulse period on the outer ring alpha. */
    pulsePeriodSec: 2.1,
    /**
     * Cone target geometry. The apex sits at the state capital; the axis points
     * from the apex TOWARD Germany's geographic centre; the wedge opens in that
     * direction.
     */
    coneSweepRad: Math.PI / 3, // 60° total, 16.67% of a full sweep
    coneRadiusWorld: 40, // wedge outer radius
    /**
     * Extra angular slack beyond ±(coneSweep / 2) that still counts as a valid
     * approach into the cone. Approaches outside this band get auto-routed via
     * two inserted waypoints (entry point + apex) so the packet U-turns into
     * the cone under its own angular-velocity limit.
     */
    approachForgivenessRad: (Math.PI * 3) / 40, // 13.5° (15° × 0.9)
  },
  path: {
    /**
     * `PolylineNode.pushIfFar` threshold, minimum world dist between points.
     * Slightly above the packet's `consumeRadius` so the packet doesn't skip a
     * queued point by accident, but tight enough that the drawn curve reads as
     * smooth.
     */
    minPointDistWorld: 10,
    /** Enter this radius while drawing → snap the polyline to epicenter center. */
    snapRadiusWorld: 55,
    /**
     * How long a consumed segment lingers before it's dropped. Kept short so
     * the tail feels snappy rather than draggy, the goal is a "was just there"
     * wisp, not a persistent line.
     */
    fadeSec: 0.3,
  },
  borderTurnaround: {
    /**
     * Angular velocity applied to the packet's heading when it hits the
     * viewport edge while still inside Germany. Higher = sharper turn.
     */
    steerRad: Math.PI / 6,
    angularVelRadPerSec: Math.PI * 1.4,
    /** Viewport-edge buffer in world units, start steering this early. */
    edgeBufferWorld: 12,
  },
  collision: {
    /**
     * Two packets collide when their centers get closer than this (roughly `2 ×
     * packet.radius`, kept slightly under so contact requires real overlap, not
     * touching-edges).
     */
    pairThresholdWorld: 11,
  },
  /**
   * Ripple that flashes through every state in BFS order from an origin. *
   * fired on state selection, collision, and border breach. A short bright
   * overlay pulses in over `riseSec` and out over `fallSec` on each state,
   * staggered by `delayPerLayerSec` per BFS depth.
   */
  stateRipple: {
    /** Delay between BFS layers (seconds). Origin fires at t=0. */
    delayPerLayerSec: 0.1,
    /** Fade-in duration on each state (seconds). */
    riseSec: 0.1,
    /** Fade-out duration on each state (seconds). */
    fallSec: 0.5,
    /** Peak alpha of the overlay at the top of the pulse. */
    peakAlpha: 0.1,
    /**
     * Overlay fill colour. Bright / warm so the ripple reads against the dim
     * state fills without shifting hue toward game-over red.
     */
    color: '#fdf6e3',
    /**
     * How long after `endRound` fires the ripple before the session's highlight
     * is cleared. Sized to exceed the ripple's wall-clock duration (worst-case
     * BFS depth × `delayPerLayerSec` + `riseSec` + `fallSec`) so the "unify
     * state colours" tween happens AFTER the bursts settle, otherwise the
     * shockwave leaves BFS-depth-3 neighbours at alpha 1 while far states sit
     * at 0.35, and the game- over card slides in over a splotchy map.
     */
    settleClearDelaySec: 1.3,
  },
  /**
   * The 299-Wahlkreise overlay, a single `WahlkreiseOverlayNode` that owns
   * every district's `Path2D` + per-district alpha buffers. Two distinct
   * effects share the node:
   *
   * - **Pulse**, event-driven ripple that spreads outward through the districts
   *   from a world position. Fired on collision + border breach. Wavefront
   *   timing is `distance / propagationSpeedWorld` per district centroid.
   * - **Warn**, continuous yellow tint on districts near a packet in danger
   *   (close to border or another packet). Session samples targets each render
   *   frame; the overlay smooths toward them.
   */
  wahlkreise: {
    // Naming is historical, the overlay originally rendered the 299
    // election districts. It's now a uniform grid of squares clipped to
    // the country outline; the pulse + warn sub-blocks below are
    // geometry-agnostic and drive the same effects on the new cells.
    grid: {
      /**
       * Cell edge length in world units. `12` gives ~2600 cells inside Germany
       * after outline filtering. Doubled from the earlier `6` wu setup: at 6 wu
       * the LIT-cell count under a full pulse was large enough (thousands of
       * `fillRect` state-changes) to spike the frame budget on the kiosk. 12 wu
       * quarters the cell count and the peak draw cost, the wavefront reads
       * slightly chunkier but stays smooth thanks to per-cell variance.
       */
      cellSizeWorld: 12,
    },
    pulse: {
      /**
       * Wave travel speed through the country (world units / second). Germany
       * is 888 tall, so 400 wu/s covers the map in ~2.2 s.
       */
      propagationSpeedWorld: 400,
      /** Rise from 0 → peakAlpha (seconds) on each district. */
      riseSec: 0.12,
      /** Fall from peakAlpha → 0 (seconds) on each district. */
      fallSec: 0.5,
      /** Peak alpha at the top of the local pulse envelope. */
      peakAlpha: 0.275,
      /**
       * Overlay fill colour, warm cream so the wave reads against the dim state
       * fills without conflicting with the game-over red debris.
       */
      color: '#fdf6e3',
      /** Max concurrent pulses; extras overwrite the oldest slot. */
      maxConcurrent: 4,
    },
    warn: {
      /** Yellow tint colour for districts near a packet in danger. */
      color: '#f2c94c',
      /** Mask inset defining "very close to border" (danger 1.0). */
      insetNearWorld: 22,
      /** Mask inset defining "getting close to border" (danger 0.5). */
      insetFarWorld: 48,
      /**
       * Two packets closer than this world distance start ramping pair-danger
       * from 0 → 1 linearly toward 0.
       */
      pairRadiusWorld: 55,
      /**
       * How far a packet's warning contribution spreads through the districts.
       * Alpha falls linearly with distance from the packet to the district's
       * centroid, hitting zero at this radius.
       */
      spreadRadiusWorld: 70,
      /**
       * Ceiling on the final warn alpha per district. Every packet's
       * contribution (`danger × (1 − dist/spread)`) is scaled by this before
       * being max-blended into the target, so the brightest possible yellow
       * reads as `peakAlpha` even when a packet sits exactly on a district's
       * centroid with full danger.
       */
      peakAlpha: 0.5,
      /**
       * Response time of the warn integrator, higher = snappier. Response time
       * constant is ~1 / rate; 8 → ~125 ms to reach 63 % of a step change.
       */
      smoothingRatePerSec: 8,
    },
  },
  lossAnim: {
    /**
     * How long the collision / escape animation plays before the Svelte
     * game-over card slides in. Session state flips to `'gameOver'` immediately
     * (spawning halts, physics freezes) but the outward `gameOver` event fires
     * only after this grace so the player sees the impact flash + debris +
     * shockwave settle first.
     */
    endScreenGraceSec: 3,
    /** Delay between adjacency layers during the shockwave pulse. */
    shockwaveStageDelaySec: 0.11,
    /** Duration of a single state's alpha pulse. */
    shockwaveDurationSec: 0.55,
    /** BFS depth cap for shockwave propagation. */
    shockwaveDepth: 3,
    /**
     * White sparkle-star that pops at the collision point. The impact flash SVG
     * is pre-scaled at load time so its max dimension equals `worldSize` world
     * units, then this node tweens `transform.scaleX/Y` from `scaleFrom` →
     * `scaleTo` in parallel with `alpha 1 → 0` over `durationSec`. The node
     * self-destroys on tween completion.
     */
    impactFlash: {
      durationSec: 0.25,
      scaleFrom: 0.5,
      scaleTo: 1.7,
      worldSize: 130,
      color: '#ffffff',
    },
    /**
     * Debris ring, a burst of magenta triangles + lines that fly outward at
     * high speed, decelerate under exponential drag, then settle into a
     * permanent ring with slow residual rotation. Never self-destroys; cleared
     * by `session.reset()` alongside every other round visual.
     */
    debris: {
      /** Total debris pieces (mix of triangles and lines). */
      count: 20,
      /** Fraction of the pool rendered as triangles (rest are lines). */
      triangleFraction: 0.35,
      /**
       * Random initial outward speed range (world units / sec). Tightened so
       * every piece settles at a similar radius, the ring reads as a clean
       * shockwave rather than a mix of near / mid / far pieces. Under
       * `dampingPerSec = 4.4` (below), settle distances span roughly `130/4.4 ≈
       * 30` → `200/4.4 ≈ 45` world units.
       */
      initialSpeedWorld: [130, 200] as readonly [number, number],
      /**
       * Translational drag, pieces coast noticeably before settling. Slower
       * than the earlier `8` (halved-in-0.09 s) so the ring has a visible
       * "still spreading" beat before it locks.
       */
      dampingPerSec: 4.4,
      /**
       * Radial emission uses evenly-spaced angular slots (with a small jitter)
       * instead of pure random, no clumps, no visible gaps in the settled ring.
       * Both the live game and the game-over vignette read from this same knob
       * so the moment feels identical.
       */
      equidistantEmission: true,
      /**
       * Transient angular velocity range applied at spawn (rad/s). Decays
       * exponentially at `angInitialDampingPerSec`; combined with
       * `angBaseWorld` for the total per-frame spin.
       */
      angInitialRadPerSec: [-9, 9] as readonly [number, number],
      /** Damping of the initial spin, decays to near-zero within ~0.8 s. */
      angInitialDampingPerSec: 3.5,
      /**
       * Permanent slow spin, total angular velocity asymptotes to this as the
       * transient component decays. Magnitude range with a random ± sign per
       * piece; widened so the ring reads as a mix of clearly slow, moderate,
       * and quicker rotators rather than a uniform swirl.
       */
      angBaseAbsRadPerSec: [0.2, 1.35] as readonly [number, number],
      /** Triangle side length (world units), an equilateral filled tri. */
      triangleSideWorld: 4,
      /** Line segment length (world units). */
      lineLengthWorld: 3,
      /** Line stroke width in CSS pixels, screen-space-scaled at draw. */
      lineWidthCssPx: 1.5,
      /** Fill / stroke colour. */
      color: '#D84EFF',
    },
    /**
     * Border-breach variant of the debris burst, lines-only cone fired along
     * the packet's exit velocity, coloured to match the country outline so the
     * pieces read as broken bits of the border. Consumed by the shared
     * `DebrisBurstNode`.
     */
    borderBreach: {
      count: 24,
      triangleFraction: 0,
      /**
       * Wide random speed range so pieces settle at clearly different
       * distances, under `dampingPerSec: 7`, travelled distance is ≈ `speed /
       * damping`, giving ~14 → ~54 world units between the closest fleck and
       * the outliers. Skewed slightly high because the earlier tuning read as
       * too close-in.
       */
      initialSpeedWorld: [20, 280] as readonly [number, number],
      dampingPerSec: 4,
      /**
       * Cone half-angle around the packet's velocity direction. Broader than a
       * tight shrapnel cone, pieces fan out to ~72° either side of the packet's
       * heading so the breach reads as a real puncture rather than a stream of
       * aligned darts.
       */
      emitSpreadRad: Math.PI * 0.2,
      /**
       * Wall-shard pose: each line launches perpendicular (90°) to its own
       * flight direction, as if it's a shard of wall broadside-shattered by a
       * projectile punching through. Combined with the spin ranges below, the
       * pieces then tumble around their own axes while they drift out and
       * decelerate, the "wall debris floating around" silhouette the design
       * brief calls for.
       */
      initialAngleOffsetRad: Math.PI / 2,
      angInitialRadPerSec: [-5, 5] as readonly [number, number],
      angInitialDampingPerSec: 3,
      angBaseAbsRadPerSec: [0.08, 1.2] as readonly [number, number],
      /** Unused (triangleFraction: 0) but the shared type requires it. */
      triangleSideWorld: 0,
      lineLengthWorld: 2.8,
      lineWidthCssPx: 1.5,
      /** Country-outline colour, the burst reads as border shrapnel. */
      color: '#fdf6e3',
    },
  },
} as const
