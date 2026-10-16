# Synthesis configuration persistence follow-up

Status: implemented and targeted tests passed; no commit created. Files changed for this follow-up: `js/core.js`, `js/input.js`, `test-synthesis-persistence.js`, this report. Existing `Undo.ruleId` behavior was preserved.

## Changes

Successful `UI.importSynthesisConfig` writes the engine's validated export snapshot into `G.save.synthesisConfig` and calls the existing persistence function. Failed JSON parsing or engine validation leaves the active registry, saved snapshot, registry version, and stored save unchanged.

`restoreSynthesisConfig()` runs after G initialization. It restores registered materials and declarative rules atomically from the save. A classic environment without PetalV3 safely skips restoration. Failed restoration retains the saved configuration and all scores, records `G.synthesisConfigError`, and displays that error after the startup menu appears. An explicitly saved malformed value, including null/false/zero/empty string, is reported rather than silently skipped.

Rules referring to a missing dynamically registered JavaScript operator cannot restore; this failure is caught and shown with the engine reason. The editor offers **导出未恢复的存档配置**, backed by `UI.exportSavedSynthesisConfig`, so the original snapshot can be copied or repaired. Exporting it does not apply it or overwrite the active registry. A successful replacement import clears the error and saves the validated replacement.

Merger text now accurately describes legacy half/final aliases as planar joining (overlap rejected). Cutter title explicitly says a full raw object may be cut vertically or horizontally and that layers split by local slots.

## TDD evidence

Initial `node test-synthesis-persistence.js` exited 1 at `successful import must save its validated snapshot`, with actual undefined. After implementation it passed. Added an explicit corrupt-falsy-value regression, observed failure at `an explicitly saved malformed config must not be silently skipped`, and changed restoration/export presence checks to distinguish missing fields from corrupted saved values.

## Verification

Each command below exited 0:

- `node test-synthesis-persistence.js`: `ALL_SYNTHESIS_PERSISTENCE_PASS`.
- `node test-synthesis-ui.js`: all eleven checks passed, `ALL_SYNTHESIS_UI_PASS`.
- `node test-v3-ui.js`: `ALL_V3_UI_PASS`.
- `node test-headless.js`: simulation, blueprint, undo, free mode, challenge, daily, and state checks passed.
- `node test-v3-integration.js`: `ALL_V3_INTEGRATION_PASS`.
- `node --check js/core.js` and `node --check js/input.js`.
- `git diff --check -- js/core.js js/input.js test-synthesis-persistence.js` (only repository LF-to-CRLF notices).

The new VM-based persistence test exercises real engine/facade/core/UI code and a shared localStorage save across fresh VM boots. It checks atomic rejection, restoration, startup notification, visible recovery export, score preservation, missing custom operators, corrupt saved values, and operation without PetalV3. Browser release/build verification remains with parent integration.
