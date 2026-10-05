'use client';

/**
 * Multi-agent orchestration — «حالت تیم».
 * Planner → Executor → Critic loop (max 2 revision rounds).
 * All three roles share the same underlying model/key; they differ by system
 * prompt. The executor may use the full agent loop (tools included).
 */
import type { CoreMessage, KeyEntry } from '@/lib/types';
import { textMsg } from '@/lib/types';
import { proxyStream } from '@/lib/providers/client';
import { runAgentLoop, type AgentLoopCallbacks } from '@/lib/agent/loop';
import type { ToolExecContext } from '@/lib/agent/executor';

export interface TeamStep {
  index: number;
  title: string;
  detail: string;
}

export interface TeamEvents {
  onPlan: (steps: TeamStep[]) => void;
  onStepStart: (index: number) => void;
  onStepDelta: (index: number, delta: string) => void;
  onStepDone: (index: number, text: string) => void;
  onCritique: (verdict: 'approve' | 'revise', feedback: string) => void;
  onDelta: (delta: string) => void; // any streaming, for the status ticker
  onDone: (finalText: string) => void;
}

export interface TeamOptions {
  key: Pick<KeyEntry, 'provider' | 'baseUrl' | 'apiKey' | 'model'>;
  goal: string;
  toolNames: string[];
  execCtx: ToolExecContext;
  temperature: number;
  maxTokens: number;
  maxSteps: number;
  signal: AbortSignal;
  /** Reuse loop callbacks for tool chips during execution. */
  loopCallbacks: AgentLoopCallbacks;
  events: TeamEvents;
}

async function completeOnce(
  opts: Pick<TeamOptions, 'key' | 'temperature' | 'maxTokens' | 'signal' | 'events'>,
  messages: CoreMessage[],
): Promise<string> {
  let text = '';
  const stream = proxyStream({
    provider: opts.key.provider,
    baseUrl: opts.key.baseUrl,
    apiKey: opts.key.apiKey,
    model: opts.key.model,
    messages,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    signal: opts.signal,
  });
  for await (const evt of stream) {
    if (evt.type === 'text') {
      text += evt.delta;
      opts.events.onDelta(evt.delta);
    } else if (evt.type === 'error') {
      throw new Error(evt.message);
    }
  }
  return text;
}

function parseSteps(raw: string): TeamStep[] {
  const jsonMatch = /\{[\s\S]*\}/.exec(raw);
  if (!jsonMatch) return [{ index: 1, title: 'اجرا', detail: raw.trim().slice(0, 500) }];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { steps?: { title?: string; detail?: string }[] };
    const steps = (parsed.steps ?? []).slice(0, 8).map((s, i) => ({
      index: i + 1,
      title: String(s.title ?? `گام ${i + 1}`).slice(0, 120),
      detail: String(s.detail ?? '').slice(0, 600),
    }));
    return steps.length ? steps : [{ index: 1, title: 'اجرا', detail: raw.trim().slice(0, 500) }];
  } catch {
    return [{ index: 1, title: 'اجرا', detail: raw.trim().slice(0, 500) }];
  }
}

export async function runTeam(opts: TeamOptions): Promise<string> {
  const { key, signal } = opts;

  /* ------------------------------ 1. Planner ------------------------------ */
  const planRaw = await completeOnce(opts, [
    textMsg(
      'system',
      'تو برنامه‌ریز هستی. یک برنامه اجرایی گام‌به‌گام برای هدف کاربر بنویس. فقط JSON برگردان، بدون هیچ متن اضافه: {"steps":[{"title":"...","detail":"..."}]} حداکثر ۶ گام. فارسی بنویس.',
    ),
    textMsg('user', `هدف: ${opts.goal}`),
  ]);
  const steps = parseSteps(planRaw);
  opts.events.onPlan(steps);

  /* ---------------------- 2+3. Executor / Critic loop --------------------- */
  let feedback = '';
  let finalText = '';
  for (let round = 0; round < 3; round += 1) {
    if (signal.aborted) break;
    const results: string[] = [];

    for (const step of steps) {
      if (signal.aborted) break;
      opts.events.onStepStart(step.index);
      const messages: CoreMessage[] = [
        textMsg(
          'system',
          `تو مجری هستی. گام ${step.index} از برنامه را اجرا کن و نتیجه کامل و ساخت‌یافته ارائه بده.
هدف کلی: ${opts.goal}
${feedback ? `بازخورد منتقد از دور قبل (آن را اعمال کن):\n${feedback}\n` : ''}
برنامه کامل:
${steps.map((s) => `${s.index}. ${s.title}: ${s.detail}`).join('\n')}`,
        ),
        textMsg('user', `گام فعلی: ${step.title} — ${step.detail}`),
      ];

      await runAgentLoop({
        key: opts.key,
        messages,
        toolNames: opts.toolNames,
        execCtx: opts.execCtx,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        maxSteps: Math.min(opts.maxSteps, 8),
        signal: opts.signal,
        callbacks: {
          ...opts.loopCallbacks,
          onTextDelta: (d) => opts.events.onStepDelta(step.index, d),
          onDone: () => undefined,
        },
      });

      // The loop mutates `messages`; last assistant text = step result.
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      const stepText = lastAssistant?.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { text: string }).text)
        .join('\n') ?? '';
      results.push(`## گام ${step.index}: ${step.title}\n${stepText}`);
      opts.events.onStepDone(step.index, stepText);
    }

    finalText = results.join('\n\n');

    /* -------------------------------- Critic ------------------------------- */
    if (signal.aborted) break;
    try {
      const critique = await completeOnce(opts, [
        textMsg(
          'system',
          'تو منتظر سخت‌گیر اما منصف هستی. خروجی مجری را برای هدف کاربر ارزیابی کن. فقط JSON برگردان: {"verdict":"approve"|"revise","feedback":"..."} — اگر خروجی کامل، صحیح و متناسب هدف است approve؛ وگرنه اصلاحات مشخص و کوتاه در feedback بنویس. فارسی.',
        ),
        textMsg('user', `هدف: ${opts.goal}\n\nخروجی مجری:\n${finalText.slice(0, 12_000)}`),
      ]);
      const m = /\{[\s\S]*\}/.exec(critique);
      const parsed = m ? (JSON.parse(m[0]) as { verdict?: string; feedback?: string }) : null;
      const verdict = parsed?.verdict === 'approve' ? 'approve' : 'revise';
      opts.events.onCritique(verdict, parsed?.feedback ?? '');
      if (verdict === 'approve') break;
      feedback = parsed?.feedback ?? '';
    } catch {
      break; // critic failed → accept executor output
    }
  }

  opts.events.onDone(finalText);
  return finalText;
}
