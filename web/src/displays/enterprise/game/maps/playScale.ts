/**
 * How many map units the round's framing shows top to bottom on a 16:9 screen.
 * Every map loads at the scale that frames this many, so what `TUNING` sizes in
 * map units (packets, the epicenter, the grid, speeds) comes out the same size
 * on screen whichever map is played.
 */
export const PLAY_VIEW_HEIGHT = 700

/** The screen shape {@link PLAY_VIEW_HEIGHT} holds for. */
export const PLAY_VIEW_ASPECT = 16 / 9
