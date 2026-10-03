import { readSandboxIdentity } from '@/lib/sandbox/identity';
import { getSession, isSandboxEnabled } from '@/lib/sandbox/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Server-Sent Events stream of a sandbox terminal session.
 *
 * GET /api/sandbox/stream?session=<id>&from=<seq>
 *
 * Every message is a JSON encoded SequencedEvent:
 *   { seq, at, event: { type: 'output' | 'meta' | 'exit' | 'error', … } }
 * Clients can reconnect with `from` to replay everything they missed.
 */
export async function GET(request: Request) {
  if (!isSandboxEnabled()) {
    return new Response('sandbox disabled', { status: 503 });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');
  const from = Number.parseInt(url.searchParams.get('from') ?? '0', 10);

  if (!sessionId) {
    return new Response('session is required', { status: 400 });
  }

  const identity = await readSandboxIdentity();
  const session = getSession(sessionId, identity.ownerKey);

  if (!session) {
    return new Response('session not found', { status: 404 });
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          close();
        }
      };

      send(`retry: 1500\n\n`);

      unsubscribe = session.subscribe((sequenced) => {
        send(`data: ${JSON.stringify(sequenced)}\n\n`);
      }, Number.isFinite(from) ? from : 0);

      heartbeat = setInterval(() => {
        send(`: ping ${Date.now()}\n\n`);
        if (!session.isAlive && session.exited) {
          close();
        }
      }, 15_000);
      heartbeat.unref?.();

      request.signal.addEventListener('abort', close);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
