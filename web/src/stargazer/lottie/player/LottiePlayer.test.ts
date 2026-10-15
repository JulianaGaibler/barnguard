import { describe, expect, it } from 'vitest'
import fixture from '../../dev/fixtures/lottie/playback_test.json'
import {
  LottiePlayer,
  type LottiePlayerOptions,
  type PlaybackMode,
  type PlayerSource,
} from './LottiePlayer'

const DT = 1000 / 60

/** The fixture animation: 30 fps, 42 frames, four markers. */
const FIXTURE: PlayerSource = {
  frameRate: fixture.fr,
  inPoint: fixture.ip,
  outPoint: fixture.op,
  markers: fixture.markers.map((m) => ({
    name: m.cm,
    time: m.tm,
    duration: m.dr,
  })),
}

/** One frame per 60 Hz step, so every step lands on a whole frame. */
const STEP_PER_FRAME: PlayerSource = {
  frameRate: 60,
  inPoint: 0,
  outPoint: 42,
  markers: [],
}

const MODES: PlaybackMode[] = ['forward', 'reverse', 'bounce', 'reverse-bounce']

/** Records every event as a compact string such as `frame:41` or `loop:2`. */
function record(player: LottiePlayer): string[] {
  const log: string[] = []
  player.events.on('frame', (e) => log.push(`frame:${e.frame}`))
  player.events.on('render', (e) => log.push(`render:${e.frame}`))
  player.events.on('loop', (e) => log.push(`loop:${e.count}`))
  player.events.on('complete', () => log.push('complete'))
  player.events.on('play', () => log.push('play'))
  player.events.on('pause', () => log.push('pause'))
  player.events.on('stop', () => log.push('stop'))
  return log
}

/** Advances until `done` is true and returns the frame after each step. */
function drive(
  player: LottiePlayer,
  done: () => boolean,
  maxSteps = 5000,
): number[] {
  const frames: number[] = []
  for (let i = 0; i < maxSteps && !done(); i++) {
    frames.push(player.advance(DT).frame)
  }
  expect(done()).toBe(true)
  return frames
}

function make(opts: LottiePlayerOptions = {}, source = FIXTURE): LottiePlayer {
  return new LottiePlayer(source, { autoplay: true, ...opts })
}

describe('LottiePlayer playback', () => {
  it('derives its timing from the source and holds still until played', () => {
    const player = make({ autoplay: false })
    expect(player.totalFrames).toBe(42)
    expect(player.durationMs).toBe(1400)
    expect(player.isStopped).toBe(true)
    for (let i = 0; i < 10; i++) expect(player.advance(DT).frame).toBe(0)
    expect(make().isPlaying).toBe(true)
  })

  it('plays a non-looping run to the last frame and completes without a stop event', () => {
    const player = make()
    const log = record(player)
    const frames = drive(player, () => player.isStopped)
    expect(frames).toHaveLength(82)
    expect(frames[frames.length - 1]).toBe(41)
    expect(frames.every((f, i) => i === 0 || f >= frames[i - 1])).toBe(true)
    expect(log.slice(-3)).toEqual(['frame:41', 'render:41', 'complete'])
    expect(log).not.toContain('stop')
    expect(player.isComplete).toBe(true)
  })

  it('reports whole frames without interpolation and fractions with it', () => {
    const whole = make({ useFrameInterpolation: false }, STEP_PER_FRAME)
    const frames = drive(whole, () => whole.isStopped)
    expect(frames).toHaveLength(41)
    expect(frames[frames.length - 1]).toBe(41)
    expect(frames.every(Number.isInteger)).toBe(true)

    const smooth = make()
    expect(smooth.advance(DT).frame).toBeCloseTo(0.5, 6)
    smooth.setUseFrameInterpolation(false)
    expect(Number.isInteger(smooth.advance(DT * 0.3).frame)).toBe(true)
  })

  it('scales playback time by speed and ignores speeds that are not positive', () => {
    for (const speed of [0.5, 1, 2]) {
      const player = make({ speed, segment: [10, 30] })
      const steps = drive(player, () => player.isStopped).length
      const expectedMs = (20 / 42) * player.durationMs
      expect(expectedMs / (steps * DT)).toBeCloseTo(speed, 0)
    }
    const player = make({ speed: 2 })
    player.setSpeed(0)
    player.setSpeed(-1)
    player.setSpeed(Number.NaN)
    expect(player.speed).toBe(2)
  })

  it('ignores negative time steps', () => {
    const player = make()
    player.advance(DT)
    const frame = player.currentFrame
    expect(player.advance(-500).frame).toBe(frame)
  })
})

describe('LottiePlayer modes', () => {
  it('reverse mode starts at the end and counts down to the first frame', () => {
    const player = make({ mode: 'reverse' })
    expect(player.currentFrame).toBe(41)
    const frames = drive(player, () => player.isStopped)
    expect(frames[frames.length - 1]).toBe(0)
    expect(frames.every((f, i) => i === 0 || f <= frames[i - 1])).toBe(true)
  })

  it('bounce goes up then down and completes at the start without counting a loop', () => {
    const player = make({ mode: 'bounce' })
    const log = record(player)
    const frames = drive(player, () => player.isStopped)
    const peak = frames.indexOf(41)
    expect(peak).toBeGreaterThan(0)
    expect(
      frames.slice(0, peak + 1).every((f, i, a) => i === 0 || f >= a[i - 1]),
    ).toBe(true)
    expect(
      frames.slice(peak).every((f, i, a) => i === 0 || f <= a[i - 1]),
    ).toBe(true)
    expect(frames[frames.length - 1]).toBe(0)
    expect(log.some((e) => e.startsWith('loop'))).toBe(false)
    expect(log[log.length - 1]).toBe('complete')
  })

  it('reverse-bounce goes down then up and completes at the end', () => {
    const player = make({ mode: 'reverse-bounce' })
    expect(player.currentFrame).toBe(41)
    const frames = drive(player, () => player.isStopped)
    const trough = frames.indexOf(0)
    expect(trough).toBeGreaterThan(0)
    expect(frames[frames.length - 1]).toBe(41)
    expect(player.isComplete).toBe(true)
  })

  it('keeps the current frame when the mode changes and continues in the new direction', () => {
    const player = make()
    drive(player, () => player.currentFrame >= 20)
    const frame = player.currentFrame
    player.setMode('reverse')
    expect(player.currentFrame).toBe(frame)
    expect(player.advance(DT).frame).toBeLessThan(frame)
    player.setMode('forward')
    expect(player.advance(DT * 4).frame).toBeGreaterThan(frame - 1)
  })
})

describe('LottiePlayer looping', () => {
  it.each(MODES)(
    '%s with loopCount 3 makes three playthroughs, then stops and completes',
    (mode) => {
      const player = make({ mode, looping: true, loopCount: 3 })
      const log = record(player)
      drive(player, () => player.isStopped)
      expect(log.filter((e) => e.startsWith('loop'))).toEqual([
        'loop:1',
        'loop:2',
        'loop:3',
      ])
      expect(log.filter((e) => e === 'complete')).toHaveLength(1)
      expect(player.completedLoops).toBe(0)
    },
  )

  it('emits frame, render and loop for an ordinary loop and the stop sequence for the final one', () => {
    const player = make({ looping: true, loopCount: 2 })
    const log = record(player)
    drive(player, () => player.isStopped)
    const firstLoop = log.indexOf('loop:1')
    expect(log.slice(firstLoop - 2, firstLoop + 1)).toEqual([
      'frame:41',
      'render:41',
      'loop:1',
    ])
    expect(log.slice(-6)).toEqual([
      'frame:41',
      'render:41',
      'frame:0',
      'stop',
      'loop:2',
      'complete',
    ])
  })

  it('loops forever when loopCount is 0', () => {
    const player = make({ looping: true, loopCount: 0 })
    const log = record(player)
    drive(player, () => player.completedLoops >= 6)
    expect(player.isPlaying).toBe(true)
    expect(log.filter((e) => e.startsWith('loop'))).toHaveLength(6)
    expect(log).not.toContain('complete')
  })

  it.each(['bounce', 'reverse-bounce'] as const)(
    'infinite %s emits one loop per full forward and reverse cycle',
    (mode) => {
      const player = make({ mode, looping: true }, STEP_PER_FRAME)
      const log = record(player)
      // A cycle is 2 * 41 steps, so 3 cycles end after 246 steps.
      for (let i = 0; i < 246; i++) player.advance(DT)
      expect(log.filter((e) => e.startsWith('loop'))).toEqual([
        'loop:1',
        'loop:2',
        'loop:3',
      ])
      expect(player.isPlaying).toBe(true)
    },
  )

  it('keeps counting across a pause and restarts with a fresh count after completing', () => {
    const player = make({ looping: true, loopCount: 5 })
    const log = record(player)
    drive(player, () => player.completedLoops >= 3)
    player.pause()
    for (let i = 0; i < 20; i++) player.advance(DT)
    expect(log).not.toContain('complete')
    player.play()
    drive(player, () => player.isStopped)
    expect(log.filter((e) => e.startsWith('loop')).pop()).toBe('loop:5')
    expect(log.filter((e) => e === 'complete')).toHaveLength(1)

    log.length = 0
    player.play()
    drive(player, () => player.isStopped)
    expect(log.filter((e) => e.startsWith('loop'))).toHaveLength(5)
  })

  it('changing the loop count resets the counter', () => {
    const player = make({ looping: true })
    drive(player, () => player.completedLoops >= 2)
    player.setLoopCount(4)
    expect(player.completedLoops).toBe(0)
  })
})

describe('LottiePlayer transport', () => {
  it('play resumes from the current frame and restarts after completion', () => {
    const player = make()
    drive(player, () => player.currentFrame >= 10)
    player.pause()
    const held = player.currentFrame
    expect(player.advance(DT * 5).frame).toBe(held)
    player.play()
    expect(player.advance(DT).frame).toBeGreaterThan(held)

    drive(player, () => player.isStopped)
    expect(player.isComplete).toBe(true)
    player.play()
    expect(player.currentFrame).toBe(0)
    expect(player.isPlaying).toBe(true)
  })

  it('does not repeat play, pause or stop events when the state already matches', () => {
    const player = make({ autoplay: false })
    const log = record(player)
    expect(player.pause()).toBe(false)
    expect(player.stop()).toBe(false)
    expect(player.play()).toBe(true)
    expect(player.play()).toBe(false)
    expect(log).toEqual(['play'])
  })

  it.each(
    MODES.flatMap((mode) => [
      { mode, segment: undefined },
      { mode, segment: [10, 30] as [number, number] },
    ]),
  )(
    'stop returns $mode playback with segment $segment to its first frame',
    ({ mode, segment }) => {
      const player = make({ mode, segment })
      const [start, end] = player.segment
      player.seek((start + end) / 2)
      player.advance(DT)
      expect(player.isPlaying).toBe(true)
      const log = record(player)
      expect(player.stop()).toBe(true)
      expect(player.isStopped).toBe(true)
      expect(player.currentFrame).toBe(
        mode === 'forward' || mode === 'bounce' ? start : end,
      )
      expect(log).toEqual([`frame:${player.currentFrame}`, 'stop'])
      expect(player.stop()).toBe(false)
    },
  )

  it('seek moves the playhead, continues from there and rejects frames outside the segment', () => {
    const player = make({ autoplay: false, segment: [10, 20] })
    expect(player.seek(5)).toBe(false)
    expect(player.seek(25)).toBe(false)
    expect(player.seek(15)).toBe(true)
    expect(player.advance(0).frame).toBe(15)
    player.play()
    expect(player.advance(DT * 2).frame).toBeCloseTo(16, 2)
  })
})

describe('LottiePlayer segments and markers', () => {
  it('rejects invalid segments and keeps playing the previous range', () => {
    const player = make({ segment: [10, 20] })
    expect(player.setSegment(50, 30)).toBe(false)
    expect(player.setSegment(25, 25)).toBe(false)
    expect(player.setSegment(60, 70)).toBe(false)
    expect(player.segment).toEqual([10, 20])
    const frames = drive(player, () => player.isStopped)
    expect(Math.min(...frames)).toBeGreaterThanOrEqual(10)
    expect(Math.max(...frames)).toBe(20)
  })

  it('cuts a segment to the animation and leaves the playhead until the next advance', () => {
    const player = make({ autoplay: false })
    player.seek(2)
    expect(player.setSegment(30, 80)).toBe(true)
    expect(player.segment).toEqual([30, 41])
    expect(player.currentFrame).toBe(2)
    player.play()
    expect(player.advance(DT).frame).toBeGreaterThanOrEqual(30)
  })

  it('plays a marker range and jumps to its start only from outside it', () => {
    const player = make()
    expect(player.setMarker('Marker_3')).toBe(true)
    expect(player.marker).toBe('Marker_3')
    expect(player.segment).toEqual([20, 30])
    expect(player.currentFrame).toBe(20)
    const frames = drive(player, () => player.isStopped)
    expect(Math.min(...frames)).toBeGreaterThanOrEqual(20)
    expect(Math.max(...frames)).toBe(30)

    const inside = make({ autoplay: false })
    inside.seek(25)
    inside.setMarker('Marker_3')
    expect(inside.currentFrame).toBe(25)
  })

  it('cuts the last marker to the final playable frame and resets with null', () => {
    const player = make({ marker: 'Marker_4' })
    expect(player.segment).toEqual([30, 41])
    expect(player.setMarker('nope')).toBe(false)
    expect(player.marker).toBe('Marker_4')
    player.setMarker(null)
    expect(player.marker).toBeNull()
    expect(player.segment).toEqual([0, 41])
    player.setSegment(5, 8)
    expect(player.marker).toBeNull()
  })

  it('treats a zero-duration marker as a seek target and keeps the segment', () => {
    const source: PlayerSource = {
      ...FIXTURE,
      markers: [{ name: 'Point', time: 12, duration: 0 }],
    }
    const player = make({ autoplay: false }, source)
    expect(player.setMarker('Point')).toBe(true)
    expect(player.currentFrame).toBe(12)
    expect(player.marker).toBeNull()
    expect(player.segment).toEqual([0, 41])
  })

  it('subtracts the in point from marker times', () => {
    const source: PlayerSource = {
      frameRate: 30,
      inPoint: 10,
      outPoint: 40,
      markers: [{ name: 'Mid', time: 20, duration: 5 }],
    }
    const player = make({ marker: 'Mid' }, source)
    expect(player.totalFrames).toBe(30)
    expect(player.segment).toEqual([10, 15])
    expect(player.currentFrame).toBe(10)
  })
})

describe('LottiePlayer change reporting', () => {
  it('reports a change only when the frame moves or the player was disturbed', () => {
    const player = make({ autoplay: false })
    expect(player.advance(DT).changed).toBe(true)
    expect(player.advance(DT).changed).toBe(false)
    player.seek(7)
    expect(player.advance(DT).changed).toBe(true)
    expect(player.advance(DT).changed).toBe(false)
    player.markDirty()
    const log = record(player)
    expect(player.advance(DT)).toEqual({ frame: 7, changed: true })
    expect(log).toEqual(['render:7'])
    expect(player.advance(DT).changed).toBe(false)
    player.play()
    expect(player.advance(DT).changed).toBe(true)
  })

  it('reports a change when stop or a segment change disturbs a paused player', () => {
    const player = make()
    drive(player, () => player.currentFrame >= 5)
    player.pause()
    player.advance(DT)
    player.setSegment(0, 20)
    expect(player.advance(DT).changed).toBe(true)
    player.stop()
    expect(player.advance(DT).changed).toBe(true)
  })
})

describe('LottiePlayer controller', () => {
  it('runs before the clock moves and may seek', () => {
    const player = make({ autoplay: false })
    const seen: number[] = []
    player.setController({
      update(p, dtMs) {
        seen.push(dtMs)
        p.seek(9)
      },
    })
    expect(player.advance(DT).frame).toBe(9)
    expect(seen).toEqual([DT])
    player.setController(null)
    player.seek(3)
    player.advance(DT)
    expect(seen).toHaveLength(1)
  })
})
