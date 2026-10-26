import { writable } from 'svelte/store'
import type { Flag, NodeId } from '../story/types'

/** Where the attendant asked the story to open. */
export interface JumpRequest {
  node: NodeId
  flags: readonly Flag[]
  /** Distinguishes two requests for the same screen. */
  id: number
}

/** The attendant's latest request, or null before any. */
export const jumpRequest = writable<JumpRequest | null>(null)

let counter = 0

/** Asks the story to open at `node`. */
export function requestJump(node: NodeId, flags: readonly Flag[] = []): void {
  jumpRequest.set({ node, flags, id: ++counter })
}
