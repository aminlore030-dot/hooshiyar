'use client';

/**
 * OnboardingDialog — first-run wizard: quick demo start OR add your own key.
 * The demo engine only exists on the original host; elsewhere (Vercel, Docker,
 * self-host) /api/demo-status reports unavailable and the demo card is disabled
 * with a clear Persian note, so a fresh deployment never fails mid-chat.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, KeyRound, ShieldCheck } from 'lucide-react';
import { useAppStore } from '@/components/hooshiyar/store';
import { updateKeys } from '@/lib/vault';
import { createChat } from '@/components/hooshiyar/use-chat-session';
import { genId } from '@/lib/types';
import { toast } from 'sonner';

export function OnboardingDialog() {
  const vaultState = useAppStore((s) => s.vaultState);
  const dialog = useAppStore((s) => s.dialog);
  const openDialog = useAppStore((s) => s.openDialog);
  const keys = useAppStore((s) => s.keys);
  const [demoAvailable, setDemoAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (vaultState !== 'empty' || dialog !== null) return;
    let alive = true;
    fetch('/api/demo-status')
      .then((r) => r.json())
      .then((j) => alive && setDemoAvailable(Boolean(j?.available)))
      .catch(() => alive && setDemoAvailable(false));
    return () => {
      alive = false;
    };
  }, [vaultState, dialog]);

  const visible = vaultState === 'empty' && dialog === null;
  if (!visible) return null;

  const startDemo = async () => {
    const hasDemo = keys.some((k) => k.provider === 'hooshiyar-demo');
    if (!hasDemo) {
      const next = await updateKeys((list) => [
        ...list,
        {
          id: genId('key_'),
          provider: 'hooshiyar-demo',
          label: 'ارائه‌دهنده دموی داخلی',
          baseUrl: '',
          apiKey: '',
          model: 'glm-4-flash',
          createdAt: Date.now(),
        },
      ]);
      useAppStore.getState().setKeys(next);
    }
    const chatId = await createChat({ keyId: null, profileId: 'hermes' });
    useAppStore.getState().setActiveChatId(chatId);
    toast.success('همه‌چیز آماده است! با دموی داخلی شروع کنید.');
  };

  const goAddKey = () => {
    openDialog('settings-keys');
  };

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-lg" dir="rtl" showCloseButton={false} aria-describedby="onboard-desc">
        <DialogHeader>
          <div className="mx-auto mb-2 grid size-14 place-items-center rounded-2xl bg-primary/10 text-3xl" aria-hidden>🪶</div>
          <DialogTitle className="text-center text-lg">به هوش‌یار خوش آمدید</DialogTitle>
          <DialogDescription id="onboard-desc" className="text-center text-xs leading-6">
            ایستگاه کاری هوش مصنوعی شخصی شما. کلیدهای API خودتان را وارد کنید — همه‌چیز محلی و در مرورگر شما می‌ماند.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <button
            onClick={goAddKey}
            className="flex items-start gap-3 rounded-xl border border-border/70 bg-card p-4 text-start transition-colors hover:border-primary/50 hover:bg-accent/30"
          >
            <KeyRound className="mt-0.5 size-5 text-primary" aria-hidden />
            <span>
              <span className="block text-sm font-bold">استفاده از کلیدهای خودم</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                OpenAI، Claude، Gemini، OpenRouter، Groq، DeepSeek، Mistral، Together، Fireworks، Ollama، LM Studio یا هر نقطه پایانی سازگار با OpenAI
              </span>
            </span>
          </button>

          <button
            onClick={startDemo}
            disabled={demoAvailable === false}
            className={`flex items-start gap-3 rounded-xl border border-border/70 bg-card p-4 text-start transition-colors hover:border-primary/50 hover:bg-accent/30 ${demoAvailable === false ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            <Sparkles className="mt-0.5 size-5 text-amber-500" aria-hidden />
            <span>
              <span className="block text-sm font-bold">شروع سریع با ارائه‌دهنده دمو</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {demoAvailable === false
                  ? '⚠️ موتور دمو روی این سرور فعال نیست — با دکمهٔ بالا و کلید خودتان شروع کنید (BYOK)'
                  : 'بدون کلید — از موتور دموی میزبان استفاده کنید و همه امکانات (ابزارها، عامل، تیم) را ببینید'}
              </span>
            </span>
          </button>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-center text-[10px] text-muted-foreground">
          <ShieldCheck className="size-3.5 text-primary" aria-hidden />
          کلیدها با AES-GCM رمزگذاری و فقط در مرورگر شما ذخیره می‌شوند
        </p>
      </DialogContent>
    </Dialog>
  );
}
