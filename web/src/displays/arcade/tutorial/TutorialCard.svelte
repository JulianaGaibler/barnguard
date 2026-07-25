<!--
  One tutorial card: a transparent, fixed-aspect media slot (the shared demo
  canvas overlays it when this card is centered) above a title + body. Pure
  DOM — no canvas of its own. Sizing comes from the `--htp-*` custom properties
  set on the carousel root in `HowToPlay.svelte`.
-->
<script lang="ts">
  interface Props {
    title: string
    body: string
  }
  const { title, body }: Props = $props()
</script>

<div class="tc">
  <div class="tc__media" aria-hidden="true"></div>
  <div class="tc__text">
    <h3 class="tc__title">{title}</h3>
    <p class="tc__body">{body}</p>
  </div>
</div>

<style lang="sass">
  .tc
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-16)
    padding: var(--htp-card-pad)
    height: 100%
    box-sizing: border-box

  .tc__media
    flex: 0 0 auto
    width: var(--htp-media-w)
    height: var(--htp-media-h)
    border-radius: var(--radius-card)

  .tc__text
    display: flex
    flex-direction: column
    align-items: center
    gap: var(--space-8)
    height: var(--htp-text-h)
    overflow: hidden

  .tc__title
    margin: 0
    @include tint.type-class(card-title)
    color: var(--color-text)
    text-align: center

  .tc__body
    margin: 0
    @include tint.type-class(body)
    color: var(--color-text)
    text-align: center
    max-width: var(--htp-media-w)
</style>
