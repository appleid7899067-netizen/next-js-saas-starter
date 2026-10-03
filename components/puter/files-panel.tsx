'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FilePlus2,
  FileText,
  Folder,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Entry = {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: number;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesPanel({
  sessionId,
  sandboxVersion,
  onAskAi
}: {
  sessionId: string | null;
  sandboxVersion: number;
  onAskAi?: (path: string, content: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ path: string; content: string; dirty: boolean } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [newFile, setNewFile] = useState('');
  const lastVersion = useRef(0);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/sandbox/files?session=${encodeURIComponent(sessionId)}`, {
        cache: 'no-store'
      });
      const payload = (await response.json()) as { entries?: Entry[]; error?: string };

      if (!response.ok) throw new Error(payload.error ?? 'อ่านรายการไฟล์ไม่สำเร็จ');
      setEntries((payload.entries ?? []).filter((entry) => entry.type === 'file'));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh shortly after terminal activity (a command probably created files).
  useEffect(() => {
    if (!sessionId || sandboxVersion === lastVersion.current) return;
    lastVersion.current = sandboxVersion;

    const timer = window.setTimeout(() => void refresh(), 1500);
    return () => window.clearTimeout(timer);
  }, [refresh, sandboxVersion, sessionId]);

  const open = async (path: string) => {
    if (!sessionId) return;
    try {
      const response = await fetch(
        `/api/sandbox/files?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
        { cache: 'no-store' }
      );
      const payload = (await response.json()) as {
        content?: string | null;
        binary?: boolean;
        error?: string;
      };

      if (!response.ok) throw new Error(payload.error ?? 'อ่านไฟล์ไม่สำเร็จ');
      setSelected({ path, content: payload.content ?? '(ไบนารีไฟล์ — แสดงผลไม่ได้)', dirty: false });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    }
  };

  const save = async () => {
    if (!sessionId || !selected) return;
    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/sandbox/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, path: selected.path, content: selected.content })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'บันทึกไม่สำเร็จ');
      setSelected({ ...selected, dirty: false });
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (path: string) => {
    if (!sessionId) return;
    await fetch(
      `/api/sandbox/files?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
      { method: 'DELETE' }
    ).catch(() => undefined);

    if (selected?.path === path) setSelected(null);
    await refresh();
  };

  const create = async () => {
    const name = newFile.trim();
    if (!sessionId || !name) return;
    await fetch('/api/sandbox/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        path: name,
        content: `# ${name}\n\ncreated from the Puter console\n`
      })
    }).catch(() => undefined);

    setNewFile('');
    await refresh();
    void open(name);
  };

  return (
    <div className="flex h-full flex-col gap-2 px-3 pb-3">
      <div className="flex items-center gap-1.5">
        <Input
          value={newFile}
          onChange={(event) => setNewFile(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void create();
          }}
          placeholder="notes.md"
          className="h-8 font-mono text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void create()}
          disabled={!sessionId || newFile.trim().length === 0}
          title="สร้างไฟล์ใหม่"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void refresh()}
          disabled={!sessionId || loading}
          title="รีเฟรช"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="max-h-[190px] overflow-y-auto rounded-lg border border-gray-200">
        {entries.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-gray-400">
            ยังไม่มีไฟล์ — ลองรัน <span className="font-mono">echo hi &gt; hello.txt</span>
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {entries.map((entry) => (
              <li key={entry.path} className="group flex items-center gap-2 px-2 py-1.5">
                <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <button
                  type="button"
                  onClick={() => void open(entry.path)}
                  className="flex-1 truncate text-left font-mono text-[11px] text-gray-700 hover:text-orange-600"
                  title={entry.path}
                >
                  {entry.path}
                </button>
                <span className="shrink-0 text-[10px] text-gray-400">{formatSize(entry.size)}</span>
                <button
                  type="button"
                  onClick={() => void remove(entry.path)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  title="ลบไฟล์"
                >
                  <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected ? (
        <div className="rounded-lg border border-gray-200">
          <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
            <span className="flex items-center gap-1.5 truncate font-mono text-[11px] text-gray-700">
              <Folder className="h-3.5 w-3.5 text-gray-400" />
              {selected.path}
              {selected.dirty ? <span className="text-orange-500">•</span> : null}
            </span>
            <div className="flex items-center gap-1">
              {onAskAi ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => onAskAi(selected.path, selected.content)}
                  title="ให้ AI รีวิวไฟล์นี้"
                >
                  <Sparkles className="h-3 w-3" /> รีวิว
                </Button>
              ) : null}
              <Button
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => void save()}
                disabled={saving || !selected.dirty}
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} บันทึก
              </Button>
              <button type="button" onClick={() => setSelected(null)} title="ปิด">
                <X className="h-4 w-4 text-gray-400 hover:text-gray-700" />
              </button>
            </div>
          </div>
          <textarea
            value={selected.content}
            spellCheck={false}
            onChange={(event) =>
              setSelected({ ...selected, content: event.target.value, dirty: true })
            }
            className="h-40 w-full resize-y bg-white p-2 font-mono text-[11px] leading-relaxed text-gray-800 outline-none"
          />
        </div>
      ) : null}

      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
}
