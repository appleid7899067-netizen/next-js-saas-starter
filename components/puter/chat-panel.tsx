'use client';

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  Bot,
  CloudUpload,
  Copy,
  Eraser,
  Play,
  Send,
  Square,
  Sparkles,
  User as UserIcon,
  Wand2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DEFAULT_MODEL,
  SHELL_LANGUAGES,
  describeError,
  extractChunkText,
  extractResponseText,
  isAsyncIterable,
  loadPuter,
  type ChatMessage
} from '@/lib/puter/client';
import type { UsePuterResult } from './use-puter';

export type ChatHandle = {
  /** Pushes a prompt into the composer and sends it immediately. */
  ask: (prompt: string, options?: { autoSend?: boolean }) => void;
  focus: () => void;
};

type Props = {
  puter: UsePuterResult;
  onRunCommand: (command: string) => void;
  getTerminalOutput: () => string;
  notify: (message: string, kind?: 'success' | 'error') => void;
};

const DEFAULT_SYSTEM_PROMPT = [
  'คุณคือผู้ช่วยของนักพัฒนาในหน้า Puter Console ของแอป Next.js SaaS Starter',
  'ตอบเป็นภาษาไทยถ้าผู้ใช้ถามเป็นภาษาไทย กระชับ ตรงประเด็น และใช้โค้ดบล็อกเมื่อให้คำสั่งเชลล์',
  'ถ้าให้คำสั่งเชลล์ ให้ใส่ในบล็อก ```sh เพื่อให้ผู้ใช้กดปุ่ม Run ในแซนบ็อกได้'
].join('\n');

function renderInline(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${index++}`;

    if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[12px] text-orange-700">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      nodes.push(
        <a key={key} href={token} target="_blank" rel="noreferrer" className="text-orange-600 underline">
          {token}
        </a>
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function MessageBody({
  content,
  onRunCommand
}: {
  content: string;
  onRunCommand: (command: string) => void;
}) {
  const parts = useMemo(() => {
    const chunks: { type: 'text' | 'code'; language?: string; value: string }[] = [];
    const pattern = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)(?:```|$)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
      if (match.index > lastIndex) {
        chunks.push({ type: 'text', value: content.slice(lastIndex, match.index) });
      }
      chunks.push({ type: 'code', language: (match[1] || '').toLowerCase(), value: match[2] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      chunks.push({ type: 'text', value: content.slice(lastIndex) });
    }

    return chunks;
  }, [content]);

  return (
    <div className="space-y-2">
      {parts.map((part, index) =>
        part.type === 'code' ? (
          <div key={index} className="overflow-hidden rounded-lg border border-gray-800 bg-[#0b1020]">
            <div className="flex items-center justify-between border-b border-gray-800 px-3 py-1">
              <span className="font-mono text-[11px] text-gray-400">
                {part.language || 'code'}
              </span>
              {SHELL_LANGUAGES.has(part.language ?? '') ? (
                <button
                  type="button"
                  onClick={() => onRunCommand(part.value.trim())}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-emerald-400 hover:bg-emerald-500/10"
                >
                  <Play className="h-3 w-3" /> Run ในแซนบ็อก
                </button>
              ) : null}
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[12px] leading-relaxed text-gray-100">
              {part.value}
            </pre>
          </div>
        ) : (
          <p key={index} className="whitespace-pre-wrap break-words leading-relaxed">
            {renderInline(part.value, `t-${index}`)}
          </p>
        )
      )}
    </div>
  );
}

export const ChatPanel = forwardRef<ChatHandle, Props>(function ChatPanel(
  { puter, onRunCommand, getTerminalOutput, notify },
  ref
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [showSettings, setShowSettings] = useState(false);
  const [temperature, setTemperature] = useState(0.4);
  const [attachTerminal, setAttachTerminal] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [saving, setSaving] = useState(false);

  const abortRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
  }, []);

  const updateMessage = useCallback(
    (id: string, updater: (message: ChatMessage) => ChatMessage) => {
      setMessages((current) => current.map((message) => (message.id === id ? updater(message) : message)));
      scrollToBottom();
    },
    [scrollToBottom]
  );

  const send = useCallback(
    async (rawContent?: string) => {
      const content = (rawContent ?? input).trim();
      if (!content || streaming) return;

      setInput('');
      setStreaming(true);
      abortRef.current = false;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: Date.now()
      };

      const history = [...messages, userMessage];
      setMessages(history);
      scrollToBottom();

      const assistantId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          model: puter.selectedModel,
          createdAt: Date.now()
        }
      ]);
      scrollToBottom();

      try {
        const sdk = puter.sdk ?? (await loadPuter());

        const systemText = attachTerminal
          ? `${systemPrompt}\n\n[ผลลัพธ์เทอร์มินอลล่าสุดของแซนบ็อก]\n\`\`\`\n${getTerminalOutput()
              .split('\n')
              .slice(-80)
              .join('\n')}\n\`\`\``
          : systemPrompt;

        const payload = [
          { role: 'system' as const, content: systemText },
          ...history.map((message) => ({ role: message.role, content: message.content }))
        ];

        const options = {
          model: puter.selectedModel || DEFAULT_MODEL,
          temperature
        };

        let response: unknown;

        try {
          response = await sdk.ai.chat(payload, { ...options, stream: true });
        } catch (streamError) {
          // Some models/vendors do not support streaming — retry without it.
          console.warn('[puter] streaming failed, retrying without stream', streamError);
          response = await sdk.ai.chat(payload, { ...options, stream: false });
        }

        if (isAsyncIterable(response)) {
          let accumulated = '';

          for await (const chunk of response) {
            if (abortRef.current) break;
            const piece = extractChunkText(chunk);
            if (!piece) continue;
            accumulated += piece;
            updateMessage(assistantId, (message) => ({ ...message, content: accumulated }));
          }

          if (!accumulated) {
            updateMessage(assistantId, (message) => ({
              ...message,
              content: '_(โมเดลไม่ได้ส่งข้อความกลับมา — ลองเลือกโมเดลอื่นหรือถามใหม่อีกครั้ง)_'
            }));
          }
        } else {
          const text = extractResponseText(response);
          updateMessage(assistantId, (message) => ({ ...message, content: text || '(ว่าง)' }));
        }
      } catch (error) {
        const description = describeError(error);
        updateMessage(assistantId, (message) => ({
          ...message,
          content: `⚠️ ${description}`,
          error: true
        }));
        notify(description, 'error');
      } finally {
        setStreaming(false);
        abortRef.current = false;
      }
    },
    [
      attachTerminal,
      getTerminalOutput,
      input,
      messages,
      notify,
      puter.selectedModel,
      puter.sdk,
      scrollToBottom,
      streaming,
      systemPrompt,
      temperature,
      updateMessage
    ]
  );

  useImperativeHandle(
    ref,
    () => ({
      ask: (prompt: string, options?: { autoSend?: boolean }) => {
        if (options?.autoSend === false) {
          setInput(prompt);
        } else {
          void send(prompt);
        }
        textareaRef.current?.focus();
      },
      focus: () => textareaRef.current?.focus()
    }),
    [send]
  );

  const buildTranscript = useCallback(() => {
    const lines: string[] = [
      '# Puter Console transcript',
      '',
      `- model: \`${puter.selectedModel}\``,
      `- puter user: \`${puter.user?.username ?? 'not signed in'}\``,
      `- exported: ${new Date().toISOString()}`,
      '',
      '## บทสนทนา'
    ];

    for (const message of messages) {
      lines.push('', `### ${message.role === 'user' ? '🧑 user' : '🤖 assistant'}`, '', message.content);
    }

    const terminal = getTerminalOutput().trim();
    if (terminal) {
      lines.push('', '## เทอร์มินอล (ท้ายสุด 200 บรรทัด)', '', '```', terminal.split('\n').slice(-200).join('\n'), '```');
    }

    return lines.join('\n');
  }, [getTerminalOutput, messages, puter.selectedModel, puter.user?.username]);

  const saveToPuterDrive = useCallback(async () => {
    if (!puter.sdk) {
      notify('ยังโหลด Puter.js ไม่เสร็จ', 'error');
      return;
    }

    if (messages.length === 0) {
      notify('ยังไม่มีบทสนทนาให้บันทึก', 'error');
      return;
    }

    setSaving(true);
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = `puter-console/chat-${stamp}.md`;
      const blob = new Blob([buildTranscript()], { type: 'text/markdown' });
      const result = (await puter.sdk.fs.write(path, blob)) as { path?: string } | undefined;
      notify(`บันทึกไปยัง Puter Drive แล้ว: ${result?.path ?? path}`, 'success');
    } catch (error) {
      notify(`บันทึกลง Puter Drive ไม่สำเร็จ: ${describeError(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [buildTranscript, messages.length, notify, puter.sdk]);

  return (
    <section className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-orange-500" />
          <h2 className="text-sm font-semibold text-gray-900">
            แชทกับโมเดล <span className="font-normal text-gray-500">/ Puter AI</span>
          </h2>
          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 font-mono text-[11px] text-gray-500">
            {puter.selectedModel}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
            <input
              type="checkbox"
              checked={attachTerminal}
              onChange={(event) => setAttachTerminal(event.target.checked)}
              className="h-3.5 w-3.5 accent-orange-500"
            />
            แนบผลลัพธ์เทอร์มินอล
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowSettings((value) => !value)}
            title="ตั้งค่า prompt / temperature"
          >
            <Bot className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void saveToPuterDrive()}
            disabled={saving || messages.length === 0}
            title="บันทึกบทสนทนาไปยัง Puter Drive (AppData ของแอป)"
          >
            <CloudUpload className="h-3.5 w-3.5" />
            Save to Puter
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMessages([])}
            disabled={messages.length === 0 || streaming}
          >
            <Eraser className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {showSettings ? (
        <div className="space-y-3 border-b border-gray-200 bg-gray-50/70 px-4 py-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-600">System prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              className="h-20 w-full resize-y rounded-lg border border-gray-300 p-2 text-xs outline-none focus:border-orange-400"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[11px] font-medium text-gray-600">
              Temperature: {temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.1}
              value={temperature}
              onChange={(event) => setTemperature(Number(event.target.value))}
              className="w-40 accent-orange-500"
            />
          </div>
        </div>
      ) : null}

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-600">
            <p className="mb-2 font-medium text-gray-800">เริ่มใช้งานได้เลย — ตัวอย่างคำสั่ง:</p>
            <ul className="list-inside list-disc space-y-1 text-xs">
              <li>“เขียนสคริปต์ bash นับไฟล์ในโฟลเดอร์นี้ แล้วให้ฉันกด Run”</li>
              <li>“อธิบายว่าโปรเจกต์ Next.js นี้ทำงานอย่างไร”</li>
              <li>“สร้างไฟล์ notes.md แล้วเขียนสรุปสถาปัตยกรรมของแอปนี้”</li>
            </ul>
            <p className="mt-3 text-xs text-gray-500">
              ครั้งแรกที่เรียกโมเดล Puter จะเปิดหน้าต่างให้ล็อกอิน (ถ้ายังไม่ได้ล็อกอิน)
              ค่าใช้งานโมเดลคิดกับบัญชี Puter ของคุณ
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <div key={message.id} className="flex gap-3">
            <div
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                message.role === 'user' ? 'bg-gray-900 text-white' : 'bg-orange-500 text-white'
              }`}
            >
              {message.role === 'user' ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>
            <div
              className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm ${
                message.error
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : message.role === 'user'
                    ? 'border-gray-200 bg-gray-50 text-gray-900'
                    : 'border-gray-200 bg-white text-gray-800'
              }`}
            >
              {message.content.length === 0 && streaming ? (
                <span className="inline-flex items-center gap-2 text-gray-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
                  กำลังสตรีม…
                </span>
              ) : (
                <MessageBody content={message.content} onRunCommand={onRunCommand} />
              )}
              {message.model ? (
                <p className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
                  <span className="font-mono">{message.model}</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-gray-600"
                    onClick={() => {
                      void navigator.clipboard.writeText(message.content);
                      notify('คัดลอกข้อความแล้ว', 'success');
                    }}
                  >
                    <Copy className="h-3 w-3" /> copy
                  </button>
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 bg-gray-50 px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={
              puter.signedIn
                ? 'ถามอะไรก็ได้ — Enter เพื่อส่ง, Shift+Enter ขึ้นบรรทัดใหม่'
                : 'พิมพ์แล้วกด Enter ระบบจะเปิดหน้าต่างล็อกอิน Puter ให้อัตโนมัติ'
            }
            className="min-h-[52px] flex-1 resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400"
          />
          {streaming ? (
            <Button
              variant="outline"
              onClick={() => {
                abortRef.current = true;
              }}
              title="หยุดสตรีม"
            >
              <Square className="h-4 w-4" /> หยุด
            </Button>
          ) : (
            <Button onClick={() => void send()} disabled={input.trim().length === 0}>
              <Send className="h-4 w-4" /> ส่ง
            </Button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          <label className="sr-only" htmlFor="chat-model">
            โมเดล
          </label>
          <select
            id="chat-model"
            value={puter.selectedModel}
            onChange={(event) => puter.setSelectedModel(event.target.value)}
            className="max-w-[260px] rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-[11px] text-gray-700"
          >
            {puter.models.slice(0, 400).map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </select>
          {puter.isFallbackModels ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
              ใช้รายการโมเดลสำรอง — กด “รีเฟรชโมเดล” หลังล็อกอิน
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Wand2 className="h-3 w-3" />
            Puter จะคิดค่าโมเดลกับบัญชีของคุณ (User-Pays) — แอปนี้ไม่ต้องใช้ API key
          </span>
        </div>
      </div>

    </section>
  );
});
