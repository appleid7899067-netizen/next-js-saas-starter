import 'server-only';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Terminal sessions for the sandbox panel.
 *
 * Every session is a long-lived interactive shell (bash on a PTY when `script`
 * is available, plain pipes otherwise) that lives next to the Next.js server.
 * Output is fanned out to any number of subscribers (the SSE route), and input
 * is forwarded from the browser (the exec route).
 *
 * Sessions are isolated per visitor (a signed cookie identity) inside an
 * ephemeral workspace directory, and are killed after being idle for a while.
 */

export type SandboxEvent =
  | {
      type: 'meta';
      sessionId: string;
      cwd: string;
      shell: string;
      pty: boolean;
      createdAt: number;
    }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number | null; signal: string | null }
  | { type: 'error'; message: string };

export type SequencedEvent = { seq: number; at: number; event: SandboxEvent };

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_SESSION_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_SESSIONS = 12;
const MAX_BUFFERED_EVENTS = 4000;
const MAX_BUFFERED_CHARS = 512 * 1024;

const PROJECT_ROOT = process.env.SANDBOX_ROOT
  ? path.resolve(process.env.SANDBOX_ROOT)
  : path.join(process.cwd(), '.sandbox');

const WORKSPACES_DIR = path.join(PROJECT_ROOT, 'workspaces');
const SHELL_DIR = path.join(PROJECT_ROOT, 'shell');

const WELCOME = [
  '\u001b[38;5;208m✦ sandbox ready\u001b[0m',
  '  commands run inside this app container, in your own workspace.',
  '  try: ls -la · node -v · cat package.json · pwd',
  ''
].join('\r\n');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function findScriptBinary(): string | null {
  for (const candidate of ['/usr/bin/script', '/bin/script', '/usr/local/bin/script']) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function findShell(): string {
  const candidates = [process.env.SHELL, '/bin/bash', '/usr/bin/bash', '/bin/sh'];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return '/bin/sh';
}

function workspacePathFor(ownerKey: string) {
  const hash = crypto.createHash('sha256').update(ownerKey).digest('hex').slice(0, 16);
  return path.join(WORKSPACES_DIR, hash);
}

/** Resolves a user supplied relative path inside the session workspace. */
export function resolveInWorkspace(cwd: string, relativePath: string) {
  const normalized = path
    .normalize(relativePath || '.')
    .replace(/^([/\\])+/, '')
    .replace(/^(\.\.)([/\\]|$)+/g, '');

  const resolved = path.resolve(cwd, normalized);
  const root = path.resolve(cwd);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes the sandbox workspace');
  }

  return resolved;
}

class SandboxSession {
  readonly id: string;
  readonly ownerKey: string;
  readonly cwd: string;
  readonly shellPath: string;
  readonly pty: boolean;
  readonly createdAt = Date.now();

  lastActivity = Date.now();
  exited = false;
  exitCode: number | null = null;

  private child: ChildProcess | null = null;
  private seq = 0;
  private events: SequencedEvent[] = [];
  private bufferedChars = 0;
  private subscribers = new Set<(event: SequencedEvent) => void>();
  private decoder = new TextDecoder('utf-8', { fatal: false });

  constructor(ownerKey: string) {
    this.ownerKey = ownerKey;
    this.id = crypto.randomUUID();
    this.cwd = workspacePathFor(ownerKey);
    ensureDir(this.cwd);
    ensureDir(SHELL_DIR);

    this.shellPath = findShell();
    this.pty = Boolean(findScriptBinary());

    this.start();
    this.emit({ type: 'output', data: WELCOME });
  }

  get isAlive() {
    return !this.exited && Boolean(this.child);
  }

  private start() {
    const rcPath = this.writeRcFile();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      PS1: '',
      PS2: '> ',
      PROMPT_COMMAND: '',
      HISTFILE: '/dev/null',
      PAGER: 'cat',
      GIT_PAGER: 'cat',
      GIT_TERMINAL_PROMPT: '0',
      npm_config_fund: 'false',
      npm_config_audit: 'false',
      SANDBOX_SESSION_ID: this.id,
      SANDBOX_WORKSPACE: this.cwd
    };

    const scriptBinary = this.pty ? findScriptBinary() : null;
    const shellCommand = `${JSON.stringify(this.shellPath)} --rcfile ${JSON.stringify(rcPath)}`;

    this.child = scriptBinary
      ? spawn(scriptBinary, ['-qfec', shellCommand, '/dev/null'], {
          cwd: this.cwd,
          env,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe']
        })
      : spawn(this.shellPath, ['--rcfile', rcPath], {
          cwd: this.cwd,
          env,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });

    this.child.on('error', (error) => {
      this.emit({ type: 'error', message: String(error?.message ?? error) });
      this.finish(null, null);
    });

    this.child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    this.child.stderr?.on('data', (chunk: Buffer) => this.onData(chunk));
    this.child.on('exit', (code, signal) => this.finish(code, signal));

    this.emit({
      type: 'meta',
      sessionId: this.id,
      cwd: this.cwd,
      shell: path.basename(this.shellPath),
      pty: this.pty,
      createdAt: this.createdAt
    });
  }

  private writeRcFile() {
    const rcPath = path.join(SHELL_DIR, `rc-${this.cwd.split('/').pop()}`);
    const contents = [
      '# generated by lib/sandbox/session.ts',
      'stty -echo 2>/dev/null || true',
      'stty columns 120 rows 32 2>/dev/null || true',
      'export TERM=xterm-256color',
      "export PS1='' PS2='' PROMPT_COMMAND=''",
      'export HISTFILE=/dev/null',
      'export PAGER=cat GIT_PAGER=cat GIT_TERMINAL_PROMPT=0',
      'export npm_config_fund=false npm_config_audit=false',
      'shopt -s checkwinsize 2>/dev/null || true',
      'set +o history 2>/dev/null || true',
      ''
    ].join('\n');

    fs.writeFileSync(rcPath, contents, 'utf8');
    return rcPath;
  }

  private onData(chunk: Buffer) {
    const text = this.decoder.decode(chunk, { stream: true });
    if (!text) return;
    this.lastActivity = Date.now();
    this.emit({ type: 'output', data: text });
  }

  private finish(code: number | null, signal: string | null) {
    if (this.exited) return;
    this.exited = true;
    this.exitCode = code;
    this.emit({ type: 'exit', code, signal: signal ? String(signal) : null });
  }

  private emit(event: SandboxEvent) {
    this.seq += 1;
    const sequenced: SequencedEvent = { seq: this.seq, at: Date.now(), event };

    this.events.push(sequenced);
    if (event.type === 'output') {
      this.bufferedChars += event.data.length;
    }

    while (
      this.events.length > MAX_BUFFERED_EVENTS ||
      this.bufferedChars > MAX_BUFFERED_CHARS
    ) {
      const dropped = this.events.shift();
      if (!dropped) break;
      if (dropped.event.type === 'output') {
        this.bufferedChars -= dropped.event.data.length;
      }
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber(sequenced);
      } catch {
        this.subscribers.delete(subscriber);
      }
    }
  }

  eventsSince(seq: number) {
    return this.events.filter((entry) => entry.seq > seq);
  }

  subscribe(subscriber: (event: SequencedEvent) => void, fromSeq = 0) {
    for (const entry of this.eventsSince(fromSeq)) {
      subscriber(entry);
    }
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  write(input: string) {
    if (!this.child || this.exited || !this.child.stdin?.writable) {
      throw new Error('The sandbox session has ended');
    }
    this.lastActivity = Date.now();
    this.child.stdin.write(input);
  }

  kill() {
    this.subscribers.clear();
    if (!this.child || this.exited) return;

    this.exited = true;
    const pid = this.child.pid;

    try {
      if (pid) {
        process.kill(-pid, 'SIGTERM');
      } else {
        this.child.kill('SIGTERM');
      }
    } catch {
      // already gone
    }

    setTimeout(() => {
      try {
        if (pid) process.kill(-pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }, 1500).unref?.();
  }
}

type SandboxManager = {
  sessions: Map<string, SandboxSession>;
  byOwner: Map<string, string>;
  sweeper: NodeJS.Timeout | null;
};

const globalRef = globalThis as unknown as { __saasStarterSandbox?: SandboxManager };

function manager(): SandboxManager {
  if (!globalRef.__saasStarterSandbox) {
    globalRef.__saasStarterSandbox = {
      sessions: new Map(),
      byOwner: new Map(),
      sweeper: null
    };
  }

  const state = globalRef.__saasStarterSandbox;

  if (!state.sweeper) {
    state.sweeper = setInterval(() => sweep(state), 60_000);
    state.sweeper.unref?.();
  }

  return state;
}

function sweep(state: SandboxManager) {
  const now = Date.now();

  for (const [id, session] of state.sessions) {
    const stale = now - session.lastActivity > IDLE_TIMEOUT_MS;
    const tooOld = now - session.createdAt > MAX_SESSION_AGE_MS;
    const gone = session.exited && now - session.lastActivity > 120_000;

    if (stale || tooOld || gone) {
      session.kill();
      state.sessions.delete(id);
      if (state.byOwner.get(session.ownerKey) === id) {
        state.byOwner.delete(session.ownerKey);
      }
    }
  }
}

export function isSandboxEnabled() {
  return process.env.SANDBOX_DISABLED !== '1';
}

export function getOrCreateSession(ownerKey: string) {
  if (!isSandboxEnabled()) {
    throw new Error('The sandbox is disabled on this deployment (SANDBOX_DISABLED=1)');
  }

  const state = manager();
  const existingId = state.byOwner.get(ownerKey);
  const existing = existingId ? state.sessions.get(existingId) : undefined;

  if (existing && existing.isAlive) {
    existing.lastActivity = Date.now();
    return existing;
  }

  if (existing) {
    state.sessions.delete(existing.id);
    state.byOwner.delete(ownerKey);
  }

  if (state.sessions.size >= MAX_SESSIONS) {
    const oldest = [...state.sessions.values()].sort(
      (a, b) => a.lastActivity - b.lastActivity
    )[0];
    if (oldest) {
      oldest.kill();
      state.sessions.delete(oldest.id);
      state.byOwner.delete(oldest.ownerKey);
    }
  }

  const session = new SandboxSession(ownerKey);
  state.sessions.set(session.id, session);
  state.byOwner.set(ownerKey, session.id);

  return session;
}

export function getSession(sessionId: string, ownerKey: string) {
  const session = manager().sessions.get(sessionId);
  if (!session || session.ownerKey !== ownerKey) return null;
  return session;
}

export function destroySession(sessionId: string, ownerKey: string) {
  const state = manager();
  const session = state.sessions.get(sessionId);

  if (!session || session.ownerKey !== ownerKey) {
    return false;
  }

  session.kill();
  state.sessions.delete(sessionId);
  state.byOwner.delete(ownerKey);
  return true;
}

export function sandboxRoot() {
  return PROJECT_ROOT;
}

export const sandboxLimits = {
  idleTimeoutMs: IDLE_TIMEOUT_MS,
  maxSessions: MAX_SESSIONS,
  tmpRoot: os.tmpdir()
};
