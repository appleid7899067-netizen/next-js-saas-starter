import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import dotenv from 'dotenv';
import * as schema from './schema';

dotenv.config();

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Connection handling:
 *
 *  - `POSTGRES_URL` is a `postgres://…` URL → talk to that Postgres server
 *    (this is what Render/Vercel/any managed Postgres uses). Migrations are
 *    applied automatically on boot so a brand new database just works.
 *  - no URL (fresh clone, sandbox, preview) → fall back to an embedded
 *    Postgres (PGlite, stored on disk in .pglite/) with migrations + demo
 *    account seeded, so `pnpm dev` boots with a working database.
 */
const connectionString = process.env.POSTGRES_URL?.trim();
const hasPostgresUrl =
  Boolean(connectionString) && /^postgres(ql)?:\/\//i.test(connectionString as string);

export const isEmbeddedDatabase = !hasPostgresUrl;

const EMBEDDED_DB_DIR = process.env.PGLITE_DIR ?? '.pglite';

if (connectionString && !hasPostgresUrl) {
  console.warn(
    '[db] POSTGRES_URL is set but does not look like a postgres:// URL — falling back to the embedded database.'
  );
}

async function createPostgresDatabase(): Promise<Database> {
  const client = postgres(connectionString as string, {
    max: Number(process.env.POSTGRES_POOL_SIZE ?? 10),
    idle_timeout: 30
  });

  try {
    const { migratePostgres } = await import('./migrate');
    const result = await migratePostgres(client, 'postgres');

    if (!result.migrated) {
      console.warn(
        '[db] no migrations folder found — skipping auto-migration. Run `pnpm db:migrate` (see lib/db/paths.ts for the locations that are searched).'
      );
    }
  } catch (error) {
    // A failed auto-migration must not take the whole app down: deployments
    // that run migrations separately (CI job, release phase) still work.
    console.error(
      '[db] automatic migration failed — run `pnpm db:migrate` manually if the schema is missing:',
      error instanceof Error ? error.message : error
    );
  }

  const database = drizzle(client, { schema });

  // Opt-in demo account on a fresh Postgres (handy for a first deploy).
  if (process.env.SEED_DEMO_ACCOUNT === '1') {
    try {
      const { seedDemoAccount } = await import('./seed-demo');
      await seedDemoAccount(database);
    } catch (error) {
      console.error(
        '[db] demo seed failed:',
        error instanceof Error ? error.message : error
      );
    }
  }

  return database;
}

async function createEmbeddedDatabase(): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
  const { bootstrapEmbeddedDatabase } = await import('./embedded');

  console.log(
    `[db] POSTGRES_URL is not set — using an embedded PGlite database in ${EMBEDDED_DB_DIR}/`
  );

  const client = await PGlite.create(EMBEDDED_DB_DIR);
  const embedded = drizzlePglite(client, { schema });

  await bootstrapEmbeddedDatabase(client as never, embedded as never);

  return embedded as unknown as Database;
}

export const db: Database = hasPostgresUrl
  ? await createPostgresDatabase()
  : await createEmbeddedDatabase();
