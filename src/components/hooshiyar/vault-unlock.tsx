'use client';

/**
 * VaultUnlockDialog — passphrase entry for an encrypted key vault.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LockKeyhole, Loader2 } from 'lucide-react';
import { loadKeys } from '@/lib/vault';
import { useAppStore } from '@/components/hooshiyar/store';

export function VaultUnlockDialog() {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      const keys = await loadKeys(pass);
      useAppStore.getState().setKeys(keys);
      useAppStore.getState().setVaultState('unlocked');
    } catch (e: any) {
      setError(e?.message ?? 'رمز اشتباه است');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-sm" dir="rtl" showCloseButton={false} aria-describedby="vault-desc">
        <DialogHeader>
          <div className="mx-auto mb-1 grid size-12 place-items-center rounded-2xl bg-primary/10" aria-hidden>
            <LockKeyhole className="size-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-base">گنجینه قفل است</DialogTitle>
          <DialogDescription id="vault-desc" className="text-center text-xs">
            برای باز کردن کلیدهای رمزگذاری‌شده، رمز گنجینه را وارد کنید.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vault-pass" className="text-xs">رمز گنجینه</Label>
            <Input
              id="vault-pass"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && pass && unlock()}
              autoFocus
              autoComplete="current-password"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <Button onClick={unlock} disabled={busy || !pass} className="gap-2">
            {busy && <Loader2 className="size-4 animate-spin" />}
            باز کردن گنجینه
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
