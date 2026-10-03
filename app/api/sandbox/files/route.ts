import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readSandboxIdentity } from '@/lib/sandbox/identity';
import { getSession, isSandboxEnabled, resolveInWorkspace } from '@/lib/sandbox/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_READ_BYTES = 256 * 1024;
const MAX_ENTRIES = 400;
const MAX_DEPTH = 4;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.turbo', '.cache']);

type Entry = { path: string; name: string; type: 'file' | 'directory'; size: number; modified: number };

async function listWorkspace(root: string) {
  const entries: Entry[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return;

    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      if (entries.length >= MAX_ENTRIES) return;
      if (SKIP_DIRS.has(dirent.name)) continue;

      const absolute = path.join(dir, dirent.name);
      const relative = path.relative(root, absolute) || dirent.name;

      if (dirent.isDirectory()) {
        entries.push({ path: relative, name: dirent.name, type: 'directory', size: 0, modified: 0 });
        await walk(absolute, depth + 1);
      } else if (dirent.isFile()) {
        let stats;
        try {
          stats = await fs.stat(absolute);
        } catch {
          continue;
        }
        entries.push({
          path: relative,
          name: dirent.name,
          type: 'file',
          size: stats.size,
          modified: stats.mtimeMs
        });
      }
    }
  }

  await walk(root, 0);
  return entries;
}

async function resolveSession(sessionId: string | null | undefined) {
  if (!isSandboxEnabled()) {
    return { error: NextResponse.json({ error: 'The sandbox is disabled.' }, { status: 503 }) };
  }

  if (!sessionId) {
    return { error: NextResponse.json({ error: 'session is required' }, { status: 400 }) };
  }

  const identity = await readSandboxIdentity();
  const session = getSession(sessionId, identity.ownerKey);

  if (!session) {
    return { error: NextResponse.json({ error: 'session not found' }, { status: 404 }) };
  }

  return { session };
}

export async function GET(request: Request) {
  const resolved = await resolveSession(new URL(request.url).searchParams.get('session'));
  if (resolved.error) return resolved.error;
  const session = resolved.session!;

  const relative = new URL(request.url).searchParams.get('path');

  if (!relative) {
    const entries = await listWorkspace(session.cwd);
    return NextResponse.json({ cwd: session.cwd, entries });
  }

  let absolute: string;
  try {
    absolute = resolveInWorkspace(session.cwd, relative);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid path' },
      { status: 400 }
    );
  }

  try {
    const stats = await fs.stat(absolute);
    if (stats.isDirectory()) {
      const entries = await listWorkspace(absolute);
      return NextResponse.json({ path: relative, entries });
    }

    const buffer = await fs.readFile(absolute);
    const truncated = buffer.byteLength > MAX_READ_BYTES;
    const slice = truncated ? buffer.subarray(0, MAX_READ_BYTES) : buffer;
    const binary = slice.includes(0);

    return NextResponse.json({
      path: relative,
      size: stats.size,
      modified: stats.mtimeMs,
      truncated,
      binary,
      content: binary ? null : slice.toString('utf8')
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}

export async function POST(request: Request) {
  let body: { sessionId?: string; path?: string; content?: string };
  try {
    body = (await request.json()) as { sessionId?: string; path?: string; content?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const resolved = await resolveSession(
    body.sessionId ?? new URL(request.url).searchParams.get('session')
  );
  if (resolved.error) return resolved.error;
  const session = resolved.session!;

  if (!body.path || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'path and content are required' }, { status: 400 });
  }

  let absolute: string;
  try {
    absolute = resolveInWorkspace(session.cwd, body.path);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid path' },
      { status: 400 }
    );
  }

  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, body.content, 'utf8');

  return NextResponse.json({ ok: true, path: body.path, bytes: Buffer.byteLength(body.content) });
}

export async function DELETE(request: Request) {
  const resolved = await resolveSession(new URL(request.url).searchParams.get('session'));
  if (resolved.error) return resolved.error;
  const session = resolved.session!;

  const relative = new URL(request.url).searchParams.get('path');
  if (!relative) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  let absolute: string;
  try {
    absolute = resolveInWorkspace(session.cwd, relative);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid path' },
      { status: 400 }
    );
  }

  if (absolute === path.resolve(session.cwd)) {
    return NextResponse.json({ error: 'Refusing to delete the workspace root' }, { status: 400 });
  }

  await fs.rm(absolute, { recursive: true, force: true });
  return NextResponse.json({ ok: true, path: relative });
}
