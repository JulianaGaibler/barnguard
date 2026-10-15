/**
 * Render a finished round's label and queue it on the printer. The game over
 * screen's Print button calls this, and does not wait on it: a failure is
 * logged for the attendant and the screen carries on.
 */
import { get } from 'svelte/store'
import { squarePxFrom } from '@src/core/print/canvas'
import { enqueuePrint, printerLive } from '@src/core/print/printerClient'
import { t } from '@src/displays/enterprise/i18n'
import { renderLabel, type LabelInput } from '@src/displays/enterprise/label'

/** Whether the printer daemon and the printer behind it can take a job. */
export function printerReady(): boolean {
  const live = get(printerLive)
  return live.connection === 'online' && (live.printer?.reachable ?? false)
}

export async function printLabel(
  input: Omit<LabelInput, 'printedAt'>,
): Promise<void> {
  try {
    // Sized to the loaded tape when known. The daemon's autofit corrects any
    // mismatch.
    const tapeWidthMm = get(printerLive).printer?.tapeWidthMm
    const blob = await renderLabel(
      { ...input, printedAt: new Date() },
      { messages: get(t), size: squarePxFrom(tapeWidthMm) },
    )
    await enqueuePrint(blob, {
      stateId: input.stateId,
      score: input.score,
      highScore: input.isOverallHigh || input.isStateHigh,
      source: 'game',
    })
  } catch (err) {
    console.error('[print] label print failed:', err)
  }
}
