<!--
  Flood It's main menu. Thin config over the shared `MenuScreen` (Valve-style
  left rail); all color comes from the game's `themeTokens`, so this stays
  presentation-free. The right side of the region is left for an in-engine
  preview.

  Each mode opens a board-size submenu rather than listing every mode and size
  pair, which would be nine buttons. `MenuSubmenu` holds actions only, so the
  nesting stops one level down and the mode has to be the outer choice.
-->
<script lang="ts">
  import RobotIcon from '@src/displays/arcade/RobotIcon.svelte'
  import MenuScreen from '@src/displays/arcade/menu/MenuScreen.svelte'
  import type {
    MenuAction,
    MenuItem,
    MenuScore,
  } from '@src/displays/arcade/menu/types'
  import { FLOOD_IT_STRINGS as t } from '../strings'
  import { ACCENT } from '../game/tuning'
  import type { GameMode, PlayerId, PresetId } from '../game/types'

  interface Props {
    onStart: (mode: GameMode) => void
    onExit: () => void
    onHowToPlay?: () => void
    /** Rounds each player has taken in the versus mode last played. */
    versusWins?: { a: number; b: number }
    /** Player whose tally just ticked up, which pulses their tile. */
    bumpPlayer?: PlayerId | null
  }
  const {
    onStart,
    onExit,
    onHowToPlay,
    versusWins,
    bumpPlayer = null,
  }: Props = $props()

  const SIZES: ReadonlyArray<{ label: string; preset: PresetId }> = [
    { label: t.sizeSmall, preset: 'small' },
    { label: t.sizeMedium, preset: 'medium' },
    { label: t.sizeLarge, preset: 'large' },
  ]

  const sizeItems = (kind: GameMode['kind']): MenuAction[] =>
    SIZES.map(({ label, preset }) => ({
      label,
      onSelect: () => onStart({ kind, preset } as GameMode),
    }))

  const items = $derived.by<MenuItem[]>(() => {
    const list: MenuItem[] = [
      {
        kind: 'submenu',
        label: t.modeSolo,
        heading: t.boardSize,
        items: sizeItems('solo'),
      },
      {
        kind: 'submenu',
        label: t.modeRace,
        heading: t.boardSize,
        items: sizeItems('race'),
      },
      {
        kind: 'submenu',
        label: t.modeTerritory,
        heading: t.boardSize,
        items: sizeItems('territory'),
      },
    ]
    if (onHowToPlay) {
      list.push({
        label: t.howToPlay,
        variant: 'surface',
        onSelect: onHowToPlay,
      })
    }
    list.push({
      label: t.returnToLauncher,
      variant: 'surface',
      icon: RobotIcon,
      onSelect: onExit,
    })
    return list
  })
  const score = $derived<MenuScore | undefined>(
    versusWins
      ? {
          left: versusWins.a,
          right: versusWins.b,
          leftColor: ACCENT[1],
          rightColor: ACCENT[2],
        }
      : undefined,
  )
  const bump = $derived<'left' | 'right' | null>(
    bumpPlayer === 1 ? 'left' : bumpPlayer === 2 ? 'right' : null,
  )
</script>

<MenuScreen title={t.title} {items} {score} {bump} />
