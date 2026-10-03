import 'server-only';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/session';

export const SANDBOX_COOKIE = 'sandbox_id';

export type SandboxIdentity = {
  /** Stable key used to scope the sandbox workspace. */
  ownerKey: string;
  /** Starter app user id, when the visitor is signed in. */
  userId: number | null;
  /** Short, human friendly label shown in the UI. */
  label: string;
  /** Set when a brand new guest id was minted and must be stored in a cookie. */
  mintedGuestId?: string;
  signedIn: boolean;
};

const GUEST_ID_PATTERN = /^[a-f0-9-]{8,64}$/i;

/**
 * Sandbox identity resolution:
 *  1. the signed-in starter user, when there is one (`session` cookie), else
 *  2. an anonymous, httpOnly `sandbox_id` cookie minted on first use.
 */
export async function readSandboxIdentity(): Promise<SandboxIdentity> {
  const jar = await cookies();

  const sessionCookie = jar.get('session')?.value;
  if (sessionCookie) {
    try {
      const parsed = await verifyToken(sessionCookie);
      if (typeof parsed?.user?.id === 'number') {
        return {
          ownerKey: `user:${parsed.user.id}`,
          userId: parsed.user.id,
          label: `user-${parsed.user.id}`,
          signedIn: true
        };
      }
    } catch {
      // fall through to guest identity
    }
  }

  const existing = jar.get(SANDBOX_COOKIE)?.value;
  if (existing && GUEST_ID_PATTERN.test(existing)) {
    return {
      ownerKey: `guest:${existing}`,
      userId: null,
      label: `guest-${existing.slice(0, 8)}`,
      signedIn: false
    };
  }

  const guestId = crypto.randomUUID();
  return {
    ownerKey: `guest:${guestId}`,
    userId: null,
    label: `guest-${guestId.slice(0, 8)}`,
    mintedGuestId: guestId,
    signedIn: false
  };
}

export function sandboxCookieOptions() {
  return {
    name: SANDBOX_COOKIE,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  };
}
