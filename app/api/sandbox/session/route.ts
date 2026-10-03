import { NextResponse } from 'next/server';
import { readSandboxIdentity, sandboxCookieOptions } from '@/lib/sandbox/identity';
import {
  destroySession,
  getOrCreateSession,
  isSandboxEnabled,
  sandboxLimits
} from '@/lib/sandbox/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!isSandboxEnabled()) {
    return NextResponse.json(
      { error: 'The sandbox is disabled on this deployment.' },
      { status: 503 }
    );
  }

  const identity = await readSandboxIdentity();
  const session = getOrCreateSession(identity.ownerKey);

  const response = NextResponse.json({
    sessionId: session.id,
    owner: identity.label,
    signedIn: identity.signedIn,
    cwd: session.cwd,
    shell: session.shellPath,
    pty: session.pty,
    createdAt: session.createdAt,
    limits: {
      idleTimeoutMs: sandboxLimits.idleTimeoutMs,
      maxSessions: sandboxLimits.maxSessions
    }
  });

  if (identity.mintedGuestId) {
    response.cookies.set({ ...sandboxCookieOptions(), value: identity.mintedGuestId });
  }

  return response;
}

export async function DELETE(request: Request) {
  const identity = await readSandboxIdentity();
  const sessionId = new URL(request.url).searchParams.get('session');

  if (!sessionId) {
    return NextResponse.json({ error: 'session is required' }, { status: 400 });
  }

  const destroyed = destroySession(sessionId, identity.ownerKey);
  return NextResponse.json({ destroyed });
}
