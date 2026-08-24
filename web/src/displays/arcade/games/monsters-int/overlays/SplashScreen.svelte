<!--
  Monsters, Int's main menu. Thin config over the shared `MenuScreen`, so all
  color comes from the game's `themeTokens` and this stays presentation-free.

  Duel is its own entry rather than a seat count. The ruleset is written for
  three or more, and at two seats the targeted actions have no choice left in
  them, which is a different game rather than a smaller one.
-->
<script lang="ts">
  import RobotIcon from '@src/displays/arcade/RobotIcon.svelte'
  import MenuScreen from '@src/displays/arcade/menu/MenuScreen.svelte'
  import type { MenuItem } from '@src/displays/arcade/menu/types'
  import { t as arcadeT } from '@src/displays/arcade/i18n'
  import { MONSTERS_INT_STRINGS as t } from '../strings'
  import type { SeatCount } from '../game'

  interface Props {
    onStart: (seats: SeatCount) => void
    onExit: () => void
    /** Absent when the booth could not build a demo stage, which hides the item. */
    onHowToPlay?: () => void
  }
  const { onStart, onExit, onHowToPlay }: Props = $props()

  const PARTY_COUNTS: SeatCount[] = [3, 4, 5]

  const items = $derived.by<MenuItem[]>(() => {
    const list: MenuItem[] = [
      { label: t.modeDuel, onSelect: () => onStart(2) },
      {
        kind: 'submenu',
        label: t.modeParty,
        heading: t.partyHeading,
        items: PARTY_COUNTS.map((seats) => ({
          label: t.players(seats),
          onSelect: () => onStart(seats),
        })),
      },
    ]
    if (onHowToPlay) {
      list.push({
        label: $arcadeT.arcade.tutorial.title,
        variant: 'surface',
        onSelect: onHowToPlay,
      })
    }
    list.push({
      label: $arcadeT.arcade.returnToLauncher,
      variant: 'surface',
      icon: RobotIcon,
      onSelect: onExit,
    })
    return list
  })
</script>

<MenuScreen title={t.title} {items} />
