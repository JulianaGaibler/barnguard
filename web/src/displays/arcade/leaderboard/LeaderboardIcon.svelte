<!-- The leaderboard star icon: outline or filled, plain color unless `gold`. -->
<script module lang="ts">
  // Shared across instances so two icons on screen never clash on id.
  let nextId = 0
</script>

<script lang="ts">
  interface Props {
    size?: number
    filled?: boolean
    /** Gold-gradient fill for the high-score badge; plain `currentColor` otherwise. */
    gold?: boolean
  }
  const { size = 16, filled = false, gold = false }: Props = $props()

  const gradientId = `leaderboard-icon-fill-${nextId++}`
  const fill = $derived(gold ? `url(#${gradientId})` : 'currentColor')

  const OUTLINE_PATH =
    'M6.465 1.48c.643-1.314 2.58-1.268 3.137.13h.001l1.184 2.974 3.598.235.134.013c1.364.192 2.031 1.92.957 2.939q-.33.314-.706.63a16 16 0 0 1-2.24 1.575l.855 3.351c.383 1.5-1.219 2.649-2.522 1.92a18 18 0 0 1-2.858-1.988 18 18 0 0 1-1.024.809l-.44.311a18 18 0 0 1-1.394.867c-1.303.73-2.906-.419-2.523-1.918l.852-3.352A16 16 0 0 1 .533 7.772c-1.11-1.053-.362-2.86 1.09-2.953l3.598-.235 1.185-2.973zm1.745.685a.22.22 0 0 0-.41 0L6.44 5.58a.75.75 0 0 1-.648.471l-4.072.265a.22.22 0 0 0-.2.15.2.2 0 0 0-.012.12c.006.029.02.061.057.097l.31.284q.159.144.33.287c.9.758 1.77 1.302 2.495 1.689a.75.75 0 0 1 .373.846l-.996 3.909a.2.2 0 0 0 .003.13.2.2 0 0 0 .074.096.23.23 0 0 0 .259.014c.414-.233.843-.496 1.279-.795l.403-.286q.588-.432 1.073-.854a1.27 1.27 0 0 1 1.58-.074l.094.074.335.284q.345.284.737.57l.402.285q.655.449 1.28.796c.096.054.187.04.26-.014a.2.2 0 0 0 .073-.095.2.2 0 0 0 .003-.13l-.996-3.91a.75.75 0 0 1 .373-.846 14.4 14.4 0 0 0 3.135-2.26l.04-.052a.2.2 0 0 0 .017-.045.2.2 0 0 0-.012-.12.22.22 0 0 0-.2-.15l-4.072-.265a.75.75 0 0 1-.648-.47L8.445 2.757z'
  const FILLED_PATH =
    'M8 1.026c.516 0 .957.3 1.148.78l1.293 3.248 3.894.252c.501.033.918.348 1.09.823a1.2 1.2 0 0 1-.302 1.294 15.5 15.5 0 0 1-3.163 2.313l.942 3.698c.123.486-.045.978-.44 1.28-.403.311-.93.346-1.376.096a17.3 17.3 0 0 1-2.915-2.048.25.25 0 0 0-.339 0 18 18 0 0 1-2.915 2.048 1.3 1.3 0 0 1-.62.165h-.003c-.267 0-.53-.088-.756-.26a1.21 1.21 0 0 1-.44-1.28l.942-3.699A15.5 15.5 0 0 1 .877 7.423 1.2 1.2 0 0 1 .575 6.13c.173-.475.59-.79 1.09-.823l3.894-.252 1.293-3.249c.19-.48.632-.779 1.148-.779'
</script>

<svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
  {#if gold}
    <defs>
      <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="20%" stop-color="#f3dc67" />
        <stop offset="80%" stop-color="#e2b719" />
      </linearGradient>
    </defs>
  {/if}
  {#if filled}
    <path {fill} d={FILLED_PATH} />
  {:else}
    <path fill-rule="evenodd" clip-rule="evenodd" {fill} d={OUTLINE_PATH} />
  {/if}
</svg>
