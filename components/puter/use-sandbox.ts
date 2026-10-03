'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { stripAnsi } from '@/lib/sandbox/ansi';

export type SandboxMeta = {
  sessionId: string;
  owner: string;
  signedIn: boolean;
  cwd: string;
  shell: string;
  pty: boolean;
  createdAt: number;
};

export type SandboxState =
  | 'idle'
  | 'starting'
  | 'live'
  | 'reconnecting'
  | 'polling'
  | 'ended'
  | 'error'
  | 'disabled';

type SequencedEvent = {
  seq: number;
  at: number;
  event:
    | { type: 'output'; data: string }
    | { type: 'meta'; sessionId: string; cwd: string; shell: string; pty: boolean; createdAt: number }
    | { type: 'exit'; code: number | null; signal: string | null }
    | { type: 'error'; message: string };
};

const MAX_BUFFER_CHARS = 240_000;
const LOCAL_PROMPT = '\u001b[38;5;114m➜\u001b[0m ';

export function useSandbox() {
  const [meta, setMeta] = useState<SandboxMeta | null>(null);
  const [state, setState] = useState<SandboxState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState<string[]>([]);

  const outputRef = useRef('');
  const seqRef = useRef(0);
  const metaRef = useRef<SandboxMeta | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const retryRef = useRef(0);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const renderQueued = useRef(false);

  const scheduleRender = useCallback(() => {
    if (renderQueued.current) return;
    renderQueued.current = true;

    const flush = () => {
      renderQueued.current = false;
      if (mountedRef.current) setVersion((value) => value + 1);
    };

    if (typeof window === 'undefined') {
      flush();
      return;
    }

    window.setTimeout(flush, 60);
  }, []);

  const appendOutput = useCallback(
    (data: string) => {
      let next = outputRef.current + data;
      if (next.length > MAX_BUFFER_CHARS) {
        next = next.slice(next.length - MAX_BUFFER_CHARS);
      }
      outputRef.current = next;
      scheduleRender();
    },
    [scheduleRender]
  );

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (sessionId: string) => {
      setState('polling');
      stopPolling();

      pollTimerRef.current = window.setInterval(async () => {
        try {
          const response = await fetch(
            `/api/sandbox/output?session=${encodeURIComponent(sessionId)}&from=${seqRef.current}`,
            { cache: 'no-store' }
          );

          if (!response.ok) {
            if (response.status === 404) {
              stopPolling();
              setState('ended');
            }
            return;
          }

          const payload = (await response.json()) as {
            events: SequencedEvent[];
            alive: boolean;
            exited: boolean;
          };

          for (const entry of payload.events) {
            applyEvent(entry);
          }

          if (payload.exited && payload.events.length === 0 && !payload.alive) {
            // shell already gone; nothing left to stream
          }
        } catch {
          // keep polling; transient network errors are expected
        }
      }, 800);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopPolling]
  );

  const applyEvent = useCallback(
    (entry: SequencedEvent) => {
      if (!entry || typeof entry.seq !== 'number' || entry.seq <= seqRef.current) return;
      seqRef.current = entry.seq;

      if (entry.event.type === 'output') {
        appendOutput(entry.event.data);
      } else if (entry.event.type === 'exit') {
        const code = entry.event.code;
        appendOutput(
          `\r\n\u001b[38;5;203m■ session ended\u001b[0m${code === null ? '' : ` (exit code ${code})`}\r\n`
        );
        setState('ended');
        stopPolling();
      } else if (entry.event.type === 'error') {
        appendOutput(`\r\n\u001b[38;5;203m${entry.event.message}\u001b[0m\r\n`);
        setError(entry.event.message);
      }
    },
    [appendOutput, stopPolling]
  );

  const openStream = useCallback(
    async (sessionId: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(
          `/api/sandbox/stream?session=${encodeURIComponent(sessionId)}&from=${seqRef.current}`,
          { signal: controller.signal, headers: { Accept: 'text/event-stream' }, cache: 'no-store' }
        );

        if (!response.ok || !response.body) {
          throw new Error(`stream failed (${response.status})`);
        }

        retryRef.current = 0;
        stopPolling();
        setState('live');
        setError(null);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const raw = line.slice(5).trim();
              if (!raw) continue;
              try {
                applyEvent(JSON.parse(raw) as SequencedEvent);
              } catch {
                // ignore malformed frames
              }
            }
          }
        }

        if (!controller.signal.aborted && mountedRef.current) {
          throw new Error('stream closed');
        }
      } catch (streamError) {
        if (controller.signal.aborted || !mountedRef.current) return;

        const attempt = retryRef.current;
        retryRef.current = attempt + 1;

        if (attempt < 2) {
          setState('reconnecting');
          window.setTimeout(() => {
            if (mountedRef.current && metaRef.current) {
              void openStream(metaRef.current.sessionId);
            }
          }, 600 * (attempt + 1));
        } else {
          console.warn('[sandbox] falling back to polling', streamError);
          startPolling(sessionId);
        }
      }
    },
    [applyEvent, startPolling, stopPolling]
  );

  const start = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setState('starting');
    setError(null);

    try {
      const response = await fetch('/api/sandbox/session', { method: 'POST' });
      const payload = (await response.json()) as SandboxMeta & { error?: string };

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? `could not start a sandbox (${response.status})`);
      }

      if (!mountedRef.current) return;

      metaRef.current = payload;
      setMeta(payload);
      scheduleRender();

      await openStream(payload.sessionId);
    } catch (startError) {
      if (mountedRef.current) {
        setState('error');
        setError(startError instanceof Error ? startError.message : String(startError));
      }
    } finally {
      startingRef.current = false;
    }
  }, [openStream, scheduleRender]);

  const restart = useCallback(async () => {
    const current = metaRef.current;
    abortRef.current?.abort();
    stopPolling();

    if (current) {
      await fetch(`/api/sandbox/session?session=${encodeURIComponent(current.sessionId)}`, {
        method: 'DELETE'
      }).catch(() => undefined);
    }

    metaRef.current = null;
    seqRef.current = 0;
    outputRef.current = '';
    setMeta(null);
    setState('idle');
    setVersion((value) => value + 1);
    await start();
  }, [start, stopPolling]);

  const send = useCallback(
    async (command: string) => {
      const current = metaRef.current;
      if (!current) return;

      appendOutput(`${LOCAL_PROMPT}${command}\r\n`);
      setHistory((entries) => [...entries.filter((entry) => entry !== command), command].slice(-50));

      try {
        const response = await fetch('/api/sandbox/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: current.sessionId, command })
        });

        if (response.status === 404) {
          setState('ended');
          return;
        }

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          appendOutput(`\r\n\u001b[38;5;203m${payload?.error ?? 'failed to send input'}\u001b[0m\r\n`);
        }
      } catch (sendError) {
        appendOutput(
          `\r\n\u001b[38;5;203m${sendError instanceof Error ? sendError.message : 'network error'}\u001b[0m\r\n`
        );
      }
    },
    [appendOutput]
  );

  const signal = useCallback(
    async (action: 'interrupt' | 'eof') => {
      const current = metaRef.current;
      if (!current) return;

      appendOutput(`\u001b[38;5;203m^C\u001b[0m\r\n`);
      await fetch('/api/sandbox/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: current.sessionId, action })
      }).catch(() => undefined);
    },
    [appendOutput]
  );

  const clear = useCallback(() => {
    outputRef.current = '';
    setVersion((value) => value + 1);
  }, []);

  const getOutput = useCallback(() => stripAnsi(outputRef.current), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  return {
    meta,
    state,
    error,
    version,
    history,
    outputRef,
    start,
    restart,
    send,
    interrupt: () => signal('interrupt'),
    eof: () => signal('eof'),
    clear,
    getOutput
  };
}
