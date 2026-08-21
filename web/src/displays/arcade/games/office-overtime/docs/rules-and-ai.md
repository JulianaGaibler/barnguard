# Office Overtime: rules and AI

Office Overtime is a two-player tableau-building card game for the arcade cabinet
(`web/src/displays/arcade/`). Each player hires nine people into a 3x3 org, drawing
from two shared shortlists in the middle of the table. It runs hot-seat against
another human or against a computer opponent at three difficulties.

The rules are a 1:1 port of the board game Castle Combo (Grard/Roussel, Catch Up
Games 2024), re-themed to a tech company. Nothing about the mechanics was changed,
so anything that looks odd here is almost certainly faithful to the original rather
than a porting decision.

This document is for review. The rules half is background; the AI half is the part
worth pushing on, and the open questions are at the end.

## Vocabulary

The theme renames things. The right column is what appears in code and on screen.

| Castle Combo               | Office Overtime             |
| -------------------------- | --------------------------- |
| Castle deck / Village deck | Management floor / IC floor |
| Messenger pawn             | Floor marker                |
| Key                        | Approval                    |
| Gold                       | Budget ($)                  |
| Purse                      | Budget line                 |
| Shield (six factions)      | Group (six departments)     |
| Tableau                    | Org                         |
| Scoring scroll             | Performance review          |
| Buy a card                 | Make a hire                 |
| Flip a card face down      | Leave the seat open         |

The six groups, with their original factions: Leadership (nobility), People
(faith), Research and Data (scholarship), Product (military), Engineering
(craftsmanship), Design (peasantry).

## The rules

### Setup

Two decks of 39 cards each, one per floor. Three face-up candidates beside each.
The floor marker starts on the IC floor. Each player starts with $15 and 2
approvals. A coin flip decides who opens.

### A turn

Four steps, in order.

1. Optionally spend one approval to either move the floor marker to the other
   floor, or discard the current floor's three candidates and deal three new ones.
2. Hire (mandatory). Take one of the three face-up cards on the marker's floor and
   pay its cost. Or leave the seat open: take any of the three face down, pay
   nothing, and immediately gain $6 and 2 approvals. An open seat has no groups, no
   ability, no discount and scores nothing.
3. Resolve the hired card's on-hire ability. The new card counts itself.
4. If the hired card's ribbon shows a floor, move the marker there. Refill both
   shortlists to three.

The game ends after nine turns each, so eighteen hires total.

### Placement

Cards go straight into the org and never move afterwards. The first card can go
anywhere. Each later card must be orthogonally adjacent to a card already placed,
and the org's bounding box may never exceed 3x3. Nine connected cards inside a 3x3
box can only be a filled 3x3, so the org always ends up complete.

The consequence that matters for play: which row or column a card sits in is not
settled when you place it. Placing your second card two spaces from the first fixes
that axis for the rest of the game.

### Discounts

Fifteen cards carry a standing discount of $1, scoped to Management hires, IC
hires, or all hires. They stack, and they are the card's entire effect: no card has
both a discount and an ability. Cost never drops below $0 and there is no refund
for excess discount. A card is priced before it is placed, so a discount card never
discounts its own purchase. An open seat's discount is inert, because the card is
face down.

### Budget lines

Eleven cards can store leftover budget. Each stores up to a printed cap and pays 2
points per dollar stored. Caps are 3, 4, 4, 4, 5, 5, 5, 6, 7, 8, 9, so total
capacity across the whole deck is 60.

Two things put money on a budget line. Some abilities move free money onto them
from the supply during the game. Then at the end, whatever budget the player has
left is poured in until the lines are full.

The end-of-game fill is automatic and the player is never asked about it. Every
budget line pays the same rate, so with `G` dollars already on lines from abilities,
`B` budget left over, and `C` total capacity, the end total is `min(G + B, C)`. That
is monotone in `G` and does not depend on which line holds what, so filling greedily
is optimal and there is nothing to decide. The same argument covers the one card
that fills two lines to full mid-game: it takes the two with the most remaining
capacity.

### Scoring

Final score is the sum of the nine performance reviews plus one point per approval
held. Most points wins. A tie is broken by leftover budget that did not fit on a
budget line, which is otherwise worth nothing. Still tied is a shared win.

Every card's review is one of six rule kinds, all expressed over a shared `Metric`
vocabulary (a countable quantity over some set of org cells):

- `perMetric`: points times a metric, counted over the whole org or restricted to
  the card's row, column, or row-or-column. Row-or-column is five distinct cells,
  and the scoring card is counted once.
- `perSet`: points times the number of complete sets holding one of each listed
  metric, so the minimum across them.
- `perMatchingGroupSet`: points times the number of runs of `size` shields of one
  group, summed over all six groups.
- `perRun`: points times `floor(count / size)`.
- `bonus`: flat points if a condition holds. Conditions are a position in the
  finished org, having none of a given group, or having at least one open seat.
- `budgetLine`: 2 points per dollar stored, up to the cap.

The metrics themselves count group shields, distinct or missing groups, cards from a
floor, cards at a cost, cards with two groups, discount cards, filled or empty
seats, budget lines and money on them, and approvals held.

### The group distribution is load-bearing

Group shields are spread deliberately unevenly across the two floors:

| Group             | Management | IC  | Total shields | Cards |
| ----------------- | ---------- | --- | ------------- | ----- |
| Leadership        | 14         | 1   | 15            | 13    |
| People            | 12         | 5   | 17            | 15    |
| Research and Data | 11         | 6   | 17            | 15    |
| Product           | 8          | 10  | 18            | 16    |
| Engineering       | 7          | 11  | 18            | 16    |
| Design            | 0          | 20  | 20            | 18    |

Cards that score on missing groups, or on runs of identical groups, are balanced
against exactly these counts. Design never appears on the Management floor and
Leadership barely appears on the IC floor, which is what makes "score 10 if you have
no Design" a real decision rather than a free bonus. `game/rules/deck.test.ts` pins
every number in that table.

Twelve cards carry two shields of the same group, and fifteen span two groups. Costs
run 0, 2, 3, 4, 5, 6, 7 with no $1 card.

### Two-player simplifications

The original is multiplayer. In two players, "a neighbour", "your opponent" and "all
other players" all mean the same person, so nothing needs a targeting prompt. Ten
cards read across the table. One card pays every player including the actor.

## Where the code lives

Everything below is pure, engine-free and unit tested. The whole game is playable
headlessly before any rendering exists.

| File                    | Contents                                                          |
| ----------------------- | ----------------------------------------------------------------- |
| `game/rules/deck.ts`    | All 78 cards, plus the `Metric`, `Effect` and `ScoringRule` types |
| `game/rules/scoring.ts` | `countMetric`, the metric interpreter, and end-of-game scoring    |
| `game/rules/economy.ts` | Discounts, ability resolution, budget line funding                |
| `game/rules/match.ts`   | Match state, legal turns, `applyTurn` / `undoTurn`, `finish`      |
| `game/ai.ts`            | The computer opponent                                             |
| `game/tuning.ts`        | Difficulty levels and evaluation weights                          |

Two design points that shape the AI.

`countMetric` is the single interpreter for the metric vocabulary, and both
abilities and scoring go through it. There is no per-card logic anywhere: nothing
branches on a card id.

An org is stored in a 5x5 working grid with the first card at the centre, and
cropped to 3x3 only at the end. A fixed 3x3 array would wrongly forbid growing up or
left from the opening card.

## The AI

### Why not the engine's search

Stargazer ships `searchBestMove`, a negamax searcher with alpha-beta
(`stargazer/ai/minimax.ts`), and Connect Four uses it. It does not fit here.

Office Overtime is almost a perfect-information game: there are no hands, both
orgs are face up, both shortlists are face up, and both players' budget and
approvals are public. The only hidden state is the order of the two draw piles.
But refilling a shortlist deals unseen cards, which is a chance node, and
negamax has nowhere to put one.

### The search must not read the deck

This one bit before it was noticed. `applyHire` ends by refilling the
shortlists, so a search that applies a candidate turn and looks at the result
has just dealt itself the real next card. At one ply that is harmless, because
the evaluation only reads the org, which a refill cannot touch. At two plies the
opponent-reply enumeration sees cards nobody at the table can see, and a deeper
search would read several cards down.

The fix is determinization. Which cards remain in a deck is public (all 78 minus
the orgs, the shortlists and the face-up discard piles); only the order is
hidden. So the search reshuffles the unseen remainder, runs on that sample, and
averages over several samples. The true order is restored afterwards.

That is also what makes redealing evaluable. Spending an approval to redeal is
worth the average, over sampled deals, of the best hire available afterwards.
Because the deal has to happen before the hire is chosen, a turn is planned in
two phases, which is how a human plays it: commit the approval, see the new row,
then choose. `applyApproval` and `applyHire` are separate for that reason.

### Turn enumeration

`legalHires` enumerates slot, placement, choice branches and drop targets for
the marker's current floor. Measured branching is 47 on average, 104 at most.

Placements are not deduplicated, because there is nothing to deduplicate.
Measured over 4,075 candidate turns across five matches, every one reached a
distinct position. Pinning the first card to the centre of the working grid
already removes the only translational freedom, and reflections are not
symmetries here because the top row and the bottom row score differently.

### Evaluation

An org is scored as if the game ended now: crop to 3x3, pour leftover budget
into budget lines, total the reviews plus approvals. Then:

```
value   = points
        + loose budget * 0.15
        + approvalReserve * (1 - exp(-held / 2)) * (seatsLeft / 9)
fitness = value(me) + 0.3 * (value(me) - value(them))
```

Both shapes of the approval term matter. An approval buys the right to move the
marker or redeal a bad row, which is worth having once rather than ten times, so
a linear term prices spending your last one exactly like spending your tenth.
And an approval held on the final turn buys no options at all, so its option
value has to decay as the org fills. Together those took the redeal rate from
52% of turns to 33%, and produced the scarcity gradient a player expects: 28% at
one approval held against 37% at five.

The `looseBudget` weight is deliberately small, and the response to it is
sharply asymmetric: 0 is fine, 0.7 loses 85 games in 100 against 0.35. A card
must be taken every turn, so an AI that prizes its bank balance starts taking
worthless open seats to protect it.

### The three levels

The steps are capability, not depth, because searching past two plies measurably
does not help.

|                       | easy             | medium | hard |
| --------------------- | ---------------- | ------ | ---- |
| Plies                 | 1                | 2      | 2    |
| Sees the opponent     | no (`denial: 0`) | yes    | yes  |
| Averages over layouts | no               | yes    | yes  |
| Will redeal           | no               | no     | yes  |
| Move choice           | random of top 3  | best   | best |

Weakness comes from playing a simpler game, not from throwing turns away. An
earlier version gave easy a 30% blunder rate; that reads as broken rather than
beatable, so easy now plays honest but myopic solitaire.

### Slicing

The search is synchronous, so `planTurn` is a generator that yields every 5ms
and the session awaits a frame between slices. The reason is not the search but
what a stall does downstream: `Ticker.maxDt` is 1/30s, so a frame that overruns
gets clamped, in-flight tweens lose wall time, and the smoothed timestep then
runs animations fast for about ten frames while it recovers.

## Measured behaviour

Self-play with a seeded generator, paired seeds played twice with the sides
swapped.

| Pairing        | Record      | Average score margin |
| -------------- | ----------- | -------------------- |
| medium vs easy | 44-16 of 60 | +6.7                 |
| hard vs easy   | 54-6 of 60  | +13.7                |
| hard vs medium | 38-22 of 60 | +4.0                 |

Decision time: easy under 1ms, medium 10ms average, hard 104ms average with a
313ms worst case. The 5ms slicing is insurance rather than a live constraint.

### What redealing is worth

Redealing is much stronger than expected, which is worth stating plainly because
it is counterintuitive and it drove several decisions.

Redraw enabled against redraw disabled, everything else equal: **77-43 over 120
paired games, +4.56 average margin** (z about 3.1). It is the widest single
lever in the evaluation, which is why it separates hard from medium.

The reason is adverse selection. The row showing on a floor is not a random
sample of the deck: it is what both players have already looked at and passed
over. Cards that linger are the ones nobody wanted. A fresh deal comes from the
whole remaining deck, so it beats the picked-over row often enough to be worth
more than the approval it costs.

Human players appear to redeal less often than this. That may mean the play is
genuinely underrated, or that the evaluation undervalues something about holding
a known row. Worth testing against a strong human.

### On measuring any of this

Two traps cost real time here, both worth knowing before touching these numbers.

Win counts over small samples are useless at this variance. An unswapped 20-game
sample initially showed hard losing to medium 9-11, which sent me hunting a bug
that did not exist; the same matchup over 120 paired games is 38-22. Average
score margin converges far faster than win rate, and pairing each seed by playing
both sides removes most of the rest.

The second trap is reading a null result as a broken feature. Averaging the
score over every layout the org could still settle into makes no measurable
difference to strength (15-15, margin -0.3 over 30 games), and the mechanism
demonstrably works: a card worth 8 in the top row scores 8 in three of nine
candidate windows and 0 in the rest, averaging 2.67 against a flat 0. It is
correct and it does not matter, because it only applies to the first few
placements and washes out once the bounding box is fixed. Kept because it is
free.

## Known weaknesses and open questions

This is the list I would most like a second opinion on.

**Depth past two plies does not pay.** A four-ply beam (width 12 then 3) scored
+2.0 margin against the one-ply baseline where two plies scored +4.2, at 66ms a
turn against 11ms. Deeper search on a biased evaluation amplifies the bias. The
remaining strength is in the evaluation, not the search.

**Evaluation is myopic about layout, and averaging did not fix it.** Scoring
every reachable 3x3 window is the principled answer and it measures as neutral.
Something better would have to model which layouts are actually likely given the
cards still to come, rather than weighting all of them equally.

**The blended objective is a real tradeoff, not a free win.** Dropping `denial`
from 0.3 to 0 costs about 2 points of margin a game (43-56 of 100). Raising it
to 0.6 gains nothing. At 0.3 the AI will still give up three points to cost the
opponent four, so a hard match shows lower scores on both sides than a medium
one.

**A liquidity bonus does nothing.** Rewarding a working balance of up to $4, at
0.5 and at 0.2 a dollar, measured 50-50 across 200 games. The end-game budget
line fill already prices held money at 2 points a dollar up to capacity, which
appears to cover it.

**The weights are hand-picked, and the search is cheap enough to tune them now.**
`looseBudget` moved from 0.35 to 0.15 on measurement, and `approvalReserve` at 2
is strength-neutral but produces the scarcity behaviour a human expects. A
self-play sweep over the four weights would likely find better.

**Score suppression at hard.** Noted above: hard drags both players' scores down
because it optimises margin. If the game ever starts showing or recording a score
that players compare, that becomes a visible inconsistency between difficulties.
