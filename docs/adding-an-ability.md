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
the complete `rank`/`suit`/`origin` tuple. `remember-last-card` separates the
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

Every Player Skill and AI Skill declares one `primaryDomain` and at least one
open-ended tag. Player Skills additionally declare one or more unique closed
`skillTags` from `gambler`, `cheater`, `intelligence-officer`, and `gunslinger`.
The first entry is the skill's primary tag and determines its group in the
visible Skill Catalog; later entries are secondary affinities and still
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

Cards have an explicit `origin`: `shoe` for physical cards and `derived` for
temporary cards. A derived card scores and counts normally, but never qualifies
for natural Blackjack or a physical-card condition. It must never be inserted
into `ShoeState.cards`; replacement removes it permanently, and starting the
next round drops it with the old hand. Hidden rendering may expose only the
origin marker. A suit can be shown only when the current round contains a
recorded `CARD_SUIT_REVEALED` event for the current viewer and card; that event
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
physical shoe. Match-status stack counts are also available as scalar values,
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
