<script lang="ts">
  /**
   * The second game over card: the round's score large, "Points" beneath, and
   * the map best and region best as small pills at the bottom. A glass card
   * that blurs what is behind it. The score shown is whatever the screen hands
   * in, so the screen can count it up.
   */
  import { t } from '@src/displays/enterprise/i18n'
  import ScorePill from './ScorePill.svelte'

  interface Props {
    /** The number shown, which counts up to the score. */
    shown: number
    overall: number
    regional: number
    /** Flag markup for the region pill, or `null` to show `regionLabel`. */
    flag: string | null
    regionLabel: string
    /** Scale of the pills' pop when the count lands, 0 at rest. */
    pop: number
  }
  let { shown, overall, regional, flag, regionLabel, pop }: Props = $props()
</script>

<section class="score">
  <p class="score__value">{Math.round(shown)}</p>
  <p class="score__label">{$t.game.points}</p>
  <div class="score__pills" style:transform="scale({1 + pop * 0.12})">
    {#if overall > 0}
      <ScorePill label={$t.game.allScores} score={overall} compact />
    {/if}
    {#if regional > 0}
      {#if flag}
        <ScorePill {flag} score={regional} compact />
      {:else}
        <ScorePill label={regionLabel} score={regional} compact />
      {/if}
    {/if}
  </div>
</section>

<style lang="sass">
  .score
    position: absolute
    inset: 0
    overflow: hidden
    box-sizing: border-box
    border-radius: 40px
    border: 2px solid rgba(255, 255, 255, 0.6)
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.72) 10.17%, rgba(255, 255, 255, 0.54) 57.52%, rgba(255, 255, 255, 0.58))
    backdrop-filter: blur(13.2px)
    color: #010612
    text-align: center

  .score__value
    position: absolute
    left: 0
    right: 0
    top: 113.6px
    margin: 0
    font-family: var(--font-mozilla-headline-extended)
    font-weight: 700
    font-size: 164.8px
    line-height: 198px

  .score__label
    position: absolute
    left: 0
    right: 0
    top: 291.2px
    margin: 0
    font-family: var(--font-mozilla-text)
    font-weight: 500
    font-size: 25.6px

  .score__pills
    position: absolute
    left: 0
    right: 0
    top: 411.2px
    display: flex
    justify-content: center
    gap: 9.6px
</style>
