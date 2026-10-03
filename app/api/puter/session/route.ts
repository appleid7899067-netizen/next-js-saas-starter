import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  clearPuterSession,
  getPuterSession,
  setPuterSession
} from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const puterSessionSchema = z.object({
  username: z.string().min(1).max(128),
  uuid: z.string().min(1).max(128),
  email: z.string().email().max(255).nullish()
});

export async function GET() {
  const puter = await getPuterSession();
  return NextResponse.json({ connected: Boolean(puter), puter });
}

/** Called right after puter.auth.signIn() succeeds in the browser. */
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

  await setPuterSession({
    username: parsed.data.username,
    uuid: parsed.data.uuid,
    email: parsed.data.email ?? null
  });

  return NextResponse.json({ connected: true, puter: await getPuterSession() });
}

export async function DELETE() {
  await clearPuterSession();
  return NextResponse.json({ connected: false, puter: null });
}
