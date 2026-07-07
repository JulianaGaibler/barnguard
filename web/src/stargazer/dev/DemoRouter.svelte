<script lang="ts">
  import { onMount } from 'svelte'
  import { demos } from './demos'
  import type { DemoCleanup } from './types'
  import type { EngineHost } from '../engine/EngineHost'
  import DebugHud from '../debug/DebugHud.svelte'

  interface Props {
    demoName: string
  }
  const { demoName }: Props = $props()

  let canvas = $state<HTMLCanvasElement | null>(null)
  let status = $state<'loading' | 'running' | 'missing' | 'error'>('loading')
  let errorMessage = $state<string | null>(null)
  let host = $state<EngineHost | null>(null)

  onMount(() => {
    const controller = new AbortController()

    const load = async (): Promise<DemoCleanup> => {
      const factory = demos[demoName]
      if (!factory) {
        status = 'missing'
        return undefined
      }
      const canvasEl = canvas
      if (!canvasEl) return undefined
      try {
        const demo = await factory()
        const cleanup = await demo({
          canvas: canvasEl,
          signal: controller.signal,
          attach: (h) => {
            host = h
          },
        })
        status = 'running'
        return cleanup
      } catch (err) {
        status = 'error'
        errorMessage = err instanceof Error ? err.message : String(err)
        return undefined
      }
    }

    const cleanupPromise = load()

    return () => {
      controller.abort()
      cleanupPromise.then((cleanup) => {
        if (typeof cleanup === 'function') cleanup()
        host = null
      })
    }
  })

  const known = $derived(Object.keys(demos))
</script>

<div class="demo">
  <canvas class="demo__canvas" bind:this={canvas}></canvas>
  {#if status === 'loading'}
    <div class="demo__overlay">Loading demo <code>{demoName}</code>…</div>
  {:else if status === 'missing'}
    <div class="demo__overlay">
      <p>Unknown demo: <code>{demoName}</code></p>
      {#if known.length > 0}
        <p>Try: {known.map((k) => `?demo=${k}`).join(' · ')}</p>
      {:else}
        <p>No demos registered yet.</p>
      {/if}
    </div>
  {:else if status === 'error'}
    <div class="demo__overlay">
      <p>Demo <code>{demoName}</code> failed:</p>
      <pre>{errorMessage}</pre>
    </div>
  {/if}
</div>

{#if host?.debug}
  <DebugHud debug={host.debug} />
{/if}

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
