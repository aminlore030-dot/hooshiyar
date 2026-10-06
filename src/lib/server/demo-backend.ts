/**
 * Backend registry for the built-in demo engine.
 *
 * The original demo used `z-ai-web-dev-sdk`, which only works on the project's
 * own hosting. On any other host (Vercel, self-host, Docker) the SDK has no
 * credentials and `ZAI.create()` throws.
 *
 * This module defines a small, uniform backend contract and a chain of
 * candidates so the demo engine can be enabled on any deployment without
 * shipping a secret in the repo. Each candidate is fed exclusively from
 * environment variables — no keys are ever read from disk or the repo.
 *
 * A candidate is only used when BOTH of its env vars are set, and it is only
 * reported as available once it has actually answered a request.
 */
export interface DemoBackend {
  /** Stable identifier used in logs / probe responses. */
  id: string;
  /** Persian label shown to the user in the UI. */
  label: string;
  /** Base URL, already normalized to end without a trailing slash. */
  baseUrl: string;
  /** Bearer token sent as `Authorization`. */
  apiKey: string;
  /** Model id passed in the request body. */
  model: string;
  /** Whether this backend is OpenAI-compatible (false = the legacy SDK). */
  openaiCompatible: boolean;
}

type EnvLike = Record<string, string | undefined>;

function norm(v: string | undefined): string {
  return (v ?? '').trim();
}

/**
 * Build the ordered list of candidate backends from the environment.
 * The first entry with a complete credential set wins.
 */
export function resolveDemoBackends(env: EnvLike = process.env): DemoBackend[] {
  const out: DemoBackend[] = [];

  // 1) z-ai SDK's own host — original behaviour, works only on the project's
  //    own hosting where .z-ai-config exists. Env vars let us reproduce it.
  const zaiBaseUrl = norm(env.ZAI_BASE_URL);
  const zaiKey = norm(env.ZAI_API_KEY);
  if (zaiBaseUrl && zaiKey) {
    out.push({
      id: 'zai',
      label: 'موتور دموی اصلی (z-ai)',
      baseUrl: zaiBaseUrl.replace(/\/+$/, ''),
      apiKey: zaiKey,
      model: norm(env.ZAI_MODEL) || 'glm-4-flash',
      openaiCompatible: false,
    });
  }

  // 2) Any OpenAI-compatible endpoint (Cloudflare Workers AI, SiliconFlow free
  //    tier, DeepInfra, Groq, a self-hosted gateway…). This is how the demo is
  //    enabled on generic hosts: point it at a free tier and it just works.
  const baseUrl = norm(env.DEMO_BASE_URL);
  const apiKey = norm(env.DEMO_API_KEY);
  if (baseUrl && apiKey) {
    out.push({
      id: 'openai-compat',
      label: norm(env.DEMO_LABEL) || 'موتور دموی داخلی',
      baseUrl: baseUrl.replace(/\/+$/, ''),
      apiKey,
      model: norm(env.DEMO_MODEL) || 'gpt-4o-mini',
      openaiCompatible: true,
    });
  }

  return out;
}

/** The single backend the demo currently uses (highest-priority configured). */
export function activeDemoBackend(env: EnvLike = process.env): DemoBackend | null {
  return resolveDemoBackends(env)[0] ?? null;
}

/**
 * True only when a backend is configured at all. `/api/demo-status` still
 * performs a live probe before telling the UI the demo is usable.
 */
export function demoBackendConfigured(env: EnvLike = process.env): boolean {
  return resolveDemoBackends(env).length > 0;
}
