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

---
Task ID: fix-atria-key
Agent: main (orchestrator)
Task: دیباگ «کلید Atria وارد نمی‌شود و خطا می‌دهد» — تست endpoint واقعی، یافتن علت، رفع و تأیید E2E

Work Log:
- curl مستقیم: GET /v1/models و POST /v1/chat/completions با کلید atr_l2H_... هر دو 200؛ تنها مدل موجود: Atria-Dawn-Preview (مدل reasoning با خروجی reasoning_content).
- تست APIهای خودِ اپ از سرور: /api/providers/test و /api/providers/models با مدل درست → هر دو موفق. پس مشکل سمت فرم بود.
- بازتولید خطا در مرورگر (Agent Browser): ذخیرهٔ کلید با فیلد مدل خالی → toast «نام مدل را وارد کنید.» و کلید ذخیره نمی‌شد. علت‌ها: (۱) placeholder «gpt-4o-mini» فیلد را پر جلوه می‌داد، (۲) چیپ‌های پیشنهادی gpt-4o/gpt-4o-mini/o3-mini برای Atria اشتباه بودند و تست با آن‌ها خطای HTTP 400: A supported model is required می‌داد.
- Fix 1 (settings-dialog KeyForm): در save() اگر مدل خالی بود، خودکار از /models ارائه‌دهنده کشف و اولین مدل انتخاب/ذخیره می‌شود؛ «دریافت فهرست مدل‌ها» اولین مدل را پیش‌انتخاب می‌کند؛ toggle «ورود دستی» و «بازگشت به فهرست»؛ placeholder فارسی شفاف + hint زیر فیلد؛ چیپ‌های پیشنهادی فقط برای endpoint پیش‌فرض واقعی همان ارائه‌دهنده نمایش داده می‌شوند.
- Fix 2 (api/providers/test): برای endpointهای openai-سازگار اگر مدل ذخیره نشده باشد، ابتدا از /models مدل کشف می‌شود (رفع تست کلیدهای قدیمی بدون مدل)؛ پیام خطای فارسی واضح در شکست کشف.
- bun lint: clean. بازبینی مرورگر: ذخیره با مدل خالی → خودکار Atria-Dawn-Preview انتخاب و ذخیره شد (toast «کلید ذخیره شد»)؛ تست کلید → تیک سبز «کلید معتبر است و مدل پاسخ داد»؛ چت زنده با کلید Atria → پاسخ فارسی روان استریم شد؛ کنسول بدون خطا.

Stage Summary:
- کلید و endpoint سالم بودند؛ مشکل UX اعتبارسنجی مدل در فرم کلید بود.
- رفتار جدید: کاربر نیازی به دانستن نام مدل ندارد؛ کلید با مدل خالی هم ذخیره و هم تست می‌شود.
- کلید Atria در گنجینه با مدل Atria-Dawn-Preview ذخیره و چت واقعی با آن E2E تأیید شد.

---
Task ID: fix-geo-403
Agent: main (orchestrator)
Task: دیباگ «دسترسی با این کلید مجاز نیست (خطای ۴۰۳): Country, region, or territory not supported»

Work Log:
- curl مستقیم: Atria از سرور sandbox سالم است (200، هر دو models و chat/completions). منبع خطای ۴۰۳: api.openai.com با کارت «کلید آزمایشی» (کلید ساختگی sk-fak...3456) — OpenAI درخواست را قبل از بررسی کلید به دلیل منطقهٔ سرور رد می‌کند: unsupported_country_region_territory.
- بازتولید در مرورگر: انتخاب گزینهٔ «OpenAI · gpt-4o-mini · کلید آزمایشی» در انتخابگر مدل و ارسال پیام → عین پیام خطای کاربر. (تست با curl روی /api/providers/test هم همین را داد.)
- Fix (sse.ts): تشخیص اختصاصی خطای جغرافیایی (code=unsupported_country_region_territory یا متن Country, region, or territory not supported) → پیام فارسی راهنما با ذکر میزبان و تأکید بر بی‌ربط بودن به اعتبار کلید + پیشنهاد تغییر ارائه‌دهنده/Base URL واسطه؛ افزودن hostOf() و پارامتر اختیاری host به extractApiError؛ prefix میزبان (host) در سایر خطاها.
- به‌روزرسانی هر ۳ آداپتور (openai-compat، anthropic، gemini) برای پاس دادن host در همهٔ مسیرهای خطا (chat stream HTTP، in-stream error، listModels، testKey).
- bun lint clean. تأیید مرورگر: خطای جدید با «api.openai.com» و راهنمای فارسی نمایش داده شد؛ سپس سوییچ به Atria و چت مجدد → پاسخ فارسی سالم. بدون خطای کنسول.

Stage Summary:
- خطای ۴۰۳ ربطی به کلید Atria نداشت؛ از api.openai.com (کارت کلید آزمایشی ساختگی) بود و ریشهٔ آن محدودیت منطقه‌ای OpenAI نسبت به سرور میزبان است.
- حالا خطاهای ارائه‌دهنده میزبان مقصد را نشان می‌دهند و خطای جغرافیایی پیام اختصاصی و راهنما دارد.
