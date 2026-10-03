import { compare, hash } from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NewUser } from '@/lib/db/schema';

const DEV_AUTH_SECRET = 'insecure-development-only-auth-secret';

if (!process.env.AUTH_SECRET) {
  console.warn(
    '[auth] AUTH_SECRET is not set — falling back to an insecure development secret. Set AUTH_SECRET before deploying.'
  );
}

const key = new TextEncoder().encode(process.env.AUTH_SECRET ?? DEV_AUTH_SECRET);
const SALT_ROUNDS = 10;

// `secure` cookies only work over HTTPS, which local dev and sandboxes are not.
const useSecureCookies = process.env.NODE_ENV === 'production';

export async function hashPassword(password: string) {
  return hash(password, SALT_ROUNDS);
}

export async function comparePasswords(
  plainTextPassword: string,
  hashedPassword: string
) {
  return compare(plainTextPassword, hashedPassword);
}

type SessionData = {
  user: { id: number };
  expires: string;
};

export async function signToken(payload: SessionData) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1 day from now')
    .sign(key);
}

export async function verifyToken(input: string) {
  const { payload } = await jwtVerify(input, key, {
    algorithms: ['HS256'],
  });
  return payload as SessionData;
}

export async function getSession() {
  const session = (await cookies()).get('session')?.value;
  if (!session) return null;
  return await verifyToken(session);
}

export async function setSession(user: NewUser) {
  const expiresInOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const session: SessionData = {
    user: { id: user.id! },
    expires: expiresInOneDay.toISOString(),
  };
  const encryptedSession = await signToken(session);
  (await cookies()).set('session', encryptedSession, {
    expires: expiresInOneDay,
    httpOnly: true,
    secure: useSecureCookies,
    sameSite: 'lax',
  });
}

/* -------------------------------------------------------------------------- */
/*  Puter account session                                                      */
/*                                                                             */
/*  The browser talks to Puter.js directly (no server round trip), and stores  */
/*  the resulting identity in a signed, httpOnly cookie so server components   */
/*  can show it and so sandbox workspaces can be scoped to a Puter account.    */
/* -------------------------------------------------------------------------- */

export const PUTER_SESSION_COOKIE = 'puter_session';

export type PuterIdentity = {
  username: string;
  uuid: string;
  email?: string | null;
};

export type PuterSessionData = {
  puter: PuterIdentity;
  expires: string;
};

export async function signPuterToken(payload: PuterSessionData) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1 day from now')
    .sign(key);
}

export async function setPuterSession(puter: PuterIdentity) {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const token = await signPuterToken({ puter, expires: expires.toISOString() });

  (await cookies()).set(PUTER_SESSION_COOKIE, token, {
    expires,
    httpOnly: true,
    secure: useSecureCookies,
    sameSite: 'lax',
    path: '/'
  });
}

export async function getPuterSession(): Promise<PuterIdentity | null> {
  const token = (await cookies()).get(PUTER_SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    const data = payload as unknown as PuterSessionData;
    if (!data?.puter || new Date(data.expires) < new Date()) return null;
    return data.puter;
  } catch {
    return null;
  }
}

export async function clearPuterSession() {
  (await cookies()).delete(PUTER_SESSION_COOKIE);
}
