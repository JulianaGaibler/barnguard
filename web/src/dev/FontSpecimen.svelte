<script lang="ts">
  /**
   * Font specimen: an overview of the typefaces the app ships. Mounted by
   * `main.ts` for a `?fonts` run.
   *
   * Each family is shown at poster size, across its weights, and small enough
   * to judge legibility — plus the same string drawn on canvas, because that is
   * a different rasterizer and a face can behave differently there.
   */
  import {
    DEFAULT_FONTS,
    FAMILIES,
    FONT_CATALOGUE,
    FONT_ROLES,
    isVariableWeights,
    primaryFamily,
    type FontFamilyEntry,
    type FontWeights,
  } from '@src/core/theme'

  const PANGRAM = 'Sphinx of black quartz, judge my vow'
  const GERMAN = 'Größenwahn, Bäckerstraße'
  const DIGITS = '0123456789'

  const kebab = (k: string): string =>
    k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)

  const weightsLabel = (w: FontWeights): string =>
    isVariableWeights(w)
      ? `variable ${w.variable[0]}–${w.variable[1]}`
      : w.join(' · ')

  const ladder = (w: FontWeights): number[] =>
    isVariableWeights(w) ? [200, 400, 600, 800] : [...w]

  /** Which role, if any, this family is the default for. */
  const roleFor = (entry: FontFamilyEntry): string | null => {
    for (const role of FONT_ROLES) {
      if (primaryFamily(DEFAULT_FONTS[role]) === entry.family) return role
    }
    return null
  }

  // --- canvas strip ---------------------------------------------------------

  let canvas = $state<HTMLCanvasElement | null>(null)

  const ROW_H = 52

  $effect(() => {
    const el = canvas
    if (!el) return
    const dpr = window.devicePixelRatio || 1
    const cssW = el.clientWidth
    const cssH = FONT_CATALOGUE.length * ROW_H
    el.width = Math.round(cssW * dpr)
    el.height = Math.round(cssH * dpr)
    el.style.height = `${cssH}px`

    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    ctx.textBaseline = 'middle'

    FONT_CATALOGUE.forEach((entry, i) => {
      const y = i * ROW_H
      if (i > 0) {
        ctx.fillStyle = '#e2e2ea'
        ctx.fillRect(0, y, cssW, 1)
      }
      const weight = isVariableWeights(entry.weights)
        ? 500
        : (entry.weights[0] ?? 400)
      ctx.fillStyle = '#86869a'
      ctx.font = '11px ui-monospace, Menlo, monospace'
      ctx.fillText(entry.family, 16, y + ROW_H / 2)
      ctx.fillStyle = '#16161c'
      ctx.font = `${weight} 24px ${FAMILIES[entry.id]}`
      ctx.fillText(PANGRAM, 210, y + ROW_H / 2)
    })
  })
</script>

<div class="page">
  <header>
    <h1>Fonts</h1>
    <p class="lede">
      Every typeface the app ships. Two of them are the themeable defaults —
      <code>--font-text</code> and <code>--font-heading</code> — which a display
      or game may override. The rest are named handles: use
      <code>var(--font-bungee)</code> in CSS, or <code>FAMILIES.bungee</code> on canvas,
      when you want that face specifically.
    </p>
  </header>

  <section>
    <h2>At a glance</h2>
    <table>
      <thead>
        <tr>
          <th>Family</th>
          <th>CSS variable</th>
          <th>Weights</th>
          <th>Role default</th>
        </tr>
      </thead>
      <tbody>
        {#each FONT_CATALOGUE as entry (entry.id)}
          <tr>
            <td>
              <span class="fam" style="font-family: {FAMILIES[entry.id]}">
                {entry.family}
              </span>
              <span class="kind">{entry.kind}</span>
            </td>
            <td><code>--font-{kebab(entry.id)}</code></td>
            <td class="dim">{weightsLabel(entry.weights)}</td>
            <td>
              {#if roleFor(entry)}
                <span class="badge">{roleFor(entry)}</span>
              {:else}
                <span class="dim">—</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section>
    <h2>On canvas</h2>
    <p class="hint">
      The engine rasterizes labels through Canvas 2D, so this is what a scene
      node gets. A face that looks wrong here looks wrong in a game.
    </p>
    <div class="panel"><canvas bind:this={canvas}></canvas></div>
  </section>

  <section>
    <h2>Specimens</h2>
    {#each FONT_CATALOGUE as entry (entry.id)}
      <article class="card">
        <div class="card-head">
          <div>
            <h3>{entry.family}</h3>
            <p class="note">{entry.note}</p>
          </div>
          <div class="tags">
            <span class="tag">{weightsLabel(entry.weights)}</span>
            {#if roleFor(entry)}
              <span class="badge">{roleFor(entry)}</span>
            {/if}
          </div>
        </div>

        <div
          class="poster"
          style="font-family: {FAMILIES[
            entry.id
          ]}; font-weight: {isVariableWeights(entry.weights)
            ? 700
            : entry.weights.at(-1)}"
        >
          Handgloves
        </div>

        {#each ladder(entry.weights) as w (w)}
          <div class="row">
            <span class="gutter">{w}</span>
            <span style="font-family: {FAMILIES[entry.id]}; font-weight: {w}">
              {PANGRAM}
            </span>
          </div>
        {/each}

        <div class="proof">
          <div>
            <span class="gutter">13px</span>
            <span style="font-family: {FAMILIES[entry.id]}; font-size: 13px">
              {PANGRAM}
            </span>
          </div>
          <div>
            <span class="gutter">äöü</span>
            <span style="font-family: {FAMILIES[entry.id]}; font-size: 20px">
              {GERMAN}
            </span>
          </div>
          <div>
            <span class="gutter">0–9</span>
            <span
              style="font-family: {FAMILIES[
                entry.id
              ]}; font-size: 20px; font-variant-numeric: tabular-nums"
            >
              {DIGITS}
            </span>
          </div>
        </div>
      </article>
    {/each}
  </section>
</div>

<style lang="sass">
  // Page chrome is pinned to a fixed system stack, never to a font variable:
  // the specimens are the only thing on the page that should change face.
  $chrome: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif
  $mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace

  $ink: #16161c
  $muted: #5c5c6b
  $faint: #86869a
  $line: #e2e2ea
  $panel: #f7f7fa
  $accent: #2b5bd7

  :global(html), :global(body)
    background: #ffffff

  .page
    max-width: 62rem
    margin: 0 auto
    padding: 2.5rem 1.5rem 6rem
    color: $ink
    background: #ffffff
    font-family: $chrome
    height: 100vh
    overflow-y: auto

  h1
    font-family: $chrome
    font-size: 1.75rem
    margin-bottom: 0.5rem

  h2
    font-family: $chrome
    font-size: 1.1rem
    margin: 2.75rem 0 0.4rem
    padding-top: 1.4rem
    border-top: 1px solid $line

  h3
    font-family: $chrome
    font-size: 1rem
    font-weight: 600

  .lede, .hint, .note
    font-family: $chrome
    color: $muted
    font-size: 0.875rem
    line-height: 1.5
    max-width: 44rem

  .hint
    margin-bottom: 1rem

  .note
    font-size: 0.8rem
    margin-top: 0.15rem

  code
    font-family: $mono
    font-size: 0.8rem
    background: $panel
    border: 1px solid $line
    padding: 0.05em 0.35em
    border-radius: 0.25rem
    white-space: nowrap

  .dim
    color: $faint
    font-size: 0.8rem

  .badge
    font-family: $mono
    font-size: 0.7rem
    padding: 0.15em 0.5em
    border-radius: 0.25rem
    background: rgba(43, 91, 215, 0.1)
    color: $accent

  .tag
    font-family: $mono
    font-size: 0.7rem
    padding: 0.15em 0.5em
    border-radius: 0.25rem
    background: $panel
    border: 1px solid $line
    color: $muted

  // --- table ----------------------------------------------------------------

  table
    width: 100%
    border-collapse: collapse
    margin-top: 0.75rem

  th
    font-family: $mono
    font-size: 0.68rem
    text-transform: uppercase
    letter-spacing: 0.06em
    color: $faint
    text-align: left
    font-weight: 400
    padding: 0.4rem 0.75rem 0.4rem 0
    border-bottom: 1px solid $line

  td
    padding: 0.6rem 0.75rem 0.6rem 0
    border-bottom: 1px solid $line
    vertical-align: baseline

  .fam
    font-size: 1.05rem

  .kind
    font-family: $mono
    font-size: 0.65rem
    color: $faint
    margin-left: 0.5rem

  // --- panels ---------------------------------------------------------------

  .panel
    border: 1px solid $line
    border-radius: 0.5rem
    overflow: hidden

  canvas
    display: block
    width: 100%

  .card
    margin: 1rem 0
    padding: 1.1rem 1.3rem 1.3rem
    border: 1px solid $line
    border-radius: 0.5rem

  .card-head
    display: flex
    justify-content: space-between
    align-items: flex-start
    gap: 1rem
    flex-wrap: wrap
    padding-bottom: 0.8rem
    border-bottom: 1px solid $line

  .tags
    display: flex
    gap: 0.4rem
    flex-wrap: wrap
    flex-shrink: 0

  .poster
    font-size: clamp(3rem, 8vw, 5rem)
    line-height: 1.05
    margin: 1rem 0 1.2rem

  .row, .proof > div
    display: flex
    gap: 1rem
    align-items: baseline
    line-height: 1.35

    > span:last-child
      overflow: hidden
      white-space: nowrap

  .row
    font-size: 1.05rem
    margin-bottom: 0.45rem

  // Fixed, not min-width: a variable gutter would shift every sample beside it.
  .gutter
    font-family: $mono
    font-size: 0.68rem
    color: $faint
    width: 2.8rem
    flex-shrink: 0
    text-align: right

  .proof
    margin-top: 1.2rem
    padding-top: 0.9rem
    border-top: 1px solid $line
    display: flex
    flex-direction: column
    gap: 0.5rem
</style>
