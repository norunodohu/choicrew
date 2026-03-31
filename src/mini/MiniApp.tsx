import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../firebase';
import {
  doc, setDoc, getDoc, collection, addDoc, onSnapshot,
  query, where, Timestamp,
} from 'firebase/firestore';
import { format, addDays } from 'date-fns';
import { ja } from 'date-fns/locale';

/* ================================================================
   Design tokens — clean clinical palette
   ================================================================ */

const T = {
  bg: 'bg-white',
  bgSub: 'bg-slate-50',
  border: 'border-slate-200',
  accent: 'teal',               // primary hue
  accentBg: 'bg-teal-600',
  accentHover: 'hover:bg-teal-700',
  accentText: 'text-teal-700',
  accentLight: 'bg-teal-50',
  accentBorder: 'border-teal-100',
  accentShadow: 'shadow-teal-100',
  ring: 'focus:ring-teal-400',
} as const;

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
    };
  });
}

function formatSlotDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return format(d, 'M/d(E)', { locale: ja });
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
  try {
    localStorage.setItem(`mini_sent_${shareId}`, JSON.stringify([...next]));
  } catch { /* ignore */ }
  return next;
}

function loadRequesterName(): string {
  try {
    return localStorage.getItem('choicrew_mini_requester') || '';
  } catch { return ''; }
}

function saveRequesterName(name: string) {
  try {
    localStorage.setItem('choicrew_mini_requester', name);
  } catch { /* ignore */ }
}

function saveOwnedShare(shareId: string) {
  try {
    const raw = localStorage.getItem('mini_owned_shares');
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(shareId)) {
      ids.push(shareId);
      localStorage.setItem('mini_owned_shares', JSON.stringify(ids));
    }
  } catch { /* ignore */ }
}

function isOwnedShare(shareId: string): boolean {
  try {
    const raw = localStorage.getItem('mini_owned_shares');
    if (raw) return (JSON.parse(raw) as string[]).includes(shareId);
  } catch { /* ignore */ }
  return false;
}

/* ================================================================
   Shared Components
   ================================================================ */

function Logo({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'text-xl' : 'text-base';
  return (
    <span className={`${cls} font-bold text-slate-800 font-righteous tracking-wide`}>
      ChoiCrew <span className={T.accentText}>Mini</span>
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
      msg.type === 'error' ? 'bg-red-600 text-white' : `${T.accentBg} text-white`
    }`}>
      {msg.text}
    </div>
  ) : null;
  return { show, UI };
}

/* ================================================================
   CreateView
   ================================================================ */

function CreateView({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState(loadDraftName);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const days = getDays(7);

  const slotsFor = (date: string) => slots.filter(s => s.date === date);

  const addSlot = (date: string) => {
    setSlots(prev => [...prev, { id: genId(6), date, start: '10:00', end: '17:00' }]);
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
      onCreated(id);
    } catch (err) {
      console.error('Failed to create share:', err);
      toast.show('作成に失敗しました。もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`min-h-screen ${T.bgSub}`}>
      {toast.UI}
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12">

        {/* Header */}
        <div className="text-center mb-10">
          <Logo />
          <p className="text-slate-400 mt-3 text-sm leading-relaxed">
            空き時間を入力して共有リンクを作成<br />
            <span className="inline-flex items-center gap-1.5 mt-2 text-xs text-slate-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-400" />
              ログイン不要
              <span className="inline-block w-1 h-1 rounded-full bg-slate-300 mx-1" />
              7日間有効
            </span>
          </p>
        </div>

        {/* Name */}
        <div className={`${T.bg} rounded-2xl border ${T.border} p-5 mb-5`}>
          <label htmlFor="creator-name" className="block text-sm font-semibold text-slate-600 mb-2">
            あなたの名前
          </label>
          <input
            id="creator-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="たなか"
            className={`w-full rounded-xl border ${T.border} px-4 py-3 text-base
                       focus:outline-none focus:ring-2 ${T.ring} focus:border-transparent
                       placeholder:text-slate-300 bg-white`}
            maxLength={30}
          />
        </div>

        {/* Day slots */}
        <div className="space-y-2 mb-8">
          {days.map(day => {
            const daySlots = slotsFor(day.date);

            if (daySlots.length === 0) {
              return (
                <button
                  key={day.date}
                  onClick={() => addSlot(day.date)}
                  className={`w-full flex items-center justify-between rounded-xl px-4 py-3 border transition
                    hover:shadow-sm ${T.bg} ${T.border}
                    ${day.isWeekend ? 'bg-amber-50/40 border-amber-100' : ''}`}
                >
                  <span className={`text-sm font-semibold ${day.isWeekend ? 'text-amber-700' : 'text-slate-600'}`}>
                    {day.label}
                  </span>
                  <span className={`text-sm ${T.accentText} font-medium`}>＋ 追加</span>
                </button>
              );
            }

            return (
              <div
                key={day.date}
                className={`${T.bg} rounded-2xl border p-4 transition-all animate-[fadeIn_0.15s_ease-out]
                  ${day.isWeekend ? 'border-amber-100 bg-amber-50/30' : T.border}`}
              >
                <p className={`text-sm font-semibold mb-2 ${day.isWeekend ? 'text-amber-700' : 'text-slate-600'}`}>
                  {day.label}
                </p>

                {daySlots.map(slot => (
                  <div key={slot.id} className="flex items-center gap-2 mb-2 animate-[fadeIn_0.15s_ease-out]">
                    <label className="sr-only" htmlFor={`start-${slot.id}`}>開始時間</label>
                    <input
                      id={`start-${slot.id}`}
                      type="time"
                      value={slot.start}
                      onChange={e => updateSlot(slot.id, 'start', e.target.value)}
                      className={`flex-1 rounded-lg border ${T.border} px-2 py-2 text-base text-center bg-white`}
                    />
                    <span className="text-slate-400 text-sm">〜</span>
                    <label className="sr-only" htmlFor={`end-${slot.id}`}>終了時間</label>
                    <input
                      id={`end-${slot.id}`}
                      type="time"
                      value={slot.end}
                      onChange={e => updateSlot(slot.id, 'end', e.target.value)}
                      className={`flex-1 rounded-lg border ${T.border} px-2 py-2 text-base text-center bg-white`}
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
                ))}

                {daySlots.some(s => s.start >= s.end) && (
                  <p className="text-xs text-red-500 mb-1">開始は終了より前にしてください</p>
                )}

                <button
                  onClick={() => addSlot(day.date)}
                  className={`text-sm ${T.accentText} hover:text-teal-800 font-medium transition-colors`}
                >
                  ＋ もう1枠
                </button>
              </div>
            );
          })}
        </div>

        {/* Create button */}
        <button
          onClick={handleCreate}
          disabled={!canCreate || saving}
          className={`w-full ${T.accentBg} text-white rounded-xl py-3.5 font-bold
                     ${T.accentHover} disabled:opacity-40 transition text-base
                     shadow-lg ${T.accentShadow}`}
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
        {name.trim() && slots.length === 0 && (
          <p className="text-center text-sm text-slate-400 mt-3">↑ 日付をタップして空き時間を追加</p>
        )}

        <p className="text-center text-xs text-slate-300 mt-12">
          ChoiCrew Mini — ちょっと空き共有
        </p>
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
      <div ref={modalRef} className={`${T.bg} rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 space-y-4
                      animate-[slideUp_0.2s_ease-out]`}>
        <h3 className="text-lg font-bold text-slate-800">依頼を送る</h3>
        <p className="text-sm text-slate-500">
          {formatSlotDate(slot.date)} {slot.start}〜{slot.end}
        </p>

        <div>
          <label htmlFor="req-name" className="block text-sm font-medium text-slate-600 mb-1">
            あなたの名前 <span className="text-red-400">*</span>
          </label>
          <input
            id="req-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className={`w-full rounded-lg border ${T.border} px-3 py-2.5 text-base
                       focus:outline-none focus:ring-2 ${T.ring} bg-white`}
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
            className={`w-full rounded-lg border ${T.border} px-3 py-2.5 text-base
                       focus:outline-none focus:ring-2 ${T.ring} bg-white`}
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
            className={`flex-1 py-2.5 rounded-xl border ${T.border} text-slate-600
                       hover:bg-slate-50 font-medium transition`}
          >
            キャンセル
          </button>
          <button
            onClick={handleSend}
            disabled={!name.trim() || sending}
            className={`flex-1 py-2.5 rounded-xl ${T.accentBg} text-white font-medium
                       ${T.accentHover} disabled:opacity-40 transition`}
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

  if (loading) {
    return (
      <div className={`min-h-screen ${T.bgSub} flex items-center justify-center`}>
        <div className="text-center">
          <Spinner className="h-8 w-8 text-teal-500 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className={`min-h-screen ${T.bgSub} flex items-center justify-center px-4`}>
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🔍</span>
          </div>
          <p className="text-slate-700 text-lg font-semibold mb-1">リンクが見つかりません</p>
          <p className="text-slate-400 text-sm mb-6">期限切れまたは無効なリンクです</p>
          <a
            href="/mini/"
            className={`inline-block ${T.accentBg} text-white rounded-xl px-6 py-3 font-medium ${T.accentHover} transition`}
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

  const expiryLabel = format(share.expires_at.toDate(), 'M/d(E)', { locale: ja });
  const canShare = typeof navigator.share === 'function';

  return (
    <div className={`min-h-screen ${T.bgSub} print:bg-white`}>
      {toast.UI}
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12">

        {/* Logo */}
        <div className="text-center mb-5 print:hidden">
          <a href="/mini/" className="hover:opacity-70 transition"><Logo size="sm" /></a>
        </div>

        {/* Just-created banner */}
        {justCreated && (
          <div className={`${T.accentLight} border ${T.accentBorder} rounded-2xl p-4 mb-5 print:hidden`}>
            <p className="font-semibold text-teal-900">共有リンクを作成しました</p>
            <p className="text-sm text-teal-700 mt-1">
              下のリンクを相手に送ってください（{expiryLabel}まで有効）
            </p>
          </div>
        )}

        {/* Share URL + actions (owner) */}
        {isOwner && (
          <div className={`${T.bg} rounded-2xl border ${T.border} p-4 mb-6 print:hidden`}>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={url}
                readOnly
                className={`flex-1 rounded-lg border ${T.border} px-3 py-2 text-sm bg-slate-50 text-slate-500 truncate`}
              />
              <button
                onClick={handleCopy}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                  copied ? `${T.accentLight} ${T.accentText}` : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {copied ? 'コピー済み' : 'コピー'}
              </button>
            </div>
            <div className="flex gap-2">
              {canShare ? (
                <button
                  onClick={handleShare}
                  className={`flex-1 py-2.5 rounded-xl text-center text-sm font-medium
                             ${T.accentBg} text-white ${T.accentHover} transition`}
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
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-slate-800">
            {share.name}さんの空き時間
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {expiryLabel}まで有効
          </p>
        </div>

        {/* Request summary for owner */}
        {isOwner && requests.length > 0 && (
          <div className="flex items-center gap-2 mb-4 px-1">
            <span className={`inline-flex items-center gap-1.5 ${T.accentLight} ${T.accentText} text-sm font-medium px-3 py-1.5 rounded-full`}>
              {requests.length}件の依頼
            </span>
          </div>
        )}

        {/* Slot cards */}
        <div className="space-y-3 mb-8">
          {sortedSlots.map((slot, i) => {
            const key = slotKey(slot);
            const sent = sentSlots.has(key);
            const reqs = requestsForSlot(slot);
            return (
              <div
                key={i}
                className={`${T.bg} rounded-2xl border ${T.border} p-4 print:border-slate-300`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-400">
                      {formatSlotDate(slot.date)}
                    </p>
                    <p className="text-xl font-bold text-slate-800 mt-0.5">
                      {slot.start} – {slot.end}
                    </p>
                    {!expired && reqs.length > 0 && !isOwner && (
                      <p className={`text-xs ${T.accentText} font-medium mt-1`}>{reqs.length}人が希望</p>
                    )}
                  </div>
                  <div className="print:hidden">
                    {isOwner ? (
                      reqs.length > 0 ? (
                        <span className={`text-sm ${T.accentText} font-medium ${T.accentLight} px-3 py-1.5 rounded-lg`}>
                          {reqs.length}件
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">依頼なし</span>
                      )
                    ) : expired ? (
                      <span className="text-xs text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg">期限切れ</span>
                    ) : sent ? (
                      <span className={`text-sm ${T.accentText} font-medium ${T.accentLight} px-3 py-1.5 rounded-lg`}>
                        依頼済み
                      </span>
                    ) : (
                      <button
                        onClick={() => setRequestSlot(slot)}
                        className={`${T.accentBg} text-white text-sm font-medium rounded-xl
                                   px-5 py-2.5 ${T.accentHover} transition shadow-sm`}
                      >
                        依頼する
                      </button>
                    )}
                  </div>
                </div>

                {isOwner && reqs.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                    {reqs.map(r => (
                      <p key={r.id} className="text-sm text-slate-500">
                        <span className="font-medium text-slate-600">{r.requester_name}</span>
                        {r.message && <span className="text-slate-400">「{r.message}」</span>}
                      </p>
                    ))}
                  </div>
                )}
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

        {/* Footer CTA */}
        {!isOwner && (
          <div className="text-center border-t border-slate-100 pt-8 mt-4 print:hidden">
            <p className="text-sm text-slate-500 mb-3">自分も空き時間を共有しませんか？</p>
            <a
              href="/mini/"
              className={`inline-block ${T.accentBg} text-white rounded-xl px-8 py-3
                         font-medium ${T.accentHover} transition shadow-sm`}
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

        <p className="text-center text-xs text-slate-300 mt-12 print:mt-4">
          ChoiCrew Mini — ちょっと空き共有
        </p>
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

  const handleCreated = (id: string) => {
    saveOwnedShare(id);
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
      return (
        <div className={`min-h-screen ${T.bgSub} flex items-center justify-center`}>
          <Spinner className="h-8 w-8 text-teal-500" />
        </div>
      );
    case 'create':
      return <CreateView onCreated={handleCreated} />;
    case 'share':
      return <ShareView shareId={shareId!} justCreated={justCreated} />;
  }
}
