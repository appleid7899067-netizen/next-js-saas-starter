import type { Metadata } from 'next';
import { PuterConsole } from '@/components/puter/puter-console';
import { getPuterSession } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Puter Console — AI models, sandbox & terminal stream',
  description:
    'Sign in with Puter to use 500+ AI models without API keys, run commands in a streamed sandbox terminal, and save results to Puter Drive.'
};

export default async function PuterPage() {
  // The Puter identity is stored in a signed, httpOnly cookie by
  // /api/puter/session right after puter.auth.signIn() resolves in the browser.
  const puter = await getPuterSession();

  return <PuterConsole initialUsername={puter?.username ?? null} />;
}
