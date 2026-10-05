'use client';

/**
 * SettingsDialog — tabs: کلیدها (BYOK vault), عمومی, امنیت, سرورهای MCP.
 * Keys are encrypted (AES-GCM) in localStorage via lib/vault.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, PlugZap, CheckCircle2, XCircle, Loader2, ShieldCheck, Eye, EyeOff, Server, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/components/hooshiyar/store';
import {
  saveKeys, updateKeys, wipeVault, maskKey, isPlainVault,
} from '@/lib/vault';
import { PROVIDERS, PROVIDER_ORDER, SUGGESTED_MODELS, providerName } from '@/lib/providers/registry';
import type { KeyEntry, McpServerRec, ProviderId } from '@/lib/types';
import { genId } from '@/lib/types';
import { faDateTime } from '@/lib/persian';
import { discoverMcpTools } from '@/lib/agent/executor';

export function SettingsDialog({ open }: { open: boolean }) {
  const close = () => useAppStore.getState().openDialog(null);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-2xl" dir="rtl">
        <Tabs defaultValue="keys" dir="rtl" className="flex max-h-[90vh] flex-col">
          <DialogHeader className="border-b border-border/60 px-6 py-4">
            <DialogTitle className="text-base">تنظیمات هوش‌یار</DialogTitle>
            <DialogDescription className="text-xs">کلیدها، رفتار عامل، امنیت و سرورهای MCP</DialogDescription>
            <TabsList className="mt-3 grid w-full grid-cols-4">
              <TabsTrigger value="keys" className="text-xs">🔑 کلیدها</TabsTrigger>
              <TabsTrigger value="general" className="text-xs">⚙️ عمومی</TabsTrigger>
              <TabsTrigger value="security" className="text-xs">🛡️ امنیت</TabsTrigger>
              <TabsTrigger value="mcp" className="text-xs">🔌 MCP</TabsTrigger>
            </TabsList>
          </DialogHeader>

          <ScrollArea className="min-h-0 flex-1">
            <TabsContent value="keys" className="m-0 p-5"><KeysTab /></TabsContent>
            <TabsContent value="general" className="m-0 p-5"><GeneralTab /></TabsContent>
            <TabsContent value="security" className="m-0 p-5"><SecurityTab /></TabsContent>
            <TabsContent value="mcp" className="m-0 p-5"><McpTab /></TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- keys ----------------------------------- */

function KeysTab() {
  const keys = useAppStore((s) => s.keys);
  const setKeys = useAppStore((s) => s.setKeys);
  const [editing, setEditing] = useState<KeyEntry | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-emerald-600/25 bg-emerald-500/5 p-3 text-xs leading-6 text-emerald-800 dark:text-emerald-300">
        🔐 کلیدهای API فقط در مرورگر شما ذخیره می‌شوند {isPlainVault() ? '(بدون رمز — برای رمزگذاری کامل، در تب امنیت رمز گنجینه تعیین کنید)' : 'و با رمز گنجینه رمزگذاری شده‌اند'}.
        هنگام گفتگو، کلید فقط برای فراخوانی ارائه‌دهنده استفاده می‌شود و روی سرور ذخیره نمی‌گردد.
      </div>

      {!adding && !editing && (
        <Button onClick={() => setAdding(true)} className="w-fit gap-1.5" size="sm">
          <Plus className="size-4" /> افزودن کلید جدید
        </Button>
      )}

      {(adding || editing) && (
        <KeyForm
          initial={editing}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSave={async (entry) => {
            const next = await updateKeys((list) => {
              const idx = list.findIndex((k) => k.id === entry.id);
              if (idx >= 0) {
                const copy = [...list];
                copy[idx] = entry;
                return copy;
              }
              return [...list, entry];
            });
            setKeys(next);
            setAdding(false);
            setEditing(null);
            toast.success('کلید ذخیره شد');
          }}
        />
      )}

      <div className="flex flex-col gap-2">
        {keys.length === 0 && !adding && (
          <p className="py-4 text-center text-sm text-muted-foreground">هنوز کلیدی اضافه نشده است.</p>
        )}
        {keys.map((k) => (
          <KeyCard
            key={k.id}
            entry={k}
            onEdit={() => setEditing(k)}
            onDelete={async () => {
              const next = await updateKeys((list) => list.filter((x) => x.id !== k.id));
              setKeys(next);
              toast.success('کلید حذف شد');
            }}
          />
        ))}
      </div>
    </div>
  );
}

function KeyCard({ entry, onEdit, onDelete }: { entry: KeyEntry; onEdit: () => void; onDelete: () => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showKey, setShowKey] = useState(false);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: entry.provider, baseUrl: entry.baseUrl, apiKey: entry.apiKey, model: entry.model }),
      });
      const json = await res.json();
      setResult(json);
      const next = await updateKeys((list) =>
        list.map((k) => (k.id === entry.id ? { ...k, lastTestOk: json.ok, lastTestAt: Date.now() } : k)),
      );
      useAppStore.getState().setKeys(next);
    } catch (e: any) {
      setResult({ ok: false, message: e?.message ?? 'خطای شبکه' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="shrink-0">{providerName(entry.provider)}</Badge>
        <span className="text-sm font-semibold">{entry.label}</span>
        {entry.lastTestOk === true && <CheckCircle2 className="size-4 text-emerald-600" aria-label="تست موفق" />}
        {entry.lastTestOk === false && <XCircle className="size-4 text-destructive" aria-label="تست ناموفق" />}
        <div className="ms-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={test} disabled={testing}>
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />} تست
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={onEdit} aria-label="ویرایش کلید">
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={onDelete} aria-label="حذف کلید">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" dir="ltr">
        <span className="inline-flex items-center gap-1 font-mono">
          {showKey ? entry.apiKey : maskKey(entry.apiKey)}
          <button onClick={() => setShowKey((v) => !v)} className="p-0.5 hover:text-foreground" aria-label={showKey ? 'پنهان کردن کلید' : 'نمایش کلید'}>
            {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          </button>
        </span>
        {entry.baseUrl && <span className="font-mono text-[10px]">{entry.baseUrl}</span>}
        <span dir="rtl">مدل: {entry.model || '—'}</span>
      </div>
      {result && (
        <p className={`mt-2 rounded-lg px-2.5 py-1.5 text-xs ${result.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}

function KeyForm({
  initial, onSave, onCancel,
}: {
  initial: KeyEntry | null;
  onSave: (entry: KeyEntry) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [provider, setProvider] = useState<ProviderId>(initial?.provider ?? 'openai');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [manualModel, setManualModel] = useState(false);
  const isDemo = provider === 'hooshiyar-demo';

  const info = PROVIDERS[provider];
  const suggestions = SUGGESTED_MODELS[provider] ?? [];

  useEffect(() => {
    if (!initial) {
      setBaseUrl(info.supportsBaseUrl ? info.defaultBaseUrl : info.defaultBaseUrl);
    }
  }, [provider, info, initial]);

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const res = await fetch('/api/providers/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, baseUrl: baseUrl || info.defaultBaseUrl, apiKey }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setModels(json.models ?? []);
      setManualModel(false);
      // Preselect the first model so «ذخیره کلید» works immediately.
      if (json.models?.length && !model.trim()) setModel(json.models[0]);
      toast.success(`${json.models?.length ?? 0} مدل یافت شد`);
    } catch (e: any) {
      toast.error(`دریافت مدل‌ها ناموفق: ${e?.message ?? e}`);
    } finally {
      setLoadingModels(false);
    }
  };

  /** Auto-discover a model when the user left the field empty. */
  const autoDiscoverModel = async (): Promise<string> => {
    if (isDemo) return 'glm-4-flash';
    try {
      const res = await fetch('/api/providers/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, baseUrl: baseUrl || info.defaultBaseUrl, apiKey }),
      });
      const json = await res.json();
      if (!json.error && Array.isArray(json.models) && json.models.length > 0) {
        setModels(json.models);
        setManualModel(false);
        return json.models[0];
      }
    } catch {
      /* fall through to manual validation */
    }
    return '';
  };

  const save = async () => {
    if (!label.trim()) {
      toast.error('برچسب کلید را وارد کنید.');
      return;
    }
    if (!info.keyOptional && !apiKey.trim()) {
      toast.error('کلید API را وارد کنید.');
      return;
    }
    let finalModel = model.trim();
    if (!finalModel && !isDemo) {
      // The user doesn't have to know the model name — ask the provider itself.
      toast.info('نام مدل خالی است؛ در حال دریافت از ارائه‌دهنده…');
      finalModel = await autoDiscoverModel();
      if (finalModel) {
        setModel(finalModel);
        toast.success(`مدل «${finalModel}» به‌طور خودکار انتخاب شد.`);
      }
    }
    if (isDemo && !finalModel) finalModel = 'glm-4-flash';
    if (!finalModel) {
      toast.error('نام مدل را وارد کنید، یا دکمهٔ «دریافت فهرست مدل‌ها» را بزنید تا یکی انتخاب شود.');
      return;
    }
    const entry: KeyEntry = {
      id: initial?.id ?? genId('key_'),
      provider,
      label: label.trim(),
      baseUrl: (baseUrl || info.defaultBaseUrl).trim(),
      apiKey: apiKey.trim(),
      model: finalModel,
      createdAt: initial?.createdAt ?? Date.now(),
      lastTestAt: initial?.lastTestAt,
      lastTestOk: initial?.lastTestOk,
    };
    await onSave(entry);
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/30 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">ارائه‌دهنده</Label>
          <Select
            value={provider}
            onValueChange={(v) => {
              setProvider(v as ProviderId);
              setModel('');
              setModels([]);
            }}
          >
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROVIDER_ORDER.map((id) => (
                <SelectItem key={id} value={id}>{PROVIDERS[id].name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">برچسب (مثلاً «کلید اصلی»)</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="کلید اصلی من" className="h-9 text-sm" />
        </div>
      </div>

      {provider !== 'hooshiyar-demo' && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">کلید API {info.keyOptional && '(اختیاری)'}</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={info.keyHint}
            className="h-9 font-mono text-sm"
            dir="ltr"
            autoComplete="off"
          />
          {info.docsUrl && (
            <a href={info.docsUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary underline underline-offset-4">
              دریافت کلید از {providerName(provider)}
            </a>
          )}
        </div>
      )}

      {info.supportsBaseUrl && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">آدرس پایه (Base URL)</Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} dir="ltr" className="h-9 font-mono text-xs" placeholder={info.defaultBaseUrl} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">نام مدل</Label>
          {provider !== 'hooshiyar-demo' && (
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={fetchModels} disabled={loadingModels}>
              {loadingModels ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} دریافت فهرست مدل‌ها
            </Button>
          )}
        </div>
        {models.length > 0 && !manualModel ? (
          <div className="flex gap-1.5">
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-9 flex-1 text-sm"><SelectValue placeholder="انتخاب مدل" /></SelectTrigger>
              <SelectContent className="max-h-60">
                {models.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs font-mono">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" className="h-9 shrink-0 text-[11px]" onClick={() => setManualModel(true)}>
              ورود دستی
            </Button>
          </div>
        ) : (
          <>
            {models.length > 0 && (
              <Button variant="ghost" size="sm" className="h-6 w-fit gap-1 px-2 text-[11px]" onClick={() => setManualModel(false)}>
                بازگشت به فهرست مدل‌ها ({models.length})
              </Button>
            )}
            <Input value={model} onChange={(e) => setModel(e.target.value)} dir="ltr" className="h-9 font-mono text-sm" placeholder="نام مدل — مثلاً gpt-4o-mini" />
            {!isDemo && (
              <p className="text-[10px] leading-5 text-muted-foreground">
                نمی‌دانید چه مدلی؟ «دریافت فهرست مدل‌ها» فهرست را مستقیم از سرویس می‌گیرد و مدل مناسب را انتخاب می‌کند.
              </p>
            )}
            {/* Suggested models are only meaningful for the provider's real endpoint. */}
            {suggestions.length > 0 && (baseUrl || '').trim().replace(/\/+$/, '') === info.defaultBaseUrl.replace(/\/+$/, '') && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModel(m)}
                    className="rounded-full border border-border/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>انصراف</Button>
        <Button size="sm" onClick={save}>ذخیره کلید</Button>
      </div>
    </div>
  );
}

/* --------------------------------- general --------------------------------- */

function GeneralTab() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">دما (خلاقیت)</Label>
          <span className="font-mono text-xs text-muted-foreground">{settings.temperature.toFixed(1)}</span>
        </div>
        <Slider
          value={[settings.temperature]}
          min={0}
          max={2}
          step={0.1}
          onValueChange={([v]) => updateSettings({ temperature: v })}
          aria-label="دما"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">حداکثر توکن پاسخ</Label>
          <span className="font-mono text-xs text-muted-foreground">{settings.maxTokens}</span>
        </div>
        <Slider
          value={[settings.maxTokens]}
          min={256}
          max={16384}
          step={256}
          onValueChange={([v]) => updateSettings({ maxTokens: v })}
          aria-label="حداکثر توکن"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">حداکثر گام‌های عامل</Label>
          <span className="font-mono text-xs text-muted-foreground">{settings.maxSteps}</span>
        </div>
        <Slider
          value={[settings.maxSteps]}
          min={2}
          max={30}
          step={1}
          onValueChange={([v]) => updateSettings({ maxSteps: v })}
          aria-label="حداکثر گام‌ها"
        />
        <p className="text-[11px] text-muted-foreground">هر گام = یک دور «پاسخ مدل + اجرای ابزار» در حلقه عامل.</p>
      </div>

      <Separator />

      <label className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">تأیید انسانی برای همه فرمان‌های شل</div>
          <div className="text-[11px] text-muted-foreground">در غیر این صورت فقط فرمان‌های پرخطر تأیید می‌خواهند</div>
        </div>
        <Switch checked={settings.approveAllShell} onCheckedChange={(v) => updateSettings({ approveAllShell: v })} />
      </label>

      <label className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">چرخش بین کلیدهای هم‌ارائه‌دهنده</div>
          <div className="text-[11px] text-muted-foreground">توزیع بار خودکار میان چند کلید (نقشه راه)</div>
        </div>
        <Switch checked={settings.keyRotation} onCheckedChange={(v) => updateSettings({ keyRotation: v })} disabled />
      </label>
    </div>
  );
}

/* --------------------------------- security -------------------------------- */

function SecurityTab() {
  const setKeys = useAppStore((s) => s.setKeys);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const plain = useMemo(() => (typeof window !== 'undefined' ? isPlainVault() : false), []);

  const setPassphrase = async () => {
    if (pass.length < 4) {
      toast.error('رمز حداقل ۴ نویسه باشد.');
      return;
    }
    setBusy(true);
    try {
      await saveKeys(useAppStore.getState().keys, pass);
      toast.success('گنجینه با رمز جدید رمزگذاری شد 🎉');
      setPass('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-xs leading-6">
        <p className="mb-1 flex items-center gap-1.5 font-semibold"><ShieldCheck className="size-4 text-primary" /> مدل امنیتی هوش‌یار</p>
        <ul className="list-disc space-y-1 ps-4 text-muted-foreground">
          <li>کلیدها با AES-GCM (کلید مشتق‌شده با PBKDF2-SHA256، ۲۵۰ هزار تکرار) در localStorage رمزگذاری می‌شوند.</li>
          <li>کلید هرگز به سرور ذخیره‌سازی نمی‌رسد؛ فقط در لحظه فراخوانی ارائه‌دهنده استفاده می‌شود.</li>
          <li>فرمان‌های شل نیازمند تأیید انسانی هستند و الگوهای مخرب در سرور مسدودند.</li>
          <li>گزارش حسابرسی در پنل عامل اقدامات ابزار را ثبت می‌کند.</li>
        </ul>
      </div>

      {plain && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-600/30 bg-amber-500/5 p-3">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">گنجینه بدون رمز است — برای امنیت بیشتر رمز تعیین کنید:</p>
          <div className="flex gap-2">
            <Input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="رمز گنجینه (حداقل ۴ نویسه)"
              className="h-9 text-sm"
              autoComplete="new-password"
            />
            <Button size="sm" onClick={setPassphrase} disabled={busy}>رمزگذاری</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-destructive">منطقه خطر</p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="w-fit gap-1.5">
              <Trash2 className="size-4" /> پاک‌سازی کامل داده‌ها و گنجینه
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>همه چیز حذف شود؟</AlertDialogTitle>
              <AlertDialogDescription>
                همه گفتگوها، پیام‌ها، اسناد، حافظه‌ها و کلیدهای API از این مرورگر حذف می‌شوند و قابل بازگشت نیستند.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>انصراف</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => {
                  wipeVault();
                  import('@/lib/idb').then((m) => m.wipeAllData());
                  setKeys([]);
                  toast.success('همه داده‌ها پاک شد. صفحه تازه‌سازی می‌شود…');
                  setTimeout(() => window.location.reload(), 1200);
                }}
              >
                بله، همه‌چیز را حذف کن
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

/* ----------------------------------- mcp ----------------------------------- */

function McpTab() {
  const mcpServers = useAppStore((s) => s.mcpServers);
  const setMcpServers = useAppStore((s) => s.setMcpServers);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [checking, setChecking] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim() || !url.trim()) {
      toast.error('نام و آدرس سرور MCP را وارد کنید.');
      return;
    }
    const server: McpServerRec = {
      id: genId('mcp_'),
      name: name.trim(),
      url: url.trim(),
      enabled: true,
      tools: [],
    };
    const next = [...mcpServers, server];
    setMcpServers(next);
    await import('@/lib/idb').then((m) => m.setSetting('mcpServers', next));
    setName('');
    setUrl('');
    toast.success('سرور MCP اضافه شد');
  };

  const check = async (server: McpServerRec) => {
    setChecking(server.id);
    try {
      const map = await discoverMcpTools([server]);
      const tools = map.get(server.id) ?? [];
      const next = mcpServers.map((s) =>
        s.id === server.id ? { ...s, tools, lastOk: tools.length > 0 || true, lastCheckedAt: Date.now() } : s,
      );
      setMcpServers(next);
      await import('@/lib/idb').then((m) => m.setSetting('mcpServers', next));
      toast.success(`اتصال موفق — ${tools.length} ابزار کشف شد`);
    } catch (e: any) {
      toast.error(`اتصال ناموفق: ${e?.message ?? e}`);
    } finally {
      setChecking(null);
    }
  };

  const remove = async (server: McpServerRec) => {
    const next = mcpServers.filter((s) => s.id !== server.id);
    setMcpServers(next);
    await import('@/lib/idb').then((m) => m.setSetting('mcpServers', next));
  };

  const toggle = async (server: McpServerRec) => {
    const next = mcpServers.map((s) => (s.id === server.id ? { ...s, enabled: !s.enabled } : s));
    setMcpServers(next);
    await import('@/lib/idb').then((m) => m.setSetting('mcpServers', next));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-xs leading-6 text-muted-foreground">
        سرورهای MCP (Model Context Protocol) با انتقال Streamable HTTP پشتیبانی می‌شوند. ابزارهای هر سرور به‌صورت
        <code className="mx-1 rounded bg-muted px-1 font-mono text-[10px]">mcp__سرور__ابزار</code>
        به عامل اضافه می‌شوند.
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border/70 p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام سرور (مثلاً ابزارهای من)" className="h-9 text-sm" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" dir="ltr" className="h-9 font-mono text-xs" />
        </div>
        <Button size="sm" className="w-fit gap-1.5" onClick={add}>
          <Server className="size-4" /> افزودن سرور MCP
        </Button>
      </div>

      {mcpServers.map((s) => (
        <div key={s.id} className="rounded-xl border border-border/70 bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{s.name}</span>
            <Badge variant={s.enabled ? 'default' : 'secondary'}>{s.enabled ? 'فعال' : 'غیرفعال'}</Badge>
            <div className="ms-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => check(s)} disabled={checking === s.id}>
                {checking === s.id ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} بررسی
              </Button>
              <Switch checked={s.enabled} onCheckedChange={() => toggle(s)} />
              <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => remove(s)} aria-label="حذف سرور">
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground" dir="ltr">{s.url}</div>
          {s.tools.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {s.tools.map((t) => (
                <Badge key={t.name} variant="outline" className="font-mono text-[10px]">{t.name}</Badge>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
