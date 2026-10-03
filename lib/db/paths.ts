import fs from 'node:fs';
import path from 'node:path';

/**
 * Locates the Drizzle migrations folder (`lib/db/migrations`).
 *
 * This has to work in three very different layouts:
 *  - `pnpm dev` / `next start`   → cwd is the project root
 *  - `next build && node .next/standalone/server.js` → cwd is either the
 *    project root (Render, Vercel-ish) or the standalone folder itself
 *  - a standalone deploy where the source tree is not present at runtime
 *    (the build script copies the migrations next to server.js)
 */
export function resolveMigrationsFolder(): string | null {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.join(process.cwd(), 'lib', 'db', 'migrations'),
    path.join(process.cwd(), '.next', 'standalone', 'lib', 'db', 'migrations'),
    process.argv[1] ? path.join(path.dirname(process.argv[1]), 'lib', 'db', 'migrations') : null
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'meta', '_journal.json'))) {
      return candidate;
    }
  }

  return null;
}

export function resolveSqlMigrationsFolder(): string | null {
  const folder = resolveMigrationsFolder();
  return folder;
}
