# Worklog — هوش‌یار (Hooshiyar) Personal AI Workspace

Project: Persian (RTL) BYOK personal AI assistant platform — Next.js 16 App Router + TS + Tailwind 4 + shadcn/ui.

---
Task ID: 1
Agent: main (orchestrator)
Task: Environment setup — deps installed, capabilities probed.

Work Log:
- Verified base project: Next.js 16, React 19, Tailwind 4, shadcn/ui complete set, Prisma, zustand, framer-motion, sonner, next-themes, react-markdown, react-syntax-highlighter present.
- Installed: dexie, dexie-react-hooks, @tanstack/react-virtual, vazirmatn, unpdf, cheerio, remark-gfm, rehype-highlight, highlight.js.
- Probed z-ai-web-dev-sdk: chat.completions.create non-streaming (per SKILL.md). Demo provider will pseudo-stream by chunking server-side.
- web-search capability available via z-ai SDK function web_search (backend only) — used as primary search for the agent's web_search tool with DuckDuckGo fallback.
- python3 availability checked for sandbox tool.

Stage Summary:
- Deps ready. Architecture decided: client-driven agent loop + thin Node API proxy layer; keys encrypted client-side (AES-GCM WebCrypto) in localStorage vault; chats/messages/RAG/memory in IndexedDB (Dexie); tools executed via server sandbox APIs; MCP via HTTP JSON-RPC.

---
Task ID: 2-5
Agent: main (orchestrator)
Task: Core libs + provider layer + persistence + API routes + agent runtime

Work Log:
- lib/types.ts: provider-agnostic Part/CoreMessage/StreamEvent/ToolSpec contracts
- lib/vault.ts: AES-GCM+PBKDF2 encrypted key vault (localStorage), session unlock
- lib/providers/: registry (13 providers, Persian metadata), sse.ts parser, adapters (openai-compat, anthropic, gemini, demo via z-ai SDK w/ function calling), server dispatcher + browser proxy client
- lib/idb.ts: Dexie schema v1 (folders/chats/messages tree/documents/chunks/memories/audit/mcpServers/kv), activePath branch walker, export/import/wipe
- lib/rag.ts: chunking + BM25 with Persian normalization (Arabic yeh/kaf, ZWNJ)
- lib/agent/: tools.ts (10 tool defs + approval heuristics), executor.ts (API+Dexie+MCP executors), profiles.ts (5 personas), loop.ts (client-driven agent loop w/ HITL), team.ts (planner/executor/critic)
- API routes: chat (SSE proxy, zod-validated, rate-limited), providers/test, providers/models, tools/{search,fetch,js,py,shell}, files (sandboxed workspace), upload (unpdf PDF extract), mcp-proxy
- lib/server/: ratelimit.ts (token bucket), workspace.ts (path sandbox, shell guard, runShell)

Stage Summary:
- Backend fully stateless re: conversations; keys never persisted server-side.
- Demo provider supports function calling (verified via probe) enabling full agent E2E.
- python3.12 available for py sandbox.

---
Task ID: 6-10
Agent: main (orchestrator)
Task: Persian RTL UI, settings/panels, MCP service, deliverables, full E2E verification

Work Log:
- UI: workspace shell (RTL, Vazirmatn, emerald theme), sidebar (folders/search/tags/pin/export/import), chat-view (virtualized via @tanstack/react-virtual), message-item (markdown GFM+hljs, copy/edit/regenerate/branch-switch/TTS/memory), composer (attachments+RAG ingest, voice input), settings dialog (keys/general/security/MCP), agent panel (tools toggles/files/memory/docs/audit), approval dialog (HITL), onboarding, vault unlock.
- MCP mini-service on port 3010 (JSON-RPC 2.0, initialize/tools list/call; workspace + python + now tools) — verified via curl and via the app's MCP tab.
- Deliverables: README.md (Persian), docs/DEPLOYMENT.md, Dockerfile, docker-compose.yml, .env.example.

Fixes found during browser verification:
1. JS sandbox: top-level return rejected → IIFE fallback + Promise await.
2. mcp-proxy host guard rewritten (allow loopback for self-host; block metadata).
3. Dexie live-query observation lost across native awaits → dbTick bump store pattern wired into all live queries + mutations.
4. Broken sendMessage closure from partial edit → fixed; tsc+lint clean.
5. Autoscroll undershoot with virtualizer → direct scrollTop pinning + rAF loop during streaming.
6. Radix Tabs hydration mismatch → explicit dir="rtl".
7. Auto-select most recent chat on boot.
8. MCP tool chip friendly Persian labels.

E2E verification (Agent Browser, all PASS):
- Onboarding dialog → demo provider boot; new chat created & auto-selected
- Chat streaming (SSE proxy, demo provider) with Persian markdown rendering
- web_search tool call loop E2E: model → tool chip → result → final Persian answer citing live results
- run_python via MCP tool: 31,536,000 seconds/year computed correctly
- Regenerate → branch switcher (1/2 dots) verified; edit-as-branch verified
- Keys: add form, masked display, test against real OpenAI API (graceful Persian 403 error shown)
- MCP: add server → بررسی → 5 tools discovered
- Agent panel: tool toggles, audit log entries (chat_turn, web_search) rendered
- Dark mode, mobile 390px layout, sticky footer on all states
- Zero console errors after fixes; bun lint clean; tsc clean (own code)

Stage Summary:
- Product complete and browser-verified. Manual test checklist + limitations documented in README.
