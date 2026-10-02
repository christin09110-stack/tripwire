# Tripwire

An anomaly-alert agent for PayPal activity. It watches a stream of payouts, invoices, captures, refunds and disputes, decides which unusual patterns are real, and builds the AG Grid and AG Charts widgets that explain each one. The board assembles itself around the problem.

- **Live:** https://d1eh6dinhiesly.cloudfront.net/ (CloudFront, S3)
- **API:** https://rakxzyszaf5ycwzeojkwrud3gy0mhyid.lambda-url.us-east-1.on.aws (one Lambda Function URL, Node 22)
- PayPal **sandbox only**. AWS account 854924711083, us-east-1. MIT licence (see the third-party notice below).

## What it does

1. PayPal activity lands in DynamoDB: real sandbox payout batches, invoices, vaulted-wallet captures and refunds, plus signed webhooks.
2. A deterministic pass flags candidates: refund rate climbing, payout items failing on one recipient, invoices ageing past 30 days, a dispute pattern.
3. A watcher agent on Bedrock (Claude Sonnet 4.5, Converse API with tool use) investigates each candidate with tools: `list_candidates`, `query_stream`, `compute_rate`, `compare_baseline`, `record_finding`, `build_widget`, `dismiss_candidate`. It loops until every candidate is settled.
4. `build_widget` is the widget-construction layer. The model writes a spec (an evidence grid, a trend chart with a normal-range band, or a breakdown chart) and the spec is validated against the real fields and checked against the data. A bad field name, or a filter that would render empty, comes back as an exact error and the model fixes it inside the loop.
5. Each finding carries a full `summary` for its page and a short `brief` for its card that must add only what the title and headline leave out. The Overview ends with "How this board was built", the last scan's narrated steps.
6. The board renders the specs inside **AG Studio**. A second agent, Studio's own chat panel, runs through the **Studio Agent Framework** against the same Bedrock model and can add widgets of the same kinds.

In the first real run the model linked the duplicate-charge disputes to the annual-plan refund spike without being asked, and wrote that into both findings.

## AG Grid, AG Charts and AG Studio: what is actually used

**AG Studio 3.0.0** (`ag-studio`) exists and is a commercial product with an unlicensed trial mode. It is the board: pages, layout grid, widget chrome, view and edit modes, theme, data sources, state API, and the chat panel.
- **Custom widgets** (`createWidgets({ additionalTypes })`): four types (`tw-brief`, `tw-grid`, `tw-trend`, `tw-breakdown`) that embed AG Grid and AG Charts, as Studio documents.
- **Studio theme** built from the same tokens as the page, grid and charts (`studioTheme.withParams`, light and dark modes).
- **Agent Framework**: `createAiHarness`, `directLlmRunner`, an `AgLlmAdapter` that translates Studio's request into Bedrock Converse (messages, tool schemas, tool calls back as AG-UI events), `studio.viewSchema` and `studio.executeQuery` on Studio's data sources, and two custom tools made with `api.defineAiTool` (`list_findings`, `add_tripwire_widget`). The Converse call goes through the Lambda, which holds the AWS credentials; nothing secret reaches the browser. Studio ships no Bedrock adapter, so this one is ours.
- Studio's own multi-agent team (lead, planning, page, widget) is **not** used. At about ten Bedrock requests a minute, five agents per request is too expensive, so one analyst agent with a short tool list runs the chat instead.

**AG Grid** (36.2): row grouping with aggregation, master/detail rows, pinned total rows and pinned columns, value formatters, cell renderers (status pill, age bar, id, source badge), rule-driven conditional cell styling (tone, glyph and weight, never colour alone), the status bar with a custom panel, the quick filter, set filters, range selection with the aggregation status panel, CSV export, and column and sort state persistence through `initialState` and `onStateUpdated`. Themed with `themeQuartz.withParams` in light and dark modes. Row grouping and master/detail cannot be combined in AG Grid, and the validator says so to the model.

**AG Charts** (14.2, Community): line, area, column, bar and donut series. The normal-range band is two stacked area series (an invisible base and a tinted width). Out-of-range points are marked by shape, label and colour. Chart theme from the shared tokens.

### Adding the AG trial licence key (no code change)
1. Request the free trial at https://www.ag-grid.com/studio/license-pricing/ (it covers AG Grid Enterprise, AG Charts Enterprise and AG Studio).
2. Put `AG_GRID_LICENSE_KEY=...` and `AG_STUDIO_LICENSE_KEY=...` in `../../.env` (or export them), using `.env.example` as the template. Never commit them.
3. Run `./deploy.sh`. It bakes them into the build; the app calls `LicenseManager.setLicenseKey` and `AgStudioLicenseManager.setLicenseKey` before anything mounts. With no key it runs in trial mode with watermarks, as now.

### Licences, stated plainly

| Product | Licence | How it is used here |
|---|---|---|
| ag-grid-community, ag-charts-community | MIT | Pinned rows, quick filter, formatters, renderers, grid state, all charts |
| ag-grid-enterprise | Commercial | Row grouping, aggregation, master/detail, status bar, set filter, range selection. **Unlicensed trial: the grid prints a console notice and draws a "For Trial Use Only" watermark.** |
| ag-studio | Commercial | The board and chat panel. **Unlicensed trial: console notice and an "AG Studio / For Trial Use Only" watermark bottom right.** Studio documents that it runs unlicensed locally; the trial key that removes the watermark is requested by email. None was requested. |

Studio's licence does not cover AG Grid Enterprise used in custom widgets, which is what the evidence grid is. Both watermarks are therefore expected and accepted for this entry.

## PayPal

Direct REST with credentials read from SSM (SecureString), never in the repo or the Lambda environment.
- **Payouts:** batches polled to a terminal state with item status read, not just batch status. A batch can read SUCCESS while an item is FAILED (bogus PayPal id) or UNCLAIMED (`RECEIVER_UNREGISTERED`); those are the anomaly material.
- **Orders and captures** with a vaulted PayPal-wallet token (no card is ever touched), **refunds**, **invoices** (past-dated; sending gives status UNPAID, so overdue is derived from the due date), **disputes** (read; the sandbox account has none).
- **Idempotency:** every create call carries `PayPal-Request-Id`. A duplicate `sender_batch_id` is adopted as the same batch through the link PayPal returns, and duplicate-id refusals count as success.
- **Webhook:** one of the free slots. The listener persists the raw delivery and answers HTTP 200 at once, then an async invocation filters to this app's own resource ids (webhooks are per app, so the sibling projects' events arrive too and are acknowledged and ignored), verifies the signature with `POST /v1/notifications/verify-webhook-signature`, and only then ingests. Tampering is proven in TEST-RESULTS.md.
- Transaction search returns 403 on this account and is not used.

### What is real and what is replayed

The sandbox cannot be back-dated, so the 30 days before the live objects are generated (`backend/src/replay.mjs`, deterministic) in PayPal's field shapes with ids prefixed `RP-`. Every row carries `origin`: `sandbox` (a real PayPal object) or `replay`. Grids show a Sandbox/Replay badge column where it matters and the status bar counts both. The anomalies are planted on top of a quiet baseline, as in any demo: 7 of 9 annual-plan/app captures refunded (the sandbox refused two refunds with REFUND_NOT_ALLOWED, so 7, not 8), six undelivered payout items to one recipient across four batches, eight overdue invoices. **Disputes are replay only**; the sandbox has none and cannot create them without a buyer in a browser.

**Stream clock.** The stream keeps its own clock (head = latest event) so a board opened weeks later still has its anomalies in window. PayPal activity more than six hours past the head lands one minute after it; the real time stays on the row as `paypal_ts`. Details dialog explains this.

## Bedrock limits

The account allows about ten requests a minute, shared. `backend/src/bedrock.mjs` paces calls, widens the gap after a throttle and relaxes it after a success, retries with jittered exponential backoff, and throws a typed error when it gives up. The scan then **falls back to rule-built findings and widgets, labelled "Written by rules" / "Built by rules" everywhere they appear**, and the run records why. An unchanged stream makes no model call. A scan with four candidates took 13 to 14 requests and about 230K input tokens. Public endpoints (`/api/scan`, `/api/llm`, `/api/widgets`, `/api/activity`) are unauthenticated and rate limited per hour in DynamoDB, because this is a demo with no accounts.

## Architecture

```
React + Vite  ->  S3 + CloudFront          AG Studio board, custom widgets, chat panel
      |
      v
Lambda Function URL (Node 22)  <-- PayPal webhooks (200 first, verify async)
  routes, detectors, watcher agent loop, Bedrock proxy, webhook worker
      |-- DynamoDB on-demand: rows, findings, widgets, runs, webhook log, rate limits
      |-- Amazon Bedrock Converse (Claude Sonnet 4.5, tool use)
      '-- PayPal sandbox REST (SSM SecureString credentials)
```
Layout: `shared/` pure modules used by both sides, `backend/src`, `frontend/src`, `scripts/`, `seed/`, `deploy.sh`.

## Run it

```
./deploy.sh --seed --scan     # creates everything, loads the stream, queues the first scan
cd backend && npm test        # 39 tests, no network
node scripts/contrast.mjs     # computes every colour pair from the real hex values
```
Local: `node backend/src/local.mjs` (API on :8788, real Bedrock and PayPal) and `cd frontend && npx vite` (uses `.env.development`).

## Accessibility, measured

Contrast ratios are computed from the hex values in `frontend/src/tokens.js` (`node scripts/contrast.mjs --md`). All 40 pairs pass: 4.5:1 for text, 3:1 for graphics and focus rings. The full table is in TEST-RESULTS.md. Measured with `scripts/a11y-check.mjs` on the live site: body text 13.0pt, nothing under 10pt in the shell and widgets, no interactive element under 28x28pt, no horizontal scroll at 200% text size, a 3px focus ring on every tab stop. Status is never colour alone: words, glyphs and weight. Known limits: Studio's own edit-mode panels (data tree, compose palette) use Studio's control sizes, themed but not individually measured; AG Grid's header menu buttons are small icon targets inside grid headers, which the check skips.

## The official boilerplate

I read `paypaldev/hackathon-paypal-ag-grid-boilerplate` (Next.js server components, the PayPal TypeScript Server SDK, plain tables for transactions, plans and balances, `env.example`). I kept its convention of an env template (`.env.example`) and credentials outside the repo. I diverged on purpose: its pages read Transaction Search, which returns 403 on this sandbox account, the SDK has no Payouts or webhook-verification surface I needed, and this entry needs a long-lived watcher, signed webhooks and a Bedrock loop, which belong in a Lambda rather than in page renders. It also shows tables only; Tripwire's point is agent-built grids, charts and an AG Studio board.

## Known gaps

- Both trial watermarks (above).
- Layout changes made in Edit mode last until reload. Widgets added from chat are saved.
- Disputes are replayed, not live.
- The web bundle is large because Studio is large. It is split into react, ag-grid, ag-charts and ag-studio chunks so the app shell and the libraries cache separately; Studio itself is still loaded on first paint.
- GBP payouts were not exercised in this project.
- The pinned total row can partly cover the last visible grid row until you scroll. That is AG Grid's pinned-row behaviour in a short widget.
- Public, unauthenticated endpoints guarded only by rate limits.
