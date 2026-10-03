'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { describeError, isPuterSignedIn, loadPuter } from '@/lib/puter/client';

/**
 * One-click Puter sign-in.
 *
 * `puter.auth.signIn()` opens the Puter popup (it has to be triggered from a
 * click), then the identity is sent to /api/puter/session which creates or
 * finds the matching local account — user, team and session cookie — so there
 * is nothing else to fill in.
 */
export function PuterSignInButton({
  redirectTo = '/dashboard',
  label = 'ล็อกอินด้วย Puter',
  variant = 'default',
  size = 'lg',
  className,
  onSignedIn
}: {
  redirectTo?: string | null;
  label?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  onSignedIn?: (account: unknown) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setPending(true);
    setError(null);

    try {
      const puter = await loadPuter();

      if (!(await isPuterSignedIn(puter))) {
        await puter.auth.signIn();
      }

      const user = await puter.auth.getUser().catch(() => null);
      if (!user?.username) {
        throw new Error('ล็อกอิน Puter สำเร็จ แต่ไม่สามารถอ่านข้อมูลบัญชีได้');
      }

      const response = await fetch('/api/puter/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user.username,
          uuid: String(user.uuid ?? user.username),
          email: user.email ?? null
        })
      });

      const payload = (await response.json()) as {
        account?: unknown;
        warning?: string | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? 'สร้างเซสชันไม่สำเร็จ');
      }

      onSignedIn?.(payload.account);
      router.refresh();

      if (redirectTo) {
        router.push(redirectTo);
      }

      if (payload.warning) {
        setError(payload.warning);
      }
    } catch (signInError) {
      setError(describeError(signInError));
    } finally {
      setPending(false);
    }
  }, [onSignedIn, redirectTo, router]);

  return (
    <div className={className}>
      <Button onClick={() => void handleClick()} disabled={pending} variant={variant} size={size} className="w-full">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {label}
        {!pending ? <ArrowRight className="h-4 w-4" /> : null}
      </Button>
      {error ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{error}</span>
        </p>
      ) : null}
    </div>
  );
}
