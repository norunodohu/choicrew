import { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  doc, setDoc, getDoc, collection, addDoc, getDocs,
  query, where, Timestamp,
} from 'firebase/firestore';
import { format, addDays } from 'date-fns';
import { ja } from 'date-fns/locale';

/* ================================================================
   Types
   ================================================================ */

interface TimeSlot {
  id: string;   // client-only, not stored in Firestore
  date: string;  // YYYY-MM-DD
  start: string; // HH:MM
  end: string;   // HH:MM
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

/* ================================================================
   CreateView
   ================================================================ */

function CreateView({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState(loadDraftName);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [saving, setSaving] = useState(false);
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
      alert('作成に失敗しました。もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-slate-100">
      <div className="max-w-lg mx-auto px-4 py-6 sm:py-10">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 font-righteous tracking-wide">
            ChoiCrew <span className="text-indigo-600">Mini</span>
          </h1>
          <p className="text-gray-500 mt-2 text-sm leading-relaxed">
            空き時間を入力して共有リンクを作成<br />
            ログイン不要 ・ 7日間有効
          </p>
        </div>

        {/* Name */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            あなたの名前
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="たなか"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base
                       focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent
                       placeholder:text-gray-300"
            maxLength={30}
          />
        </div>

        {/* Day slots */}
        <div className="space-y-3 mb-6">
          {days.map(day => {
            const daySlots = slotsFor(day.date);
            return (
              <div
                key={day.date}
                className={`bg-white rounded-2xl shadow-sm border p-4 transition-all ${
                  day.isWeekend ? 'border-orange-100 bg-orange-50/30' : 'border-gray-100'
                }`}
              >
                <p className={`text-sm font-semibold mb-2 ${
                  day.isWeekend ? 'text-orange-600' : 'text-gray-700'
                }`}>
                  {day.label}
                </p>

                {daySlots.map(slot => (
                  <div key={slot.id} className="flex items-center gap-2 mb-2">
                    <input
                      type="time"
                      value={slot.start}
                      onChange={e => updateSlot(slot.id, 'start', e.target.value)}
                      className="flex-1 rounded-lg border border-gray-200 px-2 py-2 text-base text-center"
                    />
                    <span className="text-gray-400 text-sm">〜</span>
                    <input
                      type="time"
                      value={slot.end}
                      onChange={e => updateSlot(slot.id, 'end', e.target.value)}
                      className="flex-1 rounded-lg border border-gray-200 px-2 py-2 text-base text-center"
                    />
                    <button
                      onClick={() => removeSlot(slot.id)}
                      className="text-gray-300 hover:text-red-400 p-1.5 transition-colors"
                      aria-label="削除"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {daySlots.some(s => s.start >= s.end) && (
                  <p className="text-xs text-red-500 mb-1">
                    開始は終了より前にしてください
                  </p>
                )}

                <button
                  onClick={() => addSlot(day.date)}
                  className="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                >
                  ＋ {daySlots.length > 0 ? 'もう1枠' : '空き時間を追加'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Create button */}
        <button
          onClick={handleCreate}
          disabled={!canCreate || saving}
          className="w-full bg-indigo-600 text-white rounded-xl py-3.5 font-bold
                     hover:bg-indigo-700 disabled:opacity-40 transition text-lg
                     shadow-lg shadow-indigo-200"
        >
          {saving ? '作成中...' : '🔗 共有リンクを作成'}
        </button>

        {name.trim() && slots.length > 0 && validSlots.length === 0 && (
          <p className="text-center text-sm text-red-400 mt-2">
            有効な時間帯がありません
          </p>
        )}
        {name.trim() && slots.length === 0 && (
          <p className="text-center text-sm text-gray-400 mt-3">
            ↑ 日付の「＋ 空き時間を追加」で時間帯を入力
          </p>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-300 mt-10">
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
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!name.trim()) return;
    setSending(true);
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
      onSent();
    } catch (err) {
      console.error('Failed to send request:', err);
      alert('送信に失敗しました。もう一度お試しください。');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 space-y-4
                      animate-[slideUp_0.2s_ease-out]">
        <h3 className="text-lg font-bold text-gray-900">依頼を送る</h3>
        <p className="text-sm text-gray-500">
          📅 {formatSlotDate(slot.date)} {slot.start}〜{slot.end}
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            あなたの名前 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-base
                       focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="山田太郎"
            maxLength={30}
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            メッセージ（任意）
          </label>
          <input
            type="text"
            value={message}
            onChange={e => setMessage(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-base
                       focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="入れますか？"
            maxLength={200}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600
                       hover:bg-gray-50 font-medium transition"
          >
            キャンセル
          </button>
          <button
            onClick={handleSend}
            disabled={!name.trim() || sending}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium
                       hover:bg-indigo-700 disabled:opacity-40 transition"
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

  const url = makeShareUrl(shareId);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'mini_shares', shareId));
        if (!snap.exists()) { setNotFound(true); return; }

        const data = snap.data() as ShareData;
        if (data.expires_at.toDate() < new Date()) setExpired(true);
        setShare(data);

        // Load requests for this share
        const reqQ = query(collection(db, 'mini_requests'), where('share_id', '==', shareId));
        const reqSnap = await getDocs(reqQ);
        setRequests(reqSnap.docs.map(d => ({ id: d.id, ...d.data() } as RequestEntry)));
      } catch (err) {
        console.error('Failed to load share:', err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [shareId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
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

  const handleSent = (slot: { date: string; start: string; end: string }) => {
    const key = slotKey(slot);
    const next = saveSentSlot(shareId, key, sentSlots);
    setSentSlots(next);
    setRequestSlot(null);
  };

  const requestsForSlot = (s: { date: string; start: string; end: string }) =>
    requests.filter(r => r.slot_date === s.date && r.slot_start === s.start && r.slot_end === s.end);

  // Loading
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mb-3" />
          <p className="text-gray-400 text-sm">読み込み中...</p>
        </div>
      </div>
    );
  }

  // Not found
  if (notFound) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-slate-100 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-4xl mb-4">🔍</p>
          <p className="text-gray-600 text-lg font-medium mb-2">リンクが見つかりません</p>
          <p className="text-gray-400 text-sm mb-6">期限切れまたは無効なリンクです</p>
          <a
            href="/mini/"
            className="inline-block bg-indigo-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-indigo-700 transition"
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-slate-100 print:bg-white print:from-white print:to-white">
      <div className="max-w-lg mx-auto px-4 py-6 sm:py-10">

        {/* Just-created banner */}
        {justCreated && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-4 print:hidden">
            <p className="font-bold text-green-900">✅ 共有リンクを作成しました！</p>
            <p className="text-sm text-green-700 mt-1">
              下のリンクを相手に送ってください（{expiryLabel}まで有効）
            </p>
          </div>
        )}

        {/* Share URL + actions */}
        {justCreated && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-6 print:hidden">
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={url}
                readOnly
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm bg-gray-50 text-gray-600 truncate"
              />
              <button
                onClick={handleCopy}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                  copied
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {copied ? '✅ コピー済み' : 'コピー'}
              </button>
            </div>
            <div className="flex gap-2">
              <a
                href={makeLineShareUrl(share.name, url)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 rounded-xl text-center text-sm font-medium
                           bg-[#06C755] text-white hover:bg-[#05b34d] transition"
              >
                LINEで送る
              </a>
              <button
                onClick={() => window.print()}
                className="flex-1 py-2.5 rounded-xl text-center text-sm font-medium
                           bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
              >
                🖨 印刷する
              </button>
            </div>
          </div>
        )}

        {/* Expired warning */}
        {expired && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 print:hidden">
            <p className="font-medium text-amber-800">⚠️ この共有は期限切れです</p>
            <p className="text-sm text-amber-600 mt-1">依頼の送信はできません</p>
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-900">
            {share.name}さんの空き時間
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            ⏰ {expiryLabel}まで有効
          </p>
          {!justCreated && (
            <button
              onClick={() => window.print()}
              className="text-xs text-gray-400 hover:text-gray-600 mt-2 transition print:hidden"
            >
              🖨 印刷する
            </button>
          )}
        </div>

        {/* Slot cards */}
        <div className="space-y-3 mb-8">
          {sortedSlots.map((slot, i) => {
            const key = slotKey(slot);
            const sent = sentSlots.has(key);
            const reqs = requestsForSlot(slot);
            return (
              <div
                key={i}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 print:shadow-none print:border-gray-300"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-500">
                      📅 {formatSlotDate(slot.date)}
                    </p>
                    <p className="text-xl font-bold text-gray-900 mt-0.5">
                      {slot.start} – {slot.end}
                    </p>
                  </div>
                  <div className="print:hidden">
                    {expired ? (
                      <span className="text-xs text-gray-400">期限切れ</span>
                    ) : sent ? (
                      <span className="text-sm text-green-600 font-medium bg-green-50 px-3 py-1.5 rounded-lg">
                        ✅ 依頼済み
                      </span>
                    ) : (
                      <button
                        onClick={() => setRequestSlot(slot)}
                        className="bg-indigo-600 text-white text-sm font-medium rounded-xl
                                   px-5 py-2.5 hover:bg-indigo-700 transition
                                   shadow-md shadow-indigo-100"
                      >
                        依頼する
                      </button>
                    )}
                  </div>
                </div>

                {/* Show requests for owner */}
                {justCreated && reqs.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-50">
                    {reqs.map(r => (
                      <p key={r.id} className="text-sm text-gray-500">
                        📩 {r.requester_name}{r.message && `「${r.message}」`}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {sortedSlots.length === 0 && (
            <div className="text-center py-10">
              <p className="text-gray-400">空き時間が登録されていません</p>
            </div>
          )}
        </div>

        {/* Print-only section */}
        <div className="hidden print:flex print:flex-col print:items-center print:mt-8 print:pt-6 print:border-t print:border-gray-300">
          <img
            src={makeQrUrl(url)}
            alt="QR Code"
            className="w-32 h-32 mb-2"
          />
          <p className="text-xs text-gray-500 break-all text-center max-w-xs">{url}</p>
          <p className="text-xs text-gray-400 mt-2">
            QRコードを読み取ると空き時間を確認できます
          </p>
        </div>

        {/* Footer CTA */}
        {!justCreated && (
          <div className="text-center border-t border-gray-100 pt-8 mt-4 print:hidden">
            <p className="text-sm text-gray-500 mb-3">自分も空き時間を共有しませんか？</p>
            <a
              href="/mini/"
              className="inline-block bg-indigo-600 text-white rounded-xl px-8 py-3
                         font-medium hover:bg-indigo-700 transition shadow-lg shadow-indigo-100"
            >
              空き時間を作成する →
            </a>
          </div>
        )}

        {/* New share button for owner */}
        {justCreated && (
          <div className="text-center print:hidden">
            <a
              href="/mini/"
              className="text-sm text-gray-400 hover:text-gray-600 transition"
            >
              ← 新しく作成する
            </a>
          </div>
        )}

        {/* Branding footer */}
        <p className="text-center text-xs text-gray-300 mt-10 print:mt-4">
          ChoiCrew Mini — ちょっと空き共有
        </p>
      </div>

      {/* Request Modal */}
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
    if (match) {
      setShareId(match[1]);
      setView('share');
    } else {
      setView('create');
    }
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const handlePop = () => {
      const path = window.location.pathname;
      const match = path.match(/^\/mini\/s\/([A-Za-z0-9]+)/);
      if (match) {
        setShareId(match[1]);
        setView('share');
        setJustCreated(false);
      } else {
        setView('create');
        setJustCreated(false);
      }
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const handleCreated = (id: string) => {
    window.history.pushState({}, '', `/mini/s/${id}`);
    setShareId(id);
    setJustCreated(true);
    setView('share');
  };

  // Global print styles
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideUp {
        from { transform: translateY(100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  switch (view) {
    case 'loading':
      return (
        <div className="min-h-screen bg-gradient-to-b from-gray-50 to-slate-100 flex items-center justify-center">
          <div className="inline-block w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      );
    case 'create':
      return <CreateView onCreated={handleCreated} />;
    case 'share':
      return <ShareView shareId={shareId!} justCreated={justCreated} />;
  }
}
