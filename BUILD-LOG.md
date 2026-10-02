# Tripwire build log

Project 6 of 10, PayPal AI Hackathon (deadline 12 Nov 2026). Sponsor prize target: Best Use of AG Grid.

## 2026-10-02 research
- AG Grid 36.2.0 and AG Charts 14.2.0 are current on npm. Community is MIT. Enterprise (grid, charts) is a commercial licence.
- **AG Studio exists** (`ag-studio` 3.0.0, `ag-studio-react`, Commercial licence, 35 MB unpacked). It runs without a licence key: the console prints "License Key Not Found. All AG Studio Core features are unlocked for trial" and a trial watermark applies. It depends on `ag-grid-enterprise` and `ag-charts-enterprise`, so using it means using Enterprise code unlicensed. Disclosed in the README.
- **Studio Agent Framework is real and documented** at https://www.ag-grid.com/studio/javascript/ai/ (harness, agents, tools, chat panel, WebMCP). It is provider-agnostic: you supply an `AgLlmAdapter` whose `executeTurn(request)` returns a stream of AG-UI events. There is no OpenAI/Bedrock adapter; AG ships an OpenAI example only. Tools execute in the browser against the live report. Commands (`api.defineAiCommand({type:'AgAddWidgetCommand'}).apply(...)`) work without any LLM.
- Studio supports **custom widgets** (`createWidgets({additionalTypes})`, a class with getGui/init/refresh/destroy) and documents embedding AG Grid and AG Charts inside them (`studioGridTheme`, `getChartTheme(api)`).
- Docs are readable as markdown by appending `.md` to a docs URL or sending `Accept: text/markdown`; the HTML site 403s scripts.
- Spike: Studio + custom widget + built-in grid renders at localhost with a custom widget receiving `context`. Screenshot checked.

## 2026-10-02 PayPal probes (all passed, real sandbox)
- Payout batch: registered recipient `sb-patient@personal.example.com` ends SUCCESS; unregistered email ends UNCLAIMED / RECEIVER_UNREGISTERED; `PAYPAL_ID` bogus id ends FAILED / RECEIVER_ACCOUNT_INVALID while the BATCH reads SUCCESS. Item status is the truth.
- Orders with the vaulted wallet token (borrowed from the guarantee project, wallet only, no card) complete in one call with a capture; capture refund returns COMPLETED.
- Invoices accept past `invoice_date` and `due_date`; sending gives status UNPAID, so overdue is derived from the due date.
- `GET /v1/customer/disputes` returns 0 items. Dispute rows in the stream are replayed and labelled.

## Decisions
- Name: Tripwire. Identity: cool steel blue with one warm signal colour.
- Stream clock: the stream keeps its own clock (head = latest event) so a demo opened weeks later still shows the anomalies. New PayPal activity lands at the head; the true PayPal time is kept on the row.
- Replay baseline: 30 days of synthetic history in PayPal's field shapes, ids prefixed `RP-`, `origin: replay`. Real sandbox objects are `origin: sandbox`. Both are labelled in the UI and README.

## 2026-10-02 build, round 1 (backend + first frontend)
- Seed: a Sonnet subagent created the live sandbox activity (5 payout batches/58 items: 47 SUCCESS, 9 UNCLAIMED, 2 FAILED; 14 invoices, 8 overdue; 18 vaulted-wallet captures, 8 refunds). Two annual-plan refunds returned REFUND_NOT_ALLOWED from the sandbox, so the planted refund pattern is 7 of 9 annual-plan/app captures plus 1 partial: 8 of 18 overall. Manifest in `seed/live-manifest.json`.
- `shared/` holds the pure modules both sides import: datasets, metrics (series, proportion test, breakdown), widget specs and validators, and the board-to-Studio-state converter.
- Detectors fire on the live data exactly as planted: refund spike (44% vs 3.5%), payout cluster (6 items to one recipient, 4 batches), invoice ageing, dispute pattern (replay only).
- First real Bedrock scan: 14 Converse calls, 264K input tokens, 2 min. The model cross-linked the dispute finding to the refund finding unprompted. It used one turn per candidate, ran out of turns before the fourth, and the rules fallback covered the rest. Fixes: finding ids are now given up front so record_finding and build_widget can share a turn; turn cap 18; invoice metric aligned to "31+ days" after the model spotted a 30/31 disagreement between metric and bucket.
- First screens: Studio renders the four custom widget types. Found and fixed: AG Charts v14 wants `axes` as an object keyed x/y, not an array; AG Charts needs `ModuleRegistry.registerModules([AllCommunityModule])`; the finding text is clipped inside a fixed-height Studio widget, so finding pages now carry a normal HTML header above the board.
- 38 backend tests pass (`cd backend && npm test`).

## Rounds and self-scores (screens in shots/r0 to r5; r3 to r5 are the deployed site)
- r0: first render. 4/10. Boot error screen from a missing API URL, then Studio blank in edit mode (a stray flex-basis), AG Charts axes wrong shape.
- r1: 6/10. Finding text clipped inside fixed-height Studio widgets; every finding "high"; status pills truncated; horizontal scroll at 360 (Studio min width 600).
- r2: 7.5/10. Finding header moved to HTML above the board; Studio min width zeroed; stack layout for narrow screens (it was being overwritten by Studio applying initialState late, fixed by passing the right state at creation); severity spread; edit mode shows data tree, chat and compose panels.
- r3/r4: 8/10. Deployed. Measured a11y found 12.5px text (rem was 16px, not 17.33px), chart legend proxies under 28pt, icon-only buttons with no name at 360. All fixed; re-measured clean.
- r5: 8.5/10 honestly. Not 9: both trial watermarks, the pinned total row grazing the last visible row in short grids, Studio edit-mode chrome not individually measured, and the compact overview cards are text-heavy on phones.
- Mistake worth recording: `pkill -f` killed my own shell twice because the pattern appeared in the command line.
- Deployed: Lambda tripwire-api, table tripwire, bucket tripwire-web-854924711083, distribution E3RLVJJSB9KLHD, webhook 9XF432568V596371V (one of the 5 free slots).

## Coordinator follow-ups
- Licence keys are now a build-time drop-in (`AG_GRID_LICENSE_KEY`, `AG_STUDIO_LICENSE_KEY` -> `VITE_*` via deploy.sh -> `LicenseManager` / `AgStudioLicenseManager` before mount). Not set here; I cannot request the trial. `.env.example` added.
- Read the official boilerplate; README explains what was kept and why the architecture diverges.
- Bundle split into react / ag-grid / ag-charts / ag-studio chunks (app code 66 kB). Total size unchanged.

## Coordinator review: duplicated findings
- The left rail restated the four cards. It is now a filter and summary rail on the Overview (severity chips that filter the cards, an unreviewed-only chip, stream window, counts) and a titles-only jump list when a finding is open. Overview cards size themselves to fill the board (2 rows at 1440x900, no blank space) and clamp the summary to whole lines. Re-shot at 1440 and 1280 (shots/r7-*), a11y re-measured clean.

## Coordinator review: cards said everything three times
- The agent now emits a `brief` (card text, adds only what title and headline omit) alongside the unchanged `summary`, which moved to the finding page. Cards: title, mono comparison, two lines of brief. Card height at 1440x900: 383px before, 286px after. The room that freed up holds an inline "How this board was built" trail. Forced rescan on the deployed stack produced the briefs (13 requests). Shot: shots/r8-overview-1440.png.

## Coordinator review: briefs cut mid-word
- Cause: the server capped the brief at 180 characters, which sliced words; the CSS ellipsis then hid that. Now the prompt says at most 22 words in one or two short sentences, and `fitBrief` (shared, unit-tested) enforces it by keeping whole sentences, else whole words plus an ellipsis. Rules-fallback briefs are short by construction. Forced rescan: all four briefs are 13 to 18 words and end as finished sentences. The CSS line clamp stays as the narrow-width safety net.
- Checked dark at 1440 and 768, light and dark at 360 (shots/r9-*). Found and fixed: at 360 the filter rail pushed the cards below the fold (now one row of chips, stream block hidden) and the stacked cards were too short for a four-line title (stack card height now depends on viewport width).
