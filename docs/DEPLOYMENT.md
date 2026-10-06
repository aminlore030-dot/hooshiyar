# راهنمای استقرار هوش‌یار

## گزینه ۱: Vercel / Netlify (بدون ابزار سیستمی)

آنچه کار می‌کند: گفتگوی استریم، BYOK، همه ارائه‌دهندگان، جستجوی وب، خواندن صفحه، MCP پروکسی، ذخیره‌سازی محلی مرورگر.
آنچه کار **نمی‌کند** (Serverless بدون فایل‌سیستم/فرآیند فرزند): `/api/tools/shell`، `/api/tools/py`، `/api/files`، پوشه کاری.

### Vercel
```bash
npm i -g vercel
vercel        # اولین استقرار
vercel --prod
```
- Environment Variables: نیازی نیست (اپ BYOK است). فقط `HOOSHIYAR_WORKSPACE` را تنظیم نکنید.
- توجه: `export const runtime = 'nodejs'` روی همه مسیرهای API حفظ شده است (Edge نه، چون به `node:vm`/`child_process` نیاز داریم).

### Netlify
```bash
npm i -g netlify-cli
netlify deploy --build --prod
```
- پلاگین `@netlify/plugin-nextjs` به‌صورت خودکار استفاده می‌شود.
- همان محدودیت ابزارهای سیستمی.

## گزینه ۲: Docker (امکانات کامل — پیشنهادی)

```bash
docker build -t hooshiyar .
docker run -d --name hooshiyar \
  -p 3000:3000 \
  -v hooshiyar_workspace:/app/workspace \
  --restart unless-stopped \
  hooshiyar
```

با سرور MCP اختیاری:
```bash
docker compose --profile mcp up -d
# اپ: http://localhost:3000
# MCP: http://localhost:3010  (در تنظیمات ← تب MCP آدرس http://localhost:3010/mcp را اضافه کنید)
```

ایزوله‌سازی قوی‌تر برای سندباکس‌ها (اختیاری):
```bash
docker run -d -p 3000:3000 \
  --read-only \
  --tmpfs /tmp:size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 128 \
  --memory 1g \
  -v hooshiyar_workspace:/app/workspace \
  hooshiyar
```

## گزینه ۳: سرور شخصی (bare-metal / VPS)

پیش‌نیاز: Node 20+ یا Bun 1.1+، python3 (برای ابزار پایتون).

```bash
git clone <repo> hooshiyar && cd hooshiyar
bun install
HOOSHIYAR_WORKSPACE=/srv/hooshiyar-workspace bun run build
HOOSHIYAR_WORKSPACE=/srv/hooshiyar-workspace PORT=3000 bun run start

# سرویس systemd (پیشنهادی):
# [Unit] After=network.target
# [Service] WorkingDirectory=/srv/hooshiyar
#   ExecStart=/usr/local/bin/bun run start
#   Environment=HOOSHIYAR_WORKSPACE=/srv/hooshiyar-workspace
#   Restart=always
# [Install] WantedBy=multi-user.target
```

روی Nginx/Caddy در جلوی اپ:
```nginx
# Nginx — مهم برای SSE:
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Connection '';
  proxy_buffering off;        # استریم SSE بدون بافر
  proxy_read_timeout 300s;
}
```

## پس از استقرار (چک‌لیست)

1. صفحه باز شود؛ جادوگر خوش‌آمد دیده شود (فارسی، RTL).
2. «شروع سریع با دمو» یا افزودن کلید واقعی + دکمه تست.
3. یک پیام بفرستید؛ استریم و ذخیره در IndexedDB (بعد از رفرش، گفتگو بماند).
4. اگر self-host است: ابزار فایل/شل/پایتون را با پروفایل «اوپن‌کد» امتحان کنید.
5. اگر Docker است: MCP server را در تب MCP ثبت و «بررسی» بزنید.

## اختیاری: فعال‌کردن موتور دمو

موتور دمو به کاربران اجازه می‌دهد اپ را بدون وارد کردن کلید امتحان کنند. به‌طور پیش‌فرض خاموش است و اگر چیزی تنظیم نشده باشد، برنامه خودش کارت دمو را غیرفعال نشان می‌دهد.

کافی است سه متغیر محیطی روی هر نقطه پایانی **سازگار با OpenAI** با لایه رایگان تنظیم کنید — Cloudflare Workers AI، SiliconFlow، DeepInfra، Groq یا یک gateway شخصی:

```
DEMO_BASE_URL=https://api.deepinfra.com/v1/openai
DEMO_API_KEY=sk-...          # کلید رایگان خودتان
DEMO_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo
DEMO_LABEL=دموی داخلی        # اختیاری — برچسب فارسی در UI
```

نکته‌ها:
- هیچ کلیدی در ریپو قرار نمی‌گیرد؛ همه‌چیز از محیط خوانده می‌شود.
- `/api/demo-status` قبل از اعلام «آماده» یک درخواست آزمایشی واقعی می‌فرستد، پس یک کلید اشتباه هرگز به‌عنوان دموی کارا نشان داده نمی‌شود.
- جریان اصلی اپ BYOK است و بدون این متغیرها هم کامل کار می‌کند.
