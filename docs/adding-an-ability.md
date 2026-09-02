# Adding an ability

Abilities are content, not reducer branches. Add a JSON definition under
`src/content/abilities/player-skills` or `character-mechanics`, then import it
into the immutable canonical list in `core/abilities/registry.ts`. The registry
validates every imported definition with `AbilityDefinitionSchema`, validates
its parameter/status/ability references, and deep-freezes it at startup. There
is no mutable "active registry" shared by matches. Use only the closed trigger,
condition, selector, and effect primitives in `core/abilities/types.ts`.

During rapid development, saves are current-version only. Bump
`ABILITY_CATALOG_VERSION` whenever definition semantics change; an incompatible
stored save is discarded on boot and replaced with a fresh save. Do not add
save migrations or legacy ability/event compatibility paths.

`replace-pending-draw` may use the `create-derived-card` fallback when no
physical card can satisfy an exact resulting total. A derived card does not
mutate the physical shoe or enter a discard pile; do not use this fallback as a
general substitute for selecting real cards.

`sourceKind` may be `player-skill`, `character-mechanic`, or `shared`. A
`shared` definition is limited to passive/automatic behavior and can be
instantiated as either concrete runtime kind through the common source-kind
validation helper. `hidden: true` keeps a definition in the registry for
compatibility and testing, but excludes it from visible skills, default
loadouts, unlock rewards, and drop pools.

When a rule needs a new kind of fact, add a reusable condition primitive to
`types.ts` and its strict Zod branch to `schema.ts`, then implement the same
primitive in `conditions.ts`. For a state transition, add an effect primitive
and implement it in `effects.ts`, preferably delegating card and roulette
operations to their adapters. Do not add a definition-ID or character-ID
conditional to the engine or match reducer.

`after-stand` is emitted only when an actor explicitly chooses Stand; reaching
21 and being marked stood automatically does not emit it. A status with
`until-owner-action` remains through ability and event resolution, then expires
after its target completes the next Hit or Stand; the round boundary is an
upper bound so it cannot leak into a later deal. Cross-target statuses retain
their source instance while `owner` identifies the affected actor.

Use the `active-skill-card` tag for player-skill definitions with action/card
activation. Statuses may block that tag to suppress only actively played skill
cards without suppressing passive player skills or card-free character actions.

Every `ABILITY_TRIGGERED` event is presented in the table's central notice bar
for both active and passive abilities. The UI combines the event owner, ability
name, and `triggerNotice`; when `triggerNotice` is omitted it falls back to the
definition `description`. Write `triggerNotice` as a concise player-facing
effect sentence when the description also contains activation conditions or
other context.

Every new primitive should have a focused unit test for valid data, rejected
extra fields, deterministic RNG, and atomic failure. Prefer owner/rival
selectors so one definition can be bound to either actor.

能力定义中的 `description` 负责规则说明，`profileLore`（可选）负责角色档案
中的文学化描写。档案页面根据角色 `mechanics` 的启用绑定从能力注册表自动读取
名称、规则与描写；角色 JSON 不重复维护技能文案。

For a new pure-data ability:

1. Choose `player-skill` or `character-mechanic` and declare activation,
   rules, tags, and bounded parameters in JSON.
2. Reuse only registered status IDs and declared parameter keys. If behavior
   outlives one event, add and register a status JSON definition too.
3. Import the definition into the canonical registry. Do not add its ID to the
   match reducer, engine, condition interpreter, or effect interpreter.
4. Add contract coverage for legal/illegal windows, generic history events,
   deterministic resolution, and atomic failure. Owner-relative character
   mechanisms must be exercised for both actors.
5. Run `npm test`, `npm run build`, and the relevant Playwright flow.

Character JSON binds an existing definition with `{ definitionId, enabled,
parameters }`. Bindings are checked against the definition's declared
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
expressions can combine constants, hand totals, hand-card counts, current-round
Hit counts, and add/subtract/multiply operations. `hand-rank-has-suit-partner`
checks a specified standard rank against a different card sharing its suit.
`add-derived-card-for-exact-total`
always creates a deterministic ability-RNG-derived card without touching the
physical shoe.
