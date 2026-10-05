'use client';

/**
 * Agent loop — client-driven orchestration.
 *
 * Design: the browser owns the conversation state and drives the loop:
 *   stream assistant turn → (tool calls? execute via executor → append results → repeat) : done
 * The server is a thin, stateless proxy (/api/chat). This keeps HITL approvals
 * trivial (UI dialog inside the loop), makes every step observable in the UI,
 * and means the backend stores nothing about the conversation.
 */
import type { CoreMessage, KeyEntry, StreamEvent, ToolSpec } from '@/lib/types';
import { proxyStream } from '@/lib/providers/client';
import { executeTool, type ToolExecContext } from '@/lib/agent/executor';
import { TOOL_DEFINITIONS, SENSITIVE_TOOLS } from '@/lib/agent/tools';
import { logAudit } from '@/lib/idb';

export interface AgentLoopCallbacks {
  /** Streaming text delta for the current assistant turn. */
  onTextDelta: (delta: string) => void;
  /** A tool call was requested by the model (UI can render a chip). */
  onToolStart: (id: string, name: string) => void;
  onToolDelta: (id: string, argsDelta: string) => void;
  /** Tool execution finished. */
  onToolResult: (id: string, name: string, ok: boolean, denied?: boolean) => void;
  /** Reasoning delta (extended-thinking models). */
  onReasoningDelta?: (delta: string) => void;
  onStepStart?: (step: number) => void;
  onDone: (info: { aborted: boolean; steps: number; hadError: boolean }) => void;
}

export interface AgentLoopOptions {
  key: Pick<KeyEntry, 'provider' | 'baseUrl' | 'apiKey' | 'model'>;
  /** Conversation so far (system + user + assistant + tool). Mutated by the loop. */
  messages: CoreMessage[];
  toolNames: string[];
  execCtx: ToolExecContext;
  temperature: number;
  maxTokens: number;
  maxSteps: number;
  signal: AbortSignal;
  callbacks: AgentLoopCallbacks;
}

export interface ToolCallAcc {
  id: string;
  name: string;
  args: string;
}

function toolsFor(names: string[], mcpTools: ToolSpec[]): ToolSpec[] {
  const base = names
    .map((n) => (TOOL_DEFINITIONS as Record<string, ToolSpec | undefined>)[n])
    .filter((t): t is ToolSpec => Boolean(t));
  return [...base, ...mcpTools];
}

/**
 * Run the agent loop to completion. Returns the final assistant text
 * accumulated across turns (for convenience).
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<{ text: string; error?: string }> {
  const { key, execCtx, signal, callbacks } = opts;
  let fullText = '';
  let lastError: string | undefined;
  let step = 0;

  const mcpToolSpecs: ToolSpec[] = [];
  for (const server of execCtx.mcpServers) {
    try {
      const { discoverMcpTools } = await import('@/lib/agent/executor');
      const toolsMap = await discoverMcpTools([server]);
      const tools = toolsMap.get(server.id) ?? [];
      for (const t of tools) {
        mcpToolSpecs.push({
          name: `mcp__${server.id}__${t.name}`,
          description: `[MCP:${server.name}] ${t.description}`,
          parameters: t.inputSchema?.type === 'object' ? t.inputSchema : { type: 'object', properties: {} },
        });
      }
    } catch {
      /* skip broken MCP server */
    }
  }

  while (step < opts.maxSteps && !signal.aborted) {
    step += 1;
    callbacks.onStepStart?.(step);

    const toolAcc = new Map<string, ToolCallAcc>();
    let order: string[] = [];
    let turnText = '';
    let finishReason = 'stop';
    let hadError = false;

    const stream = proxyStream({
      provider: key.provider,
      baseUrl: key.baseUrl,
      apiKey: key.apiKey,
      model: key.model,
      messages: opts.messages,
      tools: toolsFor(opts.toolNames, mcpToolSpecs),
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal,
    });

    try {
      for await (const evt of stream as AsyncGenerator<StreamEvent>) {
        switch (evt.type) {
          case 'text':
            turnText += evt.delta;
            fullText += evt.delta;
            callbacks.onTextDelta(evt.delta);
            break;
          case 'reasoning':
            callbacks.onReasoningDelta?.(evt.delta);
            break;
          case 'tool_call_start': {
            const acc = toolAcc.get(evt.id) ?? { id: evt.id, name: '', args: '' };
            if (evt.name) acc.name = evt.name;
            toolAcc.set(evt.id, acc);
            if (!order.includes(evt.id)) order.push(evt.id);
            callbacks.onToolStart(evt.id, acc.name);
            break;
          }
          case 'tool_call_delta': {
            // Anthropic streams args without repeating the id; bind to last seen call.
            const id = evt.id || order[order.length - 1] || '';
            const acc = toolAcc.get(id);
            if (acc) {
              acc.args += evt.argsDelta;
              callbacks.onToolDelta(id, evt.argsDelta);
            }
            break;
          }
          case 'finish':
            finishReason = evt.reason;
            break;
          case 'error':
            hadError = true;
            lastError = evt.message;
            fullText += `\n\n⛔ ${evt.message}`;
            callbacks.onTextDelta(`\n\n⛔ ${evt.message}`);
            break;
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        callbacks.onDone({ aborted: true, steps: step, hadError });
        return { text: fullText };
      }
      hadError = true;
      lastError = `خطای جریان: ${e?.message ?? e}`;
      callbacks.onTextDelta(`\n\n⛔ ${lastError}`);
      break;
    }

    const calls = order.map((id) => toolAcc.get(id)!).filter((c) => c && c.name);

    if (!calls.length || finishReason === 'stop' || finishReason === 'end_turn' || signal.aborted) {
      if (calls.length && (finishReason === 'stop' || finishReason === 'end_turn') && !signal.aborted) {
        // Some providers emit tools with end_turn; still execute them.
      } else {
        break;
      }
    }

    // Record the assistant turn (text + requested calls) in the conversation.
    const assistantParts: CoreMessage['parts'] = [];
    if (turnText) assistantParts.push({ type: 'text', text: turnText });
    for (const c of calls) assistantParts.push({ type: 'tool_call', id: c.id, name: c.name, args: c.args });
    opts.messages.push({ role: 'assistant', parts: assistantParts });

    if (!calls.length) break; // pure text turn → done

    // Execute tool calls sequentially (shell approvals need focus anyway).
    const resultParts: CoreMessage['parts'] = [];
    for (const call of calls) {
      if (signal.aborted) break;
      const result = await executeTool(call.name, call.args, execCtx, signal);
      callbacks.onToolResult(call.id, call.name, result.ok, result.denied);
      resultParts.push({
        type: 'tool_result',
        toolCallId: call.id,
        name: call.name,
        content: result.content,
        isError: !result.ok,
      });
    }
    if (resultParts.length) {
      opts.messages.push({ role: 'tool', parts: resultParts });
    }
    if (signal.aborted) break;
  }

  callbacks.onDone({ aborted: signal.aborted, steps: step, hadError: Boolean(lastError) });
  return { text: fullText, error: lastError };
}

/** Record tool usage in the audit log (called by UI too for non-loop actions). */
export async function auditSensitive(toolName: string, detail: string): Promise<void> {
  if (SENSITIVE_TOOLS.has(toolName)) await logAudit(toolName, detail, 'ok');
}
