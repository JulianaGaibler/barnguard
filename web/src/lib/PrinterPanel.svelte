<script lang="ts">
  // Attendant-facing printer panel. Opened from the booth menu; shows live
  // printer + queue status over SSE and offers cancel / reprint / clear plus
  // (in mock mode) fault-injection buttons for testing. Labels are hardcoded
  // English to match the booth menu's operator-facing convention.
  import { DebugSection, DraggableWindow } from '@src/stargazer/debug/ui'
  import {
    printerLive,
    cancelJob,
    reprintJob,
    clearQueue,
    debugMock,
    reconnect,
  } from './print/printerClient'
  import { printerPanelVisible, togglePrinterPanel } from './boothMenuToggle'
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

  function fmtTime(ms: number): string {
    return new Date(ms).toLocaleTimeString()
  }

  function tapeInfo(p: PrinterStatus | null): string {
    if (!p) return ''
    const parts: string[] = []
    if (p.tapeWidthMm) parts.push(`${p.tapeWidthMm.toFixed(0)}mm tape`)
    if (p.tapeRemainingMm) parts.push(`~${(p.tapeRemainingMm / 1000).toFixed(1)}m left`)
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
      parts.push(`unreachable ${fmtDuration(Date.now() - p.unreachableSinceMs)}`)
    }
    if (p.failedAttempts) {
      parts.push(`${p.failedAttempts} failed attempt${p.failedAttempts === 1 ? '' : 's'}`)
    }
    if (p.printJobError) parts.push(p.printJobError)
    return parts.join(' · ')
  }

  const onCancel = (id: string): void => void cancelJob(id).catch(logErr)
  const onReprint = (id: string): void => void reprintJob(id).catch(logErr)
  const onClear = (): void => void clearQueue().catch(logErr)
  const onReconnect = (): void => void reconnect().catch(logErr)
  const onDebug = (body: {
    forceNoMedia?: boolean
    forceAwaitingRemoval?: boolean
    clearAwaitingRemoval?: boolean
    forceUnreachable?: boolean
  }): void => void debugMock(body).catch(logErr)

  function logErr(err: unknown): void {
    console.error('[printer-panel]', err)
  }
</script>

<DraggableWindow
  visible={$printerPanelVisible}
  title="Printer"
  storageId="barnguard-window-printer-panel"
  side="left"
  width={320}
  onClose={togglePrinterPanel}
>
  <DebugSection title="Status" open>
    {#if printer}
      <div class="status-line">
        <span class="dot" class:ok={$printerLive.connected}></span>
        {printer?.backend} · {printer?.state}{printer && !printer.reachable
          ? ' · offline'
          : ''}
      </div>
      {#if printer?.state === 'no_media'}
        <div class="banner">⚠ Load tape</div>
      {/if}
      {#if printer?.state === 'awaiting_removal'}
        <div class="banner">⚠ Remove printed label</div>
      {/if}
      {#if tapeInfo(printer)}
        <div class="meta">{tapeInfo(printer)}</div>
      {/if}
      {#if printer && !printer.reachable}
        <div class="meta warn-text">{unreachableInfo(printer)}</div>
      {/if}
    {:else}
      <div class="status-line">
        <span class="dot" class:ok={$printerLive.connected}></span> connecting…
      </div>
    {/if}

    <div class="actions">
      <button type="button" class="debug-btn" onclick={onReconnect}>
        Reconnect printer
      </button>
    </div>
  </DebugSection>

  <DebugSection title={`Queue (${$printerLive.pending.length + ($printerLive.active ? 1 : 0)})`}>
    <div class="debug-list">
      {#if $printerLive.active}
        <div class="debug-list-item active-job">
          <span>{jobLine($printerLive.active)}</span>
        </div>
      {/if}
      {#each $printerLive.pending as job (job.id)}
        <div class="debug-list-item">
          <span>{jobLine(job)}</span>
          <button type="button" class="debug-btn" onclick={() => onCancel(job.id)}>
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

  <DebugSection title="Log">
    <div class="debug-list max-height-300">
      {#each [...$printerLive.logs].reverse() as entry, i (`${entry.tsMs}-${i}`)}
        <div class="log-entry log-{entry.level}">
          <span class="log-time">{fmtTime(entry.tsMs)}</span>
          <span class="log-msg">{entry.message}</span>
        </div>
      {:else}
        <div class="empty-state">no messages</div>
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
            onDebug({ forceAwaitingRemoval: false, clearAwaitingRemoval: true })}
          >Release</button
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
          onclick={() => onDebug({ forceUnreachable: false })}>Printer up</button
        >
      </div>
    </DebugSection>
  {/if}
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

  // Log entries aren't the two-column label/action shape that
  // `.debug-list-item` optimises for, so they use a simpler row layout.
  .log-entry
    display: flex
    gap: 6px
    align-items: baseline
    padding: 2px 6px
    word-break: break-word

  .log-time
    opacity: 0.5
    flex-shrink: 0

  .log-msg
    word-break: break-word

  .log-info .log-msg
    color: rgba(255, 255, 255, 0.85)

  .log-warn .log-msg
    color: #fde68a

  .log-error .log-msg
    color: #fecaca

  .actions
    display: flex
    gap: 4px
    flex-wrap: wrap
</style>
