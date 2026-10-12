<script lang="ts">
  import { t, regionName } from '@src/displays/enterprise/i18n'
  import { selectedStateId } from '@src/stores/gameSelection'
  import { activeMap } from '@src/displays/enterprise/activeMap'
  import {
    DebugSection,
    DebugSelect,
    ToggleButton,
    type DebugSelectItem,
  } from '@src/stargazer/debug/ui'
  import {
    coverScreen,
    setCoverMode,
    setCoverText,
    setCoverVisible,
    BRAND_HEADLINE,
    type CoverMode,
  } from './coverState'

  // The store carries an opaque id. Its name resolves against whichever map
  // the running session loaded, since the same id string means nothing on
  // another map.
  const id = $derived($selectedStateId)
  const name = $derived(
    id !== null && $activeMap !== null
      ? regionName($t, $activeMap.i18nNamespace, id)
      : null,
  )
</script>

{#if id !== null}
  <DebugSection title="Selected region" open>
    <div class="debug-row">
      <span class="label">Region</span>
      <span class="state-name"
        >{name ?? id}
        <span class="dim">({id})</span></span
      >
    </div>
    <div class="debug-row">
      <span class="label">Map</span>
      <span class="dim">{$activeMap?.id ?? 'unknown'}</span>
    </div>
  </DebugSection>
{/if}

<DebugSection title="Cover screen" open>
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
      { value: 'brand', label: BRAND_HEADLINE },
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

<style lang="sass">
  .debug-row
    display: flex
    justify-content: space-between
    gap: 8px
    padding: 4px 0
  .label
    color: var(--color-text-secondary)
  .state-name
    font-weight: 600
  .dim
    color: var(--color-text-secondary)
    font-weight: 400

  // Free-text field for the cover-screen custom message. Mirrors
  // `DebugSelect`'s outer chrome so the two controls read as members of the
  // same family. There's no shared text-input primitive in `debug-ui/`, so
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
</style>
