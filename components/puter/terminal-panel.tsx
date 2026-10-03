'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Eraser,
  FolderTree,
  Loader2,
  Radio,
  RotateCcw,
  SquareSlash,
  TerminalSquare,
  Wand2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ansiToHtml } from '@/lib/sandbox/ansi';
import type { useSandbox } from './use-sandbox';
import { FilesPanel } from './files-panel';

type Sandbox = ReturnType<typeof useSandbox>;

const MAX_VISIBLE_CHARS = 14_000;

const QUICK_COMMANDS = [
  'pwd',
  'ls -la',
  'node -v && pnpm -v',
  'cat package.json | head -30',
  'git status --short',
  'df -h .',
  'echo "hello from the sandbox" | rev'
];

const STATE_LABEL: Record<Sandbox['state'], string> = {
  idle: 'ยังไม่เชื่อมต่อ',
  starting: 'กำลังเปิดแซนบ็อก…',
  live: 'สตรีมสด',
  reconnecting: 'กำลังเชื่อมต่อใหม่…',
  polling: 'โหมดสำรอง (polling)',
  ended: 'จบเซสชัน',
  error: 'ผิดพลาด',
  disabled: 'ปิดใช้งาน'
};

const STATE_DOT: Record<Sandbox['state'], string> = {
  idle: 'bg-gray-400',
  starting: 'bg-amber-400 animate-pulse',
  live: 'bg-emerald-500 animate-pulse',
  reconnecting: 'bg-amber-400 animate-pulse',
  polling: 'bg-sky-400 animate-pulse',
  ended: 'bg-gray-400',
  error: 'bg-red-500',
  disabled: 'bg-gray-400'
};

function prepareTerminalHtml(raw: string) {
  // Drop escape sequences we do not render (DEC private modes such as
  // bracketed-paste \u001b[?2004h, cursor movement, OSC titles, …) while
  // keeping SGR colour codes for ansiToHtml().
  const sanitized = raw
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, (match) =>
      /^\u001b\[[0-9;]*m$/.test(match) ? match : ''
    );

  const withoutCarriageReturns = sanitized
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const parts = line.split('\r');
      return parts[parts.length - 1];
    })
    .join('\n');

  const tail =
    withoutCarriageReturns.length > MAX_VISIBLE_CHARS
      ? withoutCarriageReturns.slice(withoutCarriageReturns.length - MAX_VISIBLE_CHARS)
      : withoutCarriageReturns;

  return ansiToHtml(tail);
}

export function TerminalPanel({
  sandbox,
  onExplain,
  onExplainFile
}: {
  sandbox: Sandbox;
  onExplain: (transcript: string) => void;
  onExplainFile?: (path: string, content: string) => void;
}) {
  const [command, setCommand] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [showFiles, setShowFiles] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const html = useMemo(
    () => prepareTerminalHtml(sandbox.outputRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sandbox.version]
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !stickToBottom.current) return;
    container.scrollTop = container.scrollHeight;
  }, [html]);

  useEffect(() => {
    if (sandbox.state === 'idle') {
      void sandbox.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    const trimmed = command.trim();
    if (!trimmed) return;
    setCommand('');
    setHistoryIndex(null);
    void sandbox.send(trimmed);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (sandbox.history.length === 0) return;
      const nextIndex =
        historyIndex === null
          ? sandbox.history.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setCommand(sandbox.history[nextIndex] ?? '');
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex === null) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= sandbox.history.length) {
        setHistoryIndex(null);
        setCommand('');
        return;
      }
      setHistoryIndex(nextIndex);
      setCommand(sandbox.history[nextIndex] ?? '');
    }
  };

  const isLive = sandbox.state === 'live' || sandbox.state === 'polling' || sandbox.state === 'reconnecting';

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">
            แซนบ็อกเทอร์มินอล <span className="font-normal text-gray-500">/ Sandbox terminal</span>
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600">
            <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[sandbox.state]}`} />
            {STATE_LABEL[sandbox.state]}
          </span>
          {sandbox.meta ? (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-0.5 font-mono text-[11px] text-gray-500">
              <Radio className="h-3 w-3" />
              {sandbox.meta.shell}
              {sandbox.meta.pty ? ' · pty' : ' · pipe'}
              {' · '}
              {sandbox.meta.cwd.split('/').slice(-2).join('/')}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void sandbox.interrupt()}
            disabled={!isLive}
            title="ส่ง Ctrl+C"
          >
            <SquareSlash className="h-3.5 w-3.5" />
            Ctrl+C
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const transcript = sandbox.getOutput();
              if (transcript.trim().length === 0) return;
              onExplain(transcript.split('\n').slice(-120).join('\n'));
            }}
            disabled={!isLive}
            title="ส่งผลลัพธ์ล่าสุดให้โมเดลอธิบาย"
          >
            <Wand2 className="h-3.5 w-3.5" />
            ให้ AI อธิบาย
          </Button>
          <Button variant="outline" size="sm" onClick={sandbox.clear} title="ล้างหน้าจอ">
            <Eraser className="h-3.5 w-3.5" />
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void sandbox.restart()}
            title="เปิดเซสชันใหม่"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restart
          </Button>
        </div>
      </header>

      <div className="grid lg:grid-cols-[1fr_290px]">
        <div className="min-w-0 border-gray-200 lg:border-r">
          <div
            ref={scrollRef}
            onScroll={(event) => {
              const element = event.currentTarget;
              stickToBottom.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < 48;
            }}
            className="h-[380px] overflow-y-auto bg-[#0b1020] px-4 py-3"
          >
            {sandbox.version === 0 && sandbox.state === 'starting' ? (
              <div className="flex items-center gap-2 font-mono text-xs text-gray-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังเปิดเชลล์…
              </div>
            ) : (
              <pre
                className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-gray-200"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
          </div>

          <div className="border-t border-gray-200 bg-gray-50 px-3 py-3">
            <div className="flex flex-wrap gap-1.5 pb-2">
              {QUICK_COMMANDS.map((quick) => (
                <button
                  key={quick}
                  type="button"
                  onClick={() => {
                    setCommand(quick);
                    inputRef.current?.focus();
                  }}
                  className="rounded-full border border-gray-200 bg-white px-2.5 py-1 font-mono text-[11px] text-gray-600 transition-colors hover:border-orange-300 hover:text-orange-600"
                >
                  {quick}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-2 py-1.5 focus-within:border-orange-400">
              <span className="font-mono text-sm text-emerald-600">➜</span>
              <input
                ref={inputRef}
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                autoComplete="off"
                placeholder={isLive ? 'พิมพ์คำสั่งแล้วกด Enter — ↑/↓ ดูประวัติ' : 'เซสชันยังไม่พร้อมใช้งาน'}
                disabled={!isLive}
                className="flex-1 bg-transparent font-mono text-sm text-gray-900 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
              />
              <Button size="sm" onClick={submit} disabled={!isLive || command.trim().length === 0}>
                Run
              </Button>
            </div>

            {sandbox.error ? (
              <p className="pt-2 text-xs text-red-600">{sandbox.error}</p>
            ) : (
              <p className="pt-2 text-[11px] text-gray-500">
                คำสั่งรันอยู่บนคอนเทนเนอร์เดียวกับแอปนี้ (คนละอย่างกับแซนบ็อก Puter AppData) —
                ไฟล์ทั้งหมดอยู่ในเวิร์กสเปซของคุณ
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-gray-200 lg:border-t-0">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700">
              <FolderTree className="h-3.5 w-3.5 text-gray-500" />
              ไฟล์ในแซนบ็อก
            </span>
            <button
              type="button"
              onClick={() => setShowFiles((value) => !value)}
              className="text-[11px] text-gray-500 hover:text-gray-800"
            >
              {showFiles ? 'ซ่อน' : 'แสดง'}
            </button>
          </div>
          {showFiles ? (
            <FilesPanel
              sessionId={sandbox.meta?.sessionId ?? null}
              sandboxVersion={sandbox.version}
              onAskAi={onExplainFile}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
