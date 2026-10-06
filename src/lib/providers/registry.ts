import type { ProviderId, ProviderInfo } from '@/lib/types';

/**
 * Registry of all supported providers with Persian metadata.
 * kind determines which wire adapter is used; everything OpenAI-compatible
 * shares the `openai` adapter (OpenRouter, Groq, DeepSeek, Mistral, Together,
 * Fireworks, Ollama, LM Studio, custom endpoints).
 */
export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...',
    supportsBaseUrl: true,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (کلود)',
    kind: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-...',
    supportsBaseUrl: true,
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    keyHint: 'AIza...',
    supportsBaseUrl: true,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-...',
    supportsBaseUrl: false,
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    docsUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_...',
    supportsBaseUrl: false,
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk-...',
    supportsBaseUrl: false,
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    kind: 'openai',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    docsUrl: 'https://console.mistral.ai/api-keys',
    keyHint: '...',
    supportsBaseUrl: false,
  },
  together: {
    id: 'together',
    name: 'Together AI',
    kind: 'openai',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    docsUrl: 'https://api.together.xyz/settings/api-keys',
    keyHint: '...',
    supportsBaseUrl: false,
  },
  fireworks: {
    id: 'fireworks',
    name: 'Fireworks AI',
    kind: 'openai',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    docsUrl: 'https://fireworks.ai/account/api-keys',
    keyHint: 'fw_...',
    supportsBaseUrl: false,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (محلی)',
    kind: 'openai',
    defaultBaseUrl: 'http://localhost:11434/v1',
    docsUrl: 'https://ollama.com',
    keyHint: 'نیازی به کلید نیست',
    supportsBaseUrl: true,
    keyOptional: true,
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio (محلی)',
    kind: 'openai',
    defaultBaseUrl: 'http://localhost:1234/v1',
    docsUrl: 'https://lmstudio.ai',
    keyHint: 'نیازی به کلید نیست',
    supportsBaseUrl: true,
    keyOptional: true,
  },
  custom: {
    id: 'custom',
    name: 'نقطه پایانی سازگار با OpenAI',
    kind: 'openai',
    defaultBaseUrl: 'https://',
    docsUrl: '',
    keyHint: 'کلید API سازگار با OpenAI',
    supportsBaseUrl: true,
  },
  'hooshiyar-demo': {
    id: 'hooshiyar-demo',
    name: 'دموی داخلی (بدون کلید)',
    kind: 'demo',
    defaultBaseUrl: '',
    docsUrl: '',
    keyHint: 'بدون کلید — از طریق سرور میزبان',
    supportsBaseUrl: false,
    keyOptional: true,
  },
};

export const PROVIDER_ORDER: ProviderId[] = [
  'hooshiyar-demo',
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'groq',
  'deepseek',
  'mistral',
  'together',
  'fireworks',
  'ollama',
  'lmstudio',
  'custom',
];

export function providerName(id: ProviderId): string {
  return PROVIDERS[id]?.name ?? id;
}

/** Suggested default models per provider (editable by the user). */
export const SUGGESTED_MODELS: Partial<Record<ProviderId, string[]>> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  anthropic: ['claude-sonnet-4-5-20250929', 'claude-3-5-haiku-20241022'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro'],
  openrouter: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  mistral: ['mistral-large-latest', 'mistral-small-latest'],
  together: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  fireworks: ['accounts/fireworks/models/llama-v3p3-70b-instruct'],
  ollama: ['llama3.2', 'qwen2.5'],
  lmstudio: ['local-model'],
  'hooshiyar-demo': ['glm-4-flash', 'gpt-4o-mini', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
};
