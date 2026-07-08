<script lang="ts">
  import { locale, setLocale, t } from '@src/i18n'
  import { printerLive, reloadConfig } from '@src/lib/print/printerClient'
  import { STATE_PHOTOS } from '@src/game/data/statePhotos'
  import { selectedStateId, stopGameHandle } from '@src/stores/gameSelection'
  import ConfirmButton from './ConfirmButton.svelte'
  import {
    coverScreen,
    setCoverMode,
    setCoverText,
    setCoverVisible,
    type CoverMode,
  } from '@src/stores/coverScreen'
  import {
    DebugSection,
    DebugSelect,
    DraggableWindow,
    ToggleButton,
    type DebugSelectItem,
  } from '@src/stargazer/debug/ui'
  import {
    boothMenuState,
    closeBoothMenu,
    debugHudVisible,
    gamesPanelVisible,
    isFullscreen,
    printerPanelVisible,
    toggleDebugHud,
    toggleFullscreen,
    toggleGamesPanel,
    togglePrinterPanel,
  } from './boothMenuToggle'

  function handleReload(): void {
    location.reload()
  }

  // Ask the daemon to re-read config.toml. Success is visible when the new
  // values arrive over SSE (e.g. the label URL); failures land in the Log
  // list below. Transient label mirrors the Printer panel's reconnect button.
  let reloadConfigPending = $state(false)
  let reloadConfigTimer: ReturnType<typeof setTimeout> | null = null
  function handleReloadConfig(): void {
    reloadConfigPending = true
    if (reloadConfigTimer !== null) clearTimeout(reloadConfigTimer)
    reloadConfigTimer = setTimeout(() => {
      reloadConfigPending = false
      reloadConfigTimer = null
    }, 1500)
    reloadConfig().catch((err: unknown) =>
      console.error('[booth-menu] config reload', err),
    )
  }

  function fmtTime(ms: number): string {
    return new Date(ms).toLocaleTimeString()
  }

  // `session.reset()` (behind the stop-game handle) is a no-op when the
  // session is already idle, so it's safe to invoke unconditionally on the
  // confirming tap; the `disabled` check just guards the initial click.
  function handleStopGame(): void {
    $stopGameHandle?.()
  }

  // Photo + landmark metadata for whatever the player has tapped on the map,
  // if anything. `null` while idle / mid-round / mid-gameover so the section
  // hides itself; toggles on only during the pre-round confirmation window.
  const selectedPhoto = $derived(
    $selectedStateId !== null ? STATE_PHOTOS[$selectedStateId] : null,
  )

  // Combined printer-queue size (currently-printing job + pending). Shown in
  // the Status section so the attendant sees at-a-glance whether anything's
  // in flight before drilling into the Printer panel.
  const queueSize = $derived(
    $printerLive.pending.length + ($printerLive.active ? 1 : 0),
  )
</script>

<DraggableWindow
  visible={$boothMenuState.open}
  title="Attendant Controls"
  storageId="barnguard-window-booth-menu"
  side={$boothMenuState.side}
  width={240}
  onClose={closeBoothMenu}
>
  <DebugSection title="Status" open>
    <div class="debug-row">
      <span class="label">Backend</span>
      <span
        class="status-pill"
        class:status-pill--ok={$printerLive.connection === 'online'}
        class:status-pill--busy={$printerLive.connection === 'connecting'}
      >
        <span class="status-dot" aria-hidden="true"></span>
        {#if $printerLive.connection === 'online'}
          online
        {:else if $printerLive.connection === 'connecting'}
          connecting…
        {:else}
          offline
        {/if}
      </span>
    </div>
    <div class="debug-row">
      <span class="label">Printer</span>
      <span
        class="status-pill"
        class:status-pill--ok={$printerLive.connection === 'online' &&
          ($printerLive.printer?.reachable ?? false)}
        class:status-pill--busy={$printerLive.connection !== 'online'}
      >
        <span class="status-dot" aria-hidden="true"></span>
        {#if $printerLive.connection !== 'online'}
          unknown
        {:else if $printerLive.printer?.reachable}
          connected
        {:else}
          offline
        {/if}
      </span>
    </div>
    <div class="debug-row">
      <span class="label">Queue</span>
      <span class="dim">
        {queueSize === 0 ? 'idle' : `${queueSize} in flight`}
      </span>
    </div>
  </DebugSection>

  <DebugSection title="Panels" open>
    <ToggleButton
      active={$gamesPanelVisible}
      onToggle={toggleGamesPanel}
      label="Games"
    />
    <ToggleButton
      active={$printerPanelVisible}
      onToggle={togglePrinterPanel}
      label="Printer"
    />
    <ToggleButton
      active={$debugHudVisible}
      onToggle={toggleDebugHud}
      label="Stargazer (GFX)"
    />
  </DebugSection>

  <DebugSection title="View" open>
    <ToggleButton
      active={$isFullscreen}
      onToggle={toggleFullscreen}
      label="Fullscreen"
    />

    <div class="debug-row">
      <span class="label">Language</span>
      <div class="row__actions">
        <button
          type="button"
          class="debug-btn"
          class:active={$locale === 'de'}
          onclick={() => setLocale('de')}
        >
          DE
        </button>
        <button
          type="button"
          class="debug-btn"
          class:active={$locale === 'en'}
          onclick={() => setLocale('en')}
        >
          EN
        </button>
      </div>
    </div>

    <ToggleButton
      active={$coverScreen.visible}
      onToggle={() => setCoverVisible(!$coverScreen.visible)}
      label="Cover screen"
    />
    <DebugSelect
      label="Message"
      value={$coverScreen.mode}
      onChange={(v) => setCoverMode(v)}
      options={[
        {
          value: 'enterprise',
          label: 'Mehr Kontrolle über Datenflüsse und digitale Arbeit',
        },
        { value: 'backSoon', label: 'Wir sind gleich wieder da' },
        { divider: true },
        { value: 'custom', label: 'Custom text…' },
      ] satisfies DebugSelectItem<CoverMode>[]}
    />
    {#if $coverScreen.mode === 'custom'}
      <textarea
        class="cover-textarea"
        value={$coverScreen.customText}
        oninput={(e) =>
          setCoverText((e.currentTarget as HTMLTextAreaElement).value)}
        placeholder="Type the cover message…"
        rows="3"
      ></textarea>
    {/if}
  </DebugSection>

  {#if $selectedStateId !== null && selectedPhoto !== null}
    <DebugSection title="Selected state" open>
      <img
        class="state-photo"
        src={selectedPhoto.url}
        alt={selectedPhoto.location}
      />
      <div class="debug-row">
        <span class="label">State</span>
        <span class="state-name"
          >{$t.states[$selectedStateId]}
          <span class="dim">({$selectedStateId})</span></span
        >
      </div>
      <div class="debug-row">
        <span class="label">Landmark</span>
        <span>{selectedPhoto.location}</span>
      </div>
      <div class="debug-row">
        <span class="label">Photo</span>
        <span class="dim">{selectedPhoto.photographer}</span>
      </div>
    </DebugSection>
  {/if}

  <DebugSection title="Debug">
    <div class="debug-row">
      <span class="label">Game</span>
      <ConfirmButton
        label="Stop game"
        armedLabel="Tap again to stop"
        disabled={$stopGameHandle === null}
        onConfirm={handleStopGame}
      />
    </div>
    <div class="debug-row">
      <span class="label">Page</span>
      <button type="button" class="debug-btn" onclick={handleReload}>
        Reload
      </button>
    </div>
    <div class="debug-row">
      <span class="label">Config</span>
      <button
        type="button"
        class="debug-btn"
        onclick={handleReloadConfig}
        disabled={reloadConfigPending}
      >
        {reloadConfigPending ? 'Reloading…' : 'Reload config'}
      </button>
    </div>

    <!-- Daemon message log. Covers the whole daemon — printer + queue +
         store + panic hook — so it's more broadly useful than the printer
         panel it used to live in. Newest first. -->
    <div class="log-heading">Log</div>
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
</DraggableWindow>

<style lang="sass">
  // Row layout, button chrome, active/danger variants, and empty-state all
  // come from the shared debug-ui.sass. Toggle rows use the shared
  // ToggleButton component. What lives here is the booth-specific bits:
  // multi-button clusters (Language row), the cover-screen textarea, the
  // state photo tile, and the status pills.

  .row__actions
    display: flex
    gap: 4px

  // Free-text field for the cover-screen custom message. Mirrors
  // `DebugSelect`'s outer chrome so the two controls read as members of the
  // same family — there's no shared text-input primitive in `debug-ui/`, so
  // the styling is duplicated by hand.
  .cover-textarea
    display: block
    width: 100%
    box-sizing: border-box
    margin-block-start: 4px
    padding-block-start: 6px
    padding-block-end: 6px
    padding-inline-start: 8px
    padding-inline-end: 8px
    resize: vertical
    background: rgba(255, 255, 255, 0.05)
    border: 1px solid rgba(255, 255, 255, 0.18)
    border-radius: 4px
    color: #fff
    font: inherit
    font-size: 11px

    &:focus
      outline: none
      border-color: rgba(255, 255, 255, 0.5)
      background: rgba(255, 255, 255, 0.1)

  // Landmark photo for the "Selected state" section. Fixed height so the
  // section's overall footprint stays predictable regardless of the source
  // aspect ratio; `cover` keeps the composition sensible when cropping.
  .state-photo
    display: block
    width: 100%
    height: 88px
    object-fit: cover
    border-radius: 3px
    border: 1px solid rgba(255, 255, 255, 0.08)

  .state-name
    font-weight: 600

  .dim
    opacity: 0.55

  // Status pill: subtle "offline" (muted red) by default; flips to "connected"
  // (muted green) when the corresponding stream is live. Dot + text so it's
  // legible without relying on color alone.
  .status-pill
    display: inline-flex
    align-items: center
    gap: 6px
    padding-block-start: 2px
    padding-block-end: 2px
    padding-inline-start: 8px
    padding-inline-end: 8px
    border-radius: 999px
    background: rgba(220, 90, 90, 0.12)
    border: 1px solid rgba(220, 90, 90, 0.35)
    color: rgba(255, 170, 170, 0.9)
    text-transform: uppercase

  .status-pill--busy
    background: rgba(230, 180, 90, 0.15)
    border-color: rgba(230, 180, 90, 0.42)
    color: rgba(240, 210, 140, 0.95)

  .status-pill--ok
    background: rgba(100, 200, 130, 0.14)
    border-color: rgba(100, 200, 130, 0.4)
    color: rgba(160, 230, 180, 0.95)

  .status-dot
    width: 6px
    height: 6px
    border-radius: 50%
    background: currentColor
    flex-shrink: 0

  // Daemon log entries. Broader-than-print-status messages — printer,
  // queue, store, panic hook — so this lives in the attendant Debug
  // section rather than the printer panel.
  .log-heading
    margin-block-start: 8px
    margin-block-end: 4px
    opacity: 0.55
    text-transform: uppercase
    letter-spacing: 0.04em

  .log-entry
    display: flex
    gap: 6px
    align-items: baseline
    padding-block-start: 2px
    padding-block-end: 2px
    padding-inline-start: 6px
    padding-inline-end: 6px
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
</style>
