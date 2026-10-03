# Test results

Everything below was run on 2026-10-02 against the deployed stack or the local code. Output is pasted unedited except where a heading says otherwise.

## 1. Unit tests (no network): `cd backend && npm test`
```

> tripwire-api@1.0.0 test
> node --test test/*.test.mjs

✔ the loop calls tools, repairs a bad widget spec from the error, and stores a finding with widgets
✔ an empty widget is refused so the model must loosen the filter
✔ when Bedrock stays unavailable the board still gets findings, built by rules and labelled
✔ an unchanged stream is not re-investigated: no model call
✔ adaptive retry: throttles are retried with growing waits, then succeed
✔ adaptive retry gives up with a typed error
✔ a non-retryable Bedrock error is thrown at once
✔ the four detectors each find their planted pattern
✔ a quiet stream flags nothing
✔ candidate evidence ids exist in the stream
✔ health and board answer
✔ webhook returns 200 immediately and hands the work to an async invocation
✔ scan is rate limited per hour and queues an async run
✔ finding status can be set, and unknown values and ids are refused
✔ chat-built widgets pass through the same validators as the watcher
✔ the Bedrock proxy relays Converse output, and says so plainly when the model is rate limited
✔ unknown routes 404 with a message that says what was asked for
✔ idempotency: a duplicate sender_batch_id is adopted as the same batch, and duplicate request ids count as success
✔ activity: the payout is created with an idempotent batch id, polled to terminal, rows land in the stream, a scan is queued
✔ series is zero-filled, contiguous and ends on the stream clock day
✔ refund rate today is a proportion-test outlier against the 29 days before
✔ a quiet stream does not produce an outlier
✔ where filters apply to numerator and denominator
✔ breakdown groups, sums and sorts
✔ matches supports scalars, lists and range objects
✔ intake keeps the PayPal signature headers and the untouched body for later verification
✔ resourceIds collects ids from payout, invoice and capture shaped events
✔ an event that does not belong to this stream is acknowledged and ignored, with no verify call
✔ our event is verified with PayPal, then ingested, and the stream head moves
✔ a tampered payload is rejected: PayPal says FAILURE, nothing is ingested
✔ a body that is not JSON is rejected without calling PayPal
✔ a good grid spec passes and is normalised
✔ bad grid specs get exact, fixable errors
✔ master/detail and row grouping are refused together
✔ trend and breakdown validate metric, fields and sum fields
✔ widget sizes are clamped to the minimum legible height
✔ findings need a headline, a summary and actions
✔ pack never overlaps and wraps at 24 tracks
✔ board to Studio state: overview briefs, one page per finding, stack mode
ℹ tests 39
ℹ suites 0
ℹ pass 39
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 272.470817
```

## 2. PayPal webhook signature: real event, tampered event, deployed listener
Script `scripts/webhook-tamper.mjs`. The event is a genuine delivery PayPal signed and sent to the deployed listener. It is replayed to PayPal's `verify-webhook-signature` unchanged, then with one field changed, then the changed body is posted to the live listener with the original signature headers.
```
event PAYMENT.PAYOUTSBATCH.PROCESSING ad634d53-be16-11f1-9577-fd0009fed920
1. original event       -> SUCCESS
2. one field changed    -> FAILURE
3. deployed listener    -> HTTP 200 in 2845 ms
   recent deliveries    -> {"rejected":1,"processed":6,"ignored":1}
   tampered delivery    -> rejected | PayPal reported the signature as FAILURE.
```
The 2.8 s response on step 3 included a Lambda cold start. A warm call:
```
warm webhook listener: HTTP 200 in 0.874909s
```

## 3. Live pipeline
A "Pay the unclaimed recipient again" action created a real sandbox payout batch (B49E7N9XJJ45W): items ended SUCCESS, UNCLAIMED (RECEIVER_UNREGISTERED), SUCCESS after polling. PayPal webhooks for it were verified and processed, the stream grew, a webhook-triggered scan re-ran, and the payout finding moved from 6 items / $1,877 to 7 items / $2,117 with no manual step. Last model run on the deployed stack:
```
run r-muqfyezl-c91a trigger activity model undefined usage {"calls":6,"input":49794,"output":2944} counts undefined fallback null
```

## 4. Contrast (computed from the real hex values)

| Mode | Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|---|
| light | Body text on panels | ink #11202D | surface #FFFFFF | 16.56:1 | 4.5:1 | pass |
| light | Body text on page | ink #11202D | bg #E9EFF5 | 14.29:1 | 4.5:1 | pass |
| light | Body text on sunken areas | ink #11202D | sunken #F2F6FA | 15.25:1 | 4.5:1 | pass |
| light | Secondary text on panels | muted #43566A | surface #FFFFFF | 7.56:1 | 4.5:1 | pass |
| light | Secondary text on page | muted #43566A | bg #E9EFF5 | 6.53:1 | 4.5:1 | pass |
| light | Secondary text on sunken areas | muted #43566A | sunken #F2F6FA | 6.96:1 | 4.5:1 | pass |
| light | Links and accent text on panels | steel #285B88 | surface #FFFFFF | 7.14:1 | 4.5:1 | pass |
| light | Accent text on page | steel #285B88 | bg #E9EFF5 | 6.16:1 | 4.5:1 | pass |
| light | Selected item text | steelStrong #1A4469 | steelTint #D8E5F1 | 7.90:1 | 4.5:1 | pass |
| light | Primary button label | onSteel #FFFFFF | steel #285B88 | 7.14:1 | 4.5:1 | pass |
| light | Alert text on panels | signal #A83A06 | surface #FFFFFF | 6.42:1 | 4.5:1 | pass |
| light | Alert text on page | signal #A83A06 | bg #E9EFF5 | 5.54:1 | 4.5:1 | pass |
| light | Alert chip text | onSignalSoft #6E2A04 | signalSoft #FBE5D4 | 8.65:1 | 4.5:1 | pass |
| light | Signal button label | onSignal #FFFFFF | signalFill #B8410A | 5.53:1 | 4.5:1 | pass |
| light | Focus ring on panels (non-text) | steel #285B88 | surface #FFFFFF | 7.14:1 | 3:1 | pass |
| light | Input and control borders (non-text) | lineStrong #71879B | surface #FFFFFF | 3.72:1 | 3:1 | pass |
| light | Chart series 2 (non-text) | series2 #6C93B8 | surface #FFFFFF | 3.23:1 | 3:1 | pass |
| light | Chart series 1 (non-text) | steel #285B88 | surface #FFFFFF | 7.14:1 | 3:1 | pass |
| light | Flagged marker (non-text) | signalFill #B8410A | surface #FFFFFF | 5.53:1 | 3:1 | pass |
| light | Chart series 3 (non-text) | series3 #5B7287 | surface #FFFFFF | 5.00:1 | 3:1 | pass |
| dark | Body text on panels | ink #E6EEF6 | surface #121E2A | 14.40:1 | 4.5:1 | pass |
| dark | Body text on page | ink #E6EEF6 | bg #0A121A | 16.09:1 | 4.5:1 | pass |
| dark | Body text on sunken areas | ink #E6EEF6 | sunken #0E1822 | 15.29:1 | 4.5:1 | pass |
| dark | Secondary text on panels | muted #9FB3C6 | surface #121E2A | 7.82:1 | 4.5:1 | pass |
| dark | Secondary text on page | muted #9FB3C6 | bg #0A121A | 8.74:1 | 4.5:1 | pass |
| dark | Secondary text on sunken areas | muted #9FB3C6 | sunken #0E1822 | 8.31:1 | 4.5:1 | pass |
| dark | Links and accent text on panels | steel #88BBE8 | surface #121E2A | 8.29:1 | 4.5:1 | pass |
| dark | Accent text on page | steel #88BBE8 | bg #0A121A | 9.26:1 | 4.5:1 | pass |
| dark | Selected item text | steelStrong #B4D6F3 | steelTint #1E3850 | 7.98:1 | 4.5:1 | pass |
| dark | Primary button label | onSteel #0A121A | steel #88BBE8 | 9.26:1 | 4.5:1 | pass |
| dark | Alert text on panels | signal #FF9D5F | surface #121E2A | 8.23:1 | 4.5:1 | pass |
| dark | Alert text on page | signal #FF9D5F | bg #0A121A | 9.19:1 | 4.5:1 | pass |
| dark | Alert chip text | onSignalSoft #FFC299 | signalSoft #3A2010 | 9.63:1 | 4.5:1 | pass |
| dark | Signal button label | onSignal #1B0C02 | signalFill #FF9D5F | 9.31:1 | 4.5:1 | pass |
| dark | Focus ring on panels (non-text) | steel #88BBE8 | surface #121E2A | 8.29:1 | 3:1 | pass |
| dark | Input and control borders (non-text) | lineStrong #5B7389 | surface #121E2A | 3.42:1 | 3:1 | pass |
| dark | Chart series 2 (non-text) | series2 #5F8DB6 | surface #121E2A | 4.80:1 | 3:1 | pass |
| dark | Chart series 1 (non-text) | steel #88BBE8 | surface #121E2A | 8.29:1 | 3:1 | pass |
| dark | Flagged marker (non-text) | signalFill #FF9D5F | surface #121E2A | 8.23:1 | 3:1 | pass |
| dark | Chart series 3 (non-text) | series3 #8BA0B4 | surface #121E2A | 6.25:1 | 3:1 | pass |

All 40 pairs meet their floor.

## 5. Accessibility measurements on the live site (latest run)
```

## light theme, 1280x800, first finding page
Body text 17.3px = 13.0pt (target 13pt)
Interactive elements under 28x28pt (37.3px) in the app shell and widgets: none
Text under the 10pt (13.3px) floor: none
200% text size at a 640px viewport: scrollWidth 640 vs viewport 640 -> no horizontal scroll
Tab order, first 12 stops:
  a "Skip to the board" focus ring 3px
  button "Scan the stream" focus ring 3px
  button "Edit board" focus ring 3px
  button "Details" focus ring 3px
  button "Switch to the dark theme" focus ring 3px
  button "▲▲▲ High2" focus ring 3px
  button "▲▲ Medium2" focus ring 3px
  button "Unreviewed only4" focus ring 3px
  button "Agent trail for the last sca" focus ring 3px
  div "" focus ring 3px
  div "" focus ring 3px
  div "" focus ring 3px

## dark theme, 1280x800, first finding page
Body text 17.3px = 13.0pt (target 13pt)
Interactive elements under 28x28pt (37.3px) in the app shell and widgets: none
Text under the 10pt (13.3px) floor: none
200% text size at a 640px viewport: scrollWidth 640 vs viewport 640 -> no horizontal scroll
Tab order, first 12 stops:
  a "Skip to the board" focus ring 3px
  button "Scan the stream" focus ring 3px
  button "Edit board" focus ring 3px
  button "Details" focus ring 3px
  button "Switch to the light theme" focus ring 3px
  button "▲▲▲ High2" focus ring 3px
  button "▲▲ Medium2" focus ring 3px
  button "Unreviewed only4" focus ring 3px
  button "Agent trail for the last sca" focus ring 3px
  div "" focus ring 3px
  div "" focus ring 3px
  div "" focus ring 3px
```

## 6. What was not tested
- No automated end-to-end click-through of every control. Controls were exercised by hand through Playwright: scan, edit mode, chat starter (Bedrock tool call saved a widget), details dialog, theme toggle.
- Studio edit-mode panels were not measured for target size.
- Screen-reader output was not tested with a real screen reader.
- Bedrock throttling on the deployed stack was not provoked; retry and fallback are covered by the unit tests with injected throttling errors.
