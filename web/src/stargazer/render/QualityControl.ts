import type { RenderQuality } from './RenderQuality'
import type { Stage } from './Stage'
import {
  QUALITY_GROUPS,
  type QualityGroup,
  type QualityValues,
} from './qualityGroups'

/** The settings that are never lowered automatically, and are kept as set. */
export interface ManualQuality {
  shadowMapSize: number
  anisotropy: number
  pathShadows: boolean
  pathShadowSigma: number
  analyticShadowFrame: boolean
  dither: boolean
  /** Frame cap, `0` for none. */
  maxFps: number
}

/** The engine pieces {@link QualityControl} reads and writes. */
export interface QualityHost {
  readonly quality: RenderQuality
  readonly primaryStage: Stage
  readonly ticker: { readonly maxFps: number; setMaxFps(fps: number): void }
}

/** Whether a group follows the engine's own lowering or is held at a value. */
export type QualityMode = 'auto' | 'fixed'

/** A named set of values for the quality panel's preset row. */
export interface QualityPreset {
  id: QualityPresetId
  label: string
  /** One line on what it trades. */
  summary: string
  /** Groups held at a value. A group left out follows the engine. */
  fixed: Partial<QualityValues>
  manual: Partial<ManualQuality>
}

export type QualityPresetId =
  'auto' | 'max' | 'balanced' | 'efficient' | 'minimal'

/**
 * The presets, from most to least GPU work. `auto` pins nothing and lets the
 * engine lower settings when the GPU cannot keep up. The others pin every
 * group, so the result is the same on every run. A backend with no 2x MSAA
 * treats a request for 2 as 1.
 */
export const QUALITY_PRESETS: readonly QualityPreset[] = [
  {
    id: 'auto',
    label: 'Auto',
    summary:
      'Starts at the scene’s own settings and lowers them when the GPU falls behind.',
    fixed: {},
    manual: {},
  },
  {
    id: 'max',
    label: 'Max',
    summary:
      'Native resolution, 4× MSAA, full-resolution high AO, soft shadows.',
    fixed: {
      scale: 1,
      msaa: 4,
      shadows: 16,
      aoPreset: 'high',
      aoResolution: 'full',
    },
    manual: {
      shadowMapSize: 2048,
      anisotropy: 16,
      pathShadows: true,
      pathShadowSigma: 12,
      analyticShadowFrame: true,
      dither: true,
    },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    summary: 'Native resolution and 4× MSAA, with half-resolution medium AO.',
    fixed: {
      scale: 1,
      msaa: 4,
      shadows: 9,
      aoPreset: 'medium',
      aoResolution: 'half',
    },
    manual: {
      shadowMapSize: 1024,
      anisotropy: 8,
      pathShadows: true,
      pathShadowSigma: 8,
      analyticShadowFrame: true,
      dither: true,
    },
  },
  {
    id: 'efficient',
    label: 'Efficient',
    summary:
      'For an integrated GPU: 0.85 scale, 2× MSAA, low AO, 4-tap shadows.',
    fixed: {
      scale: 0.85,
      msaa: 2,
      shadows: 4,
      aoPreset: 'low',
      aoResolution: 'half',
    },
    manual: {
      shadowMapSize: 1024,
      anisotropy: 4,
      pathShadows: true,
      pathShadowSigma: 4,
      analyticShadowFrame: true,
      dither: true,
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    summary: '0.75 scale, no MSAA, no AO, hard shadows. The least GPU work.',
    fixed: {
      scale: 0.75,
      msaa: 1,
      shadows: 1,
      aoPreset: 'off',
      aoResolution: 'half',
    },
    manual: {
      shadowMapSize: 512,
      anisotropy: 1,
      pathShadows: true,
      pathShadowSigma: 4,
      analyticShadowFrame: true,
      dither: false,
    },
  },
]

/** What is saved for a screen: the pinned groups and the manual settings. */
interface SavedProfile {
  version: 1
  fixed: Partial<QualityValues>
  manual: Partial<ManualQuality>
}

const STORAGE_PREFIX = 'stargazer.quality.v1'

/**
 * The storage key for the screen this page is on. Tuning is per screen and per
 * pixel density, because the same GPU needs different settings on a 1080p panel
 * and a 4K one.
 */
export function defaultProfileKey(): string {
  if (typeof window === 'undefined') return `${STORAGE_PREFIX}.default`
  const s = window.screen
  return `${STORAGE_PREFIX}.${s.width}x${s.height}@${window.devicePixelRatio}`
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b
}

/**
 * Per-setting control over the quality the engine lowers on its own. Each of
 * the groups in {@link QUALITY_GROUPS} is either `auto`, left to the adaptive
 * controller that lowers it when the GPU cannot keep up, or `fixed` at a value
 * a person chose. A fixed group is enforced every frame, against a game that
 * sets the same setting itself, and the adaptive controller never lowers it.
 *
 * Fixed groups and the manual settings can be saved for this screen and put
 * back when the page loads, so a booth tuned once stays tuned.
 *
 * @example
 *   engine.qualityControl.setFixed('msaa', 2) // hold MSAA at 2x
 *   engine.qualityControl.setAuto('msaa') // hand it back to the engine
 *   engine.qualityControl.applyPreset('efficient')
 */
export class QualityControl {
  readonly #host: QualityHost
  readonly #storage: Storage | null
  readonly #key: string
  readonly #pins = new Map<QualityGroup, QualityValues[QualityGroup]>()
  /** What the engine last saw each pinned group at after applying it. */
  readonly #settled = new Map<QualityGroup, QualityValues[QualityGroup]>()
  /** The value a group had before it was first lowered or pinned. */
  readonly #ceiling = new Map<QualityGroup, QualityValues[QualityGroup]>()
  /** Groups the engine has lowered, and what each was lowered from. */
  readonly #lowered = new Map<QualityGroup, QualityValues[QualityGroup]>()
  readonly #bootManual: ManualQuality
  #revision = 0
  #saved = false

  constructor(
    host: QualityHost,
    opts: { storage?: Storage | null; key?: string } = {},
  ) {
    this.#host = host
    this.#storage =
      opts.storage !== undefined
        ? opts.storage
        : typeof localStorage !== 'undefined'
          ? localStorage
          : null
    this.#key = opts.key ?? defaultProfileKey()
    this.#bootManual = this.readManual()
  }

  /** Bumped when a pin or a manual setting changes, for a panel to redraw on. */
  get revision(): number {
    return this.#revision
  }

  /** Whether saved settings were found and applied for this screen. */
  get saved(): boolean {
    return this.#saved
  }

  /** The groups held at a value, for the adaptive controller to skip. */
  pinned(): readonly QualityGroup[] {
    return [...this.#pins.keys()]
  }

  mode(group: QualityGroup): QualityMode {
    return this.#pins.has(group) ? 'fixed' : 'auto'
  }

  /** The value `group` is at now, or `null` where it does not apply yet. */
  read<G extends QualityGroup>(group: G): QualityValues[G] | null {
    const q = this.#host.quality
    const stage = this.#host.primaryStage
    switch (group) {
      case 'msaa':
        return stage.getMsaaSamples() as QualityValues[G]
      case 'scale':
        return stage.renderScale as QualityValues[G]
      case 'shadows':
        return (q.meshShadowsEnabled ? q.shadowSoftness : 0) as QualityValues[G]
      case 'aoPreset': {
        const ao = stage.peekAmbientOcclusion()
        if (!ao) return null
        return (ao.enabled ? ao.preset : 'off') as QualityValues[G]
      }
      case 'aoResolution': {
        const ao = stage.peekAmbientOcclusion()
        return (ao ? ao.resolution : null) as QualityValues[G] | null
      }
    }
    return null
  }

  /**
   * Every group's value now, with the AO ones at their defaults before AO
   * exists.
   */
  readAll(): QualityValues {
    return {
      msaa: this.read('msaa') ?? 1,
      scale: this.read('scale') ?? 1,
      shadows: this.read('shadows') ?? 0,
      aoPreset: this.read('aoPreset') ?? 'off',
      aoResolution: this.read('aoResolution') ?? 'full',
    }
  }

  /** What the engine lowered `group` from, or `undefined` if it has not. */
  loweredFrom<G extends QualityGroup>(group: G): QualityValues[G] | undefined {
    return this.#lowered.get(group) as QualityValues[G] | undefined
  }

  /** Called by the engine just before it lowers `group`. */
  noteLowered(group: QualityGroup): void {
    const now = this.read(group)
    if (now === null) return
    if (!this.#ceiling.has(group)) this.#ceiling.set(group, now)
    if (!this.#lowered.has(group)) this.#lowered.set(group, now)
  }

  /** Hold `group` at `value`. Applied now and enforced every frame. */
  setFixed<G extends QualityGroup>(group: G, value: QualityValues[G]): void {
    const now = this.read(group)
    if (now !== null && !this.#ceiling.has(group)) {
      this.#ceiling.set(group, this.#lowered.get(group) ?? now)
    }
    this.#lowered.delete(group)
    this.#pins.set(group, value)
    this.#apply(group, value)
    const applied = this.read(group)
    if (applied === null) this.#settled.delete(group)
    else this.#settled.set(group, applied)
    this.#bump()
  }

  /**
   * Give `group` back to the engine. It returns to the value it had before it
   * was pinned or lowered, so the engine starts again from the top rather than
   * from wherever it was left.
   */
  setAuto(group: QualityGroup): void {
    this.#pins.delete(group)
    this.#settled.delete(group)
    this.#lowered.delete(group)
    const ceiling = this.#ceiling.get(group)
    this.#ceiling.delete(group)
    if (ceiling !== undefined) this.#apply(group, ceiling)
    this.#bump()
  }

  /** Give every group back to the engine. */
  setAllAuto(): void {
    for (const g of QUALITY_GROUPS) {
      if (this.#pins.has(g) || this.#lowered.has(g)) this.setAuto(g)
    }
  }

  /** The manual settings now. */
  readManual(): ManualQuality {
    const q = this.#host.quality
    return {
      shadowMapSize: q.shadowMapSize,
      anisotropy: q.anisotropy,
      pathShadows: q.vector.pathShadowsEnabled,
      pathShadowSigma: q.vector.shadowSigmaBudget,
      analyticShadowFrame: q.vector.analyticShadowFrame,
      dither: q.vector.dither,
      maxFps: this.#host.ticker.maxFps,
    }
  }

  setManual(patch: Partial<ManualQuality>): void {
    const q = this.#host.quality
    if (patch.shadowMapSize !== undefined) q.shadowMapSize = patch.shadowMapSize
    if (patch.anisotropy !== undefined) q.anisotropy = patch.anisotropy
    if (patch.pathShadows !== undefined)
      q.vector.pathShadowsEnabled = patch.pathShadows
    if (patch.pathShadowSigma !== undefined)
      q.vector.shadowSigmaBudget = patch.pathShadowSigma
    if (patch.analyticShadowFrame !== undefined)
      q.vector.analyticShadowFrame = patch.analyticShadowFrame
    if (patch.dither !== undefined) q.vector.dither = patch.dither
    if (patch.maxFps !== undefined) this.#host.ticker.setMaxFps(patch.maxFps)
    this.#bump()
  }

  /**
   * Apply a preset: pin the groups it names, free the rest, set the manual
   * ones.
   */
  applyPreset(id: QualityPresetId): void {
    const preset = QUALITY_PRESETS.find((p) => p.id === id)
    if (!preset) return
    for (const g of QUALITY_GROUPS) {
      const v = preset.fixed[g]
      if (v === undefined) {
        if (this.#pins.has(g)) this.setAuto(g)
      } else {
        this.setFixed(g, v)
      }
    }
    this.setManual(preset.manual)
  }

  /** The preset whose values match what is pinned and set now, if any. */
  matchingPreset(): QualityPresetId | null {
    const manual = this.readManual()
    for (const p of QUALITY_PRESETS) {
      const groupsMatch = QUALITY_GROUPS.every((g) => {
        const want = p.fixed[g]
        return want === undefined
          ? !this.#pins.has(g)
          : sameValue(this.#pins.get(g), want)
      })
      if (!groupsMatch) continue
      const keys = Object.keys(p.manual) as (keyof ManualQuality)[]
      if (keys.every((k) => sameValue(manual[k], p.manual[k]))) return p.id
    }
    return null
  }

  /**
   * Put every pinned group back to its pinned value if something else changed
   * it, and apply a pin that was waiting for something to exist (ambient
   * occlusion that a scene creates later). The engine calls this each frame.
   */
  enforce(): void {
    if (this.#pins.size === 0) return
    for (const [group, value] of this.#pins) {
      const now = this.read(group)
      if (now === null) continue
      if (sameValue(now, this.#settled.get(group))) continue
      if (!sameValue(now, value)) this.#apply(group, value)
      this.#settled.set(group, this.read(group) as QualityValues[QualityGroup])
    }
  }

  #apply(group: QualityGroup, value: QualityValues[QualityGroup]): void {
    const q = this.#host.quality
    const stage = this.#host.primaryStage
    switch (group) {
      case 'msaa':
        stage.setMsaaSamples(value as number)
        break
      case 'scale':
        stage.renderScale = value as number
        break
      case 'shadows':
        if (value === 0) {
          q.meshShadowsEnabled = false
        } else {
          q.meshShadowsEnabled = true
          q.shadowSoftness = value as number
        }
        break
      case 'aoPreset': {
        const ao = stage.peekAmbientOcclusion()
        if (!ao) break
        if (value === 'off') {
          ao.enabled = false
        } else {
          ao.enabled = true
          ao.preset = value as 'low' | 'medium' | 'high'
        }
        break
      }
      case 'aoResolution': {
        const ao = stage.peekAmbientOcclusion()
        if (ao) ao.resolution = value as 'full' | 'half'
        break
      }
    }
  }

  #bump(): void {
    this.#revision++
    this.#persist()
  }

  // --- saving ---------------------------------------------------------------

  /** Write the pinned groups and manual settings for this screen. */
  #persist(): void {
    if (!this.#storage || !this.#persistEnabled) return
    const fixed: Partial<QualityValues> = {}
    for (const [g, v] of this.#pins) (fixed as Record<string, unknown>)[g] = v
    const profile: SavedProfile = {
      version: 1,
      fixed,
      manual: this.readManual(),
    }
    try {
      this.#storage.setItem(this.#key, JSON.stringify(profile))
      this.#saved = true
    } catch {
      // Storage full or blocked: tuning still applies for this session.
    }
  }

  #persistEnabled = false

  /**
   * Apply what was saved for this screen, and keep saving from now on. Call it
   * once when the host is created. Returns whether anything was found.
   */
  restore(): boolean {
    if (!this.#storage) {
      this.#persistEnabled = true
      return false
    }
    let profile: SavedProfile | null = null
    try {
      const raw = this.#storage.getItem(this.#key)
      profile = raw ? (JSON.parse(raw) as SavedProfile) : null
    } catch {
      profile = null
    }
    if (!profile || profile.version !== 1) {
      this.#persistEnabled = true
      return false
    }
    this.#persistEnabled = false
    for (const g of QUALITY_GROUPS) {
      const v = profile.fixed[g]
      if (v !== undefined) this.setFixed(g, v as never)
    }
    this.setManual(profile.manual)
    this.#persistEnabled = true
    this.#saved = true
    return true
  }

  /**
   * Forget what was saved for this screen and give every group back to the
   * engine.
   */
  reset(): void {
    this.#persistEnabled = false
    this.setAllAuto()
    this.setManual(this.#bootManual)
    this.#persistEnabled = true
    try {
      this.#storage?.removeItem(this.#key)
    } catch {
      // Nothing saved, nothing to forget.
    }
    this.#saved = false
    this.#revision++
  }

  /** Stop saving, for a host that asked not to keep a profile. */
  disablePersistence(): void {
    this.#persistEnabled = false
  }
}
