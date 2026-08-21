// The Office Overtime deck: 78 candidates split evenly between the Management
// and IC floors.
//
// A card is pure data. Two fields drive everything:
//
//   ability  the on-hire effects, resolved once the moment the card is placed
//   scoring  the performance review, evaluated only at the end of the game
//
// Both are expressed through the shared `Metric` union, a countable quantity
// over an org. That is what keeps `scoring.ts` and `economy.ts` free of
// per-card logic: they interpret the union, never a card id.
//
// The group distribution is load-bearing. Leadership appears on 14 Management
// shields against 1 IC shield, Design on 0 against 20, and the four groups
// between them slide across that range. Cards that score on missing groups or
// on runs of identical groups are balanced against exactly those counts, so
// `deck.test.ts` pins every total.
//
// Ten cards carry a `from: 'opponent'` ability that reads across the table, and
// eight offer a choice. Everything else reads only the acting player's own org.

/** Which floor a card is recruited from, and which deck it belongs to. */
export type Floor = 'management' | 'ic'

/** A card's department. A card carries one or two, and they may repeat. */
export type Group =
  'leadership' | 'people' | 'research' | 'product' | 'engineering' | 'design'

export const ALL_GROUPS: readonly Group[] = [
  'leadership',
  'people',
  'research',
  'product',
  'engineering',
  'design',
]

/**
 * A countable quantity over some set of org cells. Shared by abilities and
 * scoring so that both sides need only one interpreter.
 */
export type Metric =
  | { count: 'group'; group: Group }
  | { count: 'groupAny'; groups: Group[] }
  | { count: 'distinctGroups' }
  | { count: 'missingGroups' }
  | { count: 'cardsAt'; floor: Floor }
  | { count: 'cardsWithCost'; cost: number }
  | { count: 'cardsWithCostAtLeast'; cost: number }
  | { count: 'cardsWithGroups'; groups: number }
  | { count: 'discountCards' }
  | { count: 'openSeats' }
  | { count: 'emptySeats' }
  | { count: 'filledSeats' }
  // The ribbon down a card's edge shows the floor it came from, so this counts
  // exactly what `cardsAt` counts. It stays separate so rules text can say
  // "per Management ribbon" instead of "per Management card".
  | { count: 'ribbon'; floor: Floor }
  | { count: 'budgetLines' }
  | { count: 'budgetLineTotal' }
  | { count: 'approvals' }

/** Which cells a scoring rule counts over, relative to the scoring card. */
export type Region = 'row' | 'column' | 'rowOrColumn' | 'org'

/** A named part of the finished 3x3 org, for position bonuses. */
export type Area =
  | 'topRow'
  | 'middleRow'
  | 'bottomRow'
  | 'leftColumn'
  | 'middleColumn'
  | 'rightColumn'
  | 'corner'
  | 'edgeCenter'

export type Condition =
  | { when: 'inArea'; area: Area }
  | { when: 'noGroup'; group: Group }
  | { when: 'hasOpenSeat' }

/** A standing budget approval: every later hire on `on` costs `amount` less. */
export type Discount = { amount: number; on: Floor | 'all' }

export type ScoringRule =
  | { score: 'perMetric'; points: number; per: Metric; region?: Region }
  // points x the number of complete sets holding one of each listed metric.
  | { score: 'perSet'; points: number; of: Metric[] }
  // points x the number of `size`-card runs of one group, summed over groups.
  | { score: 'perMatchingGroupSet'; points: number; size: number }
  // points x floor(count / size).
  | { score: 'perRun'; points: number; per: Metric; size: number }
  | { score: 'bonus'; points: number; when: Condition }
  // This card holds up to `cap` leftover budget, scoring `points` per dollar.
  | { score: 'budgetLine'; points: number; cap: number }

export type Resource = 'budget' | 'approval'

/**
 * An on-hire effect. `from: 'opponent'` reads the other player's org instead of
 * your own; everything else is scoped to the acting player.
 */
export type Effect =
  | { effect: 'gain'; resource: Resource; amount: number }
  | {
      effect: 'gainPer'
      resource: Resource
      amount: number
      per: Metric
      from?: 'opponent'
    }
  // Move supply money onto your budget lines: every one, or the best `target`.
  | {
      effect: 'fundBudgetLines'
      target: 'each' | number
      amount: number | 'toFull'
    }
  | { effect: 'opponentGains'; resource: Resource; amount: number }
  | { effect: 'everyoneGains'; resource: Resource; amount: number }
  // Drop one face-up candidate from `floor` and take its printed cost as budget.
  | { effect: 'dropCandidate'; floor: Floor }
  | { effect: 'choose'; options: Effect[][] }

export interface Card {
  id: string
  name: string
  floor: Floor
  cost: number
  /** One or two groups. Two entries of the same group is a common shape. */
  groups: Group[]
  /** Where hiring this card sends the floor marker, or null to leave it. */
  sendsMarkerTo: Floor | null
  discount?: Discount
  /** Empty for every card that grants a discount, non-empty for all others. */
  ability: Effect[]
  scoring: ScoringRule
}

export const DECK: readonly Card[] = [
  // Management floor

  {
    id: 'mgmt-head-of-business-analytics',
    name: 'Head of Business Analytics',
    floor: 'management',
    cost: 6,
    groups: ['research'],
    sendsMarkerTo: null,
    discount: { amount: 1, on: 'all' },
    ability: [],
    scoring: { score: 'perMetric', points: 4, per: { count: 'discountCards' } },
  },
  {
    id: 'mgmt-insights-manager',
    name: 'Insights Manager',
    floor: 'management',
    cost: 3,
    groups: ['research'],
    sendsMarkerTo: 'ic',
    discount: { amount: 1, on: 'management' },
    ability: [],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'research' },
      region: 'column',
    },
  },
  {
    id: 'mgmt-research-operations-manager',
    name: 'Research Operations Manager',
    floor: 'management',
    cost: 4,
    groups: ['research'],
    sendsMarkerTo: 'ic',
    discount: { amount: 1, on: 'ic' },
    ability: [],
    scoring: {
      score: 'perMetric',
      points: 2,
      per: { count: 'distinctGroups' },
    },
  },
  {
    id: 'mgmt-data-scientist-manager',
    name: 'Data Scientist Manager',
    floor: 'management',
    cost: 5,
    groups: ['research', 'research'],
    sendsMarkerTo: null,
    discount: { amount: 1, on: 'management' },
    ability: [],
    scoring: {
      score: 'bonus',
      points: 8,
      when: { when: 'inArea', area: 'leftColumn' },
    },
  },
  {
    id: 'mgmt-head-of-it-infrastructure',
    name: 'Head of IT Infrastructure',
    floor: 'management',
    cost: 7,
    groups: ['engineering'],
    sendsMarkerTo: 'ic',
    ability: [
      {
        effect: 'choose',
        options: [
          [{ effect: 'fundBudgetLines', target: 'each', amount: 2 }],
          [{ effect: 'gain', resource: 'approval', amount: 3 }],
        ],
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 1,
      per: { count: 'budgetLineTotal' },
    },
  },
  {
    id: 'mgmt-chief-marketing-officer',
    name: 'Chief Marketing Officer',
    floor: 'management',
    cost: 3,
    groups: ['leadership'],
    sendsMarkerTo: null,
    discount: { amount: 1, on: 'all' },
    ability: [],
    scoring: {
      score: 'bonus',
      points: 10,
      when: { when: 'noGroup', group: 'design' },
    },
  },
  {
    id: 'mgmt-head-of-workflow-innovation',
    name: 'Head of Workflow Innovation',
    floor: 'management',
    cost: 5,
    groups: ['product', 'product'],
    sendsMarkerTo: 'ic',
    discount: { amount: 1, on: 'ic' },
    ability: [],
    scoring: {
      score: 'bonus',
      points: 8,
      when: { when: 'inArea', area: 'rightColumn' },
    },
  },
  {
    id: 'mgmt-people-operations-manager',
    name: 'People Operations Manager',
    floor: 'management',
    cost: 4,
    groups: ['people'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'cardsAt', floor: 'management' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'people' },
      region: 'row',
    },
  },
  {
    id: 'mgmt-vp-of-data-and-research',
    name: 'VP of Data and Research',
    floor: 'management',
    cost: 6,
    groups: ['leadership', 'research'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'group', group: 'research' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 2,
      per: { count: 'ribbon', floor: 'management' },
    },
  },
  {
    id: 'mgmt-head-of-employee-experience',
    name: 'Head of Employee Experience',
    floor: 'management',
    cost: 5,
    groups: ['people'],
    sendsMarkerTo: 'ic',
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'cardsWithGroups', groups: 1 },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 2,
      per: { count: 'cardsAt', floor: 'ic' },
    },
  },
  {
    id: 'mgmt-chief-technical-officer',
    name: 'Chief Technical Officer',
    floor: 'management',
    cost: 2,
    groups: ['leadership', 'engineering'],
    sendsMarkerTo: null,
    discount: { amount: 1, on: 'management' },
    ability: [],
    scoring: {
      score: 'perMetric',
      points: 2,
      per: { count: 'distinctGroups' },
      region: 'row',
    },
  },
  {
    id: 'mgmt-culture-engagement-manager',
    name: 'Culture & Engagement Manager',
    floor: 'management',
    cost: 4,
    groups: ['people'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'emptySeats' },
      },
    ],
    scoring: {
      score: 'bonus',
      points: 10,
      when: { when: 'noGroup', group: 'engineering' },
    },
  },
  {
    id: 'mgmt-board-member',
    name: 'Board Member',
    floor: 'management',
    cost: 5,
    groups: ['leadership', 'leadership'],
    sendsMarkerTo: null,
    ability: [{ effect: 'gain', resource: 'approval', amount: 2 }],
    scoring: {
      score: 'bonus',
      points: 8,
      when: { when: 'inArea', area: 'topRow' },
    },
  },
  {
    id: 'mgmt-head-of-product',
    name: 'Head of Product',
    floor: 'management',
    cost: 7,
    groups: ['product'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'distinctGroups' },
      },
    ],
    scoring: { score: 'perMatchingGroupSet', points: 6, size: 3 },
  },
  {
    id: 'mgmt-frontend-engineering-manager',
    name: 'Frontend Engineering Manager',
    floor: 'management',
    cost: 5,
    groups: ['engineering'],
    sendsMarkerTo: 'ic',
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'groupAny', groups: ['people', 'engineering'] },
      },
    ],
    scoring: {
      score: 'perSet',
      points: 4,
      of: [
        { count: 'group', group: 'people' },
        { count: 'group', group: 'engineering' },
      ],
    },
  },
  {
    id: 'mgmt-ur-program-manager',
    name: 'UR Program Manager',
    floor: 'management',
    cost: 4,
    groups: ['research', 'engineering'],
    sendsMarkerTo: 'ic',
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'cardsWithGroups', groups: 2 },
      },
    ],
    scoring: {
      score: 'bonus',
      points: 6,
      when: { when: 'inArea', area: 'leftColumn' },
    },
  },
  {
    id: 'mgmt-workforce-planning-lead',
    name: 'Workforce Planning Lead',
    floor: 'management',
    cost: 4,
    groups: ['people', 'research'],
    sendsMarkerTo: null,
    ability: [{ effect: 'dropCandidate', floor: 'ic' }],
    scoring: { score: 'budgetLine', points: 2, cap: 8 },
  },
  {
    id: 'mgmt-director-of-engineering',
    name: 'Director of Engineering',
    floor: 'management',
    cost: 5,
    groups: ['engineering', 'engineering'],
    sendsMarkerTo: 'ic',
    ability: [{ effect: 'dropCandidate', floor: 'ic' }],
    scoring: {
      score: 'bonus',
      points: 5,
      when: { when: 'inArea', area: 'bottomRow' },
    },
  },
  {
    id: 'mgmt-ceo',
    name: 'CEO',
    floor: 'management',
    cost: 7,
    groups: ['leadership'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'group', group: 'leadership' },
      },
    ],
    scoring: {
      score: 'perSet',
      points: 10,
      of: [
        { count: 'group', group: 'leadership' },
        { count: 'group', group: 'research' },
        { count: 'group', group: 'engineering' },
      ],
    },
  },
  {
    id: 'mgmt-chief-people-officer',
    name: 'Chief People Officer',
    floor: 'management',
    cost: 7,
    groups: ['people'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'choose',
        options: [
          [{ effect: 'gain', resource: 'approval', amount: 3 }],
          [{ effect: 'opponentGains', resource: 'approval', amount: 1 }],
        ],
      },
    ],
    scoring: { score: 'perMetric', points: 6, per: { count: 'missingGroups' } },
  },
  {
    id: 'mgmt-chief-of-staff',
    name: 'Chief of Staff',
    floor: 'management',
    cost: 6,
    groups: ['leadership', 'people'],
    sendsMarkerTo: 'ic',
    ability: [{ effect: 'opponentGains', resource: 'budget', amount: 1 }],
    scoring: {
      score: 'perMetric',
      points: 4,
      per: { count: 'group', group: 'leadership' },
      region: 'column',
    },
  },
  {
    id: 'mgmt-general-counsel',
    name: 'General Counsel',
    floor: 'management',
    cost: 3,
    groups: ['leadership'],
    sendsMarkerTo: 'ic',
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 2,
        per: { count: 'group', group: 'leadership' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 2,
      per: { count: 'group', group: 'leadership' },
      region: 'rowOrColumn',
    },
  },
  {
    id: 'mgmt-director-of-data-and-analytics',
    name: 'Director of Data and Analytics',
    floor: 'management',
    cost: 4,
    groups: ['research'],
    sendsMarkerTo: 'ic',
    ability: [{ effect: 'gain', resource: 'approval', amount: 2 }],
    scoring: {
      score: 'perSet',
      points: 3,
      of: [
        { count: 'cardsAt', floor: 'management' },
        { count: 'cardsAt', floor: 'ic' },
      ],
    },
  },
  {
    id: 'mgmt-principal-product-manager',
    name: 'Principal Product Manager',
    floor: 'management',
    cost: 5,
    groups: ['product'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'cardsAt', floor: 'management' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'leadership' },
      region: 'rowOrColumn',
    },
  },
  {
    id: 'mgmt-director-of-product-management',
    name: 'Director of Product Management',
    floor: 'management',
    cost: 6,
    groups: ['product'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'group', group: 'product' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 4,
      per: { count: 'distinctGroups' },
      region: 'column',
    },
  },
  {
    id: 'mgmt-vp-security',
    name: 'VP Security',
    floor: 'management',
    cost: 5,
    groups: ['people', 'people'],
    sendsMarkerTo: null,
    ability: [{ effect: 'gain', resource: 'approval', amount: 4 }],
    scoring: {
      score: 'bonus',
      points: 5,
      when: { when: 'inArea', area: 'topRow' },
    },
  },
  {
    id: 'mgmt-mailroom-clerk',
    name: 'Mailroom Clerk',
    floor: 'management',
    cost: 3,
    groups: ['people'],
    sendsMarkerTo: 'ic',
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'cardsAt', floor: 'management' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'people' },
      region: 'column',
    },
  },
  {
    id: 'mgmt-product-operations-manager',
    name: 'Product Operations Manager',
    floor: 'management',
    cost: 5,
    groups: ['product'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'groupAny', groups: ['leadership', 'product'] },
      },
    ],
    scoring: {
      score: 'perSet',
      points: 4,
      of: [
        { count: 'group', group: 'leadership' },
        { count: 'group', group: 'product' },
      ],
    },
  },
  {
    id: 'mgmt-director-of-research',
    name: 'Director of Research',
    floor: 'management',
    cost: 7,
    groups: ['research'],
    sendsMarkerTo: null,
    ability: [{ effect: 'opponentGains', resource: 'budget', amount: 2 }],
    scoring: {
      score: 'perMetric',
      points: 5,
      per: { count: 'cardsWithCostAtLeast', cost: 5 },
    },
  },
  {
    id: 'mgmt-release-operations-manager',
    name: 'Release Operations Manager',
    floor: 'management',
    cost: 4,
    groups: ['engineering'],
    sendsMarkerTo: 'ic',
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'cardsWithCost', cost: 4 },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'cardsWithCost', cost: 4 },
    },
  },
  {
    id: 'mgmt-lead-of-remote-employee-program',
    name: 'Lead of Remote Employee Program',
    floor: 'management',
    cost: 6,
    groups: ['people'],
    sendsMarkerTo: 'ic',
    discount: { amount: 1, on: 'ic' },
    ability: [],
    scoring: {
      score: 'perMetric',
      points: 4,
      per: { count: 'distinctGroups' },
      region: 'row',
    },
  },
  {
    id: 'mgmt-chief-operating-officer',
    name: 'Chief Operating Officer',
    floor: 'management',
    cost: 6,
    groups: ['leadership'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'group', group: 'leadership' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 4,
      per: { count: 'group', group: 'leadership' },
      region: 'row',
    },
  },
  {
    id: 'mgmt-vp-public-relations',
    name: 'VP Public Relations',
    floor: 'management',
    cost: 3,
    groups: ['leadership'],
    sendsMarkerTo: 'ic',
    discount: { amount: 1, on: 'management' },
    ability: [],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'leadership' },
      region: 'row',
    },
  },
  {
    id: 'mgmt-principal-researcher',
    name: 'Principal Researcher',
    floor: 'management',
    cost: 4,
    groups: ['research'],
    sendsMarkerTo: 'ic',
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'distinctGroups' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'research' },
      region: 'row',
    },
  },
  {
    id: 'mgmt-outside-advisor',
    name: 'Outside Advisor',
    floor: 'management',
    cost: 3,
    groups: ['leadership', 'leadership'],
    sendsMarkerTo: null,
    ability: [{ effect: 'fundBudgetLines', target: 'each', amount: 2 }],
    scoring: { score: 'budgetLine', points: 2, cap: 5 },
  },
  {
    id: 'mgmt-head-of-product-strategy',
    name: 'Head of Product Strategy',
    floor: 'management',
    cost: 4,
    groups: ['leadership', 'product'],
    sendsMarkerTo: 'ic',
    ability: [{ effect: 'everyoneGains', resource: 'approval', amount: 1 }],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'leadership' },
      region: 'column',
    },
  },
  {
    id: 'mgmt-people-business-partner',
    name: 'People Business Partner',
    floor: 'management',
    cost: 4,
    groups: ['people'],
    sendsMarkerTo: 'ic',
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'group', group: 'people' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'research' },
      region: 'rowOrColumn',
    },
  },
  {
    id: 'mgmt-chief-financial-officer',
    name: 'Chief Financial Officer',
    floor: 'management',
    cost: 0,
    groups: ['leadership'],
    sendsMarkerTo: null,
    ability: [{ effect: 'fundBudgetLines', target: 2, amount: 'toFull' }],
    scoring: { score: 'budgetLine', points: 2, cap: 3 },
  },
  {
    id: 'mgmt-director-of-recruiting',
    name: 'Director of Recruiting',
    floor: 'management',
    cost: 5,
    groups: ['people', 'product'],
    sendsMarkerTo: 'ic',
    ability: [
      {
        effect: 'choose',
        options: [
          [
            {
              effect: 'gainPer',
              resource: 'budget',
              amount: 1,
              per: { count: 'group', group: 'people' },
              from: 'opponent',
            },
          ],
          [
            {
              effect: 'gainPer',
              resource: 'approval',
              amount: 1,
              per: { count: 'group', group: 'product' },
            },
          ],
        ],
      },
    ],
    scoring: { score: 'perMetric', points: 1, per: { count: 'approvals' } },
  },

  // IC floor

  {
    id: 'ic-security-engineer',
    name: 'Security Engineer',
    floor: 'ic',
    cost: 3,
    groups: ['engineering'],
    sendsMarkerTo: null,
    discount: { amount: 1, on: 'all' },
    ability: [],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'product' },
      region: 'rowOrColumn',
    },
  },
  {
    id: 'ic-content-designer',
    name: 'Content Designer',
    floor: 'ic',
    cost: 0,
    groups: ['design'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'group', group: 'design' },
      },
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'ribbon', floor: 'ic' },
      },
    ],
    scoring: {
      score: 'bonus',
      points: 3,
      when: { when: 'inArea', area: 'edgeCenter' },
    },
  },
  {
    id: 'ic-zero-to-one-pm',
    name: 'Zero-to-One PM',
    floor: 'ic',
    cost: 2,
    groups: ['product'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'choose',
        options: [
          [
            {
              effect: 'gainPer',
              resource: 'budget',
              amount: 1,
              per: { count: 'group', group: 'research' },
              from: 'opponent',
            },
          ],
          [{ effect: 'gain', resource: 'approval', amount: 2 }],
        ],
      },
    ],
    scoring: {
      score: 'bonus',
      points: 10,
      when: { when: 'noGroup', group: 'research' },
    },
  },
  {
    id: 'ic-icon-designer',
    name: 'Icon Designer',
    floor: 'ic',
    cost: 2,
    groups: ['design'],
    sendsMarkerTo: null,
    ability: [{ effect: 'fundBudgetLines', target: 'each', amount: 2 }],
    scoring: { score: 'budgetLine', points: 2, cap: 9 },
  },
  {
    id: 'ic-ux-desktop-manager',
    name: 'UX Desktop Manager',
    floor: 'ic',
    cost: 0,
    groups: ['design'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'filledSeats' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 2,
      per: { count: 'group', group: 'people' },
      region: 'rowOrColumn',
    },
  },
  {
    id: 'ic-backend-engineer',
    name: 'Backend Engineer',
    floor: 'ic',
    cost: 5,
    groups: ['product', 'engineering'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'choose',
        options: [
          [
            {
              effect: 'gainPer',
              resource: 'budget',
              amount: 1,
              per: { count: 'group', group: 'leadership' },
              from: 'opponent',
            },
          ],
          [{ effect: 'gain', resource: 'approval', amount: 2 }],
        ],
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 2,
      per: { count: 'cardsWithGroups', groups: 2 },
    },
  },
  {
    id: 'ic-growth-pm',
    name: 'Growth PM',
    floor: 'ic',
    cost: 2,
    groups: ['product'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'choose',
        options: [
          [
            {
              effect: 'gainPer',
              resource: 'budget',
              amount: 1,
              per: { count: 'group', group: 'engineering' },
              from: 'opponent',
            },
          ],
          [{ effect: 'gain', resource: 'approval', amount: 2 }],
        ],
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'product' },
      region: 'column',
    },
  },
  {
    id: 'ic-design-systems-designer',
    name: 'Design Systems Designer',
    floor: 'ic',
    cost: 7,
    groups: ['design'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'cardsAt', floor: 'management' },
        from: 'opponent',
      },
    ],
    scoring: {
      score: 'perRun',
      points: 7,
      per: { count: 'ribbon', floor: 'ic' },
      size: 3,
    },
  },
  {
    id: 'ic-web-platform-engineer',
    name: 'Web Platform Engineer',
    floor: 'ic',
    cost: 0,
    groups: ['engineering'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'missingGroups' },
      },
    ],
    scoring: { score: 'bonus', points: 8, when: { when: 'hasOpenSeat' } },
  },
  {
    id: 'ic-site-reliability-engineer',
    name: 'Site Reliability Engineer',
    floor: 'ic',
    cost: 3,
    groups: ['engineering'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'group', group: 'engineering' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'engineering' },
      region: 'row',
    },
  },
  {
    id: 'ic-staff-researcher',
    name: 'Staff Researcher',
    floor: 'ic',
    cost: 5,
    groups: ['research'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'groupAny', groups: ['research', 'design'] },
      },
    ],
    scoring: {
      score: 'perSet',
      points: 4,
      of: [
        { count: 'group', group: 'research' },
        { count: 'group', group: 'design' },
      ],
    },
  },
  {
    id: 'ic-sunset-program-manager',
    name: 'Sunset Program Manager',
    floor: 'ic',
    cost: 0,
    groups: ['product'],
    sendsMarkerTo: 'management',
    ability: [{ effect: 'dropCandidate', floor: 'management' }],
    scoring: {
      score: 'perMetric',
      points: 1,
      per: { count: 'cardsAt', floor: 'management' },
    },
  },
  {
    id: 'ic-senior-product-designer',
    name: 'Senior Product Designer',
    floor: 'ic',
    cost: 5,
    groups: ['design', 'design'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'group', group: 'design' },
      },
    ],
    scoring: {
      score: 'bonus',
      points: 7,
      when: { when: 'inArea', area: 'bottomRow' },
    },
  },
  {
    id: 'ic-ux-operations-lead',
    name: 'UX Operations Lead',
    floor: 'ic',
    cost: 0,
    groups: ['design'],
    sendsMarkerTo: 'management',
    discount: { amount: 1, on: 'ic' },
    ability: [],
    scoring: { score: 'budgetLine', points: 2, cap: 5 },
  },
  {
    id: 'ic-design-manager',
    name: 'Design Manager',
    floor: 'ic',
    cost: 2,
    groups: ['design', 'design'],
    sendsMarkerTo: null,
    discount: { amount: 1, on: 'management' },
    ability: [],
    scoring: {
      score: 'bonus',
      points: 4,
      when: { when: 'inArea', area: 'corner' },
    },
  },
  {
    id: 'ic-design-systems-engineer',
    name: 'Design Systems Engineer',
    floor: 'ic',
    cost: 0,
    groups: ['engineering'],
    sendsMarkerTo: null,
    ability: [
      { effect: 'fundBudgetLines', target: 'each', amount: 2 },
      { effect: 'opponentGains', resource: 'budget', amount: 2 },
    ],
    scoring: { score: 'budgetLine', points: 2, cap: 6 },
  },
  {
    id: 'ic-data-scientist',
    name: 'Data Scientist',
    floor: 'ic',
    cost: 2,
    groups: ['research', 'research'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'group', group: 'research' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 1,
      per: { count: 'cardsAt', floor: 'ic' },
    },
  },
  {
    id: 'ic-ux-engineer',
    name: 'UX Engineer',
    floor: 'ic',
    cost: 4,
    groups: ['engineering', 'design'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'group', group: 'engineering' },
      },
    ],
    scoring: { score: 'perMetric', points: 1, per: { count: 'approvals' } },
  },
  {
    id: 'ic-technical-program-manager',
    name: 'Technical Program Manager',
    floor: 'ic',
    cost: 2,
    groups: ['product', 'product'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'group', group: 'product' },
      },
    ],
    scoring: { score: 'budgetLine', points: 2, cap: 4 },
  },
  {
    id: 'ic-agency-designer',
    name: 'Agency Designer',
    floor: 'ic',
    cost: 6,
    groups: ['product', 'design'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'distinctGroups' },
      },
    ],
    scoring: {
      score: 'perSet',
      points: 7,
      of: [
        { count: 'group', group: 'people' },
        { count: 'group', group: 'product' },
        { count: 'group', group: 'design' },
      ],
    },
  },
  {
    id: 'ic-interim-innovation-director',
    name: 'Interim Innovation Director',
    floor: 'ic',
    cost: 2,
    groups: ['product'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'choose',
        options: [
          [
            {
              effect: 'gainPer',
              resource: 'budget',
              amount: 1,
              per: { count: 'group', group: 'design' },
              from: 'opponent',
            },
          ],
          [{ effect: 'gain', resource: 'approval', amount: 2 }],
        ],
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'product' },
      region: 'row',
    },
  },
  {
    id: 'ic-boomerang-hire',
    name: 'Boomerang Hire',
    floor: 'ic',
    cost: 2,
    groups: ['people', 'people'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'budgetLines' },
      },
    ],
    scoring: { score: 'budgetLine', points: 2, cap: 4 },
  },
  {
    id: 'ic-design-people-partner',
    name: 'Design People Partner',
    floor: 'ic',
    cost: 4,
    groups: ['people', 'design'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'group', group: 'people' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 2,
      per: { count: 'group', group: 'design' },
      region: 'rowOrColumn',
    },
  },
  {
    id: 'ic-qualitative-researcher',
    name: 'Qualitative Researcher',
    floor: 'ic',
    cost: 2,
    groups: ['research'],
    sendsMarkerTo: null,
    discount: { amount: 1, on: 'management' },
    ability: [],
    scoring: {
      score: 'bonus',
      points: 10,
      when: { when: 'noGroup', group: 'product' },
    },
  },
  {
    id: 'ic-mobile-engineer',
    name: 'Mobile Engineer',
    floor: 'ic',
    cost: 2,
    groups: ['engineering', 'engineering'],
    sendsMarkerTo: 'management',
    ability: [{ effect: 'fundBudgetLines', target: 'each', amount: 2 }],
    scoring: { score: 'budgetLine', points: 2, cap: 4 },
  },
  {
    id: 'ic-user-experience-advocate',
    name: 'User Experience Advocate',
    floor: 'ic',
    cost: 4,
    groups: ['design'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'cardsAt', floor: 'ic' },
      },
    ],
    scoring: {
      score: 'bonus',
      points: 9,
      when: { when: 'noGroup', group: 'leadership' },
    },
  },
  {
    id: 'ic-engineering-people-partner',
    name: 'Engineering People Partner',
    floor: 'ic',
    cost: 3,
    groups: ['people', 'engineering'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'group', group: 'people' },
      },
    ],
    scoring: { score: 'budgetLine', points: 2, cap: 7 },
  },
  {
    id: 'ic-ux-lead',
    name: 'UX Lead',
    floor: 'ic',
    cost: 5,
    groups: ['design'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'emptySeats' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'design' },
      region: 'row',
    },
  },
  {
    id: 'ic-os-integration-engineer',
    name: 'OS Integration Engineer',
    floor: 'ic',
    cost: 0,
    groups: ['engineering'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 2,
        per: { count: 'group', group: 'engineering' },
      },
    ],
    scoring: {
      score: 'bonus',
      points: 5,
      when: { when: 'inArea', area: 'middleRow' },
    },
  },
  {
    id: 'ic-market-researcher',
    name: 'Market Researcher',
    floor: 'ic',
    cost: 4,
    groups: ['research', 'product'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'group', group: 'research' },
        from: 'opponent',
      },
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'group', group: 'product' },
        from: 'opponent',
      },
    ],
    scoring: {
      score: 'bonus',
      points: 6,
      when: { when: 'inArea', area: 'middleColumn' },
    },
  },
  {
    id: 'ic-product-manager-2',
    name: 'Product Manager 2',
    floor: 'ic',
    cost: 0,
    groups: ['product'],
    sendsMarkerTo: null,
    discount: { amount: 1, on: 'all' },
    ability: [],
    scoring: {
      score: 'perMetric',
      points: 2,
      per: { count: 'group', group: 'engineering' },
      region: 'rowOrColumn',
    },
  },
  {
    id: 'ic-director-of-ux',
    name: 'Director of UX',
    floor: 'ic',
    cost: 4,
    groups: ['leadership', 'design'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'group', group: 'leadership' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'design' },
      region: 'column',
    },
  },
  {
    id: 'ic-accessibility-engineer',
    name: 'Accessibility Engineer',
    floor: 'ic',
    cost: 3,
    groups: ['engineering'],
    sendsMarkerTo: 'management',
    discount: { amount: 1, on: 'ic' },
    ability: [],
    scoring: {
      score: 'perMetric',
      points: 3,
      per: { count: 'group', group: 'engineering' },
      region: 'column',
    },
  },
  {
    id: 'ic-accessibility-advocate',
    name: 'Accessibility Advocate',
    floor: 'ic',
    cost: 0,
    groups: ['design'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 3,
        per: { count: 'cardsWithCost', cost: 0 },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 2,
      per: { count: 'cardsWithCost', cost: 0 },
    },
  },
  {
    id: 'ic-ai-designer',
    name: 'AI Designer',
    floor: 'ic',
    cost: 5,
    groups: ['design'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'gainPer',
        resource: 'approval',
        amount: 1,
        per: { count: 'cardsWithGroups', groups: 1 },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 2,
      per: { count: 'cardsAt', floor: 'management' },
    },
  },
  {
    id: 'ic-recruiting-coordinator',
    name: 'Recruiting Coordinator',
    floor: 'ic',
    cost: 0,
    groups: ['people'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'cardsAt', floor: 'ic' },
      },
    ],
    scoring: { score: 'budgetLine', points: 2, cap: 5 },
  },
  {
    id: 'ic-user-experience-researcher',
    name: 'User Experience Researcher',
    floor: 'ic',
    cost: 2,
    groups: ['research', 'design'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'cardsAt', floor: 'ic' },
      },
    ],
    scoring: {
      score: 'perMetric',
      points: 2,
      per: { count: 'distinctGroups' },
      region: 'column',
    },
  },
  {
    id: 'ic-illustrator',
    name: 'Illustrator',
    floor: 'ic',
    cost: 4,
    groups: ['design'],
    sendsMarkerTo: 'management',
    ability: [
      {
        effect: 'choose',
        options: [
          [
            {
              effect: 'gainPer',
              resource: 'budget',
              amount: 1,
              per: { count: 'group', group: 'design' },
            },
          ],
          [
            {
              effect: 'gainPer',
              resource: 'approval',
              amount: 1,
              per: { count: 'group', group: 'people' },
              from: 'opponent',
            },
          ],
        ],
      },
    ],
    scoring: {
      score: 'bonus',
      points: 9,
      when: { when: 'noGroup', group: 'people' },
    },
  },
  {
    id: 'ic-ux-mobile-manager',
    name: 'UX Mobile Manager',
    floor: 'ic',
    cost: 0,
    groups: ['design'],
    sendsMarkerTo: null,
    ability: [
      {
        effect: 'gainPer',
        resource: 'budget',
        amount: 1,
        per: { count: 'filledSeats' },
      },
    ],
    scoring: {
      score: 'bonus',
      points: 5,
      when: { when: 'inArea', area: 'rightColumn' },
    },
  },
]

export const DECK_BY_ID: ReadonlyMap<string, Card> = new Map(
  DECK.map((c) => [c.id, c]),
)
