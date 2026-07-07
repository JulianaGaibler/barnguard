import { SceneNode } from '../scene/SceneNode'

/**
 * A pure transform container, no visual output of its own. Use to group
 * children so they share a transform. Semantically identical to plain
 * `SceneNode` but expresses intent.
 */
export class GroupNode extends SceneNode {}
