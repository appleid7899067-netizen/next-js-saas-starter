import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Sql } from 'postgres';
import { resolveMigrationsFolder } from './paths';

/**
 * Applies the Drizzle migrations to a Postgres database.
 *
 * Used on boot so a fresh deploy (for example on Render with a brand new
 * managed Postgres) comes up with a ready schema instead of crashing on the
 * first query. It is safe to run on every boot: `migrate()` records applied
 * migrations and only runs what is missing.
 *
 * Returns false when no migrations folder could be found, so the caller can
 * decide whether that is fatal.
 */
export async function migratePostgres(client: Sql, label = 'postgres') {
  const folder = resolveMigrationsFolder();

  if (!folder) {
    return { migrated: false as const, folder: null };
  }

  const migrationClient = drizzle(client);
  await migrate(migrationClient, { migrationsFolder: folder });

  console.log(`[db] ${label} migrations up to date (${folder})`);
  return { migrated: true as const, folder };
}
