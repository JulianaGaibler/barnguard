<!--
  Full Stack main menu. Thin config over the shared `MenuScreen`; the
  in-engine preview to the right belongs to `FullStackGame`.
-->
<script lang="ts">
  import RobotIcon from '@src/displays/arcade/RobotIcon.svelte'
  import MenuScreen from '@src/displays/arcade/menu/MenuScreen.svelte'
  import type {
    MenuAction,
    MenuItem,
    MenuScore,
    MenuSubmenu,
  } from '@src/displays/arcade/menu/types'
  import { t as arcadeT } from '@src/displays/arcade/i18n'
  import { FS_STRINGS as t } from '../strings'
  import type { BoardSize, GameMode } from '../game'

  interface Props {
    onStart: (mode: GameMode) => void
    onExit: () => void
    /** Absent when the shared demo stage is unavailable. */
    onHowToPlay?: () => void
    /** Matches each side has taken in the mode last played. */
    matchWins?: { a: number; b: number }
    /** Side whose tally just ticked up, which pulses their tile. */
    bumpSide?: 0 | 1 | null
  }
  const {
    onStart,
    onExit,
    onHowToPlay,
    matchWins,
    bumpSide = null,
  }: Props = $props()

  // Opponent first, then mode, then (for AI) difficulty. The AI difficulties on
  // Quick are only two: on a four-seat board the deepest search plays no better
  // than the middle one, so Executive would be Manager under another name. The
  // full 3x3 board keeps all three, where they clearly part.
  const aiDifficulties = (size: BoardSize): MenuAction[] => {
    const list: MenuAction[] = [
      {
        label: t.easy,
        variant: 'primary',
        onSelect: () => onStart({ kind: 'ai', difficulty: 'easy', size }),
      },
      {
        label: t.medium,
        variant: 'primary',
        onSelect: () => onStart({ kind: 'ai', difficulty: 'medium', size }),
      },
    ]
    if (size === 'standard') {
      list.push({
        label: t.hard,
        variant: 'primary',
        onSelect: () => onStart({ kind: 'ai', difficulty: 'hard', size }),
      })
    }
    return list
  }

  const modeLabel = (size: BoardSize): string =>
    size === 'quick' ? t.quick : t.standard

  // Quick sits above Standard: the short game is the draw on an office display.
  // Each mode under "Against AI" opens its own difficulty picker.
  const aiModes: MenuSubmenu[] = (['quick', 'standard'] as const).map(
    (size) => ({
      kind: 'submenu',
      label: modeLabel(size),
      variant: 'primary',
      heading: t.chooseDifficulty,
      items: aiDifficulties(size),
    }),
  )

  // Each mode under "2 Players" starts the match directly.
  const versusModes: MenuAction[] = (['quick', 'standard'] as const).map(
    (size) => ({
      label: modeLabel(size),
      variant: 'primary',
      onSelect: () => onStart({ kind: 'versus', size }),
    }),
  )

  const items = $derived.by<MenuItem[]>(() => {
    const list: MenuItem[] = [
      {
        kind: 'submenu',
        label: t.twoPlayers,
        variant: 'primary',
        heading: t.chooseMode,
        items: versusModes,
      },
      {
        kind: 'submenu',
        label: t.vsAi,
        variant: 'primary',
        heading: t.chooseMode,
        items: aiModes,
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

  // Read from the theme rather than a local constant: the seat colors only
  // exist as `themeTokens`, and taking them from there means they cannot drift
  // from the ones the board itself is drawn in.
  const score = $derived<MenuScore | undefined>(
    matchWins
      ? {
          left: matchWins.a,
          right: matchWins.b,
          leftColor: 'var(--color-team-a)',
          rightColor: 'var(--color-team-b)',
        }
      : undefined,
  )
  const bump = $derived<'left' | 'right' | null>(
    bumpSide === 0 ? 'left' : bumpSide === 1 ? 'right' : null,
  )
</script>

<MenuScreen title={t.title} {items} {score} {bump} backLabel={t.back} />
