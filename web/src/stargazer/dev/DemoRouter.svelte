<script lang="ts">
  /**
   * The demo stage: a standalone dev surface mounted directly by `main.ts` for
   * a `?demo=…` run. It is not a kiosk display: no theme, no booth chrome, no
   * attendant panels, just one demo on a full-bleed canvas, the debug HUD when
   * the demo exposes one, and the nav bar to switch between demos.
   *
   * Switching swaps the demo in place: the running demo is aborted and cleaned
   * up, the canvas element is re-created (a lost/handed-off GPU context can't
   * be re-configured on the same canvas), and the URL is pushed so reload and
   * the browser's back button land where you'd expect.
   */
  import { demos } from './demos'
  import type { DemoCleanup } from './types'
  import type { EngineHost } from '../engine/EngineHost'
  import DebugHud from '../debug/DebugHud.svelte'
  import DemoNav from './DemoNav.svelte'

  /**
   * The `?demo=` value, or `null` when the parameter is absent entirely.
   * Present-but-unknown (and present-but-empty) shows the picker.
   */
  const demoFromUrl = (): string | null =>
    new URLSearchParams(window.location.search).get('demo')

  // The stage owns the URL ↔ demo mapping: it is mounted straight from
  // `main.ts` with no props, seeds itself from the query string, and pushes
  // every switch back to it.
  let active = $state(demoFromUrl() ?? '')
  let canvas = $state<HTMLCanvasElement | null>(null)
  let status = $state<'loading' | 'running' | 'missing' | 'error'>('loading')
  let errorMessage = $state<string | null>(null)
  let host = $state<EngineHost | null>(null)

  function select(name: string): void {
    if (name === active) return
    const url = new URL(window.location.href)
    url.searchParams.set('demo', name)
    history.pushState({ demo: name }, '', url)
    active = name
  }

  // Back/forward between demos the nav pushed.
  $effect(() => {
    const onPop = (): void => {
      const next = demoFromUrl()
      // Stepping back past the entry into the stage leaves the URL on a
      // display (or the landing page), which only `main.ts` can mount.
      if (next === null) {
        window.location.reload()
        return
      }
      active = next
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  })

  // Run the active demo. Re-runs on every switch, the teardown below aborts the
  // outgoing demo before the next one boots.
  $effect(() => {
    const name = active
    const canvasEl = canvas
    if (!canvasEl) return

    const controller = new AbortController()
    status = 'loading'
    errorMessage = null

    const load = async (): Promise<DemoCleanup> => {
      const factory = demos[name]
      if (!factory) {
        status = 'missing'
        return undefined
      }
      try {
        const demo = await factory()
        const cleanup = await demo({
          canvas: canvasEl,
          signal: controller.signal,
          attach: (h) => {
            if (!controller.signal.aborted) host = h
          },
        })
        // A switch mid-load leaves this run stale. The teardown owns the
        // cleanup, and the incoming demo owns the status.
        if (!controller.signal.aborted) status = 'running'
        return cleanup
      } catch (err) {
        if (!controller.signal.aborted) {
          status = 'error'
          errorMessage = err instanceof Error ? err.message : String(err)
        }
        return undefined
      }
    }

    const cleanupPromise = load()

    return () => {
      controller.abort()
      host = null
      void cleanupPromise.then((cleanup) => {
        if (typeof cleanup === 'function') cleanup()
      })
    }
  })
</script>

<div class="demo">
  <!--
    Keyed on the demo so each one gets a fresh canvas: a WebGPU context that
    has been configured by a dropped device can't be reused by the next.
  -->
  {#key active}
    <canvas class="demo__canvas" bind:this={canvas}></canvas>
  {/key}

  {#if status === 'loading'}
    <div class="demo__overlay">Loading demo <code>{active}</code>…</div>
  {:else if status === 'missing'}
    <div class="demo__overlay">
      {#if Object.keys(demos).length === 0}
        <p>No demos registered yet.</p>
      {:else if active === ''}
        <p>Pick a demo below.</p>
      {:else}
        <p>Unknown demo <code>{active}</code>. Pick one below.</p>
      {/if}
    </div>
  {:else if status === 'error'}
    <div class="demo__overlay">
      <p>Demo <code>{active}</code> failed:</p>
      <pre>{errorMessage}</pre>
    </div>
  {/if}
</div>

{#if host?.debug}
  <DebugHud debug={host.debug} />
{/if}

<DemoNav current={active} {select} />

<style lang="sass">
  .demo
    position: fixed
    inset: 0
    background: #0d1a2c
    overflow: hidden

  .demo__canvas
    position: absolute
    inset: 0
    width: 100%
    height: 100%
    display: block
    touch-action: none
    user-select: none
    -webkit-user-select: none
    -webkit-touch-callout: none
    outline: none

  .demo__overlay
    position: absolute
    top: tint.$size-16
    left: tint.$size-16
    padding: tint.$size-16
    background: rgba(0, 0, 0, 0.6)
    color: #fdf6e3
    border-radius: tint.$size-8
    font-family: monospace
    pointer-events: none
    max-width: 60ch
</style>
