# ☁️ راهنمای استقرار هوش‌یار روی GitHub

این راهنما از صفر تا انتشار عمومی و استقرار زنده را قدم‌به‌قدم توضیح می‌دهد.
(راهنمای فنی کامل پلتفرم‌ها در [DEPLOYMENT.md](DEPLOYMENT.md) است.)

---

## ۱) ساخت مخزن و Push

### قدم ۱ — ساخت مخزن در GitHub
1. وارد [github.com/new](https://github.com/new) شوید.
2. نام مخزن: `hooshiyar` (یا هر نام دلخواه).
3. توضیح: `ایستگاه کاری هوش مصنوعی شخصی (BYOK) — Personal Persian-first AI workspace`.
4. عمومی (Public) یا خصوصی (Private) — هر دو کار می‌کنند.
5. **تیک گزینه‌های README / .gitignore / license را نزنید** (این‌ها را داریم).

### قدم ۲ — Push پروژه

```bash
cd hooshiyar

# اگر هنوز git مقداردهی نشده:
git init
git add .
git commit -m "feat: hooshiyar v1.0.0 — Persian BYOK AI workspace"

# اتصال به مخزن (USERNAME را با نام کاربری خودتان عوض کنید)
git branch -M main
git remote add origin https://github.com/USERNAME/hooshiyar.git
git push -u origin main
```

> 🔐 نکته امنیتی: فایل `.env` به‌طور خودکار از کامیت حذف می‌شود (در `.gitignore`). فقط `.env.example` منتشر می‌شود و **هیچ کلیدی داخل آن نیست**. کلیدهای API کاربران هم فقط در مرورگرِ هر کاربر ذخیره می‌شوند و هرگز به مخزن یا سرور نمی‌رسند.

### قدم ۳ — پروفایل مخزن (اختیاری ولی مفید)
- در Settings → General → Description را کامل کنید.
- در صفحه اصلی مخزن، از About → Website آدرس استقرار زنده را بگذارید.
- Topics پیشنهادی: `ai-assistant`, `byok`, `persian`, `rtl`, `nextjs`, `agent`, `mcp`, `rag`.

---

## ۲) استقرار زنده

### گزینه A — Vercel (سریع‌ترین راه)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FUSERNAME%2Fhooshiyar&project-name=hooshiyar&repository-name=hooshiyar)

یا دستی:
1. وارد [vercel.com/new](https://vercel.com/new) شوید و مخزن را Import کنید.
2. هیچ Environment Variable لازم نیست (اپ BYOK است). گزینه‌های پیش‌فرض را بپذیرید.
3. Deploy. بعد از هر push به `main`، نسخه جدید خودکار منتشر می‌شود.

⚠️ **در Vercel/Netlify:** ابزارهای سیستمی (شل، پایتون، فایل‌سیستم سندباکس) کار نمی‌کنند — بقیه امکانات (گفتگو با همه ارائه‌دهندگان، جستجوی وب، MCP پروکسی، RAG مرورگر) فعال است. ارائه‌دهنده دموی داخلی هم فقط روی میزبانی اصلی ما کار می‌کند؛ جای دیگر خودکار غیرفعال تشخیص داده می‌شود.

### گزینه B — Docker (تمام امکانات — پیشنهادی)

```bash
git clone https://github.com/USERNAME/hooshiyar.git
cd hooshiyar
docker compose --profile mcp up -d      # اپ روی :3000 و MCP روی :3010
```

یا فقط اپ:

```bash
docker build -t hooshiyar .
docker run -d -p 3000:3000 -v hooshiyar_ws:/app/workspace hooshiyar
```

### گزینه C — اجرای مستقیم روی سرور خودتان

```bash
git clone https://github.com/USERNAME/hooshiyar.git
cd hooshiyar
bun install
bun run db:push        # فقط یک‌بار (پایگاه داده محلی سمت سرور)
bun run build
bun run start          # یا با pm2/systemd سرویس کنید
```

Nginx reverse proxy معمولی (پورت 3000) کافی است.

---

## ۳) انتشار نسخه‌های جدید

```bash
git add .
git commit -m "feat: توضیح تغییرات"
git push
```

- **Vercel/Netlify:** خودکار منتشر می‌شود.
- **Docker:** روی سرور `git pull && docker compose up -d --build`.
- برای تگ نسخه: `git tag v1.0.1 && git push --tags`

## ۴) CI

پوشه `.github/workflows/ci.yml` روی هر push/PR دو کار انجام می‌دهد:
- `bun run lint` (ESLint)
- `bunx tsc --noEmit` (بررسی تایپ)

نتیجه در تب Actions مخزن دیده می‌شود؛ badge آن را می‌توانید در README به شکل زیر اضافه کنید:

```markdown
![CI](https://github.com/USERNAME/hooshiyar/actions/workflows/ci.yml/badge.svg)
```

## ۵) سؤالات پرتکرار استقرار

| مشکل | راه‌حل |
|---|---|
| خطای ۴۰۳ «Country, region, or territory not supported» | محدودیت منطقه‌ای خودِ ارائه‌دهنده (مثلاً OpenAI) نسبت به سرور شماست؛ ارائه‌دهندهٔ دیگری انتخاب کنید یا Base URL واسطه تنظیم کنید. پیام خطای داخل اپ راهنمایی می‌کند. |
| دکمه دمو روی سرور من کار نمی‌کند | طبیعی است — موتور دمو مختص میزبانی اصلی است. کلید خودتان را وارد کنید (BYOK). |
| ابزارهای شل/پایتون در Vercel کار نمی‌کنند | Serverless فایل‌سیستم/پردازش فرزند ندارد. از Docker یا سرور شخصی استفاده کنید. |
| کلیدها بین مرورگر/دستگاه‌ها منتقل نمی‌شوند | عمدی است (Local-first). از «خروجی گرفتن» در سایدبار برای پشتیبان و «ورود داده‌ها» برای بازیابی استفاده کنید. |
