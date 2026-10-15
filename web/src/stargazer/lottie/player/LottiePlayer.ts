/**
 * Playback controller for a Lottie animation. It owns the clock, the playback
 * mode, looping, segments and markers, and reports the frame to render. It
 * knows nothing about drawing: a caller feeds it elapsed time through `advance`
 * and evaluates the animation at the frame it returns.
 */
import { createEmitter, type Emitter } from '../../events/Emitter'

/** A named time range of an animation, in frames of the animation's own clock. */
export interface PlayerMarker {
  name: string
  /** Start time in frames, absolute (includes the animation's in point). */
  time: number
  /** Length in frames. Zero marks a point to seek to, not a range to play. */
  duration: number
}

/** What the player needs to know about an animation. */
export interface PlayerSource {
  /** Frames per second. */
  frameRate: number
  /** First frame of the animation. */
  inPoint: number
  /** End frame of the animation, exclusive. */
  outPoint: number
  markers: readonly PlayerMarker[]
}

/** Direction pattern of playback. */
export type PlaybackMode = 'forward' | 'reverse' | 'bounce' | 'reverse-bounce'

/** Events emitted by a {@link LottiePlayer}. */
export interface LottiePlayerEvents {
  /** The playhead moved to `frame`. */
  frame: { frame: number }
  /** The frame at `frame` is ready to be drawn. */
  render: { frame: number }
  /** A loop finished. `count` is the number of finished loops. */
  loop: { count: number }
  /** Playback reached its end. */
  complete: void
  play: void
  pause: void
  stop: void
}

/**
 * Hook that runs at the start of every `advance`, before the clock moves. A
 * state machine uses it to seek, change segments or start and stop playback.
 */
export interface PlaybackController {
  update(player: LottiePlayer, dtMs: number): void
}

/** Options for a {@link LottiePlayer}. */
export interface LottiePlayerOptions {
  /** Default `'forward'`. */
  mode?: PlaybackMode
  /** Playback rate, greater than zero. Default `1`. */
  speed?: number
  /** Restart at the end instead of completing. Default `false`. */
  looping?: boolean
  /** Playthroughs before completing when looping. `0` loops forever. */
  loopCount?: number
  /** Start playing on construction. Default `false`. */
  autoplay?: boolean
  /**
   * Report fractional frames. When off, frames are whole numbers. Default
   * `true`.
   */
  useFrameInterpolation?: boolean
  /** Playable range as `[start, end]` in playback frames. */
  segment?: [number, number]
  /** Name of a marker to play. Takes precedence over `segment`. */
  marker?: string
}

/** Result of {@link LottiePlayer.advance}. */
export interface AdvanceResult {
  /** Playback frame, 0-based and relative to the in point. */
  frame: number
  /** True when the frame moved or the player was changed since the last call. */
  changed: boolean
}

type PlayState = 'stopped' | 'paused' | 'playing'

/** Frame differences at or below this value count as no movement. */
const FRAME_EPSILON = 0.0009

function isReverseMode(mode: PlaybackMode): boolean {
  return mode === 'reverse' || mode === 'reverse-bounce'
}

/**
 * Drives the playhead of one animation. Playback frames are 0-based, so frame 0
 * is the animation's in point and the last playable frame is `totalFrames - 1`.
 * Time enters only through {@link LottiePlayer.advance}, which makes playback
 * deterministic and testable without timers.
 *
 * @remarks
 *   The player keeps one clock, `elapsedFrames`, that counts frames travelled in
 *   the current direction. The next frame is `start + elapsed` going forward
 *   and `end - elapsed` going backward, clamped to the segment. A loop restarts
 *   the clock. `events` fires `frame` when the playhead moves and `render` when
 *   a frame should be drawn, followed by `loop` or `complete` when an end is
 *   reached. Bounce modes flip direction at the far end without counting a
 *   loop. A loop is counted at the end of a full forward and reverse cycle.
 * @example
 *   const player = new LottiePlayer(source, {
 *     looping: true,
 *     autoplay: true,
 *   })
 *   player.events.on('loop', ({ count }) => console.log(count))
 *   // each engine update:
 *   const { frame, changed } = player.advance(dtMs)
 *   if (changed) evaluate(frame)
 */
export class LottiePlayer {
  readonly events: Emitter<LottiePlayerEvents> =
    createEmitter<LottiePlayerEvents>()

  readonly #source: PlayerSource
  readonly #totalFrames: number
  readonly #durationMs: number

  #state: PlayState = 'stopped'
  #mode: PlaybackMode = 'forward'
  #speed = 1
  #looping = false
  #loopCount = 0
  #useInterpolation = true

  #frame = 0
  #elapsedFrames = 0
  #reversed = false
  #completedLoops = 0
  #segment: [number, number] | null = null
  #marker: string | null = null
  #controller: PlaybackController | null = null

  /** Set by calls that move or reconfigure the playhead, cleared by `advance`. */
  #dirty = true
  /** Set when a mode handler counts a loop during the current step. */
  #loopCounted = false
  #lastReportedFrame = Number.NaN

  constructor(source: PlayerSource, opts: LottiePlayerOptions = {}) {
    this.#source = source
    this.#totalFrames = Math.max(0, source.outPoint - source.inPoint)
    this.#durationMs =
      source.frameRate > 0 ? (this.#totalFrames / source.frameRate) * 1000 : 0
    this.#mode = opts.mode ?? 'forward'
    if (opts.speed !== undefined) this.setSpeed(opts.speed)
    this.#looping = opts.looping ?? false
    this.#loopCount = Math.max(0, Math.floor(opts.loopCount ?? 0))
    this.#useInterpolation = opts.useFrameInterpolation ?? true
    if (opts.segment) this.setSegment(opts.segment[0], opts.segment[1])
    if (opts.marker !== undefined) this.setMarker(opts.marker)
    this.#reversed = isReverseMode(this.#mode)
    this.#frame = this.#reversed ? this.#end : this.#start
    if (opts.autoplay) this.play()
  }

  /** Last playable frame of the whole animation. */
  get #lastFrame(): number {
    return Math.max(0, this.#totalFrames - 1)
  }

  get #start(): number {
    return this.#segment ? this.#segment[0] : 0
  }

  get #end(): number {
    return this.#segment ? this.#segment[1] : this.#lastFrame
  }

  /** Playhead position in playback frames. */
  get currentFrame(): number {
    return this.#frame
  }

  /** Length of the animation in frames, `outPoint - inPoint`. */
  get totalFrames(): number {
    return this.#totalFrames
  }

  /** Length of the animation at speed 1, in milliseconds. */
  get durationMs(): number {
    return this.#durationMs
  }

  get isPlaying(): boolean {
    return this.#state === 'playing'
  }

  get isPaused(): boolean {
    return this.#state === 'paused'
  }

  get isStopped(): boolean {
    return this.#state === 'stopped'
  }

  /** True when the playhead sits at the end that the current mode finishes on. */
  get isComplete(): boolean {
    const frame = this.#frame
    switch (this.#mode) {
      case 'forward':
        return frame >= this.#end
      case 'reverse':
        return frame <= this.#start
      case 'bounce':
        if (this.#looping && this.#loopCount > 0) {
          return this.#completedLoops > 0 && frame <= this.#start
        }
        return frame <= this.#start && this.#reversed
      case 'reverse-bounce':
        if (this.#looping && this.#loopCount > 0) {
          return this.#completedLoops > 0 && frame >= this.#end
        }
        return frame >= this.#end && !this.#reversed
    }
  }

  get mode(): PlaybackMode {
    return this.#mode
  }

  get speed(): number {
    return this.#speed
  }

  get looping(): boolean {
    return this.#looping
  }

  get loopCount(): number {
    return this.#loopCount
  }

  /** Number of loops finished in the current run. */
  get completedLoops(): number {
    return this.#completedLoops
  }

  get useFrameInterpolation(): boolean {
    return this.#useInterpolation
  }

  /** Playable range `[start, end]` in playback frames. */
  get segment(): readonly [number, number] {
    return [this.#start, this.#end]
  }

  /** Name of the active marker, or `null`. */
  get marker(): string | null {
    return this.#marker
  }

  /** Install or remove the hook that runs at the start of every `advance`. */
  setController(controller: PlaybackController | null): void {
    this.#controller = controller
  }

  /**
   * Move the clock forward by `dtMs` and report the frame to render. Emits
   * `frame`, `render`, `loop` and `complete` as playback crosses them.
   *
   * @remarks
   *   `changed` is false when the frame differs from the previous call's by no
   *   more than 0.0009 and nothing was seeked, restarted, stopped, segmented or
   *   marked dirty since then. The first call always reports a change.
   */
  advance(dtMs: number): AdvanceResult {
    const dt = dtMs > 0 ? dtMs : 0
    this.#controller?.update(this, dt)

    if (this.#state === 'playing' && this.#durationMs > 0) {
      this.#elapsedFrames +=
        dt * this.#speed * (this.#totalFrames / this.#durationMs)
    }

    const wasDirty = this.#dirty
    this.#loopCounted = false
    const next = this.#nextFrame()
    if (next === this.#frame && !wasDirty && !this.#loopCounted) {
      return this.#report(false)
    }

    this.#dirty = false
    if (next !== this.#frame) this.#moveTo(next)
    this.#render()
    return this.#report(wasDirty || this.#loopCounted)
  }

  /** Start or resume playback. A finished run restarts from its first frame. */
  play(): boolean {
    if (this.#state === 'playing') return false
    if (this.#state === 'stopped' && this.isComplete) {
      this.#elapsedFrames = 0
      this.#reversed = isReverseMode(this.#mode)
      this.#dirty = true
      this.#moveTo(this.#reversed ? this.#end : this.#start)
    } else {
      this.#elapsedFrames = this.#elapsedFor(this.#frame)
    }
    this.#state = 'playing'
    this.events.emit('play', undefined)
    return true
  }

  /** Hold the playhead where it is. Returns false unless playing. */
  pause(): boolean {
    if (this.#state !== 'playing') return false
    this.#state = 'paused'
    this.events.emit('pause', undefined)
    return true
  }

  /**
   * Stop and return the playhead to the first frame of the current mode, which
   * is the segment start going forward and the segment end going backward.
   * Returns false when already stopped.
   */
  stop(): boolean {
    if (this.#state === 'stopped') return false
    this.#state = 'stopped'
    this.#reversed = isReverseMode(this.#mode)
    this.#dirty = true
    this.#moveTo(this.#reversed ? this.#end : this.#start)
    this.#elapsedFrames = 0
    this.events.emit('stop', undefined)
    return true
  }

  /**
   * Move the playhead to `frame` and continue from there. Returns false when
   * `frame` lies outside the segment.
   */
  seek(frame: number): boolean {
    if (!(frame >= this.#start && frame <= this.#end)) return false
    this.#dirty = true
    this.#moveTo(frame)
    this.#elapsedFrames = this.#elapsedFor(frame)
    return true
  }

  /**
   * Restrict playback to `[start, end]` in playback frames. The range is cut to
   * the animation and must keep `start < end`, otherwise nothing changes and
   * the call returns false. The playhead stays where it is until the next
   * `advance` pulls it into the range. Clears the active marker.
   */
  setSegment(start: number, end: number): boolean {
    if (!(start < end)) return false
    const lo = Math.max(0, start)
    const hi = Math.min(this.#lastFrame, end)
    if (!(lo < hi)) return false
    this.#segment = [lo, hi]
    this.#marker = null
    this.#dirty = true
    return true
  }

  /** Remove the segment and the active marker so the whole animation plays. */
  resetSegment(): void {
    this.#segment = null
    this.#marker = null
    this.#dirty = true
  }

  /**
   * Play the range of a named marker, or the whole animation for `null`. The
   * playhead jumps to the marker start only when it lies outside the range. A
   * marker with a zero duration is a point, so it seeks and leaves the segment
   * alone. Returns false for an unknown name.
   */
  setMarker(name: string | null): boolean {
    if (name === null) {
      this.resetSegment()
      return true
    }
    if (name === this.#marker) return true
    const marker = this.#source.markers.find((m) => m.name === name)
    if (!marker) return false

    const start = Math.max(0, marker.time - this.#source.inPoint)
    if (marker.duration <= 0) {
      const target = Math.min(Math.max(start, this.#start), this.#end)
      this.seek(target)
      return true
    }
    const end = Math.min(
      marker.time + marker.duration - this.#source.inPoint,
      this.#lastFrame,
    )
    if (!(start < end)) return false

    this.#segment = [start, end]
    this.#marker = name
    this.#dirty = true
    if (this.#frame < start || this.#frame > end) {
      this.#elapsedFrames = 0
      this.#moveTo(start)
    }
    return true
  }

  /** Change the direction pattern. The playhead keeps its frame. */
  setMode(mode: PlaybackMode): void {
    if (mode === this.#mode) return
    this.#mode = mode
    const reversed = this.#reversed
    const wantsReverse = isReverseMode(mode)
    if (reversed !== wantsReverse) {
      this.#reversed = wantsReverse
      this.#elapsedFrames = this.#elapsedFor(this.#frame)
    }
  }

  /** Set the playback rate. Values that are not greater than zero are ignored. */
  setSpeed(speed: number): void {
    if (speed > 0 && Number.isFinite(speed)) this.#speed = speed
  }

  /** Turn looping on or off. Resets the loop counter. */
  setLooping(looping: boolean): void {
    if (looping === this.#looping) return
    this.#completedLoops = 0
    this.#looping = looping
  }

  /** Set how many playthroughs a looping run makes. `0` loops forever. */
  setLoopCount(count: number): void {
    const next = Math.max(0, Math.floor(count))
    if (next === this.#loopCount) return
    this.#completedLoops = 0
    this.#loopCount = next
  }

  setUseFrameInterpolation(enabled: boolean): void {
    this.#useInterpolation = enabled
  }

  /**
   * Make the next `advance` report `changed: true` and emit `render` even if
   * the frame did not move. Use it when something other than the playhead
   * changed what the frame looks like.
   */
  markDirty(): void {
    this.#dirty = true
  }

  /** Clock value that places the playhead at `frame` in the current direction. */
  #elapsedFor(frame: number): number {
    return this.#reversed ? this.#end - frame : frame - this.#start
  }

  #moveTo(frame: number): void {
    this.#frame = frame
    this.events.emit('frame', { frame })
  }

  #report(force: boolean): AdvanceResult {
    const frame = this.#frame
    const last = this.#lastReportedFrame
    const changed =
      force || Number.isNaN(last) || Math.abs(frame - last) > FRAME_EPSILON
    this.#lastReportedFrame = frame
    return { frame, changed }
  }

  /** Whether another loop may be counted. */
  #canLoop(): boolean {
    if (!this.#looping) return false
    return this.#loopCount === 0 || this.#completedLoops < this.#loopCount
  }

  #countLoop(): void {
    this.#completedLoops++
    this.#loopCounted = true
    this.#elapsedFrames = 0
  }

  #nextFrame(): number {
    if (this.#state !== 'playing') return this.#frame
    const start = this.#start
    const end = this.#end

    let next = this.#reversed
      ? end - this.#elapsedFrames
      : start + this.#elapsedFrames
    next = this.#useInterpolation
      ? Math.round(next * 1000) / 1000
      : Math.round(next)
    next = Math.min(Math.max(next, start), end)

    switch (this.#mode) {
      case 'forward':
        if (next < end) return next
        if (this.#canLoop()) this.#countLoop()
        return end
      case 'reverse':
        if (next > start) return next
        if (this.#canLoop()) this.#countLoop()
        return start
      case 'bounce':
        if (!this.#reversed) {
          if (next < end) return next
          this.#reversed = true
          this.#elapsedFrames = 0
          return end
        }
        if (next > start) return next
        if (this.#canLoop()) {
          this.#countLoop()
          this.#reversed = false
        }
        return start
      case 'reverse-bounce':
        if (this.#reversed) {
          if (next > start) return next
          this.#reversed = false
          this.#elapsedFrames = 0
          return start
        }
        if (next < end) return next
        if (this.#canLoop()) {
          this.#countLoop()
          this.#reversed = true
        }
        return end
    }
  }

  /** Emits `render`, then detects loops and completion while playing. */
  #render(): void {
    this.events.emit('render', { frame: this.#frame })
    if (this.#state !== 'playing') return

    if (this.#looping) {
      if (!this.#loopCounted) return
      const finished =
        this.#loopCount > 0 && this.#completedLoops >= this.#loopCount
      // Stopping before the events keeps the player stopped when handlers run.
      if (finished) this.stop()
      this.events.emit('loop', { count: this.#completedLoops })
      if (finished) {
        this.events.emit('complete', undefined)
        this.#completedLoops = 0
      }
    } else if (this.isComplete) {
      this.#state = 'stopped'
      this.events.emit('complete', undefined)
    }
  }
}
