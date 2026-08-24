/**
 * Monsters, Int's UI copy. English only, a plain object the components and
 * nodes import directly. Copy that is about the arcade shell rather than this
 * game (Paused, Resume, How to play, Return to Launcher, Main menu) comes from
 * `displays/arcade/i18n` instead, so every game says it the same way.
 */
export const MONSTERS_INT_STRINGS = {
  title: 'Monsters, Int',

  modeDuel: 'Duel',
  modeParty: 'Party',
  partyHeading: 'How many players?',
  players: (n: number): string => `${n} Players`,

  hit: 'HIT',
  stay: 'STAY',

  drawnBy: (shape: string): string => `Drawn by ${shape}`,
  /**
   * Marks the chooser's own button in a target prompt. Every seat is named by
   * its shape, and the one holding the card is named the same way as the rest,
   * so without this it takes a beat to work out which one is you.
   */
  you: 'You',
  aimFreeze: 'Freeze a player',
  aimThreeMore: 'Give someone three more',
  giveLife: 'Pass the spare life on',

  /**
   * The readout on the lip, in two pieces: a line that follows the seat's shape
   * and a quieter one under it saying what to do about it.
   *
   * The shape leads instead of a name, so a player matches the shape in front
   * of them to the shape on the banner without reading a word. That is why
   * these read as sentence tails rather than sentences.
   *
   * The table also moves on its own for long stretches, the deal and a Three
   * More run especially. Without a line saying so, cards arrive in front of
   * people for no stated reason and the game reads as something happening TO
   * the players rather than something they are doing.
   */
  turn: "'s turn!",
  turnNote: 'Hit or stay?',
  drewFreeze: ' drew Freeze',
  aimFreezeNote: 'Pick a player to freeze',
  drewThreeMore: ' drew Three More',
  aimThreeMoreNote: 'Pick a player to draw three',
  hasSpareLife: ' has a spare life',
  giveLifeNote: 'Pick a player to pass it to',

  isDealt: ' is dealt in',
  draws: ' draws',
  alreadyHas: ' has that one already',
  spendsLife: ' spends the extra life',
  spendsLifeNote: 'Both cards go back to the deck',
  isOut: ' is out',
  isOutNote: 'Bust, and the round is worth nothing',
  hasSeven: ' has all seven',
  hasSevenNote: 'That ends the round',
  staysWith: ' stays',
  staysWithNote: 'Banked for the round',
  isFrozen: ' is frozen',
  isFrozenNote: 'Banked, whether they liked it or not',
  takesThree: ' takes three more',
  takesThreeNote: 'Three cards, no choice about it',
  takesLife: ' keeps the extra life',
  takesLifeNote: 'One duplicate will not bust them',
  getsLife: ' is handed the extra life',
  getsLifeNote: 'One duplicate will not bust them',
  dropsLife: 'The spare life goes back to the deck',
  reshuffling: 'Shuffling the deck back together',

  round: (n: number): string => `Round ${n}`,
  roundOver: 'Round over',
  winner: (shape: string): string => `${shape} wins`,
  sharedWin: (shapes: readonly string[]): string =>
    `${shapes.join(' and ')} win together`,
  afterRounds: (n: number): string =>
    n === 1 ? 'After one round' : `After ${n} rounds`,
  nextRound: 'Next round',
  bust: 'Bust',
  stayed: 'Stayed',
  seven: 'Seven!',
  total: 'Total',

  /**
   * The how-to-play cards, in the order they are read.
   *
   * The goal comes before the controls on purpose. A player who knows they are
   * collecting numbers without repeating one understands what a button does the
   * moment they see it, where a player told about buttons first has to hold
   * that in mind until the point arrives.
   *
   * One idea a card. Where two ideas are really one, they share a card: staying
   * only means anything against hitting, and the three cards that change the
   * rules are recognised as a group before they are told apart.
   */
  tutorial: {
    goalTitle: 'First to 200 wins',
    goalBody:
      'A round is worth what the numbers in front of you add up to. Bank enough rounds to reach 200 and the match is yours.',

    deckTitle: 'Big numbers are common',
    deckBody:
      'One 1, two 2s, three 3s, all the way to twelve 12s. The bigger a card, the more of them there are to run into twice. One 0, worth nothing.',

    sevenTitle: 'Seven different numbers',
    sevenBody:
      'Collect seven numbers with no repeat and the round ends for everyone, there and then. It is worth 15 points on top of your own.',

    bustTitle: 'Never take the same number twice',
    bustBody:
      'Draw a number already in front of you and you are out of the round with nothing. That is the whole risk.',

    hitStayTitle: 'Hit, or stay',
    hitStayBody:
      'Hit takes another card off the monster. Stay ends your round and banks what you have, which is scored whatever anybody else does next.',

    bonusTitle: 'Bonuses and the doubler',
    bonusBody:
      'A plus card adds its number to your score. The doubler doubles your numbers first, and any plus cards are added after that.',

    actionsTitle: 'Three cards change the rules',
    actionsBody:
      'Freeze ends a player\u2019s round for them. Three More forces three cards on somebody. An Extra Life survives one repeat.',
  },

  /**
   * A way to finish rather than abandon. The booth is played standing up and a
   * game to 200 can outlast the people playing it, so the table can call the
   * score where it stands and still get a winner.
   */
  endEarly: 'Call it here',
  calledEarly: 'Called early',
} as const
