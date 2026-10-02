// Bedrock Converse with the account's real constraint in mind: about 10 requests a minute, shared with other work.
// The client paces itself, learns from throttles (the gap widens after one and relaxes after a success), retries
// with jittered exponential backoff, and gives up with a typed error so the caller can fall back to rules and say so.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

export const MODEL = process.env.BEDROCK_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
export class BedrockUnavailable extends Error {
  constructor(message, info) { super(message); this.name = 'BedrockUnavailable'; this.info = info; }
}
const RETRYABLE = new Set(['ThrottlingException', 'TooManyRequestsException', 'ServiceUnavailableException', 'ModelTimeoutException', 'InternalServerException', 'ModelNotReadyException', 'ModelStreamErrorException']);
const isRetryable = (e) => RETRYABLE.has(e?.name) || [429, 500, 502, 503, 504].includes(e?.$metadata?.httpStatusCode);

export function makeBedrock({ client, model = MODEL, minGapMs = 3500, maxGapMs = 20000, maxAttempts = 7, baseDelayMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), random = Math.random } = {}) {
  const c = client || new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 1 });
  const state = { gap: minGapMs, last: 0, throttles: 0, calls: 0, waitedMs: 0 };

  async function converse({ system, messages, toolConfig, maxTokens = 2500, temperature = 0.2, deadlineMs = 240000, onRetry }) {
    const started = now();
    let attempt = 0, lastErr;
    while (attempt < maxAttempts) {
      const wait = Math.max(0, state.last + state.gap - now());
      if (wait) { state.waitedMs += wait; await sleep(wait); }
      if (now() - started > deadlineMs) break;
      state.last = now(); state.calls++;
      try {
        const out = await c.send(new ConverseCommand({
          modelId: model, system: system ? [{ text: system }] : undefined, messages, toolConfig,
          inferenceConfig: { maxTokens, temperature },
        }));
        state.gap = Math.max(minGapMs, state.gap * 0.85);
        return { message: out.output.message, stopReason: out.stopReason, usage: out.usage || {}, attempts: attempt + 1, waitedMs: state.waitedMs };
      } catch (e) {
        lastErr = e;
        if (!isRetryable(e)) throw e;
        state.throttles++;
        state.gap = Math.min(maxGapMs, Math.max(state.gap * 1.6, 5000));
        const delay = Math.min(25000, baseDelayMs * 2 ** attempt) + Math.floor(random() * 1000);
        onRetry?.({ attempt: attempt + 1, error: e.name || String(e.$metadata?.httpStatusCode), delay });
        state.waitedMs += delay;
        await sleep(delay);
        attempt++;
      }
    }
    throw new BedrockUnavailable(`Bedrock did not answer after ${attempt} attempts (${lastErr?.name || 'deadline'}).`, { attempts: attempt, last: lastErr?.name, throttles: state.throttles });
  }
  return { converse, state, model };
}
