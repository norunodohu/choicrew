import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../firebase';
import {
  doc, setDoc, getDoc, collection, addDoc, onSnapshot,
  query, where, Timestamp,
} from 'firebase/firestore';
import { format, addDays } from 'date-fns';
import { ja } from 'date-fns/locale';

/* ================================================================
   Types
   ================================================================ */

interface TimeSlot {
  id: string;
  date: string;
  start: string;
  end: string;
}


interface ShareData {
  name: string;
  slots: { date: string; start: string; end: string }[];
  created_at: Timestamp;
  expires_at: Timestamp;
}

interface RequestEntry {
  id: string;
  share_id: string;
  slot_date: string;
  slot_start: string;
  slot_end: string;
  requester_name: string;
  message: string;
  created_at: Timestamp;
}

interface OwnedShareEntry {
  id: string;
  name: string;
  created_at: number;
}

/* ================================================================
   Utilities
   ================================================================ */

function genId(len = 8): string {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: len }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

function getDays(count = 7) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const d = addDays(today, i);
    const formatted = format(d, 'M/d(E)', { locale: ja });
    let prefix = '';
    if (i === 0) prefix = '今日 ';
    else if (i === 1) prefix = '明日 ';
    return {
      date: format(d, 'yyyy-MM-dd'),
      label: prefix + formatted,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      isToday: i === 0,
    };
  });
}

function formatSlotDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return format(d, 'M/d(E)', { locale: ja });
}

function isDateToday(dateStr: string): boolean {
  return dateStr === format(new Date(), 'yyyy-MM-dd');
}

function makeShareUrl(id: string): string {
  return `${window.location.origin}/mini/s/${id}`;
}

function makeQrUrl(url: string, size = 160): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;
}

function makeLineShareUrl(name: string, url: string): string {
  const text = `${name}の空き時間をチェック👇\n${url}`;
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

function slotKey(s: { date: string; start: string; end: string }): string {
  return `${s.date}_${s.start}_${s.end}`;
}

function timeToPercent(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return Math.max(0, Math.min(100, ((h * 60 + m - 360) / 1080) * 100));
}

async function nativeShare(title: string, url: string): Promise<boolean> {
  if (!navigator.share) return false;
  try { await navigator.share({ title, url }); return true; } catch { return false; }
}

/* ================================================================
   localStorage helpers
   ================================================================ */

function loadDraftName(): string {
  try {
    const raw = localStorage.getItem('choicrew_mini_draft');
    if (raw) return JSON.parse(raw).name || '';
  } catch { /* ignore */ }
  return '';
}

function saveDraftName(name: string) {
  try {
    localStorage.setItem('choicrew_mini_draft', JSON.stringify({ name }));
  } catch { /* ignore */ }
}

function loadSentSlots(shareId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`mini_sent_${shareId}`);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveSentSlot(shareId: string, key: string, current: Set<string>) {
  const next = new Set(current).add(key);
  try { localStorage.setItem(`mini_sent_${shareId}`, JSON.stringify([...next])); } catch { /* */ }
  return next;
}

function loadRequesterName(): string {
  try { return localStorage.getItem('choicrew_mini_requester') || ''; } catch { return ''; }
}

function saveRequesterName(name: string) {
  try { localStorage.setItem('choicrew_mini_requester', name); } catch { /* */ }
}

function saveOwnedShare(shareId: string, name: string) {
  try {
    const raw = localStorage.getItem('mini_owned_shares');
    let entries: OwnedShareEntry[] = [];
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
        entries = parsed.map((id: string) => ({ id, name: '', created_at: 0 }));
      } else {
        entries = parsed;
      }
    }
    if (!entries.some(e => e.id === shareId)) {
      entries.push({ id: shareId, name, created_at: Date.now() });
      if (entries.length > 10) entries = entries.slice(-10);
      localStorage.setItem('mini_owned_shares', JSON.stringify(entries));
    }
  } catch { /* ignore */ }
}

function isOwnedShare(shareId: string): boolean {
  try {
    const raw = localStorage.getItem('mini_owned_shares');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    if (typeof parsed[0] === 'string') return parsed.includes(shareId);
    return (parsed as OwnedShareEntry[]).some(e => e.id === shareId);
  } catch { return false; }
}

function loadOwnedShares(): OwnedShareEntry[] {
  try {
    const raw = localStorage.getItem('mini_owned_shares');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    if (typeof parsed[0] === 'string') return parsed.map((id: string) => ({ id, name: '', created_at: 0 }));
    return parsed;
  } catch { return []; }
}

/* ================================================================
   Shared Components
   ================================================================ */

function Logo({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'text-xl' : 'text-base';
  return (
    <span className={`${cls} font-bold text-slate-800 font-righteous tracking-wide`}>
      ChoiCrew <span className="text-teal-600">Mini</span>
    </span>
  );
}

function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function TimeBar({ start, end }: { start: string; end: string }) {
  const l = timeToPercent(start);
  const w = Math.max(timeToPercent(end) - l, 3);
  return (
    <div className="h-1 bg-slate-100 rounded-full overflow-hidden mt-2" aria-hidden="true">
      <div
        className="h-full bg-gradient-to-r from-teal-400 to-teal-300 rounded-full"
        style={{ marginLeft: `${l}%`, width: `${w}%` }}
      />
    </div>
  );
}

const AVATAR_COLORS = ['bg-teal-500', 'bg-sky-500', 'bg-amber-500', 'bg-rose-400', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500'];

function nameToColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function Avatar({ name }: { name: string }) {
  return (
    <div
      className={`w-6 h-6 rounded-full ${nameToColor(name)} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}
      title={name}
    >
      {name.charAt(0)}
    </div>
  );
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded-lg ${className}`} />;
}

function ShareViewSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12">
        <div className="text-center mb-8">
          <SkeletonBlock className="h-5 w-28 mx-auto mb-4" />
          <SkeletonBlock className="h-7 w-48 mx-auto mb-2" />
          <SkeletonBlock className="h-4 w-32 mx-auto" />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 mb-3">
            <SkeletonBlock className="h-3 w-16 mb-3" />
            <SkeletonBlock className="h-8 w-32 mb-3" />
            <SkeletonBlock className="h-1 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================
   Toast hook
   ================================================================ */

function useToast(duration = 3000) {
  const [msg, setMsg] = useState<{ text: string; type: 'error' | 'success' } | null>(null);
  const show = useCallback((text: string, type: 'error' | 'success' = 'error') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), duration);
  }, [duration]);
  const UI = msg ? (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl shadow-lg text-sm font-medium animate-[slideDown_0.25s_ease-out] ${
      msg.type === 'error' ? 'bg-red-600 text-white' : 'bg-teal-600 text-white'
    }`}>
      {msg.text}
    </div>
  ) : null;
  return { show, UI };
}

/* ================================================================
   Time presets
   ================================================================ */

const TIME_PRESETS = [
  { label: '午前', start: '09:00', end: '12:00', sub: '9–12' },
  { label: '午後', start: '13:00', end: '17:00', sub: '13–17' },
  { label: '夕方', start: '17:00', end: '21:00', sub: '17–21' },
];

/* ================================================================
   CreateView
   ================================================================ */

function CreateView({ onCreated }: { onCreated: (id: string, name: string) => void }) {
  const [name, setName] = useState(loadDraftName);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set([format(new Date(), 'yyyy-MM-dd')]));
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const days = getDays(7);
  const ownedShares = loadOwnedShares().filter(e => e.name);

  const slotsFor = (date: string) => slots.filter(s => s.date === date);

  const toggleDay = (date: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const addSlot = (date: string, start = '10:00', end = '17:00') => {
    setSlots(prev => [...prev, { id: genId(6), date, start, end }]);
  };

  const updateSlot = (id: string, field: 'start' | 'end', value: string) => {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const removeSlot = (id: string) => {
    setSlots(prev => prev.filter(s => s.id !== id));
  };

  const validSlots = slots.filter(s => s.start < s.end);
  const canCreate = name.trim().length > 0 && validSlots.length > 0;

  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
    try {
      const id = genId(8);
      const now = new Date();
      const expires = addDays(now, 7);
      await setDoc(doc(db, 'mini_shares', id), {
        name: name.trim(),
        slots: validSlots.map(({ date, start, end }) => ({ date, start, end })),
        created_at: Timestamp.fromDate(now),
        expires_at: Timestamp.fromDate(expires),
      });
      saveDraftName(name.trim());
      onCreated(id, name.trim());
    } catch (err) {
      console.error('Failed to create share:', err);
      toast.show('作成に失敗しました。もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {toast.UI}
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12 pb-28 sm:pb-12">

        {/* Header */}
        <div className="text-center mb-10">
          <Logo />
          <p className="text-slate-400 mt-2 text-xs tracking-wide">ログイン不要 · 7日間有効</p>
        </div>

        {/* Name */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6">
          <label htmlFor="creator-name" className="block text-sm font-semibold text-slate-600 mb-2">
            あなたの名前
          </label>
          <input
            id="creator-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="たなか"
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base
                       focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent
                       placeholder:text-slate-300 bg-white"
            maxLength={30}
            autoFocus
          />
        </div>

        {/* Day slots */}
        <div className="space-y-2 mb-8">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-1">
            空き時間
          </p>

          {days.map(day => {
            const daySlots = slotsFor(day.date);
            const isExpanded = expandedDays.has(day.date) || daySlots.length > 0;

            if (!isExpanded) {
              return (
                <button
                  key={day.date}
                  onClick={() => toggleDay(day.date)}
                  className={`w-full flex items-center justify-between rounded-xl px-4 py-3 border transition
                    hover:shadow-sm bg-white border-slate-200
                    ${day.isWeekend ? 'bg-amber-50/40 border-amber-100' : ''}
                    ${day.isToday ? 'border-l-[3px] border-l-teal-400' : ''}`}
                >
                  <span className={`text-sm font-semibold ${day.isToday ? 'text-teal-700' : day.isWeekend ? 'text-amber-700' : 'text-slate-600'}`}>
                    {day.isToday && <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500 mr-1.5 align-middle" />}
                    {day.label}
                  </span>
                  <span className="text-sm text-teal-600 font-medium">＋</span>
                </button>
              );
            }

            return (
              <div
                key={day.date}
                className={`bg-white rounded-2xl border p-4 transition-all animate-[fadeIn_0.15s_ease-out]
                  ${day.isWeekend ? 'border-amber-100 bg-amber-50/30' : 'border-slate-200'}
                  ${day.isToday ? 'border-l-[3px] border-l-teal-400' : ''}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <p className={`text-sm font-semibold ${day.isToday ? 'text-teal-700' : day.isWeekend ? 'text-amber-700' : 'text-slate-600'}`}>
                    {day.isToday && <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500 mr-1.5 align-middle" />}
                    {day.label}
                  </p>
                  {daySlots.length === 0 && (
                    <button onClick={() => toggleDay(day.date)} className="text-xs text-slate-400 hover:text-slate-600 transition">
                      閉じる
                    </button>
                  )}
                </div>

                {daySlots.map(slot => (
                  <div key={slot.id} className="mb-3 animate-[fadeIn_0.15s_ease-out]">
                    <div className="flex items-center gap-2">
                      <label className="sr-only" htmlFor={`start-${slot.id}`}>開始時間</label>
                      <input
                        id={`start-${slot.id}`}
                        type="time"
                        value={slot.start}
                        onChange={e => updateSlot(slot.id, 'start', e.target.value)}
                        className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-base text-center bg-white"
                      />
                      <span className="text-slate-300 text-sm">–</span>
                      <label className="sr-only" htmlFor={`end-${slot.id}`}>終了時間</label>
                      <input
                        id={`end-${slot.id}`}
                        type="time"
                        value={slot.end}
                        onChange={e => updateSlot(slot.id, 'end', e.target.value)}
                        className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-base text-center bg-white"
                      />
                      <button
                        onClick={() => removeSlot(slot.id)}
                        className="text-slate-300 hover:text-red-400 p-1.5 transition-colors rounded-lg
                                   focus:outline-none focus:ring-2 focus:ring-red-300"
                        aria-label="この時間枠を削除"
                      >
                        ✕
                      </button>
                    </div>
                    {slot.start < slot.end && <TimeBar start={slot.start} end={slot.end} />}
                    {slot.start >= slot.end && (
                      <p className="text-xs text-red-500 mt-1">開始は終了より前にしてください</p>
                    )}
                  </div>
                ))}

                {/* Presets */}
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {TIME_PRESETS.map(p => (
                    <button
                      key={p.label}
                      onClick={() => addSlot(day.date, p.start, p.end)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium
                                 bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-100/50 transition"
                    >
                      {p.label}
                      <span className="text-teal-400">{p.sub}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => addSlot(day.date)}
                    className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-medium
                               bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-100/50 transition"
                  >
                    カスタム
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Inline CTA — desktop */}
        <div className="hidden sm:block">
          <button
            onClick={handleCreate}
            disabled={!canCreate || saving}
            className="w-full bg-teal-600 text-white rounded-xl py-3.5 font-bold
                       hover:bg-teal-700 disabled:opacity-40 transition text-base shadow-sm"
          >
            {saving ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Spinner /> 作成中...
              </span>
            ) : '共有リンクを作成'}
          </button>
          {name.trim() && slots.length > 0 && validSlots.length === 0 && (
            <p className="text-center text-sm text-red-400 mt-2">有効な時間帯がありません</p>
          )}
        </div>

        {/* Recent shares */}
        {ownedShares.length > 0 && (
          <div className="mt-10 pt-6 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-1">最近の共有</p>
            <div className="space-y-1">
              {ownedShares.slice(-3).reverse().map(entry => (
                <a
                  key={entry.id}
                  href={`/mini/s/${entry.id}`}
                  className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white transition group border border-transparent hover:border-slate-200"
                >
                  <span className="text-sm text-slate-500 group-hover:text-slate-700 transition truncate">
                    {entry.name}の空き時間
                  </span>
                  <span className="text-slate-300 group-hover:text-teal-500 transition ml-2 shrink-0">→</span>
                </a>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Sticky CTA — mobile */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-sm border-t border-slate-100 p-4 sm:hidden z-30">
        <div className="max-w-lg mx-auto">
          <button
            onClick={handleCreate}
            disabled={!canCreate || saving}
            className="w-full bg-teal-600 text-white rounded-xl py-3.5 font-bold
                       hover:bg-teal-700 disabled:opacity-40 transition text-base"
          >
            {saving ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Spinner /> 作成中...
              </span>
            ) : `共有リンクを作成${validSlots.length > 0 ? ` (${validSlots.length}枠)` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   RequestModal
   ================================================================ */

function RequestModal({ shareId, slot, onClose, onSent }: {
  shareId: string;
  slot: { date: string; start: string; end: string };
  onClose: () => void;
  onSent: () => void;
}) {
  const [name, setName] = useState(loadRequesterName);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>('input,button,[tabindex]');
    if (focusable.length === 0) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    el.addEventListener('keydown', trap);
    return () => el.removeEventListener('keydown', trap);
  }, []);

  const handleSend = async () => {
    if (!name.trim()) return;
    setSending(true);
    setError('');
    try {
      await addDoc(collection(db, 'mini_requests'), {
        share_id: shareId,
        slot_date: slot.date,
        slot_start: slot.start,
        slot_end: slot.end,
        requester_name: name.trim(),
        message: message.trim(),
        created_at: Timestamp.fromDate(new Date()),
      });
      saveRequesterName(name.trim());
      onSent();
    } catch (err) {
      console.error('Failed to send request:', err);
      setError('送信に失敗しました。もう一度お試しください。');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="依頼を送る"
    >
      <div ref={modalRef} className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 space-y-4 animate-[slideUp_0.2s_ease-out]">
        {/* Drag handle — mobile */}
        <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto -mt-1 mb-2 sm:hidden" />

        <h3 className="text-lg font-bold text-slate-800">依頼を送る</h3>

        {/* Selected slot with time bar */}
        <div className="bg-slate-50 rounded-xl p-3">
          <p className="text-base font-semibold tracking-tight text-slate-700">
            {formatSlotDate(slot.date)} {slot.start}–{slot.end}
          </p>
          <TimeBar start={slot.start} end={slot.end} />
        </div>

        <div>
          <label htmlFor="req-name" className="block text-sm font-medium text-slate-600 mb-1">
            あなたの名前 <span className="text-red-400">*</span>
          </label>
          <input
            id="req-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-base
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
            placeholder="山田太郎"
            maxLength={30}
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="req-msg" className="block text-sm font-medium text-slate-600 mb-1">
            メッセージ（任意）
          </label>
          <input
            id="req-msg"
            type="text"
            value={message}
            onChange={e => setMessage(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-base
                       focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
            placeholder="よろしくお願いします"
            maxLength={200}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600
                       hover:bg-slate-50 font-medium transition"
          >
            キャンセル
          </button>
          <button
            onClick={handleSend}
            disabled={!name.trim() || sending}
            className="flex-1 py-2.5 rounded-xl bg-teal-600 text-white font-medium
                       hover:bg-teal-700 disabled:opacity-40 transition"
          >
            {sending ? '送信中...' : '送信する'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   ShareView
   ================================================================ */

function ShareView({ shareId, justCreated }: { shareId: string; justCreated: boolean }) {
  const [share, setShare] = useState<ShareData | null>(null);
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expired, setExpired] = useState(false);
  const [requestSlot, setRequestSlot] = useState<{ date: string; start: string; end: string } | null>(null);
  const [sentSlots, setSentSlots] = useState<Set<string>>(() => loadSentSlots(shareId));
  const [copied, setCopied] = useState(false);
  const isOwner = justCreated || isOwnedShare(shareId);
  const toast = useToast();

  const url = makeShareUrl(shareId);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'mini_shares', shareId));
        if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
        const data = snap.data() as ShareData;
        if (data.expires_at.toDate() < new Date()) setExpired(true);
        setShare(data);
      } catch (err) {
        console.error('Failed to load share:', err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    load();

    const reqQ = query(collection(db, 'mini_requests'), where('share_id', '==', shareId));
    const unsub = onSnapshot(reqQ, (snap) => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as RequestEntry)));
    });
    return () => unsub();
  }, [shareId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    const shared = await nativeShare(`${share?.name}さんの空き時間`, url);
    if (!shared) handleCopy();
  };

  const handleSent = (slot: { date: string; start: string; end: string }) => {
    const key = slotKey(slot);
    const next = saveSentSlot(shareId, key, sentSlots);
    setSentSlots(next);
    setRequestSlot(null);
    toast.show('依頼を送信しました', 'success');
  };

  const requestsForSlot = (s: { date: string; start: string; end: string }) =>
    requests.filter(r => r.slot_date === s.date && r.slot_start === s.start && r.slot_end === s.end);

  if (loading) return <ShareViewSkeleton />;

  if (notFound) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <p className="text-slate-700 text-lg font-semibold mb-1">リンクが見つかりません</p>
          <p className="text-slate-400 text-sm mb-6">期限切れまたは無効なリンクです</p>
          <a
            href="/mini/"
            className="inline-block bg-teal-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-teal-700 transition"
          >
            空き時間を作成する
          </a>
        </div>
      </div>
    );
  }

  if (!share) return null;

  const sortedSlots = [...share.slots].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.start.localeCompare(b.start);
  });

  const groupedSlots: Record<string, typeof sortedSlots> = {};
  for (const slot of sortedSlots) {
    if (!groupedSlots[slot.date]) groupedSlots[slot.date] = [];
    groupedSlots[slot.date].push(slot);
  }

  const expiryLabel = format(share.expires_at.toDate(), 'M/d(E)', { locale: ja });
  const canShareNative = typeof navigator.share === 'function';

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      {toast.UI}
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12">

        {/* Logo */}
        <div className="text-center mb-5 print:hidden">
          <a href="/mini/" className="hover:opacity-70 transition"><Logo size="sm" /></a>
        </div>

        {/* Just-created banner */}
        {justCreated && (
          <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4 mb-5 print:hidden">
            <p className="font-semibold text-teal-900">作成しました</p>
            <p className="text-sm text-teal-700 mt-1">リンクを相手に共有してください</p>
          </div>
        )}

        {/* Share URL + actions (owner) */}
        {isOwner && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-6 print:hidden">
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={url}
                readOnly
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm bg-slate-50 text-slate-500 truncate"
              />
              <button
                onClick={handleCopy}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                  copied ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {copied ? 'コピー済み' : 'コピー'}
              </button>
            </div>
            <div className="flex gap-2">
              {canShareNative ? (
                <button
                  onClick={handleShare}
                  className="flex-1 py-2.5 rounded-xl text-center text-sm font-medium
                             bg-teal-600 text-white hover:bg-teal-700 transition"
                >
                  共有する
                </button>
              ) : (
                <a
                  href={makeLineShareUrl(share.name, url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2.5 rounded-xl text-center text-sm font-medium
                             bg-[#06C755] text-white hover:bg-[#05b34d] transition"
                >
                  LINEで送る
                </a>
              )}
              <button
                onClick={() => window.print()}
                className="flex-1 py-2.5 rounded-xl text-center text-sm font-medium
                           bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
              >
                印刷する
              </button>
            </div>
          </div>
        )}

        {/* Expired warning */}
        {expired && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5 print:hidden">
            <p className="font-medium text-amber-800">この共有は期限切れです</p>
            <p className="text-sm text-amber-600 mt-1">依頼の送信はできません</p>
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            {share.name}さんの空き時間
          </h1>
          <div className="flex items-center justify-center gap-3 mt-2 text-sm text-slate-400">
            <span>{expiryLabel}まで有効</span>
            {isOwner && requests.length > 0 && (
              <>
                <span className="w-1 h-1 rounded-full bg-slate-300" />
                <span className="text-teal-600 font-medium">{requests.length}件の依頼</span>
              </>
            )}
          </div>
        </div>

        {/* Owner: Request summary */}
        {isOwner && requests.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6 print:hidden">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">依頼一覧</h2>
            <div className="space-y-2">
              {requests
                .sort((a, b) => b.created_at.toMillis() - a.created_at.toMillis())
                .map(r => (
                <div key={r.id} className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-50">
                  <Avatar name={r.requester_name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-700">{r.requester_name}</span>
                      <span className="text-[11px] text-slate-400">
                        {formatSlotDate(r.slot_date)} {r.slot_start}–{r.slot_end}
                      </span>
                    </div>
                    {r.message && (
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{r.message}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Visitor: brief instruction */}
        {!isOwner && !expired && sortedSlots.length > 0 && (
          <p className="text-center text-sm text-slate-400 mb-4">希望の時間帯を選んで依頼できます</p>
        )}

        {/* Date-grouped slot cards */}
        <div className="space-y-6 mb-8">
          {Object.entries(groupedSlots).map(([date, dateSlots]) => {
            const today = isDateToday(date);
            return (
              <div key={date}>
                {/* Date header */}
                <div className="flex items-center gap-2 mb-2.5 px-1">
                  {today && <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />}
                  <h2 className={`text-sm font-semibold ${today ? 'text-teal-700' : 'text-slate-400'}`}>
                    {formatSlotDate(date)}
                    {today && <span className="ml-1.5 text-xs font-normal text-teal-500">今日</span>}
                  </h2>
                </div>

                {/* Slots for this date */}
                <div className="space-y-2.5">
                  {dateSlots.map((slot, i) => {
                    const key = slotKey(slot);
                    const sent = sentSlots.has(key);
                    const reqs = requestsForSlot(slot);
                    return (
                      <div key={i} className={`bg-white rounded-2xl border p-4 print:border-slate-300 transition-colors ${reqs.length > 0 && isOwner ? 'border-teal-200 border-l-[3px] border-l-teal-400' : 'border-slate-200'}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-2xl font-semibold tracking-tight text-slate-800">
                              {slot.start}<span className="text-slate-300 mx-1.5">–</span>{slot.end}
                            </p>
                            <TimeBar start={slot.start} end={slot.end} />
                            {!expired && reqs.length > 0 && !isOwner && (
                              <p className="text-xs text-teal-600 font-medium mt-2">{reqs.length}人が希望</p>
                            )}
                          </div>
                          <div className="ml-3 shrink-0 print:hidden">
                            {isOwner ? (
                              reqs.length > 0 ? (
                                <span className="text-sm text-teal-700 font-medium bg-teal-50 px-3 py-1.5 rounded-lg">
                                  {reqs.length}件
                                </span>
                              ) : null
                            ) : expired ? (
                              <span className="text-xs text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg">期限切れ</span>
                            ) : sent ? (
                              <span className="text-sm text-teal-700 font-medium bg-teal-50 px-3 py-1.5 rounded-lg">
                                依頼済み
                              </span>
                            ) : (
                              <button
                                onClick={() => setRequestSlot(slot)}
                                className="bg-teal-600 text-white text-sm font-medium rounded-xl
                                           px-5 py-2.5 hover:bg-teal-700 active:scale-95 transition-all shadow-sm"
                              >
                                依頼する
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Owner: requester avatars */}
                        {isOwner && reqs.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-100">
                            <div className="flex flex-wrap gap-2">
                              {reqs.map(r => (
                                <div key={r.id} className="flex items-center gap-1.5 bg-slate-50 rounded-full pl-1 pr-2.5 py-1" title={r.message || undefined}>
                                  <Avatar name={r.requester_name} />
                                  <span className="text-xs font-medium text-slate-600">{r.requester_name}</span>
                                  {r.message && <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {sortedSlots.length === 0 && (
            <div className="text-center py-10">
              <p className="text-slate-400">空き時間が登録されていません</p>
            </div>
          )}
        </div>

        {/* Print-only section */}
        <div className="hidden print:flex print:flex-col print:items-center print:mt-8 print:pt-6 print:border-t print:border-slate-300">
          <img src={makeQrUrl(url)} alt="QR Code" className="w-32 h-32 mb-2" />
          <p className="text-xs text-slate-500 break-all text-center max-w-xs">{url}</p>
          <p className="text-xs text-slate-400 mt-2">QRコードを読み取ると空き時間を確認できます</p>
        </div>

        {/* Footer CTA (visitor) */}
        {!isOwner && (
          <div className="text-center border-t border-slate-100 pt-8 mt-4 print:hidden">
            <p className="text-sm text-slate-500 mb-3">自分も空き時間を共有しませんか？</p>
            <a
              href="/mini/"
              className="inline-block bg-teal-600 text-white rounded-xl px-8 py-3
                         font-medium hover:bg-teal-700 transition shadow-sm"
            >
              空き時間を作成する
            </a>
          </div>
        )}

        {isOwner && (
          <div className="text-center print:hidden">
            <a href="/mini/" className="text-sm text-slate-400 hover:text-slate-600 transition">
              ← 新しく作成する
            </a>
          </div>
        )}

      </div>

      {requestSlot && (
        <RequestModal
          shareId={shareId}
          slot={requestSlot}
          onClose={() => setRequestSlot(null)}
          onSent={() => handleSent(requestSlot)}
        />
      )}
    </div>
  );
}

/* ================================================================
   MiniApp (Router)
   ================================================================ */

export default function MiniApp() {
  const [view, setView] = useState<'loading' | 'create' | 'share'>('loading');
  const [shareId, setShareId] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState(false);

  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/mini\/s\/([A-Za-z0-9]+)/);
    if (match) { setShareId(match[1]); setView('share'); }
    else { setView('create'); }
  }, []);

  useEffect(() => {
    const handlePop = () => {
      const path = window.location.pathname;
      const match = path.match(/^\/mini\/s\/([A-Za-z0-9]+)/);
      if (match) { setShareId(match[1]); setView('share'); setJustCreated(false); }
      else { setView('create'); setJustCreated(false); }
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const handleCreated = (id: string, name: string) => {
    saveOwnedShare(id, name);
    window.history.pushState({}, '', `/mini/s/${id}`);
    setShareId(id);
    setJustCreated(true);
    setView('share');
  };

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideUp {
        from { transform: translateY(100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes slideDown {
        from { transform: translateY(-20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-8px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  switch (view) {
    case 'loading':
      return <ShareViewSkeleton />;
    case 'create':
      return <CreateView onCreated={handleCreated} />;
    case 'share':
      return <ShareView shareId={shareId!} justCreated={justCreated} />;
  }
}
