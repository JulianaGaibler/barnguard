<!--
  A line of rules text in the DOM, with the same symbols the board draws.

  The board paints glyphs from rasterised canvases, which an overlay cannot
  reach into, so this inlines the artwork the raster was made from. Sizes are in
  em for the same reason they are on a card: a symbol is scaled against the text
  it sits in, not against the screen.
-->
<script lang="ts">
  import type { TextSpan } from '@src/stargazer'
  import { glyphSvg, parseGlyph } from '../art/glyphs'

  interface Props {
    spans: readonly TextSpan[]
  }
  const { spans }: Props = $props()

  interface Piece {
    svg: string | null
    text: string
    bold: boolean
    heightEm: number
    widthEm: number
    leadEm: number
    trailEm: number
  }

  const pieces = $derived(
    spans.map((span): Piece => {
      if (!('box' in span)) {
        return {
          svg: null,
          text: span.text,
          bold: span.bold ?? false,
          heightEm: 0,
          widthEm: 0,
          leadEm: 0,
          trailEm: 0,
        }
      }
      const glyph = parseGlyph(span.box)
      return {
        svg: glyph ? glyphSvg(glyph) : null,
        // A glyph with no artwork here still has to say what it stood for.
        text: glyph ? '' : (span.alt ?? ''),
        bold: false,
        heightEm: span.heightEm,
        widthEm: span.heightEm * span.aspect,
        leadEm: span.leadEm ?? 0,
        trailEm: span.trailEm ?? 0,
      }
    }),
  )
</script>

{#each pieces as piece, i (i)}{#if piece.svg}<span
      class="fs-glyph"
      style:height="{piece.heightEm}em"
      style:width="{piece.widthEm}em"
      style:margin-left="{piece.leadEm}em"
      style:margin-right="{piece.trailEm}em">{@html piece.svg}</span
    >{:else if piece.bold}<strong>{piece.text}</strong
    >{:else}{piece.text}{/if}{/each}

<style lang="sass">
  .fs-glyph
    display: inline-block
    vertical-align: middle

    // The badge artwork runs flush to its own viewBox, so the ring's outer edge
    // is the last row of the box. At a fractional size the default clip shaves
    // whichever side rounds down, and a badge at a different offset in the line
    // loses a different one.
    :global(svg)
      display: block
      width: 100%
      height: 100%
      overflow: visible
</style>
