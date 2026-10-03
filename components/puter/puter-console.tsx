'use client';

import { useCallback, useRef, useState } from 'react';
import {
  BadgeCheck,
  Cloud,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  ShieldCheck,
  TerminalSquare,
  UserRound,
  Wand2,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatPanel, type ChatHandle } from './chat-panel';
import { ModelPicker } from './model-picker';
import { TerminalPanel } from './terminal-panel';
import { usePuter } from './use-puter';
import { useSandbox } from './use-sandbox';

type Toast = { id: string; message: string; kind: 'success' | 'error' };

function prettyUsage(usage: unknown) {
  if (!usage || typeof usage !== 'object') return null;

  const record = usage as Record<string, unknown>;
  const candidates = ['usage', 'credits', 'total', 'monthly_usage']
    .map((key) => record[key])
    .find((value) => value && typeof value === 'object');

  const source = (candidates ?? record) as Record<string, unknown>;
  const entries = Object.entries(source)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
    .slice(0, 6);

  if (entries.length === 0) return null;
  return entries;
}

export function PuterConsole({ initialUsername }: { initialUsername: string | null }) {
  const puter = usePuter(initialUsername);
  const sandbox = useSandbox();
  const chatRef = useRef<ChatHandle | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 6000);
  }, []);

  const runInSandbox = useCallback(
    (command: string) => {
      void sandbox.send(command);
      terminalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      notify('ส่งคำสั่งไปที่แซนบ็อกแล้ว', 'success');
    },
    [notify, sandbox]
  );

  const explainTerminal = useCallback(
    (transcript: string) => {
      chatRef.current?.ask(
        [
          'นี่คือผลลัพธ์ล่าสุดจากเทอร์มินอลในแซนบ็อก:',
          '```',
          transcript,
          '```',
          'ช่วยอธิบายว่าเกิดอะไรขึ้น สรุปสิ่งที่พบ และถ้าต้องมีคำสั่งถัดไปให้ใส่ในบล็อก ```sh'
        ].join('\n')
      );
      notify('ส่งผลลัพธ์เทอร์มินอลให้โมเดลแล้ว');
    },
    [notify]
  );

  const explainFile = useCallback(
    (path: string, content: string) => {
      chatRef.current?.ask(
        [
          `ช่วยรีวิวไฟล์ \`${path}\` ในแซนบ็อกนี้ และเสนอการปรับปรุง:`,
          '```',
          content.slice(0, 8000),
          '```'
        ].join('\n')
      );
      notify(`ส่ง ${path} ให้โมเดลรีวิวแล้ว`);
    },
    [notify]
  );

  const usageEntries = prettyUsage(puter.monthlyUsage);

  return (
    <div className="relative">
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg ${
              toast.kind === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            <span className="flex-1 break-words">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
            >
              <X className="h-3.5 w-3.5 opacity-60" />
            </button>
          </div>
        ))}
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">Puter Console</h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-600">
                ล็อกอินด้วยบัญชี <strong>Puter</strong> เพื่อใช้โมเดล AI 500+ ตัวแบบไม่ต้องมี API key
                (ผู้ใช้จ่ายเอง / User-Pays) — พร้อมเทอร์มินอลแซนบ็อกที่สตรีมผลลัพธ์แบบเรียลไทม์
                และบันทึกผลงานลง Puter Drive ได้
              </p>
            </div>

            <div className="flex flex-col items-stretch gap-2">
              {puter.signedIn ? (
                <Button variant="outline" onClick={() => void puter.signOut()}>
                  <LogOut className="h-4 w-4" />
                  ออกจากระบบ Puter
                  {puter.user?.username ? (
                    <span className="font-mono text-xs text-gray-500">@{puter.user.username}</span>
                  ) : null}
                </Button>
              ) : (
                <Button onClick={() => void puter.signIn()} disabled={puter.signInPending}>
                  {puter.signInPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  ล็อกอินด้วย Puter
                </Button>
              )}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                    puter.signedIn
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 bg-white text-gray-500'
                  }`}
                >
                  <ShieldCheck className="h-3 w-3" />
                  {puter.signedIn ? 'Puter: ล็อกอินแล้ว' : 'Puter: ยังไม่ล็อกอิน'}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-gray-500">
                  <Wand2 className="h-3 w-3" />
                  โมเดล: {puter.models.length}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-gray-500">
                  <TerminalSquare className="h-3 w-3" />
                  แซนบ็อก: {sandbox.state}
                </span>
              </div>
            </div>
          </div>

          {puter.error ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {puter.error}
            </p>
          ) : null}
        </header>

        <div className="grid gap-5 lg:grid-cols-[330px_1fr]">
          <div className="space-y-5">
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                <UserRound className="h-4 w-4 text-gray-500" />
                บัญชี Puter
              </h2>

              {puter.signedIn ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-orange-500 text-sm font-semibold text-white">
                      {puter.profilePicture ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={puter.profilePicture}
                          alt={puter.user?.username ?? 'Puter profile'}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        (puter.user?.username ?? 'P').slice(0, 1).toUpperCase()
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {puter.user?.username ?? 'ไม่ทราบชื่อผู้ใช้'}
                      </p>
                      <p className="truncate font-mono text-[11px] text-gray-500">
                        {puter.user?.email ?? puter.user?.uuid ?? '—'}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                    <p className="flex items-center gap-1 font-medium">
                      <BadgeCheck className="h-3.5 w-3.5" /> เชื่อมต่อกับ Puter แล้ว
                    </p>
                    <p className="mt-1">
                      ค่าใช้จ่ายโมเดลคิดกับบัญชีของคุณ · แอปนี้ไม่เก็บ API key
                      และไม่เห็นรหัสผ่านของคุณ
                    </p>
                  </div>

                  {usageEntries ? (
                    <div className="rounded-lg border border-gray-200 px-3 py-2">
                      <p className="mb-1 text-[11px] font-medium text-gray-700">
                        การใช้งานเดือนนี้ (getMonthlyUsage)
                      </p>
                      <ul className="space-y-0.5 text-[11px] text-gray-600">
                        {usageEntries.map(([key, value]) => (
                          <li key={key} className="flex justify-between gap-2">
                            <span className="font-mono">{key}</span>
                            <span className="font-mono">{String(value)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
                    <Cloud className="mt-0.5 h-3 w-3 shrink-0" />
                    ไฟล์ที่บันทึกผ่านปุ่ม “Save to Puter” จะเก็บในโฟลเดอร์ AppData ของแอปในบัญชี Puter
                    ของคุณ (Puter sandbox ต่อแอป)
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-600">
                    ยังไม่ได้ล็อกอิน Puter — กดปุ่มด้านบนเพื่อเปิดหน้าต่างล็อกอิน
                    (ป๊อปอัปต้องมาจากการคลิกของผู้ใช้)
                  </p>
                  <ul className="space-y-1.5 text-[11px] text-gray-500">
                    <li className="flex items-start gap-1.5">
                      <KeyRound className="mt-0.5 h-3 w-3 shrink-0" />
                      ไม่ต้องใช้ API key ของ OpenAI/Anthropic/Google
                    </li>
                    <li className="flex items-start gap-1.5">
                      <Cloud className="mt-0.5 h-3 w-3 shrink-0" />
                      ได้พื้นที่เก็บไฟล์ + KV ส่วนตัวต่อผู้ใช้
                    </li>
                    <li className="flex items-start gap-1.5">
                      <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
                      แนะนำให้ใช้บัญชี Puter สำหรับการทดลอง ไม่ใช่บัญชีที่ผูกบัตรจริง
                    </li>
                  </ul>
                </div>
              )}
            </section>

            <ModelPicker
              models={puter.models}
              selected={puter.selectedModel}
              onSelect={puter.setSelectedModel}
              onRefresh={() => void puter.refreshModels()}
              refreshing={puter.modelsSource === 'loading'}
              source={puter.modelsSource}
            />

            <section className="rounded-xl border border-gray-200 bg-white p-4 text-[11px] text-gray-500 shadow-sm">
              <h3 className="mb-2 text-xs font-semibold text-gray-900">ต้องรู้อะไรบ้าง</h3>
              <ul className="list-inside list-disc space-y-1">
                <li>
                  <strong>แซนบ็อกเทอร์มินอล</strong> รันคำสั่งบนเซิร์ฟเวอร์ของแอปนี้
                  (คนละส่วนกับ Puter Drive) — เหมาะทดลองคำสั่ง/สคริปต์
                </li>
                <li>
                  ไฟล์ของแต่ละคนแยกตามบัญชี/คุกกี้ และจะถูกปิดเมื่อไม่มีการใช้งานนาน 30 นาที
                </li>
                <li>
                  อย่าใช้กับข้อมูลลับ: เทอร์มินอลนี้เป็นเดโม ไม่ได้ทำ hardening แบบ production
                </li>
              </ul>
              <p className="mt-3">
                <a
                  href="https://docs.puter.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-orange-600 hover:underline"
                >
                  เอกสาร Puter.js <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </section>
          </div>

          <ChatPanel
            ref={chatRef}
            puter={puter}
            onRunCommand={runInSandbox}
            getTerminalOutput={sandbox.getOutput}
            notify={notify}
          />
        </div>

        <div ref={terminalRef} className="mt-5">
          <TerminalPanel sandbox={sandbox} onExplain={explainTerminal} onExplainFile={explainFile} />
        </div>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4 text-[11px] text-gray-500">
          <span>
            ล็อกอิน Puter จะถูกเก็บเป็นคุกกี้ที่เซ็นด้วย AUTH_SECRET ฝั่งเซิร์ฟเวอร์ ·
            ไม่มีการส่งข้อมูลบัญชีไปที่อื่น
          </span>
          <a
            href="https://developer.puter.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-gray-600 hover:text-orange-600"
          >
            Powered by Puter <ExternalLink className="h-3 w-3" />
          </a>
        </footer>
      </div>
    </div>
  );
}
