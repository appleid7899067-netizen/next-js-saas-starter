import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import dotenv from 'dotenv';
import * as schema from './schema';

dotenv.config();

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * When POSTGRES_URL is set we behave exactly like the original starter and talk
 * to a real Postgres server.
 *
 * When it is not set (fresh clone, sandbox, preview) we fall back to an
 * embedded Postgres (PGlite, stored on disk) so that `pnpm dev` boots with a
 * working database, migrations applied and the demo account seeded.
 */
export const isEmbeddedDatabase = !process.env.POSTGRES_URL;

const EMBEDDED_DB_DIR = process.env.PGLITE_DIR ?? '.pglite';

function createPostgresDatabase(): Database {
  const client = postgres(process.env.POSTGRES_URL!);
  return drizzle(client, { schema });
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

export const db: Database = isEmbeddedDatabase
  ? await createEmbeddedDatabase()
  : createPostgresDatabase();
