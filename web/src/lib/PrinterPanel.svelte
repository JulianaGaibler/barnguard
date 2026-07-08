<script lang="ts">
  // Attendant-facing printer panel. Opened from the booth menu; shows live
  // printer + queue status over SSE and offers cancel / reprint / clear plus
  // (in mock mode) fault-injection buttons for testing. Labels are hardcoded
  // English to match the booth menu's operator-facing convention.
  import {
    DebugSection,
    DraggableWindow,
    ToggleButton,
  } from '@src/stargazer/debug/ui'
  import { t } from '@src/i18n'
  import {
    printerLive,
    cancelJob,
    reprintJob,
    clearQueue,
    debugMock,
    reconnect,
    setLabelUrlOverride,
    resetLabelUrlOverride,
  } from './print/printerClient'
  import {
    renderLabel,
    squarePxFrom,
    type LabelInput,
  } from './print/labelRenderer'
  import { printerPanelVisible, togglePrinterPanel } from './boothMenuToggle'
  import { daemonConfig } from '@src/stores/daemonConfig'
  import type { PrintJob, PrinterStatus } from './print/types'

  const printer = $derived($printerLive.printer)

  function short(id: string): string {
    return id.slice(0, 8)
  }

  function jobLine(j: PrintJob): string {
    const parts = [short(j.id), j.state]
    if (j.meta.stateId) parts.push(j.meta.stateId)
    if (j.meta.score != null) parts.push(`${j.meta.score}p`)
    return parts.join(' · ')
  }

  function tapeInfo(p: PrinterStatus | null): string {
    if (!p) return ''
    const parts: string[] = []
    if (p.tapeWidthMm) parts.push(`${p.tapeWidthMm.toFixed(0)}mm tape`)
    if (p.tapeRemainingMm)
      parts.push(`~${(p.tapeRemainingMm / 1000).toFixed(1)}m left`)
    if (p.model) parts.push(p.model)
    return parts.join(' · ')
  }

  function fmtDuration(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000))
    const m = Math.floor(s / 60)
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
  }

  function unreachableInfo(p: PrinterStatus): string {
    const parts: string[] = []
    if (p.unreachableSinceMs) {
      parts.push(
        `unreachable ${fmtDuration(Date.now() - p.unreachableSinceMs)}`,
      )
    }
    if (p.failedAttempts) {
      parts.push(
        `${p.failedAttempts} failed attempt${p.failedAttempts === 1 ? '' : 's'}`,
      )
    }
    if (p.printJobError) parts.push(p.printJobError)
    return parts.join(' · ')
  }

  const onCancel = (id: string): void => void cancelJob(id).catch(logErr)
  const onReprint = (id: string): void => void reprintJob(id).catch(logErr)
  const onClear = (): void => void clearQueue().catch(logErr)

  // Transient "connecting…" feedback for the Reconnect button. Independent of
  // the SSE state so the operator sees an unambiguous "I heard the click"
  // signal even if the SSE was already online. Cleared after 1500 ms.
  let reconnectPending = $state(false)
  let reconnectPendingTimer: ReturnType<typeof setTimeout> | null = null
  function onReconnect(): void {
    reconnectPending = true
    if (reconnectPendingTimer !== null) clearTimeout(reconnectPendingTimer)
    reconnectPendingTimer = setTimeout(() => {
      reconnectPending = false
      reconnectPendingTimer = null
    }, 1500)
    // `reconnect()` force-reopens the SSE in its `finally` block, so we
    // don't need to invoke that explicitly here.
    reconnect().catch(logErr)
  }
  const onDebug = (body: {
    forceNoMedia?: boolean
    forceAwaitingRemoval?: boolean
    clearAwaitingRemoval?: boolean
    forceUnreachable?: boolean
  }): void => void debugMock(body).catch(logErr)

  function logErr(err: unknown): void {
    console.error('[printer-panel]', err)
  }

  // --- Label URL override -------------------------------------------------
  // Escape hatch: set an in-memory URL on the daemon that supersedes
  // config.toml (and propagates to every client), or reset back to config.
  // The draft is a local input; the "Current" line reflects whatever the
  // daemon last echoed over SSE into `daemonConfig`.
  let urlDraft = $state('')
  let urlPending = $state(false)
  const urlDirty = $derived(
    urlDraft.trim().length > 0 && urlDraft.trim() !== $daemonConfig.labelUrl,
  )

  function onSetUrl(): void {
    const url = urlDraft.trim()
    if (url.length === 0 || urlPending) return
    urlPending = true
    setLabelUrlOverride(url)
      .then(() => {
        urlDraft = '' // Current line now shows the new value via SSE echo.
      })
      .catch(logErr)
      .finally(() => {
        urlPending = false
      })
  }

  function onResetUrl(): void {
    if (urlPending) return
    urlPending = true
    urlDraft = ''
    resetLabelUrlOverride()
      .catch(logErr)
      .finally(() => {
        urlPending = false
      })
  }

  // Design-preview: render a representative label so the attendant can see
  // what the printed output looks like without having to run a game. Values
  // are placeholders; the "new high score" pill is toggleable so the
  // attendant can preview both variants of the layout — the composition
  // re-centers when the pill drops in / out.
  let previewHighScore = $state(true)

  const previewInput = $derived<LabelInput>({
    reason: 'exitedGermany',
    stateId: 'BE',
    score: 42,
    isOverallHigh: previewHighScore,
    isStateHigh: previewHighScore,
    highScores: { overall: 42, byState: { BE: 42 } },
  })

  let previewUrl = $state<string | null>(null)
  let previewError = $state<string | null>(null)

  $effect(() => {
    // Track reactive deps: tape width for size, locale for the caption
    // text, and the high-score toggle for the pill / layout re-centering.
    const tapeWidthMm = $printerLive.printer?.tapeWidthMm
    const messages = $t
    const input = previewInput
    // Re-render the preview when a config reload changes the label URL.
    // `renderLabel` reads the live value itself; this read just tracks the dep.
    const _labelUrl = $daemonConfig.labelUrl
    let cancelled = false
    let localUrl: string | null = null

    renderLabel(input, {
      messages,
      size: squarePxFrom(tapeWidthMm),
    })
      .then((blob) => {
        if (cancelled) return
        localUrl = URL.createObjectURL(blob)
        if (previewUrl !== null) URL.revokeObjectURL(previewUrl)
        previewUrl = localUrl
        previewError = null
      })
      .catch((err: unknown) => {
        if (cancelled) return
        previewError = err instanceof Error ? err.message : String(err)
      })

    return () => {
      cancelled = true
      // If this effect was superseded before the render landed, drop any
      // URL we managed to create so it isn't leaked.
      if (localUrl !== null && localUrl !== previewUrl) {
        URL.revokeObjectURL(localUrl)
      }
    }
  })
</script>

<DraggableWindow
  visible={$printerPanelVisible}
  title="Printer"
  storageId="barnguard-window-printer-panel"
  spawnedBy="barnguard-window-booth-menu"
  side="left"
  width={320}
  onClose={togglePrinterPanel}
>
  <DebugSection title="Status" open>
    {#if printer && $printerLive.connection === 'online'}
      <div class="status-line">
        <span class="dot ok"></span>
        {printer.backend} · {printer.state}{!printer.reachable
          ? ' · offline'
          : ''}
      </div>
      {#if printer.state === 'no_media'}
        <div class="banner">⚠ Load tape</div>
      {/if}
      {#if printer.state === 'awaiting_removal'}
        <div class="banner">⚠ Remove printed label</div>
      {/if}
      {#if tapeInfo(printer)}
        <div class="meta">{tapeInfo(printer)}</div>
      {/if}
      {#if !printer.reachable}
        <div class="meta warn-text">{unreachableInfo(printer)}</div>
      {/if}
    {:else}
      <div class="status-line">
        <span class="dot" class:busy={$printerLive.connection === 'connecting'}
        ></span>
        {$printerLive.connection === 'connecting'
          ? 'connecting…'
          : 'backend offline'}
      </div>
    {/if}

    <div class="actions">
      <button type="button" class="debug-btn" onclick={onReconnect}>
        {reconnectPending ? 'Reconnecting…' : 'Reconnect printer'}
      </button>
    </div>
  </DebugSection>

  <DebugSection
    title={`Queue (${$printerLive.pending.length + ($printerLive.active ? 1 : 0)})`}
    open
  >
    <div class="debug-list">
      {#if $printerLive.active}
        <div class="debug-list-item active-job">
          <span>{jobLine($printerLive.active)}</span>
        </div>
      {/if}
      {#each $printerLive.pending as job (job.id)}
        <div class="debug-list-item">
          <span>{jobLine(job)}</span>
          <button
            type="button"
            class="debug-btn"
            onclick={() => onCancel(job.id)}
          >
            Cancel
          </button>
        </div>
      {/each}
      {#if !$printerLive.active && $printerLive.pending.length === 0}
        <div class="empty-state">idle</div>
      {/if}
    </div>

    <div class="actions">
      <button type="button" class="debug-btn" onclick={onClear}>
        Clear queue
      </button>
    </div>
  </DebugSection>

  <DebugSection title="Recent">
    <div class="debug-list">
      {#each [...$printerLive.recent].reverse() as job (job.id)}
        <div class="debug-list-item">
          <span
            >{jobLine(job)}{job.error ? ` · ${job.error}` : ''}{job.warning
              ? ` · ${job.warning}`
              : ''}</span
          >
          {#if job.state === 'failed'}
            <button
              type="button"
              class="debug-btn"
              onclick={() => onReprint(job.id)}
            >
              Reprint
            </button>
          {/if}
        </div>
      {:else}
        <div class="empty-state">none</div>
      {/each}
    </div>
  </DebugSection>

  {#if printer?.backend === 'mock'}
    <DebugSection title="Mock controls">
      <div class="actions">
        <button
          type="button"
          class="debug-btn"
          onclick={() => onDebug({ forceNoMedia: true })}>No media</button
        >
        <button
          type="button"
          class="debug-btn"
          onclick={() => onDebug({ forceNoMedia: false })}>Media OK</button
        >
      </div>
      <div class="actions">
        <button
          type="button"
          class="debug-btn"
          onclick={() => onDebug({ forceAwaitingRemoval: true })}
          >Hold label</button
        >
        <button
          type="button"
          class="debug-btn"
          onclick={() =>
            onDebug({
              forceAwaitingRemoval: false,
              clearAwaitingRemoval: true,
            })}>Release</button
        >
      </div>
      <div class="actions">
        <button
          type="button"
          class="debug-btn"
          onclick={() => onDebug({ forceUnreachable: true })}
          >Printer down</button
        >
        <button
          type="button"
          class="debug-btn"
          onclick={() => onDebug({ forceUnreachable: false })}
          >Printer up</button
        >
      </div>
    </DebugSection>
  {/if}

  <DebugSection title="Label URL">
    <div class="debug-row">
      <span class="label">Current</span>
      <span class="value" class:accent={$daemonConfig.labelUrlOverridden}>
        {$daemonConfig.labelUrl}
      </span>
    </div>
    <div class="meta">
      {$daemonConfig.labelUrlOverridden
        ? 'Override active — supersedes config.toml'
        : 'From config.toml'}
    </div>
    <input
      class="url-input"
      type="text"
      bind:value={urlDraft}
      placeholder={$daemonConfig.labelUrl}
      onkeydown={(e) => {
        if (e.key === 'Enter') onSetUrl()
      }}
    />
    <div class="actions">
      <button
        type="button"
        class="debug-btn"
        onclick={onSetUrl}
        disabled={!urlDirty || urlPending}
      >
        {urlPending ? 'Saving…' : 'Set override'}
      </button>
      <button
        type="button"
        class="debug-btn"
        onclick={onResetUrl}
        disabled={!$daemonConfig.labelUrlOverridden || urlPending}
      >
        Reset to config
      </button>
    </div>
  </DebugSection>

  <DebugSection title="Preview">
    <div class="preview">
      {#if previewUrl}
        <img class="preview-img" src={previewUrl} alt="Print label preview" />
      {:else if previewError}
        <div class="empty-state">preview failed: {previewError}</div>
      {:else}
        <div class="empty-state">rendering…</div>
      {/if}
      <div class="preview-caption">
        Placeholder values · shown at 1:1 aspect
      </div>
      <ToggleButton
        active={previewHighScore}
        onToggle={() => (previewHighScore = !previewHighScore)}
        label="New high score"
      />
    </div>
  </DebugSection>
</DraggableWindow>

<style lang="sass">
  // Printer-panel body content. Chrome (window frame, header, close button,
  // section collapsibles, scrollbars, list container + rows, empty-state)
  // all come from the shared debug-ui.sass via DraggableWindow /
  // DebugSection / .debug-list. What lives here is only the printer-status
  // specific readouts (connection dot, banners, tape info) and the log
  // entry sub-styles.

  .status-line
    display: flex
    align-items: center
    gap: 6px
    font-weight: 700

  .dot
    width: 8px
    height: 8px
    border-radius: 50%
    background: rgba(248, 113, 113, 0.9)
    flex-shrink: 0

    &.busy
      background: rgba(240, 210, 140, 0.95)

    &.ok
      background: rgba(74, 222, 128, 0.9)

  .banner
    padding: 4px 6px
    border-radius: 3px
    background: rgba(248, 113, 113, 0.2)
    border: 1px solid rgba(248, 113, 113, 0.5)
    color: #fecaca
    font-weight: 700

  .meta
    opacity: 0.7

  .warn-text
    color: #fecaca
    opacity: 0.95

  // The one job currently being printed. Sits at the top of the Queue list
  // and reads as visually distinct from pending items behind it.
  .active-job
    background: rgba(96, 165, 250, 0.12)
    border-left: 2px solid rgba(96, 165, 250, 0.7)

  .actions
    display: flex
    gap: 4px
    flex-wrap: wrap

  // Label-URL override input. No shared text-input primitive in debug-ui/, so
  // the chrome is matched by hand to the cover-message textarea in BoothMenu.
  .url-input
    display: block
    width: 100%
    box-sizing: border-box
    margin-block: 4px
    padding: 6px 8px
    background: rgba(255, 255, 255, 0.05)
    border: 1px solid rgba(255, 255, 255, 0.18)
    border-radius: 4px
    color: #fff
    font: inherit
    font-size: 11px

    &:focus
      outline: none

  // Preview section: the rendered label image + a small caption below.
  .preview
    display: flex
    flex-direction: column
    gap: 4px

  .preview-img
    display: block
    width: 100%
    aspect-ratio: 1 / 1
    object-fit: contain
    background: rgba(0, 0, 0, 0.3)
    border: 1px solid rgba(255, 255, 255, 0.08)
    border-radius: 3px

  .preview-caption
    opacity: 0.55
    font-size: 10px
    text-align: center
</style>
