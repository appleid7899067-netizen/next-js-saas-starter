#!/usr/bin/env node
/**
 * Post-processes the Next.js standalone output so it can be started with
 *
 *     node .next/standalone/server.js
 *
 * (what render.yaml, Dockerfiles and most PaaS "start command" fields do).
 *
 * Two things are fixed up:
 *
 *  1. Drizzle migrations are copied next to server.js. The runtime resolves
 *     them from `lib/db/migrations` (see lib/db/paths.ts); `next build` does
 *     not trace .sql files, so without this a fresh deploy would start with an
 *     empty database schema.
 *
 *  2. The standalone folder is declared as the output file tracing root. It
 *     contains a lockfile-less package.json, which can otherwise make Next.js
 *     guess a different workspace root and fail to locate the server bundle.
 */
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const standaloneDir = path.join(projectRoot, '.next', 'standalone');

if (!fs.existsSync(standaloneDir)) {
  console.warn(
    '[prepare-standalone] .next/standalone not found — is `output: "standalone"` enabled (BUILD_STANDALONE=1)?'
  );
  process.exit(0);
}

// 1. copy migrations
const migrationsSource = path.join(projectRoot, 'lib', 'db', 'migrations');
const migrationsTarget = path.join(standaloneDir, 'lib', 'db', 'migrations');

if (fs.existsSync(migrationsSource)) {
  fs.mkdirSync(path.dirname(migrationsTarget), { recursive: true });
  fs.cpSync(migrationsSource, migrationsTarget, { recursive: true });
  console.log(`[prepare-standalone] copied migrations → ${path.relative(projectRoot, migrationsTarget)}`);
} else {
  console.warn('[prepare-standalone] lib/db/migrations not found — nothing to copy');
}

// 2. tracing root hint
const configCandidates = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.json'];
const existingConfig = configCandidates.find((file) => fs.existsSync(path.join(standaloneDir, file)));

if (existingConfig) {
  console.log(
    `[prepare-standalone] ${existingConfig} already exists in the standalone output — leaving it untouched.`
  );
} else {
  const config = {
    outputFileTracingRoot: projectRoot
  };

  fs.writeFileSync(
    path.join(standaloneDir, 'next.config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8'
  );
  console.log('[prepare-standalone] wrote next.config.json (outputFileTracingRoot)');
}
