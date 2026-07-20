<script lang="ts">
  import type { DebugController } from '../DebugController'
  import type { TextureInspectorSnapshot } from '../../render/gfx/gpu/TextureManager'
  import DebugSection from './DebugSection.svelte'
  import DebugRow from './DebugRow.svelte'
  import ProgressBar from './ProgressBar.svelte'

  interface Props {
    debug: DebugController
    /** Whether the parent's Textures `<details>` is open. Gates all work. */
    open: boolean
    /** Bumped by the HUD's rAF poll. We throttle off it. */
    revision: number
  }

  const { debug, open, revision }: Props = $props()

  // `CanvasImageSource` is a type-only DOM global (no runtime value), so we
  // reference it through the snapshot type rather than by name.
  type Drawable = TextureInspectorSnapshot['perSource'][number]['source']

  // Snapshot poll is throttled: counts don't need 60 Hz, and this keeps the
  // panel cheap. `null` snapshot = the active stage isn't on the GPU backend.
  const POLL_MS = 250

  let snap = $state<TextureInspectorSnapshot | null>(null)
  let hasGpu = $state(true)
  let selectedLabel = $state<string | null>(null)
  let lastPoll = 0

  $effect(() => {
    void revision // re-run each HUD tick
    if (!open) return
    const now = performance.now()
    if (now - lastPoll < POLL_MS) return
    lastPoll = now
    const inspector = debug.activeStage.textureInspector
    hasGpu = inspector !== null
    snap = inspector ? inspector.snapshot() : null
  })

  // Preview canvas for the selected label. Recomputed only when the selection
  // changes (re-rasterizes on the CPU, no GPU readback); null otherwise.
  const labelPreview = $derived(
    selectedLabel !== null
      ? (debug.activeStage.textureInspector?.renderLabelPreview(
          selectedLabel,
        ) ?? null)
      : null,
  )

  function pct(used: number, cap: number): number {
    return cap > 0 ? (used / cap) * 100 : 0
  }

  function shortText(t: string): string {
    return t.length > 24 ? t.slice(0, 23) + '…' : t
  }

  interface FitParams {
    source: Drawable | null
    srcW: number
    srcH: number
    /** Longest edge of the preview, CSS px. */
    max: number
  }

  /**
   * Draw a `CanvasImageSource` into `node`, contained within a `max`-px box at
   * device resolution. Reused for the atlas, per-source thumbnails, and the
   * label preview. Redraws when its params change.
   */
  function fitImage(node: HTMLCanvasElement, params: FitParams) {
    function render(p: FitParams): void {
      const ctx = node.getContext('2d')
      if (!ctx) return
      if (!p.source || p.srcW <= 0 || p.srcH <= 0) {
        node.width = 1
        node.height = 1
        node.style.width = '0px'
        node.style.height = '0px'
        return
      }
      const scale = Math.min(p.max / p.srcW, p.max / p.srcH)
      const cw = Math.max(1, Math.round(p.srcW * scale))
      const ch = Math.max(1, Math.round(p.srcH * scale))
      const dpr = window.devicePixelRatio || 1
      node.width = Math.round(cw * dpr)
      node.height = Math.round(ch * dpr)
      node.style.width = `${cw}px`
      node.style.height = `${ch}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cw, ch)
      ctx.drawImage(p.source, 0, 0, cw, ch)
    }
    render(params)
    return { update: render }
  }
</script>

{#if !hasGpu}
  <p class="hint">Texture inspection is GPU-backend only.</p>
{:else if snap}
  <DebugSection title="Summary" open={true}>
    <DebugRow
      label="Atlas tiles"
      value={`${snap.atlas.used} / ${snap.atlas.capacity}`}
      tone={snap.atlas.full ? 'warning' : 'default'}
    />
    <ProgressBar percentage={pct(snap.atlas.used, snap.atlas.capacity)} />
    <DebugRow label="Labels" value={`${snap.labelCount} / ${snap.labelCap}`} />
    <ProgressBar percentage={pct(snap.labelCount, snap.labelCap)} />
    <DebugRow
      label="Label regens / frame"
      value={`${snap.labelRegensThisFrame} / ${snap.labelMaxRegensPerFrame}`}
      tone={snap.labelRegensThisFrame >= snap.labelMaxRegensPerFrame
        ? 'warning'
        : 'default'}
    />
    <DebugRow label="Per-source images" value={snap.perSource.length} />
  </DebugSection>

  <DebugSection title={`Atlas (${snap.atlas.width}×${snap.atlas.height})`}>
    {#if snap.atlas.canvas}
      <div class="preview">
        <canvas
          class="checker"
          use:fitImage={{
            source: snap.atlas.canvas,
            srcW: snap.atlas.width,
            srcH: snap.atlas.height,
            max: 260,
          }}
        ></canvas>
      </div>
    {:else}
      <p class="hint">Atlas not yet allocated.</p>
    {/if}
  </DebugSection>

  <DebugSection title={`Labels (${snap.labels.length})`} maxHeight={true}>
    {#if snap.labels.length === 0}
      <p class="hint">No cached labels.</p>
    {/if}
    {#each snap.labels as label (label.key)}
      <button
        class="row"
        class:selected={selectedLabel === label.key}
        onpointerdown={(e) => e.preventDefault()}
        onclick={() =>
          (selectedLabel = selectedLabel === label.key ? null : label.key)}
      >
        <span class="text" title={label.text}>{shortText(label.text)}</span>
        <span class="meta">{label.texW}×{label.texH} · b{label.bucket}</span>
      </button>
      {#if selectedLabel === label.key}
        <div class="preview">
          {#if labelPreview}
            <canvas
              class="checker"
              use:fitImage={{
                source: labelPreview,
                srcW: labelPreview.width,
                srcH: labelPreview.height,
                max: 260,
              }}
            ></canvas>
          {:else}
            <p class="hint">Preview unavailable.</p>
          {/if}
        </div>
      {/if}
    {/each}
  </DebugSection>

  <DebugSection
    title={`Per-source (${snap.perSource.length})`}
    maxHeight={true}
  >
    {#if snap.perSource.length === 0}
      <p class="hint">No per-source textures.</p>
    {/if}
    <div class="thumbs">
      {#each snap.perSource as ps, i (i)}
        <figure class="thumb">
          <canvas
            class="checker"
            use:fitImage={{
              source: ps.source,
              srcW: ps.width,
              srcH: ps.height,
              max: 72,
            }}
          ></canvas>
          <figcaption>{ps.width}×{ps.height}</figcaption>
        </figure>
      {/each}
    </div>
  </DebugSection>
{:else}
  <p class="hint">No texture data.</p>
{/if}

<style lang="sass">
  .hint
    margin: 2px 0
    font-size: 10px
    color: rgba(255, 255, 255, 0.5)

  .preview
    display: flex
    justify-content: center
    padding: 4px 0

  // Checkerboard so transparent regions of a texture are visible.
  .checker
    display: block
    max-width: 100%
    border: 1px solid rgba(255, 255, 255, 0.1)
    border-radius: 2px
    background-color: rgba(255, 255, 255, 0.06)
    background-image: linear-gradient(45deg, rgba(255, 255, 255, 0.08) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.08) 75%), linear-gradient(45deg, rgba(255, 255, 255, 0.08) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.08) 75%)
    background-size: 12px 12px
    background-position: 0 0, 6px 6px

  .row
    display: flex
    align-items: baseline
    justify-content: space-between
    gap: 8px
    width: 100%
    padding: 2px 4px
    border: 0
    border-radius: 2px
    background: transparent
    color: inherit
    font: inherit
    text-align: left
    cursor: pointer

    &:hover
      background: rgba(255, 255, 255, 0.06)

    &.selected
      background: rgba(96, 165, 250, 0.18)

    .text
      overflow: hidden
      white-space: nowrap
      text-overflow: ellipsis

    .meta
      flex-shrink: 0
      font-size: 9px
      color: rgba(255, 255, 255, 0.5)

  .thumbs
    display: flex
    flex-wrap: wrap
    gap: 6px

  .thumb
    margin: 0
    display: flex
    flex-direction: column
    align-items: center
    gap: 2px

    figcaption
      font-size: 9px
      color: rgba(255, 255, 255, 0.5)
</style>
