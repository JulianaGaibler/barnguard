<!--
  Booth-menu section for the sign-ups the form has collected. They live only on
  this device, since the venue's internet can't be counted on, so this is how
  they leave it: as a CSV file or on the clipboard. Clearing takes two taps.
-->
<script lang="ts">
  import { DebugSection } from 'stargazer/debug-ui'
  import ConfirmButton from '@src/core/ui/ConfirmButton.svelte'
  import { t } from '../i18n'
  import { signupForm } from '../signup/form'
  import { clearSignups, signups, toCsv } from '../signup/entries'

  /** How long "Copied" stays on the button. */
  const FEEDBACK_MS = 2000

  let copyState = $state<'idle' | 'copied' | 'failed'>('idle')
  let feedback: ReturnType<typeof setTimeout> | null = null

  const csv = (): string => toCsv($signups, signupForm.fields)

  function download(): void {
    // The byte order mark tells a spreadsheet the file is UTF-8, so accented
    // names come through.
    const blob = new Blob(['﻿', csv()], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `age-verification-signups-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  /**
   * The clipboard API needs a secure context, which a kiosk served over the
   * local network may not be, so the old copy command stands in.
   */
  async function writeClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.append(area)
      area.select()
      try {
        return document.execCommand('copy')
      } catch {
        return false
      } finally {
        area.remove()
      }
    }
  }

  async function copy(): Promise<void> {
    copyState = (await writeClipboard(csv())) ? 'copied' : 'failed'
    if (feedback) clearTimeout(feedback)
    feedback = setTimeout(() => (copyState = 'idle'), FEEDBACK_MS)
  }

  $effect(() => () => {
    if (feedback) clearTimeout(feedback)
  })
</script>

<DebugSection title={$t.signupPanel.title} open>
  <div class="debug-row">
    <span class="label">{$t.signupPanel.count($signups.length)}</span>
  </div>
  <div class="actions">
    <button
      type="button"
      class="debug-btn"
      disabled={$signups.length === 0}
      onclick={download}
    >
      {$t.signupPanel.download}
    </button>
    <button
      type="button"
      class="debug-btn"
      disabled={$signups.length === 0}
      onclick={() => void copy()}
    >
      {copyState === 'copied'
        ? $t.signupPanel.copied
        : copyState === 'failed'
          ? $t.signupPanel.copyFailed
          : $t.signupPanel.copy}
    </button>
    <ConfirmButton
      label={$t.signupPanel.clear}
      disabled={$signups.length === 0}
      onConfirm={clearSignups}
    />
  </div>
  <p class="note">{$t.signupPanel.note}</p>
</DebugSection>

<style lang="sass">
  .actions
    display: flex
    flex-wrap: wrap
    gap: 4px

    :global(.debug-btn)
      flex: 1

  .note
    margin: 6px 0 0
    font-size: 11px
    opacity: 0.7
</style>
