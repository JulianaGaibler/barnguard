<!--
  Booth-menu section for the attendant: opens the story at a section, so a
  screen can be shown without playing up to it. The flags a section reads are
  set by the shortest path there, and a visitor who plays from the start
  overrides them by choosing.
-->
<script lang="ts">
  import { DebugSection } from 'stargazer/debug-ui'
  import { SECTIONS } from '../story/sections'
  import { requestJump } from './jump'
</script>

<DebugSection title="Jump to section">
  {#each SECTIONS as section (section.node)}
    <button
      type="button"
      class="debug-btn"
      onclick={() => requestJump(section.node, section.flags)}
    >
      {section.node}
      {section.title}
    </button>
  {/each}
</DebugSection>
