import { NextResponse } from 'next/server';
import { readSandboxIdentity } from '@/lib/sandbox/identity';
import { getSession } from '@/lib/sandbox/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Polling fallback for environments where SSE is buffered by a proxy.
 *
 * GET /api/sandbox/output?session=<id>&from=<seq>
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');
  const from = Number.parseInt(url.searchParams.get('from') ?? '0', 10);

  if (!sessionId) {
    return NextResponse.json({ error: 'session is required' }, { status: 400 });
  }

  const identity = await readSandboxIdentity();
  const session = getSession(sessionId, identity.ownerKey);

  if (!session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }

  const events = session.eventsSince(Number.isFinite(from) ? from : 0);
  const next = events.length > 0 ? events[events.length - 1].seq : from;

  return NextResponse.json({ events, next, alive: session.isAlive, exited: session.exited });
}
