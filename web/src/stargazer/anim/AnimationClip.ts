import type { Node3D } from '../scene/Node3D'
import { quat, quatSlerp } from '../math/Quat'

/**
 * Keyframe interpolation for an {@link AnimationSampler}. `CUBICSPLINE` is
 * approximated as `LINEAR` over the value keyframes (the tangents are ignored);
 * the two glTF assets this engine targets use only `LINEAR`.
 *
 * @category Animation
 */
export type Interpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE'

/** The transform component an {@link AnimationChannel} drives. */
export type ChannelPath = 'translation' | 'rotation' | 'scale'

/**
 * Keyframe times and values for one channel. `output` is `input.length`
 * elements of stride 3 (translation/scale) or 4 (rotation), or three times that
 * for `CUBICSPLINE` (in-tangent, value, out-tangent per keyframe).
 *
 * @category Animation
 */
export interface AnimationSampler {
  input: Float32Array
  output: Float32Array
  interpolation: Interpolation
}

/** One channel: a sampler driving a `path` on a target node. */
export interface AnimationChannel {
  target: Node3D
  path: ChannelPath
  sampler: AnimationSampler
}

/**
 * A named set of channels plus the clip `duration` (the latest keyframe time).
 * Play it with an {@link AnimationPlayer}.
 *
 * @category Animation
 */
export interface AnimationClip {
  name: string
  channels: AnimationChannel[]
  duration: number
}

let warnedCubic = false
const scratchA = new Float64Array(4)
const scratchB = new Float64Array(4)
const qa = quat()
const qb = quat()
const qo = quat()

/**
 * Sample `clip` at `time` (seconds) and write each channel into its target's
 * transform.
 */
export function applyAnimation(clip: AnimationClip, time: number): void {
  for (const channel of clip.channels) sampleChannel(channel, time)
}

function sampleChannel(channel: AnimationChannel, time: number): void {
  const { sampler, target, path } = channel
  const times = sampler.input
  const n = times.length
  if (n === 0) return
  const stride = path === 'rotation' ? 4 : 3
  const cubic = sampler.interpolation === 'CUBICSPLINE'
  if (cubic && !warnedCubic) {
    warnedCubic = true
    console.warn(
      'AnimationClip: CUBICSPLINE interpolation is approximated as LINEAR.',
    )
  }
  // CUBICSPLINE stores [inTangent, value, outTangent] per keyframe; take value.
  const valueAt = (k: number, out: Float64Array): void => {
    const base = (cubic ? k * 3 + 1 : k) * stride
    for (let c = 0; c < stride; c++) out[c] = sampler.output[base + c]
  }

  let i0: number
  let i1: number
  let f: number
  if (time <= times[0]) {
    i0 = i1 = 0
    f = 0
  } else if (time >= times[n - 1]) {
    i0 = i1 = n - 1
    f = 0
  } else {
    let lo = 0
    let hi = n - 1
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1
      if (times[mid] <= time) lo = mid
      else hi = mid
    }
    i0 = lo
    i1 = lo + 1
    const span = times[i1] - times[i0]
    f = span > 0 ? (time - times[i0]) / span : 0
  }

  valueAt(i0, scratchA)
  const step = sampler.interpolation === 'STEP' || i0 === i1
  if (path === 'rotation') {
    if (step) {
      target.transform.setRotation(
        scratchA[0],
        scratchA[1],
        scratchA[2],
        scratchA[3],
      )
      return
    }
    valueAt(i1, scratchB)
    qa.x = scratchA[0]
    qa.y = scratchA[1]
    qa.z = scratchA[2]
    qa.w = scratchA[3]
    qb.x = scratchB[0]
    qb.y = scratchB[1]
    qb.z = scratchB[2]
    qb.w = scratchB[3]
    quatSlerp(qo, qa, qb, f)
    target.transform.setRotation(qo.x, qo.y, qo.z, qo.w)
    return
  }
  let x = scratchA[0]
  let y = scratchA[1]
  let z = scratchA[2]
  if (!step) {
    valueAt(i1, scratchB)
    x += (scratchB[0] - x) * f
    y += (scratchB[1] - y) * f
    z += (scratchB[2] - z) * f
  }
  if (path === 'translation') target.transform.setPosition(x, y, z)
  else target.transform.setScale(x, y, z)
}
