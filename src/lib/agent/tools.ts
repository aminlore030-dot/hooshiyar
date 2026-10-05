/**
 * Agent tool catalogue — JSON-Schema definitions with Persian descriptions
 * that are sent to the model. Execution lives in executor.ts.
 */
import type { ToolSpec } from '@/lib/types';

export const TOOL_IDS = [
  'web_search',
  'web_fetch',
  'run_js',
  'run_python',
  'run_shell',
  'read_file',
  'write_file',
  'list_files',
  'search_docs',
  'remember',
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export const TOOL_PERSIAN_NAMES: Record<ToolId, string> = {
  web_search: 'جستجوی وب',
  web_fetch: 'خواندن صفحه وب',
  run_js: 'اجرای جاوااسکریپت',
  run_python: 'اجرای پایتون',
  run_shell: 'اجرای فرمان ترمینال',
  read_file: 'خواندن فایل',
  write_file: 'نوشتن فایل',
  list_files: 'فهرست فایل‌ها',
  search_docs: 'جستجو در اسناد',
  remember: 'ذخیره حافظه',
};

export const TOOL_DEFINITIONS: Record<ToolId, ToolSpec> = {
  web_search: {
    name: 'web_search',
    description:
      'جستجوی زنده در وب. نتایج شامل عنوان، آدرس و خلاصه است. برای اطلاعات به‌روز یا ناشناخته استفاده کن. پس از آن در صورت نیاز صفحه را با web_fetch بخوان.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'عبارت جستجو (می‌تواند فارسی یا انگلیسی باشد)' },
        num: { type: 'integer', description: 'تعداد نتایج (۱ تا ۱۰، پیش‌فرض ۶)' },
        recency_days: { type: 'integer', description: 'فقط نتایج N روز اخیر (اختیاری)' },
      },
      required: ['query'],
    },
  },
  web_fetch: {
    name: 'web_fetch',
    description: 'محتوای متنی یک صفحه وب را می‌خواند (بدون HTML اضافه). برای مطالعه کامل یک لینک از نتایج جستجو استفاده کن.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'آدرس کامل صفحه (http/https)' },
        max_chars: { type: 'integer', description: 'حداکثر طول متن بازگشتی (اختیاری)' },
      },
      required: ['url'],
    },
  },
  run_js: {
    name: 'run_js',
    description:
      'اجرای جاوااسکریپت در سندباکس امن (بدون شبکه، بدون فایل، حداکثر ۵ ثانیه). برای محاسبه، پردازش متن/JSON و آزمایش منطق. با return یا console.log نتیجه را برگردان.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'کد جاوااسکریپت برای اجرا' },
      },
      required: ['code'],
    },
  },
  run_python: {
    name: 'run_python',
    description:
      'اجرای پایتون ۳ در سندباکس (stdin بسته، خروجی محدود، حداکثر ۱۰ ثانیه). برای محاسبات ریاضی، پردازش داده و الگوریتم‌ها. نتایج را با print چاپ کن.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'کد پایتون برای اجرا' },
      },
      required: ['code'],
    },
  },
  run_shell: {
    name: 'run_shell',
    description:
      'اجرای فرمان شل در پوشه کاری سندباکس‌شده (cwd = workspace). برای فرمان‌های سیستمی، git، بیلد و غیره. ⚠️ فرمان‌های مخرب (sudo، rm -rf، ...) مسدود هستند و اجرای هر فرمان ممکن است نیاز به تأیید کاربر داشته باشد.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'فرمان شل برای اجرا' },
        timeout_ms: { type: 'integer', description: 'مهلت اجرا به میلی‌ثانیه (پیش‌فرض ۳۰۰۰۰)' },
      },
      required: ['command'],
    },
  },
  read_file: {
    name: 'read_file',
    description: 'خواندن محتوای یک فایل متنی از پوشه کاری (workspace). مسیرها نسبی به ریشه پوشه کاری هستند.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'مسیر نسبی فایل، مثل src/app.ts' },
      },
      required: ['path'],
    },
  },
  write_file: {
    name: 'write_file',
    description: 'نوشتن (یا بازنویسی) یک فایل متنی در پوشه کاری. پوشه‌های والد خودکار ساخته می‌شوند.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'مسیر نسبی فایل' },
        content: { type: 'string', description: 'محتوای کامل فایل' },
      },
      required: ['path', 'content'],
    },
  },
  list_files: {
    name: 'list_files',
    description: 'فهرست فایل‌ها و پوشه‌های پوشه کاری به‌صورت بازگشتی.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'مسیر شروع (پیش‌فرض ریشه)' },
      },
    },
  },
  search_docs: {
    name: 'search_docs',
    description:
      'جستجوی معنایی-کلیدواژه‌ای (BM25) در اسنادی که کاربر بارگذاری کرده (PDF، مارک‌داون، متن). بهترین قطعات مرتبط را با نام سند برمی‌گرداند.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'پرسش یا عبارت برای جستجو در اسناد' },
        top_k: { type: 'integer', description: 'تعداد قطعات بازگشتی (پیش‌فرض ۵)' },
      },
      required: ['query'],
    },
  },
  remember: {
    name: 'remember',
    description:
      'ذخیره یک واقعیت یا ترجیح مهم درباره کاربر در حافظه بلندمدت. فقط اطلاعات پایدار و مفید را ذخیره کن (نه اطلاعات موقت).',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'واقعیت یا ترجیح برای ذخیره (به فارسی)' },
      },
      required: ['fact'],
    },
  },
};

/** IDs of tools that touch the real system and count as "sensitive". */
export const SENSITIVE_TOOLS: ReadonlySet<string> = new Set(['run_shell']);

/**
 * Check a shell command against the server blocklist mirror for
 * pre-flight UI warnings (the server re-checks authoritatively).
 */
const DANGEROUS_UI: RegExp[] = [
  /\bsudo\b/, /\brm\s+-[a-z]*r[a-z]*f/, /\bmkfs\b/, /\bdd\s+if=/,
  /\b(shutdown|reboot|halt|poweroff)\b/, /:\(\)\s*\{/, /\bcurl[^|]*\|\s*(ba)?sh/, /\bwget[^|]*\|\s*(ba)?sh/,
];

export function commandNeedsApproval(command: string, approveAllShell: boolean): boolean {
  if (approveAllShell) return true;
  return DANGEROUS_UI.some((re) => re.test(command));
}
