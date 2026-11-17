// Cloud back ends for masked text. Whatever the provider, only text that passed prepareOutgoing
// (masked, leak-checked) is ever handed to send().
//
// - gemini: Firebase AI Logic (default, no key needed).
// - anthropic: the user's own key, official SDK, direct from the browser.
// - xai: the user's own key, OpenAI-compatible endpoint, direct from the browser.
// - copy: no network at all; the user carries the masked text to any AI and pastes the reply back.
// OpenAI is not offered for direct calls: its API blocks browser requests (CORS), see docs/.
import type Anthropic from '@anthropic-ai/sdk';
import { CLOUD_SYSTEM } from '../relay/prompts';
import { sendCloud, startCloudChat } from './ai';

export type ProviderId = 'gemini' | 'anthropic' | 'xai' | 'copy';
export const DIRECT_PROVIDERS: readonly ProviderId[] = ['gemini', 'anthropic', 'xai'];

export const DEFAULT_MODELS = { anthropic: 'claude-opus-5-5', xai: 'grok-4' } as const;

export interface CloudChat {
  readonly provider: ProviderId;
  readonly model: string;
  /** Sends masked text, returns the reply. Keeps the conversation for follow-ups. */
  send(masked: string): Promise<string>;
}

export class ProviderError extends Error {}

export function geminiChat(model: string): CloudChat {
  const chat = startCloudChat(model);
  return { provider: 'gemini', model, send: (masked) => sendCloud(chat, masked) };
}

export function anthropicChat(apiKey: string, model: string = DEFAULT_MODELS.anthropic): CloudChat {
  let client: Anthropic | null = null;
  let sdk: typeof import('@anthropic-ai/sdk') | null = null;
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  return {
    provider: 'anthropic',
    model,
    async send(masked) {
      sdk ??= await import('@anthropic-ai/sdk');
      const A = sdk.default;
      // The key is the user's own and never leaves this browser except to Anthropic.
      client ??= new A({ apiKey, dangerouslyAllowBrowser: true });
      messages.push({ role: 'user', content: masked });
      try {
        const response = await client.beta.messages
          .stream({
            model,
            max_tokens: 16000,
            system: CLOUD_SYSTEM,
            thinking: { type: 'adaptive' },
            // If a safety classifier declines, the API retries on a fallback model in the same call.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            messages,
          })
          .finalMessage();
        if (response.stop_reason === 'refusal') {
          messages.pop();
          throw new ProviderError('The model declined this request.');
        }
        messages.push({ role: 'assistant', content: response.content });
        return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        messages.pop();
        if (e instanceof A.AuthenticationError) throw new ProviderError('Anthropic rejected the API key.');
        if (e instanceof A.PermissionDeniedError) throw new ProviderError('This API key is not allowed to use that model.');
        if (e instanceof A.NotFoundError) throw new ProviderError(`Anthropic does not know the model "${model}".`);
        if (e instanceof A.RateLimitError) throw new ProviderError('Anthropic rate limit reached. Try again in a moment.');
        if (e instanceof A.APIConnectionError) throw new ProviderError('Could not reach Anthropic. Check your connection.');
        if (e instanceof A.APIError) throw new ProviderError(`Anthropic error ${e.status ?? ''}: ${e.message.slice(0, 160)}`);
        throw e;
      }
    },
  };
}

type XaiMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export function xaiChat(apiKey: string, model: string = DEFAULT_MODELS.xai): CloudChat {
  const messages: XaiMessage[] = [{ role: 'system', content: CLOUD_SYSTEM }];
  return {
    provider: 'xai',
    model,
    async send(masked) {
      messages.push({ role: 'user', content: masked });
      let res: Response;
      try {
        res = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages }),
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        messages.pop();
        throw new ProviderError('Could not reach xAI. Check your connection.');
      }
      if (!res.ok) {
        messages.pop();
        if (res.status === 401) throw new ProviderError('xAI rejected the API key.');
        if (res.status === 404) throw new ProviderError(`xAI does not know the model "${model}".`);
        if (res.status === 429) throw new ProviderError('xAI rate limit reached. Try again in a moment.');
        throw new ProviderError(`xAI error ${res.status}.`);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content ?? '';
      messages.push({ role: 'assistant', content: text });
      return text;
    },
  };
}
