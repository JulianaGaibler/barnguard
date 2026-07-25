/**
 * Stylized in-engine menu preview for Connect Four, built on the primary stage
 * while the menu is shown. A big 4×4 two-player arrangement — one side pure
 * white, the other 50% white — positioned so it spills off the right and bottom
 * edges (partially obscured). No visible grid; only placed discs read. After a
 * short delay the top disc of each column drops in using the real
 * `DiscNode.drop` animation, then it rests.
 */
import {
  SceneNode,
  ignoreAbort,
  type EngineHost,
  type Rect,
} from '@src/stargazer'
import type { MenuPreview } from '@src/displays/arcade/menu/types'
import { DiscNode } from './nodes/DiscNode'
import { BOARD } from './tuning'

// Two "players": A is 50% white, B is pure white.
const PLAYER_A = 'rgba(255, 255, 255, 0.5)'
const PLAYER_B = '#ffffff'

// 4×4 layout, top row first. X = empty, A = 50%, B = 100%.
const PATTERN = ['XXBX', 'XBAX', 'XABA', 'BBAB'] as const
// Topmost filled disc of each column drops in; the rest are pre-placed.
const DROP_IN: ReadonlyArray<readonly [number, number]> = [
  [3, 0],
  [1, 1],
  [0, 2],
  [2, 3],
]
/** Wait before the drop-in animation begins. */
const START_DELAY_SEC = 0.5

const colorFor = (ch: string): string => (ch === 'B' ? PLAYER_B : PLAYER_A)

export function buildConnectFourMenuPreview(
  host: EngineHost,
  view: Rect,
): MenuPreview {
  const abort = new AbortController()

  const root = new SceneNode('cf-menu-preview')
  root.transform.x = view.x
  root.transform.y = view.y
  const discLayer = new SceneNode('preview-discs')
  root.add(discLayer)
  host.engine.scene.root.add(root)

  // Big cells anchored past the middle so the 4×4 runs off the right + bottom.
  const cell = view.height * 0.23
  const gridX = view.width * 0.51
  const gridY = view.height * 0.14
  const discRadius = cell * BOARD.discRadiusFrac
  const cellX = (col: number): number => gridX + (col + 0.5) * cell
  const cellY = (row: number): number => gridY + (row + 0.5) * cell
  const startY = gridY - cell * 0.5 // just above the grid, where drops begin

  const dropKeys = new Set(DROP_IN.map(([r, c]) => `${r},${c}`))

  // Pre-place the static discs (everything except the drop-ins).
  for (let row = 0; row < PATTERN.length; row++) {
    const line = PATTERN[row]
    for (let col = 0; col < line.length; col++) {
      const ch = line[col]
      if (ch === 'X' || dropKeys.has(`${row},${col}`)) continue
      const disc = new DiscNode(colorFor(ch), discRadius)
      disc.transform.x = cellX(col)
      disc.transform.y = cellY(row)
      discLayer.add(disc)
    }
  }

  // After a beat, drop the column tops in using the real game drop animation.
  async function run(): Promise<void> {
    await host.engine.wait(START_DELAY_SEC, abort.signal).catch(ignoreAbort)
    for (const [row, col] of DROP_IN) {
      if (abort.signal.aborted || root.isDestroyed) return
      const disc = new DiscNode(colorFor(PATTERN[row][col]), discRadius)
      disc.transform.x = cellX(col)
      disc.transform.y = startY
      discLayer.add(disc)
      // Reuse the game's drop tween; `row + 1` scales its duration to the fall.
      await disc.drop(cellY(row), row + 1)
      if (abort.signal.aborted || root.isDestroyed) return
      await host.engine.wait(0.12, abort.signal).catch(ignoreAbort)
    }
  }
  void run()

  return {
    destroy() {
      abort.abort()
      if (!root.isDestroyed) root.destroy()
    },
  }
}
