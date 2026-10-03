'use client';

import { useMemo, useState } from 'react';
import { Check, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatContextWindow, formatModelCost, type PuterModel } from '@/lib/puter/client';

export function ModelPicker({
  models,
  selected,
  onSelect,
  onRefresh,
  refreshing,
  source
}: {
  models: PuterModel[];
  selected: string;
  onSelect: (model: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  source: 'puter' | 'fallback' | 'loading';
}) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? models.filter(
          (model) =>
            model.id.toLowerCase().includes(needle) ||
            (model.name ?? '').toLowerCase().includes(needle) ||
            (model.provider ?? '').toLowerCase().includes(needle)
        )
      : models;

    return showAll ? list : list.slice(0, 60);
  }, [models, query, showAll]);

  const current = useMemo(
    () => models.find((model) => model.id === selected),
    [models, selected]
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <h3 className="text-xs font-semibold text-gray-900">
          เลือกโมเดล <span className="font-normal text-gray-500">({models.length})</span>
        </h3>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          onClick={onRefresh}
          disabled={refreshing}
          title="ดึงรายการโมเดลจากบัญชี Puter"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
          รีเฟรชโมเดล
        </Button>
      </div>

      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2 rounded-lg border border-gray-300 px-2">
          <Search className="h-3.5 w-3.5 text-gray-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาโมเดล เช่น claude, gemini, gpt"
            className="h-8 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-[11px] text-gray-400">ไม่พบโมเดลที่ค้นหา</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.map((model) => (
                <li key={model.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(model.id)}
                    className={`flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-orange-50 ${
                      model.id === selected ? 'bg-orange-50/70' : ''
                    }`}
                  >
                    <span className="mt-0.5 w-3.5 shrink-0 text-orange-500">
                      {model.id === selected ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11px] text-gray-800">
                        {model.id}
                      </span>
                      <span className="block truncate text-[10px] text-gray-500">
                        {[model.provider, model.name, formatContextWindow(model)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {formatModelCost(model) ? (
                        <span className="block text-[10px] text-gray-400">{formatModelCost(model)}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {models.length > filtered.length ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="w-full text-[11px] text-gray-500 hover:text-gray-800"
          >
            แสดงทั้งหมด ({models.length})
          </button>
        ) : null}

        <p className="text-[11px] text-gray-500">
          {source === 'puter'
            ? 'รายการโมเดลสดจากบัญชี Puter ของคุณ — 500+ โมเดล ไม่ต้องใช้ API key'
            : source === 'loading'
              ? 'กำลังดึงรายการโมเดล…'
              : 'รายการสำรอง (ยังไม่ล็อกอิน) — กด “รีเฟรชโมเดล” หลังล็อกอินเพื่อดูทั้งหมด'}
        </p>

        {current && formatModelCost(current) ? (
          <p className="rounded-lg bg-gray-50 px-2 py-1 text-[10px] text-gray-500">
            ค่าใช้งาน {current.id}: {formatModelCost(current)} — คิดกับบัญชี Puter ของคุณ
          </p>
        ) : null}
      </div>
    </div>
  );
}
