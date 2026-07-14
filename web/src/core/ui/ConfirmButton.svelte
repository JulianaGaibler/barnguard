<script lang="ts" module>
  /**
   * Coordinator for mutual-exclusive confirmation. When a button arms, it
   * claims the coordinator; any button previously armed in the same group
   * auto-disarms. Create one per group (usually per panel) and pass it into
   * every `<ConfirmButton>` that should participate.
   */
  export interface ConfirmCoordinator {
    /** Called by a button when it arms; `release` disarms this button. */
    claim(release: () => void): void
  }

  /**
   * Factory for a group coordinator. Safe to call in a component's script; the
   * returned object is a plain closure over one slot — no reactivity of its
   * own, since each button owns its own `armed` state and the coordinator only
   * needs to relay a disarm signal.
   */
  export function createConfirmCoordinator(): ConfirmCoordinator {
    let releaseActive: (() => void) | null = null
    return {
      claim(release: () => void): void {
        if (releaseActive !== null && releaseActive !== release) {
          releaseActive()
        }
        releaseActive = release
      },
    }
  }
</script>

<script lang="ts">
  /**
   * Two-tap destructive-action button. First tap arms (label swaps, `.danger`
   * highlight); second tap within `timeoutMs` fires `onConfirm`. Auto-disarms
   * after the timeout so a stray tap can't leave the button hot indefinitely.
   *
   * Pass an optional `coordinator` to enforce mutual exclusivity with other
   * confirm buttons — arming any one in the group disarms the others.
   */
  interface Props {
    /** Idle-state label. */
    label: string
    /** Armed-state label. Default: `Tap again to <label lowercased>`. */
    armedLabel?: string
    /** Fires on the second (confirming) tap. */
    onConfirm: () => void
    disabled?: boolean
    /** Auto-disarm window. */
    timeoutMs?: number
    /** Overrides `debug-btn`. Use e.g. an app-level primary/secondary class. */
    class?: string
    /** Optional mutual-exclusion group; see `ConfirmCoordinator`. */
    coordinator?: ConfirmCoordinator
    title?: string
  }

  let {
    label,
    armedLabel,
    onConfirm,
    disabled = false,
    timeoutMs = 3000,
    class: klass = 'debug-btn',
    coordinator,
    title,
  }: Props = $props()

  let armed = $state(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  const shownLabel = $derived.by(() => {
    if (!armed) return label
    return armedLabel ?? `Tap again to ${label.toLowerCase()}`
  })

  function disarm(): void {
    armed = false
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function handleClick(): void {
    if (disabled) return
    if (armed) {
      disarm()
      onConfirm()
      return
    }
    armed = true
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      armed = false
      timer = null
    }, timeoutMs)
    coordinator?.claim(disarm)
  }
</script>

<button
  type="button"
  class={klass}
  class:danger={armed}
  {disabled}
  {title}
  onclick={handleClick}
>
  {shownLabel}
</button>
