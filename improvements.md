# OpenPets — Improvements & Observations

A running, standalone log of improvements, risks, and inconsistencies noticed
while working in this repo. Not a task board — a curated backlog of things worth
fixing, with enough context to act on later. Newest sections reflect the most
recent pass.

**Criticality scale:** 🔴 high (correctness / production / breakage risk) ·
🟠 medium (DX friction, drift, or confusion that costs time) ·
🟡 low (polish, nice-to-have, organizational).

---

## Documentation pass — 2026-06-13

Context: rebuilt the `docs/` set from empty and rewired `AGENTS.md`. Findings
surfaced while reading the codemaps, scripts, and catalogs.

### Documentation & references

- 🔴 **`AGENTS.md` referenced docs that did not exist.** It pointed at
  `docs/plugins.md` and `docs/superplugins.md` as required reading before plugin
  work, but `docs/` was empty. Any agent following `AGENTS.md` hit a dead end.
  *Fixed in this pass* — both docs now exist. Keep this from regressing: if a
  doc is referenced as required reading, it must exist.

- 🟠 **Stale official-plugin lineup in `web/docs/plugin-publishing.md`.** That
  runbook lists `ambient-companion`, `break-buddy`, `pet-pal`,
  `github-notifications` as the official set and references
  `public/plugins/catalog.v1.json` as the active catalog. Reality (verified
  2026-06-13): the active catalog is `catalog.v2.json`, v1 is an empty compat
  shim, and `plugins/official/` actually contains `day-routine`, `focus-buddy`,
  `fortune-cookie`, `launch-buddy`, `magic-8-ball`, `mood-check-in`,
  `reminders`, `virtual-pet`, `water-reminder`. The runbook's QA checklist and
  catalog-version assertions are now wrong. Recommend updating
  `web/docs/plugin-publishing.md` to match, or folding it into the new
  `docs/plugins.md` publishing section and leaving a pointer.

- 🟠 **Two codemaps disagreed on the plugin lineup.** `plugins/official/codemap.md`
  lists the current 9 plugins; `web/docs/plugin-publishing.md` lists the old 5.
  The codemap is correct. Single-source the lineup (catalog generator output is
  the real source of truth) to stop this drift.

- 🟡 **`web/docs/plugin-publishing.md` "as of the companion-first launch"** is
  undated and frozen at a past state. Time-relative framing in docs goes stale
  silently; prefer dated entries or generated content.

### Project structure / organization

- 🟡 **Root `docs/` vs `web/docs/` overlap.** `web/docs/` holds genuinely useful
  publishing runbooks (`pet_publishing.md`, `plugin-publishing.md`,
  `pet-import-process.md`). The new root `docs/` is the conceptual layer. Worth a
  one-line cross-link from each side so contributors find the runbooks (the new
  `docs/catalog.md` and `docs/plugins.md` point into `web/docs/`).

- 🟡 **Top-level `DESIGN.md`** exists alongside `codemap.md` and now `docs/`.
  Confirm it is still current or fold its still-true parts into
  `docs/architecture.md` and retire the rest, so there is one front door.

### Observations to verify later (not yet confirmed bugs)

- 🟡 The desktop `catalog.ts` falls back V3 → V2 → fixture. Worth confirming the
  fixture path is only reachable in tests/offline and never silently ships a
  stale fixture catalog to users.
- 🟠 **Confirmed stale: `apps/desktop/codemap.md` "External Services" lists the
  plugin catalog as `plugins/catalog.v1.json`.** The source
  (`apps/desktop/src/plugin-catalog.ts`) actually fetches
  `plugins/catalog.v2.json` (`pluginCatalogUrl`), keeping the v1 URL only as a
  compat constant. The desktop codemap's external-services line should be updated
  to v2 (it implies the app still reads v1). Low blast radius but it's exactly the
  kind of drift that misleads an agent reading the codemap.

---

*Append new dated sections above this line as work continues.*
</content>
