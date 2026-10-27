import { describe, expect, it, vi } from 'vitest'
import { fixtureStory as story } from '../story/fixture'
import { Run } from '../story/run'
import { AnswerRow } from './answerRow'
import { ROW_GAP, TILE_SIZE } from './rowLayout'
import { ENDING_POSE, MOTION, flightPoint, stepPose, type Pose } from './motion'
import { StoryDirector, poseOf, type DirectorMotion } from './storyDirector'
import { TrailView, type Tweener } from './trailView'

vi.mock('./motion', async (importOriginal) => {
  const original = await importOriginal<typeof import('./motion')>()
  return { ...original, flightPoint: vi.fn(original.flightPoint) }
})

/**
 * An engine whose tweens finish at once, or wait until released. A released
 * tween that was cancelled meanwhile rejects the way the real one does.
 */
function fakeEngine() {
  const waiting: Array<() => void> = []
  const engine = {
    holding: false,
    tweens: 0,
    tween<T extends object>(
      target: T,
      to: Partial<T>,
      opts: { onUpdate?: () => void; signal?: AbortSignal },
    ): Promise<void> {
      engine.tweens++
      const finish = (): void => {
        Object.assign(target, to)
        opts.onUpdate?.()
      }
      if (!engine.holding) {
        if (opts.signal?.aborted) {
          return Promise.reject(new DOMException('Aborted', 'AbortError'))
        }
        finish()
        return Promise.resolve()
      }
      return new Promise<void>((resolve, reject) => {
        waiting.push(() => {
          if (opts.signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          finish()
          resolve()
        })
      })
    },
    wait: () => Promise.resolve(),
    release(): void {
      engine.holding = false
      for (const go of waiting.splice(0)) go()
    },
  }
  return engine
}

function setup(opts: { stacked?: boolean } = {}) {
  const engine = fakeEngine()
  const motion: DirectorMotion = { text: 1, side: 1, nav: 1, trail: 1, sign: 1 }
  const trail = new TrailView(engine as unknown as Tweener)
  const rows = [new AnswerRow('A'), new AnswerRow('B'), new AnswerRow('C')]
  rows.forEach((row, i) => row.place(1024, 284 + i * (TILE_SIZE + ROW_GAP)))
  const log: string[] = []
  const poses: Array<{ pose: Pose; swell: boolean | undefined }> = []
  const pictures: number[] = []
  const snapshots: Array<Array<AnswerRow['pose']>> = []
  let shown: Run | null = null
  const director = new StoryDirector({
    engine: engine as never,
    motion,
    trail,
    rows: () => rows,
    trailOrigin: () => ({ x: 128, y: 63 }),
    rowWidth: () => 1664,
    stacked: () => opts.stacked ?? false,
    setRun: async (next) => {
      snapshots.push(rows.map((row) => ({ ...row.pose })))
      shown = next
      log.push(`run:${next.currentId}`)
    },
    setPicked: (id) => log.push(`picked:${id}`),
    showPicture: async (next) => {
      log.push(`picture:${next.currentId}`)
    },
    movePicture: (_x, alpha) => pictures.push(alpha),
    backdrop: {
      to: (pose, opts) => poses.push({ pose, swell: opts?.swell }),
    },
  })
  return {
    engine,
    motion,
    trail,
    rows,
    snapshots,
    log,
    poses,
    pictures,
    director,
    get shown() {
      return shown
    },
  }
}

const start = new Run(story)
const atChoice = start.continue()

describe('poseOf', () => {
  it('depends on the step', () => {
    expect(poseOf(start)).toEqual(stepPose(0))
    expect(poseOf(atChoice.choose('strict'))).toEqual(stepPose(2))
  })

  it('opens up for the ending', () => {
    let run = atChoice.choose('strict').continue()
    while (run.current.kind !== 'ending') {
      run =
        run.current.kind === 'choice'
          ? run.choose(run.current.options[0]!.id)
          : run.continue()
    }
    expect(poseOf(run)).toBe(ENDING_POSE)
  })
})

describe('StoryDirector.enter', () => {
  it('shows the run, moves the background and brings every part in', async () => {
    const t = setup()
    Object.assign(t.motion, { text: 0, side: 0, nav: 0, trail: 0 })
    await t.director.enter(start)
    expect(t.log).toEqual(['run:scenario', 'picture:scenario'])
    expect(t.poses[0]!.pose).toEqual(stepPose(0))
    expect(t.motion).toMatchObject({
      text: 1,
      side: 1,
      nav: 1,
      trail: 1,
      sign: 1,
    })
    expect(t.director.busy).toBe(false)
  })

  it('brings the answers of a choice in, each at rest', async () => {
    const t = setup()
    await t.director.enter(atChoice)
    for (const row of t.rows) {
      expect(row.pose.alpha).toBe(1)
      expect(row.pose.labelAlpha).toBe(1)
      expect(row.pose.offsetX).toBe(0)
      expect(row.pose.scale).toBe(1)
    }
  })
})

describe('StoryDirector.forward', () => {
  it('moves a plain screen on: the row grows, the background drifts, the new screen arrives from the right', async () => {
    const t = setup()
    t.trail.sync(start.progress(), 1664, { animate: false })
    const next = start.continue()
    await t.director.forward(next, null)
    expect(t.trail.count).toBe(1)
    expect(t.log).toEqual([
      'picked:null',
      'run:first-choice',
      'picture:first-choice',
    ])
    expect(t.poses).toHaveLength(1)
    expect(t.poses[0]).toMatchObject({ swell: true })
    expect(t.poses[0]!.pose).toEqual(poseOf(next))
    expect(t.motion).toMatchObject({ text: 1, side: 1, nav: 1, sign: 1 })
  })

  it('turns the picked answer into a circle that flies to the next mark and lands there', async () => {
    const t = setup()
    t.trail.sync(atChoice.progress(), 1664, { animate: false })
    const next = atChoice.choose('strict')
    await t.director.forward(next, { index: 0, id: 'strict' })
    const picked = t.snapshots[0]![0]!
    // Round and red, with its letter gone.
    expect(picked.radius).toBe(TILE_SIZE / 2)
    expect(picked.red).toBe(1)
    expect(picked.letterAlpha).toBe(0)
    // It flew from where it sat to the slot of the third mark, shrunk to its size.
    const from = { x: 1024 + TILE_SIZE / 2, y: 284 + TILE_SIZE / 2 }
    expect(picked.flightX).toBeCloseTo(128 + 18 + 52 - from.x)
    expect(picked.flightY).toBeCloseTo(63 + 18 - from.y)
    expect(picked.scale).toBeCloseTo(36 / TILE_SIZE)
    // The mark took its place, visible, and the circle is gone.
    expect(t.trail.count).toBe(2)
    expect(t.trail.markAt(1)?.visible).toBe(true)
    expect(picked.alpha).toBe(0)
  })

  it('flies up first on two columns and across first on one', async () => {
    for (const stacked of [false, true]) {
      vi.mocked(flightPoint).mockClear()
      const t = setup({ stacked })
      t.trail.sync(atChoice.progress(), 1664, { animate: false })
      await t.director.forward(atChoice.choose('strict'), {
        index: 0,
        id: 'strict',
      })
      const orders = vi.mocked(flightPoint).mock.calls.map((call) => call[3])
      expect(orders.length).toBeGreaterThan(0)
      expect(new Set(orders)).toEqual(
        new Set([stacked ? 'across-first' : 'up-first']),
      )
    }
  })

  it('names the picked answer before anything moves, and clears it for the next screen', async () => {
    const t = setup()
    t.trail.sync(atChoice.progress(), 1664, { animate: false })
    await t.director.forward(atChoice.choose('strict'), {
      index: 0,
      id: 'strict',
    })
    expect(t.log[0]).toBe('picked:strict')
    expect(t.log).toContain('picked:null')
    expect(t.log.indexOf('picked:null')).toBeLessThan(
      t.log.indexOf('run:strict-consequence'),
    )
  })

  it('sends the other answers away and the text with them', async () => {
    const t = setup()
    t.trail.sync(atChoice.progress(), 1664, { animate: false })
    t.motion.sign = 1
    let signAtLeave: number | null = null
    const original = t.engine.tween.bind(t.engine)
    t.engine.tween = ((
      target: object,
      to: Record<string, number>,
      opts: never,
    ) => {
      if (target === t.motion && 'text' in to && to.text === 0) {
        signAtLeave = t.motion.sign
      }
      return original(target as never, to as never, opts)
    }) as typeof t.engine.tween
    await t.director.forward(atChoice.choose('strict'), {
      index: 0,
      id: 'strict',
    })
    expect(signAtLeave).toBe(-1)
    // The two others ended hidden, where they slid to the left.
    for (const row of t.snapshots[0]!.slice(1)) {
      expect(row.alpha).toBe(0)
      expect(row.offsetX).toBe(-MOTION.dismissDistance)
    }
  })

  it('falls back to a plain move when the answer is not there', async () => {
    const t = setup()
    t.trail.sync(atChoice.progress(), 1664, { animate: false })
    await t.director.forward(atChoice.choose('strict'), {
      index: 7,
      id: 'strict',
    })
    expect(t.trail.count).toBe(2)
    expect(t.log).toContain('run:strict-consequence')
  })
})

describe('StoryDirector.back', () => {
  it('drops the last mark, returns the background and brings the screen in from the left', async () => {
    const t = setup()
    t.trail.sync(atChoice.progress(), 1664, { animate: false })
    await t.director.back(start)
    expect(t.trail.count).toBe(0)
    expect(t.poses[0]!.pose).toEqual(poseOf(start))
    expect(t.motion.sign).toBe(-1)
    expect(t.log).toEqual(['picked:null', 'run:scenario', 'picture:scenario'])
  })
})

describe('StoryDirector.exit', () => {
  it('takes everything out to the right', async () => {
    const t = setup()
    await t.director.exit()
    expect(t.motion).toMatchObject({
      text: 0,
      side: 0,
      nav: 0,
      trail: 0,
      sign: 1,
    })
  })
})

describe('StoryDirector cancelling', () => {
  it('is busy while a transition runs and not after', async () => {
    const t = setup()
    t.trail.sync(start.progress(), 1664, { animate: false })
    t.engine.holding = true
    const moving = t.director.forward(start.continue(), null)
    expect(t.director.busy).toBe(true)
    t.engine.release()
    await moving
    expect(t.director.busy).toBe(false)
  })

  it('leaves nothing half done when stopped in the middle', async () => {
    const t = setup()
    t.trail.sync(start.progress(), 1664, { animate: false })
    t.engine.holding = true
    const moving = t.director.forward(start.continue(), null)
    t.director.stop()
    expect(t.director.busy).toBe(false)
    t.engine.release()
    await moving
    // The screen was never swapped, so nothing shows the half-made move.
    expect(t.log).not.toContain('run:first-choice')
  })

  it('lets a newer transition replace one that was running', async () => {
    const t = setup()
    t.trail.sync(start.progress(), 1664, { animate: false })
    t.engine.holding = true
    const first = t.director.forward(start.continue(), null)
    const second = t.director.forward(start.continue(), null)
    t.engine.release()
    await Promise.all([first, second])
    expect(t.log.filter((entry) => entry === 'run:first-choice')).toHaveLength(
      1,
    )
    expect(t.director.busy).toBe(false)
  })
})
