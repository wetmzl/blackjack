# Adding an ability

Abilities are content, not reducer branches. Add a JSON definition under
`src/content/abilities/player-skills`, `ai-skills`, or `talents`, then import it
into the immutable canonical list in `core/abilities/registry.ts`. The registry
validates every imported definition with `AbilityDefinitionSchema`, validates
its parameter/status/ability references, and deep-freezes it at startup. There
is no mutable "active registry" shared by matches. Use only the closed trigger,
condition, selector, and effect primitives in `core/abilities/types.ts`.

During rapid development, saves are current-version only. Bump
`ABILITY_CATALOG_VERSION` whenever definition semantics change; an incompatible
runtime save is discarded after a one-time player confirmation, while the
separate long-term progress save remains intact. Do not add runtime-save
migrations or legacy ability/event compatibility paths.

`replace-pending-draw` may use the `create-derived-card` fallback when no
physical card can satisfy an exact resulting total. A derived card does not
mutate the physical shoe or enter a discard pile; do not use this fallback as a
general substitute for selecting real cards.

For cross-round card memory, use a match-duration status whose parameters store
the complete `rank`/`suit`/`source` tuple and original `cardId`. `remember-last-card` separates the
status `target` from its `cardTarget`; `replace-bust-hand-card-with-memory-card`
is evaluated during `before-bust-check` against the already modified pending
bust limit, creates a derived replacement, and may request `standAfterReplacement`.
The physical draw has already advanced the shoe cursor, so the replacement must
not move a physical card back into the shoe. `status-card-rank-is` and the
character info-bar `status-card` projection expose the saved card without
coupling the engine to a character ID.

`sourceKind` must be exactly `player-skill`, `ai-skill`, or `talent`. These are
independent domains: definitions and IDs cannot be shared even when their
names and effects are identical. They may reuse only the generic trigger,
condition, effect, status, and runtime machinery. `hidden: true` keeps a
definition in the registry for testing, while excluding it from the visible
Player Skill catalog and offer pool.

Every Player Skill, AI Skill, and Talent declares one closed `primaryDomain`
from `gambler`, `cheater`, `intelligence-officer`, and `gunslinger`, plus at
least one open-ended tag. Player Skills additionally declare one or more unique
closed `skillTags` from the same set. The first entry must equal
`primaryDomain`; it determines the visible Skill Catalog group and the Chinese
domain label in skill offers. Later entries are secondary affinities and still
participate in draw-weight matching.
The player's selected zero-to-two skill tags apply a single factor of 4 when a
skill matches any selected tag. Player Skills also declare `drop.enabled`, positive
`drop.baseWeight`, and `stackable`; active cards may repeat, while a held
non-stackable passive is excluded from later draws. Definitions in any of the
three domains may declare `skillDrawWeightModifiers`; modifier tags are closed
Skill Tags and match only a Player Skill's `skillTags`. Every matching weight
factor multiplies rather than overrides. The draw candidate count is a single core constant and
is not modified by round outcomes or abilities. Use the generic
`add-skill-draws` effect when a data-driven Talent or ability grants draws.

Every passive Player Skill or AI Skill must declare a positive finite `ttl` as
either `{ "type": "rounds", "amount": N }` or
`{ "type": "triggers", "amount": N }`. Round TTL is consumed after
`on-round-end`; trigger TTL is consumed only after a rule successfully applies,
not when its conditions miss or resolution fails. At zero the definition stops
participating in future events and a Player Skill card is removed from inventory.
Talent definitions and active cards cannot declare TTL. Automatic AI Skills may
declare TTL when their product behavior is intentionally finite.

When a rule needs a new kind of fact, add a reusable condition primitive to
`types.ts` and its strict Zod branch to `schema.ts`, then implement the same
primitive in `conditions.ts`. For a state transition, add an effect primitive
and implement it in `effects.ts`, preferably delegating card and roulette
operations to their adapters. Do not add a definition-ID or character-ID
conditional to the engine or match reducer.

Use the `before-turn` trigger for rules that need to intercept an actor before
they receive a Hit/Stand decision. Pair `pending-turn-can-skip` with
`skip-turn` for a true pass: it emits `TURN_SKIPPED`, hands control to the
other actor, and deliberately does not emit Hit/Stand, set `stood`, or consume
an `until-owner-action` lifecycle. The condition is false once the other actor
has stood or busted, so a rule such as “skip until the rival stands” naturally
falls through to a normal decision. Reciprocal skip rules are bounded to one
skip per actor in a single handoff chain. The test-only hidden
`turn-skip-mechanic` definition is the canonical unbound fixture; production
characters should bind their own data definition instead of its ID.

`after-stand` is emitted only when an actor explicitly chooses Stand; reaching
21 does not mark the actor stood and does not emit it. A status with
`until-owner-action` remains through ability and event resolution, then expires
after its target completes the next Hit or Stand; the round boundary is an
upper bound so it cannot leak into a later deal. Cross-target statuses retain
their source instance while `owner` identifies the affected actor.

Use the `active-skill-card` tag for player-skill definitions with action/card
activation. Statuses may block that tag to suppress only actively played skill
cards without suppressing passive player skills or card-free character actions.

Every player-facing `ABILITY_TRIGGERED` event from a Player Skill or AI Skill
is presented as its own stacked toast above the table for both active and
passive abilities. The UI combines the event owner, ability name, and the
matching rule's `triggerNotice`; when the rule omits it, the definition-level
`triggerNotice` and then `description` are used as fallbacks. Toasts insert at
the top, live for 2.5 seconds, then fade out independently. When the same batch
contains a concrete result (such as `TRIGGER_PULLED`, `CARD_SUIT_REVEALED`, or
published advice), prefer that final data over a formula. Write
`triggerNotice` as a concise player-facing effect sentence when the description
also contains activation conditions or other context. Talent events and
bookkeeping-only rules may declare `"notify": false`; they still emit domain
events but do not occupy the toast stack.

`reveal-hand-card-suit` keeps revealed information bound to card entities by
emitting one `CARD_SUIT_REVEALED` event per selected `cardId`. Use
`first-private-card` for the first hidden card or `all-current-cards` for the
cards present in the target hand at resolution time. Cards drawn later are not
implicitly revealed, and the projection expires at the round boundary.
`swap-last-hand-card-with-draw-pile-top` similarly emits
`DRAW_PILE_CARD_REVEALED` when a physical hand card returns to the draw-pile
top, preserving that card's known rank and suit for its owner during the
current round. A derived outgoing card dissipates instead and emits no such
knowledge event.

Talent definitions must declare an explicit data-driven `unlock`, currently
`{ "type": "defeat-count", "count": N, "label": "..." }`; unlocked Talent IDs
are derived from CharacterDefeatRecord facts and are not duplicated in the
long-term profile. Every new primitive should have a focused unit test for valid
data, rejected extra fields, deterministic RNG, and atomic failure. Prefer
owner/rival selectors so one definition can be bound to either actor.

能力定义中的 `description` 负责规则说明，`profileLore`（可选）负责角色档案
中的文学化描写。档案页面根据角色 `aiSkills` 的启用绑定从能力注册表自动读取
名称、规则与描写；角色 JSON 不重复维护技能文案。

For a new pure-data ability:

1. Choose exactly one of `player-skill`, `ai-skill`, or `talent`; declare its
   primary domain, tags, activation, rules, bounded parameters, and required
   passive TTL in JSON.
2. Reuse only registered status IDs and declared parameter keys. If behavior
   outlives one event, add and register a status JSON definition too.
3. Import the definition into the canonical registry. Do not add its ID to the
   match reducer, engine, condition interpreter, or effect interpreter.
4. Add contract coverage for legal/illegal windows, generic history events,
   deterministic resolution, and atomic failure. Owner-relative character
   mechanisms must be exercised for both actors.
5. Run `npm test`, `npm run build`, and the relevant Playwright flow.

Character JSON `aiSkills` binds an existing AI Skill definition with
`{ definitionId, enabled, parameters }`. Bindings are checked against the definition's declared
parameter table; unknown, missing, or out-of-range values fail during loading.

Cards are entities with a stable `id`, a single-value `attributes` dictionary
(`source`, `rank`, `suit`), and a unique string `tags` collection. `source` is
`shoe` for physical cards and `derived` for temporary cards. A derived card
also carries `derived` and `generated-by:<ability-id>` tags. It scores and counts normally, but never qualifies
for natural Blackjack or a physical-card condition. It must never be inserted
into `ShoeState.cards`; replacement removes it permanently, and starting the
next round drops it with the old hand. Use `hand-card-has-tag`,
`add-hand-card-tag`, and `remove-hand-card-tag` for open-ended card metadata.
A suit can be shown only when the current round contains a recorded
`CARD_SUIT_REVEALED` event for the current viewer and `cardId`; that event
never includes rank, and hidden rendering must never disclose rank.

Test-only mechanisms live beside production content but remain unbound in
formal character JSON. `owner-load-penalty` and `rival-bust-load` exercise
automatic/passive owner-relative resolution; `action-advice-mechanic` proves a
card-free active character action enters the same legal-action pipeline; and
`hand-change-observer` verifies that only real hand mutations broadcast
`after-hand-changed`. Hand-based mechanisms should listen to this broadcast,
which is emitted after every real hand mutation, including the two-card
initial deal at the start of each round and ability-created cards, rather than
coupling to a particular draw path. They are canonical
test fixtures so character loading,
saves, and replay all use the same immutable definitions.

The generic event vocabulary also includes `before-bust-check` (with a pending
bust limit), `before-trigger-pull` (with a pending misfire chance), and
`after-ability-played` (a post-commit broadcast for observers). Scalar
expressions can combine constants, hand totals, final displayed round scores,
hand-card counts, current-round Hit counts, and add/subtract/multiply operations.
`round-final-score` reads the score already stored for a completed point
comparison and otherwise falls back to the base hand total before any live
comparison-score preview shown by the table.
`hand-rank-has-suit-partner`
checks a specified standard rank against a different card sharing its suit.
`add-derived-card-for-exact-total`
always creates a deterministic ability-RNG-derived card without touching the
physical shoe.
`copy-last-hand-card-as-derived` similarly creates a new derived entity with
the last hand card's rank and suit while leaving both the source card and the
physical shoe unchanged.
`transfer-last-physical-hand-card` instead moves the existing final physical
card from one actor's hand to another actor's hand. It preserves the card ID,
keeps `source: shoe`, does not clone the card, and leaves the shoe ledger
unchanged; a missing or derived source card makes the effect fail atomically.
Match-status stack counts are also available as scalar values,
and `add-to-pending-comparison-score` can adjust an actor's score only while a
normal point comparison is being resolved, including when both unmodified
scores are equal. Each base score is the hand's highest total under that
actor's active bust limit; modifiers are applied afterward and therefore do
not cause a bust. The reducer derives the winner from the adjusted scores and
stores those final scores in the round outcome for presentation. During the
turn phase, `previewComparisonScores` dry-runs that same window against a
discarded copy so UI can display current modifiers without consuming ability
state, events, counters, TTL, or RNG.
`set-status-stacks` replaces a match-status stack count with a nonnegative,
integer scalar result (zero removes the status), allowing a data-driven
mechanic to carry one public numeric threshold between rounds.
`set-status-suit-to-hand-majority` stores the most common suit in a chosen hand
as a status parameter. Ties follow the canonical `SUITS` order so the result is
replay-safe without consuming RNG. Read that selection with
`hand-card-status-suit-count`; use `scalar-compare` when two dynamically
computed counts must be compared before applying an effect. Initial hands are
already complete when their `after-hand-changed` broadcasts run, so an
owner-filtered rule with a `perRound: 1` limit can select a suit exactly once at
the start of every round.

`on-ability-gained` targets only the newly created ability instance. It is the
entry point for a passive Player Skill that must publish information as soon as
the player selects it. `reveal-draw-pile-top-suit` records knowledge against the
stable physical `cardId`; presentation may expose that suit only while the same
card remains on top in the current round. `publish-hit-bust-forecast` and
`publish-hand-total-comparison` publish conclusions without exposing the next
rank or either numeric hand total.

For roulette load composition, `set-pending-load` replaces the base load and
should use an earlier priority than additive modifiers. `add-to-pending-load`
then layers bonuses on top. `hand-card-suit-count` can derive the replacement
from one exact suit, while `add-gun-bullets` is reserved for immediate direct
loading outside the pending settlement window.

The scalar `power` expression is deterministic and must resolve to a finite
number before an effect commits. Derived-card effects use a closed card-face
expression: `static` rank/suit, scalar-to-rank (1=A, 11=J, 12=Q, 13=K), or a
complete 13-rank JSON map from a selected hand card; `uniform-ability-rng`
chooses the suit only from the saved ability RNG. Use `add-derived-card` and
`replace-hand-card-with-derived` for temporary cards, and
`rotate-draw-pile-top-to-bottom` for the unshown remaining shoe segment. The
`grant-player-skill-card` effect copies the previous successfully played Player
Skill, falling back to the current definition, and atomically creates both its
inventory card and runtime instance. These effects publish the generic
`ABILITY_RESULT` GameEvent so presentation can use actual ranks, replacements,
granted names, and stack deltas without definition-ID branches.
