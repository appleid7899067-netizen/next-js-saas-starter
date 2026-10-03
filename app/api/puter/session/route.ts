import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  clearPuterSession,
  getPuterSession,
  setPuterSession,
  setSession
} from '@/lib/auth/session';
import { findOrCreateUserForPuter } from '@/lib/db/puter-account';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const puterSessionSchema = z.object({
  username: z.string().min(1).max(128),
  uuid: z.string().min(1).max(128),
  email: z.string().email().max(255).nullish()
});

export type AccountPayload = {
  userId: number;
  teamId: number;
  name: string | null;
  email: string;
  created: boolean;
  linked: boolean;
};

async function currentAccount(): Promise<AccountPayload | null> {
  const puter = await getPuterSession();
  if (!puter) return null;

  try {
    const result = await findOrCreateUserForPuter({
      username: puter.username,
      uuid: puter.uuid,
      email: puter.email ?? null
    });

    return {
      userId: result.user.id,
      teamId: result.teamId,
      name: result.user.name,
      email: result.user.email,
      created: false,
      linked: false
    };
  } catch (error) {
    console.error('[puter] could not resolve the local account:', error);
    return null;
  }
}

export async function GET() {
  const puter = await getPuterSession();
  return NextResponse.json({
    connected: Boolean(puter),
    puter,
    account: await currentAccount()
  });
}

/**
 * Called right after `puter.auth.signIn()` resolves in the browser.
 *
 * One click does everything: it records the Puter identity, creates (or finds)
 * the matching local account with its own team, and issues the app's session
 * cookie so the whole dashboard works without any sign-up form.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = puterSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Invalid Puter identity' },
      { status: 400 }
    );
  }

  const identity = {
    username: parsed.data.username,
    uuid: parsed.data.uuid,
    email: parsed.data.email ?? null
  };

  await setPuterSession(identity);
  const puter = await getPuterSession();

  // Provisioning must not block the Puter features: if the database is
  // unavailable we still keep the Puter session and report a warning.
  let account: AccountPayload | null = null;
  let warning: string | null = null;

  try {
    const result = await findOrCreateUserForPuter(identity);

    // The starter's own session cookie: dashboard, middleware, server actions
    // and the sandbox identity all key off this.
    await setSession(result.user);

    account = {
      userId: result.user.id,
      teamId: result.teamId,
      name: result.user.name,
      email: result.user.email,
      created: result.created,
      linked: result.linked
    };
  } catch (error) {
    warning =
      error instanceof Error
        ? `สร้างบัญชีในแอปไม่สำเร็จ: ${error.message}`
        : 'สร้างบัญชีในแอปไม่สำเร็จ';
    console.error('[puter] provisioning failed:', error);
  }

  return NextResponse.json({
    connected: true,
    puter,
    account,
    warning
  });
}

/** Signs out of both the Puter session and the local account session. */
export async function DELETE() {
  await clearPuterSession();

  const response = NextResponse.json({ connected: false, puter: null, account: null });
  response.cookies.delete('session');
  return response;
}
