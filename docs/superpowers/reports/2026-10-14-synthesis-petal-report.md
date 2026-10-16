# Task 2 — PetalV3 compatibility facade

Status: implemented, targeted verification passed. No commits created. Files owned and changed: `js/petal-v3.js`, `test-petal-v3.js`, this report.

## Behavior and interfaces

- The facade requires the independent engine/config in Node and directly uses their globals in browsers. Missing dependencies fail visibly; there is no legacy fallback.
- `merge` delegates to `mergeMany` and the engine. `engine`, `describe`, `matches`, `registerMaterial`, `registerRule`, `derive`, and `validItem` are public. Legacy `half`/`final` merge modes map to `join` without stage filtering.
- Removed both fixed recipe tables. `H_XX` and `F_XX_XX` legacy targets are parsed structurally for T/C/S, including same-material combinations. Multicharacter materials retain their complete identifiers in layers and canonical keys, without character slicing. Labels such as `mixed-half`, `finished`, and `composite` describe outputs and never decide legality.
- `raw` accepts registered materials. A `WeakSet` trusts only facade-issued physical items. Frozen previews carry display structures but are rejected by production operations. Spread copies, duplicate IDs, and conflicting material claims for a source are rejected.
- Raw horizontal cutting produces real top/bottom halves; each can then be cut vertically. Cut splits arbitrary layer stacks by local slots, preserving every layer index and physical ID. Auto cutting chooses vertical when both columns exist, then horizontal when both rows exist; a single occupied slot cannot split further.
- Rotation retains the existing local-unit convention. Engine combination normalizes each input orientation into world positions and outputs orientation zero. `describe` and `matches` use world structure, while item layers accompany local units for drawing under the item's orientation.

## TDD evidence

Before production changes, `node test-petal-v3.js` exited 1 at `same-material complementary quarters must merge`, with actual `null` from the old table-based implementation. The new test suite additionally replaces obsolete assertions that same materials, raw halves, horizontal raw cuts, and mismatched orientations are always illegal.

A subsequent malformed-description regression was observed as `TypeError` for `{units:[null]}`; the facade now validates the structure signature before building a description and returns null for damaged input.

## Latest targeted verification

- `node test-petal-v3.js`: exit 0, `ALL_PETAL_V3_PASS (81 combinations, dynamic materials/rules, identity, layers, recutting, rotations)`.
- `node --check js/petal-v3.js`: exit 0.
- `git diff --check -- js/petal-v3.js test-petal-v3.js`: exit 0. Git only printed the repository's LF-to-CRLF conversion notices.

Tests cover all 81 T/C/S combinations; same-material halves; three/four inputs; `alloy:blue` and `__proto__` registration; explicit three-input rule dispatch; layer stacks to five levels; rotated stack splitting/recombination; source/ID conservation; complete raw horizontal partitioning; fake and preview rejection; structural matching; and bounded path delegation.

## Integration boundaries

Parent integration owns VM loader dependencies and runtime/UI changes. This task did not modify runtime, rendering, build, or other tests. Parent review should verify whole-game semantics and the full suite with engine/config loaded before PetalV3. Legacy fixed-table exports were removed intentionally, as no production consumer needs them. `isFinished` now compares trusted physical structure with the supplied target rather than requiring a particular cutting history.

## Follow-up: unary extension rules

Parent review identified that the facade's two-input guard prevented engine-supported unary registered operators. Added a unary identity operator and slot-constrained rule test first; it failed with `registered unary operator must be available through the physical facade` (actual null). The facade now accepts at least one trusted input and delegates arity/rule validation to the engine. Tests exercise the runtime's `select` → `mergeMany` handoff using `selected.result.ruleId`, require the same canonical output key, reject unregistered singleton input and unknown rule IDs, and preserve preview/spread-copy rejection. Latest `node test-petal-v3.js` and `node --check js/petal-v3.js` exited 0; targeted `git diff --check` exited 0 with only CRLF conversion notices.
