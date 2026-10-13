import type { Component } from 'svelte'

/** Dark (`primary`) or white (`surface`) button, matching `core/ui/Button`. */
export type MenuVariant = 'primary' | 'surface'

/** A leaf menu button that runs an action. */
export interface MenuAction {
  kind?: 'action'
  label: string
  /** Default `'primary'` (dark). */
  variant?: MenuVariant
  /** Optional leading icon component (e.g. `RobotIcon`). */
  icon?: Component
  onSelect: () => void
  /**
   * A square icon-only button rendered to this item's right (e.g. a leaderboard
   * toggle next to "How to Play").
   */
  trailing?: {
    icon: Component
    ariaLabel: string
    onSelect: () => void
  }
}

/**
 * A button that opens a sub-panel in the same rail. Its items may themselves be
 * submenus, so a menu can nest more than one level deep (e.g. opponent, then
 * mode, then AI difficulty). `MenuScreen` tracks the open path and adds a Back
 * button at every level.
 */
export interface MenuSubmenu {
  kind: 'submenu'
  label: string
  variant?: MenuVariant
  /** Heading shown above the sub-panel (e.g. "Play against AI"). */
  heading: string
  items: MenuItem[]
}

export type MenuItem = MenuAction | MenuSubmenu

/**
 * Optional running score shown under the title. Rendered only when a game
 * passes it AND it's past 0:0. Colors are the two teams' dot colors.
 */
export interface MenuScore {
  left: number
  right: number
  leftColor: string
  rightColor: string
}

/**
 * A stylized in-engine menu preview (right side of the game region), built by a
 * game while its menu is shown and torn down when the menu leaves.
 */
export interface MenuPreview {
  destroy(): void
}
