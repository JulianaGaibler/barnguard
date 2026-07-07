<script lang="ts">
  interface Props {
    label: string
    value: string | number
    tone?: 'default' | 'warning' | 'error' | 'accent'
  }

  let { label, value, tone = 'default' }: Props = $props()
</script>

<div class="info-row">
  <span class="label">{label}:</span>
  <span
    class="value"
    class:warning={tone === 'warning'}
    class:error={tone === 'error'}
    class:accent={tone === 'accent'}
  >
    {value}
  </span>
</div>
