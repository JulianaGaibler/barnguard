<script lang="ts">
  import { tweened } from 'svelte/motion'
  import { cubicOut } from 'svelte/easing'

  interface Props {
    /** Target value the display counts up (or down) to. */
    value: number
    /** Tween duration in milliseconds. Default 1000 ms. */
    durationMs?: number
    /** Fired once the tween finishes (or immediately if `value` is 0). */
    onComplete?: () => void
    /** Class forwarded onto the rendered `<span>`. */
    class?: string
  }

  const {
    value,
    durationMs = 1000,
    onComplete,
    class: cls = '',
  }: Props = $props()

  // Snapshot `durationMs` at mount; the tween store's default duration
  // is only read at creation. Wrapping the read in an IIFE tells Svelte
  // we intentionally captured the initial value (the compiler warns on
  // direct prop reads at the module-scope of a component).
  const store = ((): ReturnType<typeof tweened<number>> =>
    tweened(0, { duration: durationMs, easing: cubicOut }))()
  let displayed = $state(0)

  // Reactive: when `value` changes, kick off a new tween. The Promise
  // returned by `store.set` resolves when the tween settles, at which
  // point we fire `onComplete`. `cancelled` guards a mid-flight change
  // (or unmount) so we don't call a stale callback.
  $effect(() => {
    let cancelled = false
    void store.set(value).then(() => {
      if (!cancelled) onComplete?.()
    })
    return () => {
      cancelled = true
    }
  })

  // Mirror the tweened store into a $state so the template gets Svelte
  // reactivity. Rounding per-frame is cheap and keeps the display an
  // integer throughout the ramp.
  $effect(() => {
    const unsub = store.subscribe((v) => {
      displayed = Math.round(v)
    })
    return unsub
  })
</script>

<span class={cls}>{displayed}</span>
