/**
 * Server-side streaming dispatcher. The /api/chat route calls this.
 * Picks the right wire adapter for the provider kind.
 * NOTE: user API keys arrive per-request and are never logged or persisted.
 */
import type { ProxyChatRequest, StreamEvent } from '@/lib/types';
import { streamOpenAiCompatible } from '@/lib/providers/adapters/openai-compat';
import { streamAnthropic } from '@/lib/providers/adapters/anthropic';
import { streamGemini } from '@/lib/providers/adapters/gemini';
import { streamDemo } from '@/lib/providers/adapters/demo';

export async function* dispatchStream(req: ProxyChatRequest): AsyncGenerator<StreamEvent> {
  switch (req.provider) {
    case 'anthropic':
      yield* streamAnthropic(req);
      return;
    case 'gemini':
      yield* streamGemini(req);
      return;
    case 'hooshiyar-demo':
      yield* streamDemo(req);
      return;
    default:
      yield* streamOpenAiCompatible(req);
      return;
  }
}

export { listOpenAiModels, testOpenAiKey, joinUrl } from '@/lib/providers/adapters/openai-compat';
export { listAnthropicModels, testAnthropicKey } from '@/lib/providers/adapters/anthropic';
export { listGeminiModels, testGeminiKey } from '@/lib/providers/adapters/gemini';
