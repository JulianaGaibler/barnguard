import type { Readable } from 'svelte/store'
import type { ConnectionState } from './printerClient'

/**
 * Call `onBack` each time `connection` turns `'online'` from any other state.
 * The state it holds when the watch begins never counts, so a connection that
 * is already online calls nothing until it drops and returns. Returns the
 * function that stops the watch.
 */
export function onReconnect(
  connection: Readable<{ connection: ConnectionState }>,
  onBack: () => void,
): () => void {
  let last: ConnectionState | null = null
  return connection.subscribe(({ connection: state }) => {
    const cameBack = last !== null && last !== 'online'
    last = state
    if (state === 'online' && cameBack) onBack()
  })
}
