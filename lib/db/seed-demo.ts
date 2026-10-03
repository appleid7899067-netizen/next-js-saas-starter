import type { Database } from './drizzle';
import { eq } from 'drizzle-orm';
import { hash } from 'bcryptjs';
import { activityLogs, teamMembers, teams, users } from './schema';

/**
 * Creates the demo account (`pnpm db:seed` does the same, plus Stripe products).
 *
 * Used automatically by the embedded PGlite database and — when
 * `SEED_DEMO_ACCOUNT=1` — by the Postgres path, which is handy on a fresh
 * deployment when you want an account to log in with right away. It never
 * overwrites an existing account.
 */

export const DEMO_EMAIL = 'test@test.com';
export const DEMO_PASSWORD = 'admin123';

type Log = (message: string) => void;

export async function seedDemoAccount(
  db: Database,
  log: Log = (message) => console.log(`[db] ${message}`)
) {
  const existing = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);

  if (existing.length > 0) {
    log(`demo account ${DEMO_EMAIL} already exists — skipping seed`);
    return false;
  }

  const passwordHash = await hash(DEMO_PASSWORD, 10);

  const [user] = await db
    .insert(users)
    .values({ name: 'Demo User', email: DEMO_EMAIL, passwordHash, role: 'owner' })
    .returning();

  const [team] = await db.insert(teams).values({ name: 'Demo Team' }).returning();

  await db.insert(teamMembers).values({ userId: user.id, teamId: team.id, role: 'owner' });
  await db.insert(activityLogs).values({ teamId: team.id, userId: user.id, action: 'SIGN_UP' });

  log(`seeded demo account ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  return true;
}
