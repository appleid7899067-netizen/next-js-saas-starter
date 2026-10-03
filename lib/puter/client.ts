/**
 * Browser-side helpers around the Puter.js SDK (https://docs.puter.com).
 *
 * The SDK is loaded on demand from js.puter.com. Everything runs with the
 * signed-in user's Puter account (the "User-Pays" model): the app never holds
 * an API key and never pays for model usage — the visitor's own Puter account
 * does, which is exactly what the login button is for.
 */

export const PUTER_SCRIPT_URL = 'https://js.puter.com/v2/';

export type PuterUser = {
  username?: string;
  uuid?: string;
  email?: string | null;
  [key: string]: unknown;
};

export type PuterModel = {
  id: string;
  provider?: string;
  name?: string;
  context?: number | null;
  max_tokens?: number | null;
  aliases?: string[] | null;
  cost?: {
    currency?: string;
    tokens?: number;
    input?: number;
    output?: number;
  } | null;
};

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  model?: string;
  error?: boolean;
  createdAt: number;
};

export type ChatOptions = {
  model?: string;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
};

export type PuterAi = {
  chat: (
    prompt: unknown,
    options?: ChatOptions
  ) => Promise<unknown>;
  listModels: (provider?: string | null) => Promise<unknown>;
  listModelProviders?: () => Promise<unknown>;
};

export type PuterSdk = {
  auth: {
    signIn: (options?: { attempt_temp_user_creation?: boolean }) => Promise<unknown>;
    signOut: () => Promise<unknown>;
    isSignedIn: () => boolean | Promise<boolean>;
    getUser: () => Promise<PuterUser>;
    getProfile?: () => Promise<unknown>;
    getProfilePicture?: (options?: { width?: number; height?: number }) => Promise<string | null>;
    getMonthlyUsage?: () => Promise<unknown>;
    getDetailedAppUsage?: () => Promise<unknown>;
  };
  ai: PuterAi;
  fs: {
    write: (path: string, data: unknown, options?: unknown) => Promise<unknown>;
    read: (path: string) => Promise<Blob>;
    readdir: (path: string) => Promise<unknown[]>;
    delete?: (path: string) => Promise<unknown>;
  };
  kv?: {
    set: (key: string, value: unknown) => Promise<unknown>;
    get: (key: string) => Promise<unknown>;
  };
  print?: (...args: unknown[]) => void;
};

declare global {
  interface Window {
    puter?: PuterSdk;
  }
}

let loaderPromise: Promise<PuterSdk> | null = null;

/** Injects the Puter.js script tag once and resolves with the SDK. */
export function loadPuter(): Promise<PuterSdk> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Puter.js can only be loaded in the browser'));
  }

  if (window.puter) {
    return Promise.resolve(window.puter);
  }

  if (loaderPromise) {
    return loaderPromise;
  }

  loaderPromise = new Promise<PuterSdk>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      loaderPromise = null;
      reject(
        new Error(
          'โหลด Puter.js ไม่สำเร็จ (timeout) — ตรวจสอบว่าเบราว์เซอร์เข้าถึง https://js.puter.com ได้'
        )
      );
    }, 20_000);

    const script = document.createElement('script');
    script.src = PUTER_SCRIPT_URL;
    script.async = true;

    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.puter) {
        resolve(window.puter);
      } else {
        loaderPromise = null;
        reject(new Error('Puter.js โหลดแล้วแต่ไม่พบตัว SDK บน window.puter'));
      }
    };

    script.onerror = () => {
      window.clearTimeout(timeout);
      loaderPromise = null;
      reject(
        new Error(
          'โหลด Puter.js ไม่สำเร็จ — เบราว์เซอร์อาจถูกบล็อกไม่ให้เชื่อมต่อ js.puter.com'
        )
      );
    };

    document.head.appendChild(script);
  });

  return loaderPromise;
}

/** Puter currently needs a user gesture to open the sign-in popup. */
export async function isPuterSignedIn(puter: PuterSdk) {
  try {
    return Boolean(await puter.auth.isSignedIn());
  } catch {
    return false;
  }
}

function coerceModelEntry(entry: unknown): PuterModel | null {
  if (typeof entry === 'string') {
    return { id: entry };
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const id = [record.id, record.model, record.name, record.slug]
    .find((value) => typeof value === 'string' && value.length > 0) as string | undefined;

  if (!id) return null;

  return {
    id,
    provider:
      (typeof record.provider === 'string' && record.provider) ||
      (typeof record.vendor === 'string' && record.vendor) ||
      (id.includes('/') ? id.split('/')[0] : undefined) ||
      undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
    context:
      typeof record.context === 'number'
        ? record.context
        : typeof record.context_window === 'number'
          ? record.context_window
          : null,
    max_tokens: typeof record.max_tokens === 'number' ? record.max_tokens : null,
    aliases: Array.isArray(record.aliases) ? (record.aliases as string[]) : null,
    cost: (record.cost as PuterModel['cost']) ?? null
  };
}

/** `puter.ai.listModels()` may return an array, a map or a { models: [] } wrapper. */
export function normalizeModels(raw: unknown): PuterModel[] {
  const candidates: unknown[] = [];

  if (Array.isArray(raw)) {
    candidates.push(...raw);
  } else if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.models)) {
      candidates.push(...record.models);
    } else if (Array.isArray(record.data)) {
      candidates.push(...record.data);
    } else {
      candidates.push(...Object.values(record));
    }
  }

  const seen = new Set<string>();
  const models: PuterModel[] = [];

  for (const candidate of candidates) {
    const model = coerceModelEntry(candidate);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

/** Used before sign-in / when listModels() is unavailable. */
export const FALLBACK_MODELS: PuterModel[] = [
  { id: 'openai/gpt-5.4-nano', provider: 'openai', name: 'GPT-5.4 Nano' },
  { id: 'openai/gpt-5.6-luna', provider: 'openai', name: 'GPT-5.6 Luna' },
  { id: 'anthropic/claude-sonnet-5', provider: 'anthropic', name: 'Claude Sonnet 5' },
  { id: 'anthropic/claude-sonnet-4', provider: 'anthropic', name: 'Claude Sonnet 4' },
  { id: 'google/gemini-3.1-pro-preview', provider: 'google', name: 'Gemini 3.1 Pro' },
  { id: 'google/gemini-3.1-flash-lite', provider: 'google', name: 'Gemini 3.1 Flash Lite' },
  { id: 'x-ai/grok-4.7', provider: 'x-ai', name: 'Grok 4.7' }
];

export const DEFAULT_MODEL = 'openai/gpt-5.4-nano';

/** Streaming chunks look like { text } (and occasionally { message.content }). */
export function extractChunkText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (!chunk || typeof chunk !== 'object') return '';

  const record = chunk as Record<string, unknown>;

  if (typeof record.text === 'string') return record.text;

  const message = record.message as Record<string, unknown> | undefined;
  if (message) {
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) =>
          part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
            ? (part as { text: string }).text
            : ''
        )
        .join('');
    }
  }

  const delta = record.delta as Record<string, unknown> | undefined;
  if (delta && typeof delta.content === 'string') return delta.content;

  return '';
}

/** Non-streaming responses can be a string, an OpenAI-style object or a native one. */
export function extractResponseText(response: unknown): string {
  if (response === null || response === undefined) return '';
  if (typeof response === 'string') return response;

  if (typeof response === 'object') {
    const record = response as Record<string, unknown>;
    const message = record.message as Record<string, unknown> | undefined;

    if (message) {
      if (typeof message.content === 'string') return message.content;
      if (Array.isArray(message.content)) {
        const joined = message.content
          .map((part) =>
            part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
              ? (part as { text: string }).text
              : ''
          )
          .join('');
        if (joined) return joined;
      }
    }

    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;

    const asString = String(record);
    if (asString !== '[object Object]') return asString;
  }

  return String(response);
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  );
}

export function describeError(error: unknown): string {
  if (!error) return 'Unknown error';

  if (typeof error === 'string') return error;

  if (error instanceof Error) {
    const message = error.message || String(error);
    if (/auth|sign|permission|unauthor/i.test(message)) {
      return `${message} — ลองกด “ล็อกอินด้วย Puter” อีกครั้ง`;
    }
    return message;
  }

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.toString;
    if (typeof message === 'string') return message;
    if (typeof record.toString === 'function') {
      const asString = String(record);
      if (asString !== '[object Object]') return asString;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  }

  return String(error);
}

export function formatModelCost(model: PuterModel | undefined) {
  if (!model?.cost || typeof model.cost.input !== 'number' || typeof model.cost.output !== 'number') {
    return null;
  }

  const unit = model.cost.tokens ?? 1_000_000;
  const per = unit === 1_000_000 ? '1M tokens' : `${unit} tokens`;
  return `$${(model.cost.input / 100).toFixed(2)} in / $${(model.cost.output / 100).toFixed(2)} out per ${per}`;
}

export function formatContextWindow(model: PuterModel | undefined) {
  if (!model?.context) return null;
  if (model.context >= 1_000_000) return `${(model.context / 1_000_000).toFixed(1)}M ctx`;
  if (model.context >= 1_000) return `${Math.round(model.context / 1_000)}K ctx`;
  return `${model.context} ctx`;
}

/** Extracts ```lang fenced blocks so the UI can offer "run this". */
export function extractCodeBlocks(content: string) {
  const blocks: { language: string; code: string }[] = [];
  const pattern = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;

  for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
    blocks.push({ language: (match[1] || 'text').toLowerCase(), code: match[2].replace(/\s+$/, '') });
  }

  return blocks;
}

export const SHELL_LANGUAGES = new Set(['sh', 'bash', 'shell', 'zsh', 'console', 'terminal', '']);
