import type { Flag, NodeId } from './types'

/** A place in the story the attendant can open it at. */
export interface Section {
  title: string
  node: NodeId
  /**
   * Flags to start with, for a screen that reads one. Without them the run is
   * the shortest path to the screen, which sets its own. Either way they are
   * only defaults, since a visitor who plays from the start sets them by
   * choosing.
   */
  flags?: readonly Flag[]
}

/** The story in the order it plays, by its chapters and its turning points. */
export const SECTIONS: readonly Section[] = [
  { title: 'The booth', node: '1.01b' },
  { title: 'The driveway', node: '1.05' },
  { title: 'The office', node: '1.11' },
  { title: 'The grocery store', node: '2.01' },
  { title: 'The first fight', node: '2.07' },
  { title: 'Sunday night', node: '3.01' },
  { title: 'The party', node: '4.01' },
  { title: 'The photo', node: '4.04' },
  { title: 'The bill', node: '5.01' },
  { title: 'The second fight', node: '5.06b' },
  { title: 'October', node: '5.08' },
  { title: 'Election night', node: '6.01' },
  { title: 'The car', node: '6.05' },
  { title: 'The dark house', node: '6.06' },
  { title: 'The first touch', node: '6.12' },
  { title: 'Eyes red at the edges', node: '6.14' },
  { title: 'The end', node: '6.15' },
  { title: 'Your law', node: '7.01' },
]
