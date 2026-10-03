import 'server-only';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hash } from 'bcryptjs';
import { db } from './drizzle';
import {
  ActivityType,
  activityLogs,
  teamMembers,
  teams,
  users,
  type User
} from './schema';

/**
 * One Puter login = one local account.
 *
 * Signing in with Puter is the only step a visitor has to take: this module
 * finds (or creates) the matching local user, gives them a team, and returns
 * the user so the caller can issue the app's own session cookie. There is no
 * password to set and no email confirmation to click.
 *
 * Accounts that already exist with the same email (i.e. registered with the
 * email/password flow) are linked to the Puter account instead of duplicated.
 */

export type PuterIdentityInput = {
  username: string;
  uuid: string;
  email?: string | null;
};

export type PuterAccountResult = {
  user: User;
  teamId: number;
  created: boolean;
  /** True when an existing email/password account was attached to Puter. */
  linked: boolean;
  /** True when this Puter account was already known (plain sign-in). */
  alreadyLinked?: boolean;
  email: string;
};

async function teamIdFor(userId: number): Promise<number> {
  const [membership] = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .limit(1);

  if (membership) {
    return membership.teamId;
  }

  // Account exists but has no team (e.g. a membership was removed): give the
  // dashboard something to work with instead of throwing.
  const [team] = await db.insert(teams).values({ name: 'My Team' }).returning();
  await db.insert(teamMembers).values({ userId, teamId: team.id, role: 'owner' });

  return team.id;
}

async function emailIsFree(email: string) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return existing === undefined;
}

async function pickEmail(input: PuterIdentityInput) {
  const slug = input.username
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 40);

  const candidates = [
    input.email?.trim() || null,
    slug ? `${slug}@puter.local` : null,
    slug ? `${slug}.${input.uuid.slice(0, 8)}@puter.local` : null,
    `${input.uuid}@puter.local`
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await emailIsFree(candidate)) {
      return candidate;
    }
  }

  // The uuid is unique, so this can only collide if the same identity was
  // created concurrently — callers treat the unique violation as a retry signal.
  return `${input.uuid}@puter.local`;
}

export async function findOrCreateUserForPuter(
  input: PuterIdentityInput
): Promise<PuterAccountResult> {
  // 1. Already linked to this Puter account.
  const [byUuid] = await db
    .select()
    .from(users)
    .where(eq(users.puterUuid, input.uuid))
    .limit(1);

  if (byUuid && !byUuid.deletedAt) {
    return {
      user: byUuid,
      teamId: await teamIdFor(byUuid.id),
      created: false,
      linked: false,
      // `false` so callers can show "already signed in" instead of "just linked".
      alreadyLinked: true,
      email: byUuid.email
    };
  }

  // 2. An account with the same email already exists (registered with
  //    email/password, or linked to another Puter account before): attach this
  //    Puter identity to it instead of creating a second account.
  //    Puter emails are verified, so an email match means the same person —
  //    this is what keeps "one Puter login" idempotent.
  if (input.email) {
    const [byEmail] = await db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (byEmail && !byEmail.deletedAt) {
      const wasLinked = Boolean(byEmail.puterUuid);

      const [linked] = await db
        .update(users)
        .set({
          puterUuid: input.uuid,
          puterUsername: input.username,
          updatedAt: new Date()
        })
        .where(eq(users.id, byEmail.id))
        .returning();

      const teamId = await teamIdFor(linked.id);

      await db.insert(activityLogs).values({
        teamId,
        userId: linked.id,
        action: ActivityType.SIGN_IN
      });

      return {
        user: linked,
        teamId,
        created: false,
        linked: true,
        alreadyLinked: wasLinked,
        email: linked.email
      };
    }
  }

  // 3. Brand new visitor: create the account, the team and the membership.
  const email = await pickEmail(input);
  // No password is ever used for Puter accounts — store an unguessable hash so
  // the email/password form cannot authenticate into them.
  const passwordHash = await hash(crypto.randomBytes(32).toString('hex'), 10);

  const [user] = await db
    .insert(users)
    .values({
      name: input.username,
      email,
      passwordHash,
      role: 'owner',
      puterUuid: input.uuid,
      puterUsername: input.username
    })
    .returning();

  const [team] = await db
    .insert(teams)
    .values({ name: `${input.username}'s Team` })
    .returning();

  await db.insert(teamMembers).values({
    userId: user.id,
    teamId: team.id,
    role: 'owner'
  });

  await db.insert(activityLogs).values({
    teamId: team.id,
    userId: user.id,
    action: ActivityType.SIGN_UP
  });

  return {
    user,
    teamId: team.id,
    created: true,
    linked: false,
    email
  };
}
