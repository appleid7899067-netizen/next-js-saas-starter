import { NextResponse } from 'next/server';
import { readSandboxIdentity } from '@/lib/sandbox/identity';
import { getSession, isSandboxEnabled } from '@/lib/sandbox/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ExecPayload = {
  sessionId?: string;
  /** Raw keyboard input (keystrokes, pasted text, control characters). */
  input?: string;
  /** A single command line; a newline is appended automatically. */
  command?: string;
  /** interrupt -> Ctrl+C, eof -> Ctrl+D */
  action?: 'interrupt' | 'eof';
};

const MAX_INPUT_LENGTH = 16_384;

export async function POST(request: Request) {
  if (!isSandboxEnabled()) {
    return NextResponse.json({ error: 'The sandbox is disabled.' }, { status: 503 });
  }

  let payload: ExecPayload;
  try {
    payload = (await request.json()) as ExecPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!payload.sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const identity = await readSandboxIdentity();
  const session = getSession(payload.sessionId, identity.ownerKey);

  if (!session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }

  let input = '';

  if (payload.action === 'interrupt') {
    input = '\u0003';
  } else if (payload.action === 'eof') {
    input = '\u0004';
  } else if (typeof payload.command === 'string') {
    input = `${payload.command}\n`;
  } else if (typeof payload.input === 'string') {
    input = payload.input;
  } else {
    return NextResponse.json({ error: 'input, command or action is required' }, { status: 400 });
  }

  if (input.length > MAX_INPUT_LENGTH) {
    return NextResponse.json({ error: 'Input is too large' }, { status: 413 });
  }

  try {
    session.write(input);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not write to the session' },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, alive: session.isAlive });
}
