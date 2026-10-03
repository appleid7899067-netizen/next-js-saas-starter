'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_MODEL,
  FALLBACK_MODELS,
  describeError,
  isPuterSignedIn,
  loadPuter,
  normalizeModels,
  type PuterModel,
  type PuterSdk,
  type PuterUser
} from '@/lib/puter/client';

export type PuterStatus = 'idle' | 'loading' | 'ready' | 'error';

export type PuterAccount = {
  userId: number;
  teamId: number;
  name: string | null;
  email: string;
  created: boolean;
  linked: boolean;
};

export type UsePuterResult = {
  status: PuterStatus;
  error: string | null;
  sdk: PuterSdk | null;
  signedIn: boolean;
  user: PuterUser | null;
  profilePicture: string | null;
  monthlyUsage: unknown;
  models: PuterModel[];
  modelsSource: 'puter' | 'fallback' | 'loading';
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  signInPending: boolean;
  refreshModels: () => Promise<void>;
  isFallbackModels: boolean;
  /** The local account that the Puter login created (or matched). */
  account: PuterAccount | null;
  accountWarning: string | null;
};

/**
 * Loads Puter.js, tracks the Puter account state and exposes the model list.
 * The SDK is only fetched when this hook mounts (i.e. on /puter).
 */
export function usePuter(initialUsername: string | null): UsePuterResult {
  const router = useRouter();
  const [status, setStatus] = useState<PuterStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sdk, setSdk] = useState<PuterSdk | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [user, setUser] = useState<PuterUser | null>(
    initialUsername ? { username: initialUsername } : null
  );
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [monthlyUsage, setMonthlyUsage] = useState<unknown>(null);
  const [models, setModels] = useState<PuterModel[]>(FALLBACK_MODELS);
  const [modelsSource, setModelsSource] = useState<'puter' | 'fallback' | 'loading'>('loading');
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [signInPending, setSignInPending] = useState(false);
  const [account, setAccount] = useState<PuterAccount | null>(null);
  const [accountWarning, setAccountWarning] = useState<string | null>(null);
  const bootstrapped = useRef(false);

  const refreshModels = useCallback(async (instance?: PuterSdk) => {
    const active = instance ?? sdk;
    if (!active) return;

    try {
      setModelsSource('loading');
      const raw = await active.ai.listModels();
      const normalized = normalizeModels(raw);

      if (normalized.length > 0) {
        setModels(normalized);
        setModelsSource('puter');
        setSelectedModel((current) => {
          if (normalized.some((model) => model.id === current)) return current;
          const preferred = normalized.find((model) => model.id === DEFAULT_MODEL);
          return preferred?.id ?? normalized[0].id;
        });
      } else {
        setModelsSource('fallback');
      }
    } catch (listError) {
      console.warn('[puter] listModels failed', listError);
      setModelsSource('fallback');
    }
  }, [sdk]);

  const loadIdentity = useCallback(
    async (instance: PuterSdk) => {
      try {
        const [puterUser, picture, usage] = await Promise.all([
          instance.auth.getUser().catch(() => null),
          instance.auth.getProfilePicture?.({ width: 128, height: 128 }).catch(() => null) ??
            Promise.resolve(null),
          instance.auth.getMonthlyUsage?.().catch(() => null) ?? Promise.resolve(null)
        ]);

        setUser(puterUser);
        setProfilePicture(typeof picture === 'string' ? picture : null);
        setMonthlyUsage(usage ?? null);

        if (puterUser?.username) {
          // Creates/links the local account + session cookie and tells the UI
          // which account this Puter login maps to.
          const response = await fetch('/api/puter/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: puterUser.username,
              uuid: String(puterUser.uuid ?? puterUser.username),
              email: puterUser.email ?? null
            })
          }).catch(() => null);

          if (response?.ok) {
            const payload = (await response.json().catch(() => null)) as
              | { account?: PuterAccount | null; warning?: string | null }
              | null;

            if (payload?.account) setAccount(payload.account);
            setAccountWarning(payload?.warning ?? null);
          }
        }
      } catch (identityError) {
        console.warn('[puter] could not read the Puter account', identityError);
      }
    },
    []
  );

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    let cancelled = false;
    setStatus('loading');

    loadPuter()
      .then(async (instance) => {
        if (cancelled) return;
        setSdk(instance);
        setStatus('ready');

        const alreadySignedIn = await isPuterSignedIn(instance);
        if (cancelled) return;
        setSignedIn(alreadySignedIn);

        if (alreadySignedIn) {
          await loadIdentity(instance);
        }

        await refreshModels(instance);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setStatus('error');
        setError(describeError(loadError));
        setModelsSource('fallback');
      });

    return () => {
      cancelled = true;
    };
  }, [loadIdentity, refreshModels]);

  // Puter KV is per-app, per-user storage — remember the picked model there.
  useEffect(() => {
    if (!signedIn || !sdk?.kv?.get) return;

    sdk.kv
      .get('puter-console:selected-model')
      .then((value) => {
        if (typeof value === 'string' && value.length > 0) {
          setSelectedModel(value);
        }
      })
      .catch(() => undefined);
  }, [sdk, signedIn]);

  useEffect(() => {
    if (!signedIn || !sdk?.kv?.set) return;

    const timer = window.setTimeout(() => {
      void sdk.kv?.set?.('puter-console:selected-model', selectedModel)?.catch?.(() => undefined);
    }, 900);

    return () => window.clearTimeout(timer);
  }, [selectedModel, sdk, signedIn]);

  const signIn = useCallback(async () => {
    setSignInPending(true);
    setError(null);

    try {
      const instance = sdk ?? (await loadPuter());
      setSdk(instance);
      setStatus('ready');

      // Must be triggered from a user gesture: opens the Puter sign-in popup.
      await instance.auth.signIn();
      setSignedIn(true);
      await loadIdentity(instance);
      await refreshModels(instance);
      router.refresh();
    } catch (signInError) {
      setError(describeError(signInError));
    } finally {
      setSignInPending(false);
    }
  }, [loadIdentity, refreshModels, router, sdk]);

  const signOut = useCallback(async () => {
    try {
      const instance = sdk ?? (await loadPuter());
      await instance.auth.signOut();
    } catch (signOutError) {
      console.warn('[puter] signOut failed', signOutError);
    } finally {
      await fetch('/api/puter/session', { method: 'DELETE' }).catch(() => undefined);
      setSignedIn(false);
      setUser(null);
      setProfilePicture(null);
      setMonthlyUsage(null);
      setAccount(null);
      setAccountWarning(null);
      router.refresh();
    }
  }, [router, sdk]);

  return useMemo(
    () => ({
      status,
      error,
      sdk,
      signedIn,
      user,
      profilePicture,
      monthlyUsage,
      models,
      modelsSource,
      selectedModel,
      setSelectedModel,
      signIn,
      signOut,
      signInPending,
      refreshModels: () => refreshModels(),
      isFallbackModels: modelsSource === 'fallback',
      account,
      accountWarning
    }),
    [
      account,
      accountWarning,
      error,
      models,
      modelsSource,
      monthlyUsage,
      profilePicture,
      refreshModels,
      sdk,
      selectedModel,
      signIn,
      signInPending,
      signOut,
      signedIn,
      status,
      user
    ]
  );
}
