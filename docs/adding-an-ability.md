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

When a rule needs a new kind of fact, add a reusable condition primitive to
`types.ts` and its strict Zod branch to `schema.ts`, then implement the same
primitive in `conditions.ts`. For a state transition, add an effect primitive
and implement it in `effects.ts`, preferably delegating card and roulette
operations to their adapters. Do not add a definition-ID or character-ID
conditional to the engine or match reducer.

Every new primitive should have a focused unit test for valid data, rejected
extra fields, deterministic RNG, and atomic failure. Prefer owner/rival
selectors so one definition can be bound to either actor.

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

Test-only mechanisms live beside production content but remain unbound in
formal character JSON. `owner-load-penalty` and `rival-bust-load` exercise
automatic/passive owner-relative resolution; `action-advice-mechanic` proves a
card-free active character action enters the same legal-action pipeline. They
are canonical test fixtures so character loading, saves, and replay all use the
same immutable definitions.
