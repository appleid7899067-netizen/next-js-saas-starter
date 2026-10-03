import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { hash } from 'bcryptjs';
import { activityLogs, teamMembers, teams, users } from './schema';

/**
 * Embedded (PGlite) database bootstrap.
 *
 * This is only used when POSTGRES_URL is not configured, so that the starter
 * can be booted in environments where no Postgres server is available
 * (sandboxes, previews, `pnpm dev` on a fresh machine).
 *
 * It applies the regular Drizzle migrations from ./migrations and then seeds
 * the same demo account the regular `pnpm db:seed` script creates
 * (test@test.com / admin123), minus the Stripe setup.
 */

type PGliteLike = {
  exec(query: string): Promise<unknown>;
  query<T = unknown>(query: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

type EmbeddedDb = {
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
};

const MIGRATIONS_DIR = path.join(process.cwd(), 'lib', 'db', 'migrations');
const BREAKPOINT = '--> statement-breakpoint';

export const DEMO_EMAIL = 'test@test.com';
export const DEMO_PASSWORD = 'admin123';

async function applyMigrations(client: PGliteLike, log: (message: string) => void) {
  await client.exec(
    `CREATE TABLE IF NOT EXISTS "applied_migrations" (
       "tag" text PRIMARY KEY NOT NULL,
       "applied_at" timestamp DEFAULT now() NOT NULL
     );`
  );

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    log(`no migrations directory found at ${MIGRATIONS_DIR}`);
    return;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const tag = file.replace(/\.sql$/, '');
    const { rows } = await client.query<{ tag: string }>(
      'SELECT tag FROM "applied_migrations" WHERE tag = $1',
      [tag]
    );

    if (rows.length > 0) {
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    for (const statement of sql.split(BREAKPOINT)) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) {
        continue;
      }
      await client.exec(trimmed);
    }

    await client.query('INSERT INTO "applied_migrations" (tag) VALUES ($1)', [tag]);
    log(`applied migration ${file}`);
  }
}

async function seedDemoAccount(db: EmbeddedDb, log: (message: string) => void) {
  const existing = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);

  if (existing.length > 0) {
    return;
  }

  const passwordHash = await hash(DEMO_PASSWORD, 10);

  const [user] = await db
    .insert(users)
    .values({ name: 'Demo User', email: DEMO_EMAIL, passwordHash, role: 'owner' })
    .returning();

  const [team] = await db.insert(teams).values({ name: 'Demo Team' }).returning();

  await db.insert(teamMembers).values({ userId: user.id, teamId: team.id, role: 'owner' });
  await db
    .insert(activityLogs)
    .values({ teamId: team.id, userId: user.id, action: 'SIGN_UP' });

  log(`seeded demo account ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

export async function bootstrapEmbeddedDatabase(client: PGliteLike, db: EmbeddedDb) {
  const log = (message: string) => console.log(`[embedded-db] ${message}`);

  await applyMigrations(client, log);
  await seedDemoAccount(db, log);
}
