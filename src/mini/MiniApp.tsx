import { useState, useEffect, useRef, useCallback, Component, ReactNode } from 'react';

/* ================================================================
   Error Boundary — クラッシュ時に白画面にならないように
   ================================================================ */
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
          <div className="text-center">
            <p className="text-slate-700 text-lg font-semibold mb-2">表示エラーが発生しました</p>
            <p className="text-slate-400 text-sm mb-6">ページをリロードしてみてください</p>
            <button onClick={() => window.location.reload()}
              className="bg-teal-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-teal-700 transition">
              リロード
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// チャンクエラー時の自動リカバリ
window.addEventListener("error", (e) => {
  if (e.message && (e.message.includes("chunk") || e.message.includes("dynamically imported module"))) {
    if (!sessionStorage.getItem('__choicrew_reload')) {
      sessionStorage.setItem('__choicrew_reload', '1');
      if ('caches' in window) {
        caches.keys().then(names => Promise.all(names.map(n => caches.delete(n)))).then(() => location.reload());
      } else {
        location.reload();
      }
    }
  }
});

import { db, messaging } from '../firebase';
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, collection, addDoc, onSnapshot,
  query, where, Timestamp,
} from 'firebase/firestore';
import { getToken } from 'firebase/messaging';
import { format, addDays } from 'date-fns';
import { ja } from 'date-fns/locale';

/* ================================================================
   Icons
   ================================================================ */
const TaskIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="3" width="13" height="13" rx="2" />
    <path d="M5 7H2v14a2 2 0 0 0 2 2h13v-3" />
    <path d="m13 13-3 3-1.5-1.5" />
  </svg>
);

const BellIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

/* ================================================================
   Types
   ================================================================ */

type ThemeKey = 'simple' | 'dark' | 'pop' | 'modern' | 'anime' | 'konbini' | 'himawari' | 'darkbg';

interface TimeSlot {
  id: string;
  date: string;
  start: string;
  end: string;
}

interface ShareData {
  name: string;
  title?: string;
  displayName?: string;
  requester_aliases?: Record<string, string>;
  slots: { date: string; start: string; end: string }[];
  created_at: Timestamp;
  expires_at: Timestamp;
  theme?: ThemeKey;
  bookingMode?: 'multiple' | 'exclusive';
  paused?: boolean;
  draft?: boolean;
  owner_token?: string;
  notify_email?: string;
}

interface RequestEntry {
  id: string;
  share_id: string;
  slot_date: string;
  slot_start: string;
  slot_end: string;
  requester_name: string;
  message: string;
  status?: 'pending' | 'approved' | 'declined' | 'cancelled';
  created_at: Timestamp;
}

interface OwnedShareEntry {
  id: string;
  name: string;
  created_at: number;
  dateRange?: string;
  lastDate?: string;
}

/* ================================================================
   Utilities
   ================================================================ */

function genId(len = 8): string {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: len }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

function getDays(count = 14) {
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

function isValidSlotRange(start: string, end: string): boolean {
  if (start === end) return false;
  // 日をまたぐ（例: 8:00～0:00）も許容
  if (end === '24:00' || end === '00:00') return true;
  return start < end;
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

function loadDraftData(): { title: string; displayName: string } {
  try {
    const raw = localStorage.getItem('choicrew_mini_draft');
    if (raw) {
      const p = JSON.parse(raw);
      return { title: p.title || p.name || '', displayName: p.displayName || p.name || '' };
    }
  } catch { /* ignore */ }
  return { title: '', displayName: '' };
}

function saveDraftData(title: string, displayName: string) {
  try {
    localStorage.setItem('choicrew_mini_draft', JSON.stringify({ title, displayName }));
  } catch { /* ignore */ }
}

function computeDateRange(slots: { date: string }[]): string {
  if (slots.length === 0) return '';
  const dates = slots.map(s => s.date).sort();
  const first = new Date(dates[0] + 'T00:00:00');
  const last = new Date(dates[dates.length - 1] + 'T00:00:00');
  if (dates[0] === dates[dates.length - 1]) return format(first, 'M/d', { locale: ja });
  return `${format(first, 'M/d', { locale: ja })}–${format(last, 'M/d', { locale: ja })}`;
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

function loadSentRequestIds(shareId: string): Map<string, string> {
  try {
    const raw = localStorage.getItem(`mini_sent_ids_${shareId}`);
    return raw ? new Map(JSON.parse(raw)) : new Map();
  } catch { return new Map(); }
}

function saveSentRequestId(shareId: string, key: string, requestId: string) {
  const map = loadSentRequestIds(shareId);
  map.set(key, requestId);
  try { localStorage.setItem(`mini_sent_ids_${shareId}`, JSON.stringify([...map.entries()])); } catch { /* */ }
}

function saveOwnerToken(shareId: string, token: string) {
  try { localStorage.setItem(`mini_owner_token_${shareId}`, token); } catch { /* */ }
}

function loadOwnerToken(shareId: string): string | null {
  try { return localStorage.getItem(`mini_owner_token_${shareId}`); } catch { return null; }
}

/* ── デバイスフィンガープリント ── */
function getDeviceFingerprintRaw(): string {
  const parts = [
    screen.width,
    screen.height,
    window.devicePixelRatio,
    // hardwareConcurrency は Brave 等で偽装されるため除外
    // navigator.platform はブラウザ間で微妙に異なるため除外
    navigator.maxTouchPoints || 0,
    navigator.language || '',
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    screen.colorDepth || 0,
    screen.availWidth || 0,
    screen.availHeight || 0,
  ];
  return parts.join('|');
}

function getDeviceFingerprint(): string {
  const raw = getDeviceFingerprintRaw();
  // シンプルなハッシュ（djb2）
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

async function registerOwnerFingerprint(shareId: string) {
  try {
    await fetch('/api/mini/register-fp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId, fingerprint: getDeviceFingerprint() }),
    });
  } catch { /* 通知失敗は無視suru */ }
}

async function checkOwnerFingerprint(shareId: string): Promise<boolean> {
  try {
    const res = await fetch('/api/mini/check-fp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId, fingerprint: getDeviceFingerprint() }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.match;
  } catch { return false; }
}

function isNotOwnerDismissed(shareId: string): boolean {
  try { return localStorage.getItem(`mini_not_owner_${shareId}`) === '1'; } catch { return false; }
}

function setNotOwnerDismissed(shareId: string) {
  try { localStorage.setItem(`mini_not_owner_${shareId}`, '1'); } catch { /* */ }
}

function saveOwnedShare(shareId: string, name: string, dateRange?: string, lastDate?: string) {
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
    const existing = entries.find(e => e.id === shareId);
    if (existing) {
      // 既存エントリのdateRange/lastDateを更新
      if (dateRange !== undefined) existing.dateRange = dateRange;
      if (lastDate !== undefined) existing.lastDate = lastDate;
      if (name) existing.name = name;
    } else {
      entries.push({ id: shareId, name, created_at: Date.now(), dateRange, lastDate });
      if (entries.length > 10) entries = entries.slice(-10);
    }
    localStorage.setItem('mini_owned_shares', JSON.stringify(entries));
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

/* ── WheelColumn: iOSスタイルのスクロールピッカー列 ── */
function WheelColumn({ items, value, onChange }: { items: string[]; value: string; onChange: (v: string) => void }) {
  const ITEM_H = 40;
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number>(0);
  const scrollingRef = useRef(false);

  useEffect(() => {
    if (scrollingRef.current || !scrollRef.current) return;
    const idx = items.indexOf(value);
    if (idx >= 0) scrollRef.current.scrollTop = idx * ITEM_H;
  }, [value, items]);

  const handleScroll = () => {
    scrollingRef.current = true;
    clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (!scrollRef.current) return;
      const idx = Math.round(scrollRef.current.scrollTop / ITEM_H);
      const safe = Math.max(0, Math.min(items.length - 1, idx));
      scrollRef.current.scrollTop = safe * ITEM_H;
      onChange(items[safe]);
      setTimeout(() => { scrollingRef.current = false; }, 60);
    }, 100);
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="overflow-y-scroll snap-y snap-mandatory [&::-webkit-scrollbar]:hidden"
      style={{ height: ITEM_H * 3 }}
    >
      <div style={{ paddingTop: ITEM_H, paddingBottom: ITEM_H }}>
        {items.map(item => (
          <div
            key={item}
            className={`snap-center flex items-center justify-center w-10 font-mono text-lg font-semibold select-none transition-colors ${
              item === value ? 'text-slate-800' : 'text-slate-300'
            }`}
            style={{ height: ITEM_H }}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimeSpinner({ value, onChange, isEnd }: { value: string; onChange: (v: string) => void; isEnd?: boolean }) {
  const [hStr, mStr] = value.split(':');
  const HOURS = isEnd
    ? [...Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')), '24']
    : Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const MINS = hStr === '24' ? ['00'] : ['00', '15', '30', '45'];
  const normM = hStr === '24' ? '00' : MINS.reduce((a, b) => Math.abs(+b - +mStr) < Math.abs(+a - +mStr) ? b : a);
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  if (!isMobile) {
    return (
      <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <select
          value={hStr}
          onChange={e => { const h = e.target.value; onChange(h === '24' ? '24:00' : `${h}:${normM}`); }}
          className="text-base font-semibold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
        >
          {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <span className="text-slate-300 font-bold text-lg">:</span>
        <select
          value={normM}
          onChange={e => onChange(`${hStr}:${e.target.value}`)}
          className="text-base font-semibold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
          disabled={hStr === '24'}
        >
          {MINS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    );
  }

  return (
    <div className="relative flex items-center rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 bg-teal-50/80 border-y border-teal-100 z-10" />
      <WheelColumn items={HOURS} value={hStr} onChange={h => onChange(h === '24' ? '24:00' : `${h}:${normM}`)} />
      <span className="relative z-20 px-0.5 text-slate-400 font-bold text-lg">:</span>
      <WheelColumn items={MINS} value={normM} onChange={m => onChange(`${hStr}:${m}`)} />
    </div>
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
   Themes
   ================================================================ */

const THEMES: Record<ThemeKey, {
  label: string; emoji: string;
  pageBg: string; card: string;
  accentBtn: string; accentText: string;
  headingText: string; subText: string;
  timeText: string; labelText: string;
  cardPreviewFrom: string; cardPreviewTo: string;
  previewBg: string; previewCard: string;
  previewBorder: string;
}> = {
  simple: {
    label: 'シンプル', emoji: '🌿',
    pageBg: 'bg-slate-50', card: 'bg-white border border-slate-200',
    accentBtn: 'bg-teal-600 text-white hover:bg-teal-700 active:scale-95',
    accentText: 'text-teal-600', headingText: 'text-slate-800',
    subText: 'text-slate-400', timeText: 'text-slate-800', labelText: 'text-slate-600',
    cardPreviewFrom: '#2dd4bf', cardPreviewTo: '#0d9488',
    previewBg: '#f8fafc', previewCard: '#ffffff', previewBorder: '#e2e8f0',
  },
  dark: {
    label: 'ダーク', emoji: '🌙',
    pageBg: 'bg-slate-900', card: 'bg-slate-800 border border-slate-700',
    accentBtn: 'bg-teal-400 text-slate-900 hover:bg-teal-300 active:scale-95',
    accentText: 'text-teal-400', headingText: 'text-white',
    subText: 'text-slate-500', timeText: 'text-white', labelText: 'text-slate-300',
    cardPreviewFrom: '#2dd4bf', cardPreviewTo: '#134e4a',
    previewBg: '#0f172a', previewCard: '#1e293b', previewBorder: '#334155',
  },
  pop: {
    label: 'ポップ', emoji: '🎨',
    pageBg: 'bg-fuchsia-50', card: 'bg-white border-2 border-fuchsia-200',
    accentBtn: 'bg-fuchsia-500 text-white hover:bg-fuchsia-600 active:scale-95',
    accentText: 'text-fuchsia-500', headingText: 'text-fuchsia-900',
    subText: 'text-fuchsia-400', timeText: 'text-fuchsia-900', labelText: 'text-fuchsia-700',
    cardPreviewFrom: '#e879f9', cardPreviewTo: '#f97316',
    previewBg: '#fdf4ff', previewCard: '#ffffff', previewBorder: '#f0abfc',
  },
  modern: {
    label: 'モダン', emoji: '⚫',
    pageBg: 'bg-white', card: 'bg-gray-50 border border-gray-200',
    accentBtn: 'bg-gray-900 text-white hover:bg-gray-700 active:scale-95',
    accentText: 'text-gray-900', headingText: 'text-gray-900',
    subText: 'text-gray-400', timeText: 'text-gray-900', labelText: 'text-gray-700',
    cardPreviewFrom: '#374151', cardPreviewTo: '#111827',
    previewBg: '#ffffff', previewCard: '#f9fafb', previewBorder: '#e5e7eb',
  },
  anime: {
    label: 'アニメ', emoji: '🌸',
    pageBg: 'bg-gradient-to-br from-pink-100 via-purple-50 to-sky-100',
    card: 'bg-white border-2 border-pink-300 shadow-[4px_4px_0px_#f472b6]',
    accentBtn: 'bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:from-pink-600 hover:to-purple-600 active:scale-95 shadow-[2px_2px_0px_#be185d]',
    accentText: 'text-pink-500', headingText: 'text-purple-900',
    subText: 'text-pink-400', timeText: 'text-purple-800', labelText: 'text-purple-700',
    cardPreviewFrom: '#f472b6', cardPreviewTo: '#a855f7',
    previewBg: 'linear-gradient(135deg,#fce7f3,#ede9fe,#e0f2fe)', previewCard: '#ffffff', previewBorder: '#f9a8d4',
  },
  konbini: {
    label: 'コンビニ', emoji: '🏪',
    pageBg: 'bg-sky-50',
    card: 'bg-white/90 backdrop-blur border border-sky-200',
    accentBtn: 'bg-sky-500 text-white hover:bg-sky-600 active:scale-95',
    accentText: 'text-sky-600', headingText: 'text-sky-900',
    subText: 'text-sky-400', timeText: 'text-sky-900', labelText: 'text-sky-700',
    cardPreviewFrom: '#38bdf8', cardPreviewTo: '#0284c7',
    previewBg: 'linear-gradient(135deg,#e0f2fe,#bae6fd,#f0fdf4)', previewCard: 'rgba(255,255,255,0.85)', previewBorder: '#bae6fd',
  },
  himawari: {
    label: 'ひまわり', emoji: '🌻',
    pageBg: 'bg-amber-50',
    card: 'bg-white/80 border border-yellow-200',
    accentBtn: 'bg-gradient-to-r from-yellow-400 to-orange-400 text-white hover:from-yellow-500 hover:to-orange-500 active:scale-95',
    accentText: 'text-yellow-600', headingText: 'text-amber-900',
    subText: 'text-yellow-500', timeText: 'text-amber-900', labelText: 'text-amber-700',
    cardPreviewFrom: '#fbbf24', cardPreviewTo: '#f97316',
    previewBg: 'linear-gradient(135deg,#fef9c3,#fef3c7,#fff7ed)', previewCard: '#ffffff', previewBorder: '#fde68a',
  },
  darkbg: {
    label: 'ダークフォト', emoji: '🌃',
    pageBg: 'bg-gray-950',
    card: 'bg-black/60 backdrop-blur border border-white/10',
    accentBtn: 'bg-white/90 text-gray-900 hover:bg-white active:scale-95',
    accentText: 'text-white', headingText: 'text-white',
    subText: 'text-white/50', timeText: 'text-white', labelText: 'text-white/80',
    cardPreviewFrom: '#1a1a2e', cardPreviewTo: '#16213e',
    previewBg: 'linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)', previewCard: 'rgba(255,255,255,0.08)', previewBorder: 'rgba(255,255,255,0.15)',
  },
};

/* ================================================================
   CreateView
   ================================================================ */


function CreateView({ onCreated }: { onCreated: (id: string, name: string) => void }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(() => loadDraftData().title);
  const [displayName, setDisplayName] = useState(() => loadDraftData().displayName);
  const [createMode, setCreateMode] = useState<'quick' | 'custom' | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [bookingMode, setBookingMode] = useState<'multiple' | 'exclusive'>('multiple');
  const [theme, setTheme] = useState<ThemeKey>('simple');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteShareId, setConfirmDeleteShareId] = useState<string | null>(null);
  const toast = useToast();
  const days = getDays(7);
  // Firebaseから予定名を取得するためのstate
  const [ownedShares, setOwnedShares] = useState<OwnedShareEntry[]>([]);
  const [loadingOwned, setLoadingOwned] = useState(true);

  // Firebaseから予定名を取得
  useEffect(() => {
    const fetchOwnedShares = async () => {
      setLoadingOwned(true);
      const local = loadOwnedShares();
      if (local.length === 0) { setOwnedShares([]); setLoadingOwned(false); return; }
      const results: OwnedShareEntry[] = [];
      for (const entry of local) {
        try {
          const snap = await getDoc(doc(db, 'mini_shares', entry.id));
          if (snap.exists()) {
            const data = snap.data();
            results.push({
              id: entry.id,
              name: data.title || data.name || '',
              created_at: entry.created_at,
              dateRange: computeDateRange(data.slots || []),
              lastDate: (data.slots && data.slots.length > 0)
                ? [...data.slots].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || ''
                : '',
            });
          }
        } catch { /* ignore individual errors */ }
      }
      setOwnedShares(results);
      setLoadingOwned(false);
    };
    fetchOwnedShares();
  }, []);

  const removeOwnedShare = (id: string) => {
    try {
      const raw = localStorage.getItem('mini_owned_shares');
      if (raw) {
        const entries = JSON.parse(raw) as OwnedShareEntry[];
        localStorage.setItem('mini_owned_shares', JSON.stringify(entries.filter(e => e.id !== id)));
      }
    } catch { /* */ }
    setOwnedShares(prev => prev.filter(e => e.id !== id));
  };

  const slotsFor = (date: string) => slots.filter(s => s.date === date);

  const addSlot = (date: string, start = '10:00', end = '17:00') => {
    setSlots(prev => [...prev, { id: genId(6), date, start, end }]);
    setExpandedDays(prev => new Set([...prev, date]));
  };

  const updateSlot = (id: string, field: 'start' | 'end', value: string) => {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const removeSlot = (id: string) => {
    setSlots(prev => prev.filter(s => s.id !== id));
  };

  const validSlots = slots.filter(s => isValidSlotRange(s.start, s.end));

  const handleCreate = async () => {
    if (!title.trim() || validSlots.length === 0) return;
    setSaving(true);
    try {
      const id = genId(8);
      const ownerToken = genId(16);
      const now = new Date();
      const expires = addDays(now, 365);
      const slotData = validSlots.map(({ date, start, end }) => ({ date, start, end }));
      await setDoc(doc(db, 'mini_shares', id), {
        name: displayName.trim() || title.trim(),
        title: title.trim(),
        displayName: displayName.trim(),
        slots: slotData,
        theme,
        bookingMode,
        owner_token: ownerToken,
        created_at: Timestamp.fromDate(now),
        expires_at: Timestamp.fromDate(expires),
      });
      saveOwnerToken(id, ownerToken);
      saveDraftData(title.trim(), displayName.trim());
      const dateRange = computeDateRange(slotData);
      const lastDate = [...slotData].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || '';
      saveOwnedShare(id, title.trim(), dateRange, lastDate);
      // FP+IP登録（第2層オーナー認証用）
      registerOwnerFingerprint(id);
      onCreated(id, title.trim());
    } catch (err) {
      console.error('Failed to create share:', err);
      toast.show('作成に失敗しました。もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  // Shared slot picker used in both quick and custom step 4
  const SlotPicker = () => (
    <div className="space-y-2 mb-6">
      {days.map(day => {
        const daySlots = slotsFor(day.date);
        const isExpanded = expandedDays.has(day.date) || daySlots.length > 0;
        if (!isExpanded) {
          return (
            <button key={day.date} onClick={() => setExpandedDays(prev => new Set([...prev, day.date]))}
              className={`w-full flex items-center justify-between rounded-xl px-4 py-3 border transition hover:shadow-sm bg-white border-slate-200 ${day.isWeekend ? 'bg-amber-50/40 border-amber-100' : ''} ${day.isToday ? 'border-l-[3px] border-l-teal-400' : ''}`}>
              <span className={`text-sm font-semibold ${day.isToday ? 'text-teal-700' : day.isWeekend ? 'text-amber-700' : 'text-slate-600'}`}>
                {day.isToday && <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500 mr-1.5 align-middle" />}
                {day.label}
              </span>
              <span className="text-sm text-teal-600 font-medium">＋</span>
            </button>
          );
        }
        return (
          <div key={day.date} className={`bg-white rounded-2xl border p-4 animate-[fadeIn_0.15s_ease-out] ${day.isWeekend ? 'border-amber-100 bg-amber-50/30' : 'border-slate-200'} ${day.isToday ? 'border-l-[3px] border-l-teal-400' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <p className={`text-sm font-semibold ${day.isToday ? 'text-teal-700' : day.isWeekend ? 'text-amber-700' : 'text-slate-600'}`}>
                {day.isToday && <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500 mr-1.5 align-middle" />}
                {day.label}
              </p>
              {daySlots.length === 0 && (
                <button onClick={() => setExpandedDays(prev => { const n = new Set(prev); n.delete(day.date); return n; })} className="text-xs text-slate-400 hover:text-slate-600 transition">閉じる</button>
              )}
            </div>
            {daySlots.map(slot => (
              <div key={slot.id} className="mb-3 animate-[fadeIn_0.15s_ease-out]">
                <div className="flex items-center gap-2">
                  <TimeSpinner value={slot.start} onChange={v => updateSlot(slot.id, 'start', v)} />
                  <span className="text-slate-300 text-sm">–</span>
                  <TimeSpinner value={slot.end} onChange={v => updateSlot(slot.id, 'end', v)} isEnd />
                  <button onClick={() => removeSlot(slot.id)} className="text-slate-300 hover:text-red-400 p-1.5 transition-colors rounded-lg" aria-label="削除">✕</button>
                </div>
                {isValidSlotRange(slot.start, slot.end) && <TimeBar start={slot.start} end={slot.end} />}
                {!isValidSlotRange(slot.start, slot.end) && <p className="text-xs text-red-500 mt-1">開始は終了より前にしてください</p>}
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5 mt-1">
              {TIME_PRESETS.map(p => (
                <button key={p.label} onClick={() => addSlot(day.date, p.start, p.end)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-100/50 transition">
                  {p.label}<span className="text-teal-400">{p.sub}</span>
                </button>
              ))}
              <button onClick={() => addSlot(day.date)} className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-100/50 transition">カスタム</button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const steps = createMode === 'custom' ? [1, 2, 3, 4] : [1, 2];
  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-1.5 mb-6">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
            step === s ? 'bg-teal-600 text-white ring-4 ring-teal-100' :
            step > s ? 'bg-teal-100 text-teal-600' : 'bg-slate-100 text-slate-400'
          }`}>
            {step > s ? '✓' : s}
          </div>
          {i < steps.length - 1 && <div className={`w-8 h-0.5 rounded-full transition-all ${step > s ? 'bg-teal-300' : 'bg-slate-200'}`} />}
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {toast.UI}
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12 pb-28 sm:pb-12">

        {/* Header */}
        <div className="text-center mb-6">
          <Logo />
          <p className="text-slate-400 mt-2 text-xs tracking-wide">ログイン不要で依頼受付まで</p>
        </div>

        {/* ── 作成済みの予定リスト（常時表示） ── */}
        {(() => {
          const todayStr = format(new Date(), 'yyyy-MM-dd');
          const activeShares = ownedShares.filter(e => e.name && (!e.lastDate || e.lastDate >= todayStr));
          if (loadingOwned) {
            return (
              <div className="mb-6">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 px-1">あなたの作成済み予定</p>
                <div className="space-y-2">
                  <SkeletonBlock className="h-10 w-full mb-2" />
                  <SkeletonBlock className="h-10 w-full mb-2" />
                </div>
              </div>
            );
          }
          if (activeShares.length === 0) return null;
          return (
            <div className="mb-6">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 px-1">あなたの作成済み予定</p>
              <div className="space-y-2">
                {activeShares.slice(-5).reverse().map(entry => (
                  <div key={entry.id} className="flex items-center gap-2 group">
                    <a
                      href={`/mini/s/${entry.id}`}
                      className="flex-1 flex items-center gap-3 bg-white border border-slate-200 hover:border-teal-300 hover:shadow-sm rounded-2xl px-4 py-3 transition min-w-0"
                    >
                      <div className="w-2.5 h-2.5 rounded-full bg-teal-400 shrink-0" />
                      <span className="flex-1 text-sm font-semibold text-slate-700 group-hover:text-teal-700 transition truncate">{entry.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {entry.dateRange && (
                          <span className="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-2 py-0.5">{entry.dateRange}</span>
                        )}
                        <span className="text-slate-300 group-hover:text-teal-500 transition text-sm">→</span>
                      </div>
                    </a>
                    {confirmDeleteShareId === entry.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => removeOwnedShare(entry.id)} className="text-xs px-2 py-1 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition">削除</button>
                        <button onClick={() => setConfirmDeleteShareId(null)} className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-500 font-medium hover:bg-slate-200 transition">戻る</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteShareId(entry.id)}
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-slate-300 hover:text-red-400 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                        aria-label="削除"
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-slate-100" />
              <p className="text-center text-xs text-slate-400 mt-3 mb-1">または新しく作成する</p>
            </div>
          );
        })()}

        <StepIndicator />

        {/* ── Step 1: Title + DisplayName ── */}
        {step === 1 && (
          <div className="animate-[fadeIn_0.2s_ease-out]">
            <h2 className="text-xl font-bold text-slate-800 mb-1">予定表を作成（１週間分）</h2>
            <p className="text-sm text-slate-400 mb-5">公開される予定表タイトルと名前を入力してください</p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">タイトル</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="空いてます"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3.5 text-lg focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent placeholder:text-slate-300 bg-white"
                  maxLength={40}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">表示名(公開相手に分かればOK)</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && title.trim() && displayName.trim()) setStep(2); }}
                  placeholder="やまだ"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3.5 text-lg focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent placeholder:text-slate-300 bg-white"
                  maxLength={30}
                />
              </div>
            </div>
            <button
              onClick={() => title.trim() && displayName.trim() && setStep(2)}
              disabled={!title.trim() || !displayName.trim()}
              className="w-full bg-teal-600 text-white rounded-xl py-3.5 font-bold hover:bg-teal-700 disabled:opacity-40 transition text-base shadow-sm"
            >
              次へ →
            </button>


            <p>
              ※過ぎた予定は自動で削除されます。<br />
              <br />
              ※作成したデバイスでのみ編集が続けられます
            </p>
          </div>
        )}

        {/* ── Step 2: Mode selection or Quick slot picker ── */}
        {step === 2 && (
          <div className="animate-[fadeIn_0.2s_ease-out]">
            {createMode === null ? (
              <>
                <h2 className="text-xl font-bold text-slate-800 mb-1">作り方を選んでください</h2>
                <p className="text-sm text-slate-400 mb-6">時間帯をどう追加しますか？</p>
                <div className="space-y-3">
                  <button onClick={() => setCreateMode('quick')}
                    className="w-full text-left bg-white border-2 border-teal-200 rounded-2xl p-5 hover:border-teal-400 hover:shadow-md transition-all group">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center text-xl shrink-0 group-hover:bg-teal-200 transition">⚡</div>
                      <div>
                        <p className="font-bold text-slate-800 text-base">かんたん作成</p>
                        <p className="text-sm text-slate-500 mt-0.5">1週間の空き枠を自分で選んで追加</p>
                      </div>
                    </div>
                  </button>
                  <button onClick={() => { setCreateMode('custom'); setStep(3); }}
                    className="w-full text-left bg-white border-2 border-slate-200 rounded-2xl p-5 hover:border-slate-400 hover:shadow-md transition-all group">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-xl shrink-0 group-hover:bg-slate-200 transition">🎛</div>
                      <div>
                        <p className="font-bold text-slate-800 text-base">カスタム作成</p>
                        <p className="text-sm text-slate-500 mt-0.5">デザイン・リクエスト方法など細かく設定する<br />※後からでも変更可能</p>
                      </div>
                    </div>
                  </button>
                </div>
                <button onClick={() => setStep(1)} className="w-full mt-3 py-2.5 text-sm text-slate-400 hover:text-slate-600 transition">← 戻る</button>
              </>
            ) : (
              // Quick mode: 7-day blank slot picker
              <>
                <h2 className="text-xl font-bold text-slate-800 mb-1">空き時間を追加</h2>
                <p className="text-sm text-slate-400 mb-5">希望の日時をタップして追加してください</p>
                <SlotPicker />
                <button
                  onClick={handleCreate}
                  disabled={validSlots.length === 0 || saving}
                  className="w-full bg-teal-600 text-white rounded-xl py-3.5 font-bold hover:bg-teal-700 disabled:opacity-40 transition text-base shadow-sm"
                >
                  {saving
                    ? <span className="inline-flex items-center justify-center gap-2"><Spinner /> 作成中...</span>
                    : validSlots.length > 0 ? `🎉 共有リンクを作成（${validSlots.length}枠）` : '時間帯を追加してください'}
                </button>
                <button onClick={() => { setCreateMode(null); setSlots([]); setExpandedDays(new Set()); }} className="w-full mt-3 py-2.5 text-sm text-slate-400 hover:text-slate-600 transition">← 戻る</button>
              </>
            )}
          </div>
        )}

        {/* ── Step 3 (custom): Design + Booking mode ── */}
        {step === 3 && createMode === 'custom' && (
          <div className="animate-[fadeIn_0.2s_ease-out]">
            <h2 className="text-xl font-bold text-slate-800 mb-1">デザインと受け方を選ぶ</h2>
            <p className="text-sm text-slate-400 mb-5">自分の予定表と相手が見る画面に反映されます</p>
            {/* Design grid */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              {(Object.entries(THEMES) as [ThemeKey, typeof THEMES[ThemeKey]][]).map(([key, t]) => (
                <button key={key} onClick={() => setTheme(key as ThemeKey)}
                  className={`relative rounded-2xl overflow-hidden transition-all ${theme === key ? 'ring-2 ring-teal-500 ring-offset-2 shadow-lg scale-[1.02]' : 'ring-1 ring-slate-200 hover:ring-slate-400'}`}>
                  {key === 'anime' ? (
                    /* アニメテーマ専用プレビュー */
                    <div style={{ background: 'linear-gradient(135deg,#fce7f3,#ede9fe,#e0f2fe)', position: 'relative', overflow: 'hidden', paddingBottom: 0 }}>
                      <svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', display: 'block' }}>
                        {/* 背景グラデ */}
                        <defs>
                          <linearGradient id="animeBg" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor="#fce7f3" />
                            <stop offset="50%" stopColor="#ede9fe" />
                            <stop offset="100%" stopColor="#e0f2fe" />
                          </linearGradient>
                          <linearGradient id="animePink" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#f472b6" />
                            <stop offset="100%" stopColor="#a855f7" />
                          </linearGradient>
                        </defs>
                        <rect width="160" height="90" fill="url(#animeBg)" />
                        {/* スピードライン */}
                        {[0,15,30,45,60,75].map(y => (
                          <line key={y} x1="0" y1={y} x2="160" y2={y+8} stroke="#f9a8d4" strokeWidth="0.5" opacity="0.4" />
                        ))}
                        {/* カード */}
                        <rect x="10" y="10" width="140" height="40" rx="6" fill="white" stroke="#f472b6" strokeWidth="2" />
                        <rect x="10" y="10" width="140" height="40" rx="6" fill="none" stroke="#f472b6" strokeWidth="2" />
                        {/* タイトルバー */}
                        <rect x="16" y="16" width="80" height="8" rx="3" fill="url(#animePink)" />
                        {/* サブテキスト線 */}
                        <rect x="16" y="30" width="50" height="4" rx="2" fill="#f9a8d4" />
                        <rect x="16" y="38" width="35" height="4" rx="2" fill="#e9d5ff" />
                        {/* ★ stars */}
                        <text x="108" y="36" fontSize="14" fill="#f472b6">★</text>
                        <text x="124" y="28" fontSize="10" fill="#a855f7">✦</text>
                        {/* ボタン */}
                        <rect x="10" y="58" width="140" height="18" rx="5" fill="url(#animePink)" />
                        <text x="80" y="70" textAnchor="middle" fontSize="7" fill="white" fontWeight="bold">依頼する ♡</text>
                        {/* 桜 */}
                        <text x="6" y="20" fontSize="12" opacity="0.7">🌸</text>
                        <text x="138" y="82" fontSize="10" opacity="0.6">✿</text>
                        <text x="2" y="88" fontSize="9" opacity="0.5">🌸</text>
                      </svg>
                    </div>
                  ) : (
                    <div style={{ background: t.previewBg }} className="p-3 pb-0">
                      <div style={{ background: t.previewCard, borderRadius: 8, padding: '8px', border: `1px solid ${t.previewBorder}` }}>
                        <div style={{ height: 7, borderRadius: 4, background: `linear-gradient(to right, ${t.cardPreviewFrom}, ${t.cardPreviewTo})`, marginBottom: 5 }} />
                        <div style={{ height: 3, borderRadius: 2, background: t.previewBorder, width: '55%' }} />
                      </div>
                      <div style={{ height: 5 }} />
                      <div style={{ background: `linear-gradient(to right, ${t.cardPreviewFrom}, ${t.cardPreviewTo})`, borderRadius: 6, height: 22, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ height: 3, width: 36, background: 'rgba(255,255,255,0.7)', borderRadius: 2 }} />
                      </div>
                    </div>
                  )}
                  <div style={{ background: key === 'anime' ? 'linear-gradient(to right,#fce7f3,#ede9fe)' : t.previewBg, paddingBlock: 8, paddingInline: 12, borderTop: `1px solid ${t.previewBorder}` }}>
                    <span className="text-xs font-bold" style={{ color: key === 'dark' ? '#fff' : key === 'pop' ? '#701a75' : key === 'anime' ? '#7e22ce' : '#1e293b' }}>
                      {t.emoji} {t.label}
                    </span>
                  </div>
                  {theme === key && (
                    <div className="absolute top-2 right-2 w-5 h-5 bg-teal-500 rounded-full flex items-center justify-center shadow">
                      <svg viewBox="0 0 12 12" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
            {/* Booking mode */}
            <div className="space-y-3 mb-6">
              {(['multiple', 'exclusive'] as const).map(mode => (
                <button key={mode} onClick={() => setBookingMode(mode)}
                  className={`w-full text-left rounded-2xl p-4 border-2 transition-all ${bookingMode === mode ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${bookingMode === mode ? 'border-teal-500 bg-teal-500' : 'border-slate-300'}`}>
                      {bookingMode === mode && <div className="w-2 h-2 bg-white rounded-full" />}
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">{mode === 'multiple' ? '複数人から受ける' : '1人決まったら締め切る'}</p>
                      <p className="text-sm text-slate-500 mt-0.5">{mode === 'multiple' ? '複数の依頼を受け取って、自分で選んで承認する' : '最初に承認した時点で自動的に締め切られる'}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setStep(4)} className="w-full bg-teal-600 text-white rounded-xl py-3.5 font-bold hover:bg-teal-700 transition">次へ →</button>
            <button onClick={() => { setStep(2); setCreateMode(null); }} className="w-full mt-3 py-2.5 text-sm text-slate-400 hover:text-slate-600 transition">← 戻る</button>
          </div>
        )}

        {/* ── Step 4 (custom): Time slots ── */}
        {step === 4 && createMode === 'custom' && (
          <div className="animate-[fadeIn_0.2s_ease-out]">
            <h2 className="text-xl font-bold text-slate-800 mb-1">空き時間を追加</h2>
            <p className="text-sm text-slate-400 mb-5">希望の日時をタップして追加してください</p>
            <SlotPicker />
            <button
              onClick={handleCreate}
              disabled={validSlots.length === 0 || saving}
              className="w-full bg-teal-600 text-white rounded-xl py-3.5 font-bold hover:bg-teal-700 disabled:opacity-40 transition text-base shadow-sm"
            >
              {saving
                ? <span className="inline-flex items-center justify-center gap-2"><Spinner /> 作成中...</span>
                : validSlots.length > 0 ? `🎉 共有リンクを作成（${validSlots.length}枠）` : '時間帯を追加してください'}
            </button>
            <button onClick={() => setStep(3)} className="w-full mt-3 py-2.5 text-sm text-slate-400 hover:text-slate-600 transition">← 戻る</button>
          </div>
        )}

      </div>

      {/* Sticky create button — mobile quick slot step */}
      {step === 2 && createMode === 'quick' && validSlots.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-sm border-t border-slate-100 p-4 sm:hidden z-30">
          <div className="max-w-lg mx-auto">
            <button onClick={handleCreate} disabled={saving} className="w-full bg-teal-600 text-white rounded-xl py-3.5 font-bold hover:bg-teal-700 transition text-base">
              {saving ? '作成中...' : `🎉 作成（${validSlots.length}枠）`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


/* ================================================================
   RequestModal
   ================================================================ */

function RequestModal({ shareId, slot, onClose, onSent, ownerName, hasEmail }: {
  shareId: string;
  slot: { date: string; start: string; end: string };
  onClose: () => void;
  onSent: (requestId: string) => void;
  ownerName?: string;
  hasEmail?: boolean;
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
      const reqRef = await addDoc(collection(db, 'mini_requests'), {
        share_id: shareId,
        slot_date: slot.date,
        slot_start: slot.start,
        slot_end: slot.end,
        requester_name: name.trim(),
        message: message.trim(),
        status: 'pending',
        created_at: Timestamp.fromDate(new Date()),
      });
      // オーナーにFCMプッシュ通知を送信
      try {
        const shareSnap = await getDoc(doc(db, 'mini_shares', shareId));
        const fcmToken = shareSnap.data()?.fcm_token;
        if (fcmToken) {
          const shareUrl = `${location.origin}${location.pathname}?share=${shareId}`;
          await fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: fcmToken,
              title: '新着依頼があります',
              body: `${name.trim()}さんから依頼が届きました`,
              url: shareUrl,
            }),
          });
        }
        // メール通知
        fetch('/api/mini/notify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shareId,
            requesterName: name.trim(),
            slotDate: slot.date,
            slotStart: slot.start,
            slotEnd: slot.end,
            message: message.trim(),
          }),
        }).catch(() => { /* 通知失敗は無視 */ });
      } catch { /* 通知失敗は無視 */ }
      saveRequesterName(name.trim());
      onSent(reqRef.id);
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

        {hasEmail && ownerName && (
          <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
            📧 {ownerName}さんはメール通知を設定しています
          </p>
        )}

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

function ShareView({ shareId, justCreated, ownerToken }: { shareId: string; justCreated: boolean; ownerToken?: string | null }) {
  const [share, setShare] = useState<ShareData | null>(null);
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  // 依頼一覧の表示/非表示
  const [showRequestList, setShowRequestList] = useState(false);
    // 期限切れ依頼をDBから削除
    useEffect(() => {
      const deleteExpiredRequests = async () => {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        try {
          const reqQ = query(collection(db, 'mini_requests'), where('share_id', '==', shareId));
          const snap = await getDoc(doc(db, 'mini_shares', shareId)); // シェアが存在するか確認
          if (!snap.exists()) return;
          const reqSnap = await onSnapshot(reqQ, async (snapshot) => {
            const batch: Promise<unknown>[] = [];
            snapshot.docs.forEach(docSnap => {
              const data = docSnap.data();
              if (data.slot_date < todayStr) {
                batch.push(deleteDoc(doc(db, 'mini_requests', docSnap.id)));
              }
            });
            if (batch.length > 0) await Promise.all(batch);
          });
          // 1回だけ実行してunsubscribe
          setTimeout(() => reqSnap(), 2000);
        } catch (e) { /* ignore */ }
      };
      deleteExpiredRequests();
    }, [shareId]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expired, setExpired] = useState(false);
  const [requestSlot, setRequestSlot] = useState<{ date: string; start: string; end: string } | null>(null);
  const [sentSlots, setSentSlots] = useState<Set<string>>(() => loadSentSlots(shareId));
  const [copied, setCopied] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(() => {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission !== 'granted') return false;
    try { return localStorage.getItem(`mini_notif_${shareId}`) !== 'off'; } catch { return true; }
  });
  const [showNotifExpand, setShowNotifExpand] = useState(false);
  const [editingSlots, setEditingSlots] = useState(false);
  const [draftSlots, setDraftSlots] = useState<TimeSlot[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [savingSlots, setSavingSlots] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [myRequestStatuses, setMyRequestStatuses] = useState<Map<string, { status: string; id: string }>>(new Map());
  const [showOwnerMenu, setShowOwnerMenu] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isDraft, setIsDraft] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [tokenVerified, setTokenVerified] = useState(false);
  const [showMgmtQr, setShowMgmtQr] = useState(false);
  const [showEditTitle, setShowEditTitle] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [platinumCode, setPlatinumCode] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailCodeError, setEmailCodeError] = useState('');
  const [editTitleVal, setEditTitleVal] = useState('');
  const [editDisplayNameVal, setEditDisplayNameVal] = useState('');
  const [requesterAliases, setRequesterAliases] = useState<Record<string, string>>({});
  const [editingRequesterName, setEditingRequesterName] = useState<{ id: string; name: string } | null>(null);
  const [editingRequesterAliasValue, setEditingRequesterAliasValue] = useState('');
  const [fpOwnerPrompt, setFpOwnerPrompt] = useState(false);
  const [fpChecked, setFpChecked] = useState(false);
  const isOwner = justCreated || isOwnedShare(shareId) || tokenVerified;
  const toast = useToast();

  const url = makeShareUrl(shareId);
  const prevPendingIdsRef = useRef<Set<string> | null>(null);
  const fcmRegisteredRef = useRef(false);

  useEffect(() => {
    if (!share) {
      setRequesterAliases({});
      return;
    }
    setRequesterAliases(share.requester_aliases || {});
  }, [share]);

  useEffect(() => {
    if (!editingRequesterName) {
      setEditingRequesterAliasValue('');
      return;
    }
    setEditingRequesterAliasValue(requesterAliases[editingRequesterName.name] || editingRequesterName.name);
  }, [editingRequesterName, requesterAliases]);

  const handleSaveNotifyEmail = async () => {
    if (!share) return;
    if (platinumCode !== 'mario3015#') {
      setEmailCodeError('プラチナコードが正しくありません');
      return;
    }
    if (!emailInput.trim()) { setEmailCodeError('メールアドレスを入力してください'); return; }
    setEmailSaving(true);
    setEmailCodeError('');
    const newEmail = emailInput.trim();
    try {
      await updateDoc(doc(db, 'mini_shares', shareId), { notify_email: newEmail });
      setShare(prev => prev ? { ...prev, notify_email: newEmail } : prev);
      // 確認メール送信
      const confirmRes = await fetch('/api/mini/email-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: newEmail,
          shareId,
          ownerName: share.displayName || share.name,
        }),
      });
      if (confirmRes.ok) {
        toast.show('登録完了！確認メールを送信しました', 'success');
      } else {
        const errBody = await confirmRes.json().catch(() => ({}));
        toast.show(`登録しましたがメール送信に失敗: ${errBody.error || confirmRes.status}`, 'error');
      }
      setShowEmailModal(false);
    } catch { toast.show('登録に失敗しました', 'error'); }
    setEmailSaving(false);
  };

  const handleSaveTitle = async () => {
    if (!share) return;
    const t = editTitleVal.trim();
    const d = editDisplayNameVal.trim();
    if (!t && !d) { setShowEditTitle(false); return; }
    const newTitle = t || share.title || '';
    const newDisplayName = d || share.displayName || share.name;
    try {
      await updateDoc(doc(db, 'mini_shares', shareId), { title: newTitle, displayName: newDisplayName });
      setShare(prev => prev ? { ...prev, title: newTitle, displayName: newDisplayName } : prev);
      toast.show('タイトルを更新しました', 'success');
    } catch { toast.show('更新に失敗しました', 'error'); }
    setShowEditTitle(false);
  };

  const getRequesterAlias = useCallback((requesterName: string) => {
    return requesterAliases[requesterName]?.trim() || requesterName;
  }, [requesterAliases]);

  const handleSaveRequesterAlias = async (requesterName: string, alias: string) => {
    const trimmed = alias.trim();
    const nextAliases = { ...requesterAliases };
    if (trimmed) nextAliases[requesterName] = trimmed;
    else delete nextAliases[requesterName];
    try {
      await updateDoc(doc(db, 'mini_shares', shareId), {
        requester_aliases: nextAliases,
      });
      setRequesterAliases(nextAliases);
      return true;
    } catch {
      return false;
    }
  };

  const handleChangeStatus = async (newStatus: 'active' | 'view_only' | 'draft') => {
    if (!share) return;
    const paused = newStatus === 'view_only';
    const draft = newStatus === 'draft';
    try {
      await updateDoc(doc(db, 'mini_shares', shareId), { paused, draft });
      setIsPaused(paused);
      setIsDraft(draft);
      setShare(prev => prev ? { ...prev, paused, draft } : prev);
      const msgs = { active: '依頼受付を再開しました', view_only: '閲覧専用に変更しました', draft: '下書き（非公開）に変更しました' };
      toast.show(msgs[newStatus], 'success');
      setShowStatusModal(false);
    } catch {
      toast.show('更新に失敗しました');
    }
  };

  const handleChangeBookingMode = async (mode: 'multiple' | 'exclusive') => {
    if (!share) return;
    const currentMode = share.bookingMode || 'exclusive';
    if (currentMode === mode) return;
    // exclusive に切り替え時: 同じ枠に2件以上approvedがあればブロック
    if (mode === 'exclusive') {
      const slotApprovedCount = new Map<string, number>();
      for (const r of requests) {
        if (r.status === 'approved') {
          const key = `${r.slot_date}_${r.slot_start}_${r.slot_end}`;
          slotApprovedCount.set(key, (slotApprovedCount.get(key) || 0) + 1);
        }
      }
      const conflict = [...slotApprovedCount.values()].some(c => c > 1);
      if (conflict) {
        toast.show('同じ枠に複数の承認があります。先に承認を整理してください', 'error');
        return;
      }
    }
    try {
      await updateDoc(doc(db, 'mini_shares', shareId), { bookingMode: mode });
      setShare(prev => prev ? { ...prev, bookingMode: mode } : prev);
      toast.show(mode === 'exclusive' ? '「1つだけ承認」に変更しました' : '「選んで承認」に変更しました', 'success');
    } catch {
      toast.show('変更に失敗しました', 'error');
    }
  };
  const myStatusRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const load = async () => {
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 12000)
        );
        const snap = await Promise.race([getDoc(doc(db, 'mini_shares', shareId)), timeout]);
        if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
        const data = snap.data() as ShareData;
        if (data.expires_at?.toDate() < new Date()) setExpired(true);
        setIsPaused(!!data.paused);
        setIsDraft(!!data.draft);
        setShare(data);
        // URL に ?owner=TOKEN が付いていれば照合してオーナー権限を引き継ぐ
        if (ownerToken && data.owner_token && ownerToken === data.owner_token) {
          saveOwnerToken(shareId, ownerToken);
          const dateRange = computeDateRange(data.slots);
          const lastDate = [...data.slots].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || '';
          saveOwnedShare(shareId, data.title || data.name, dateRange, lastDate);
          setTokenVerified(true);
        }
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
      const reqArr = snap.docs.map(d => ({ id: d.id, ...d.data() } as RequestEntry));
      setRequests(reqArr);
      // windowにrequestsをセットしイベント発火（MiniAppでバッジ用に参照）
      (window as any).__mini_requests = reqArr;
      window.dispatchEvent(new Event('mini_requests_update'));
      // ページ内通知: 新着pending依頼を検知
      if (isOwner) {
        const pendingMap = new Map(
          reqArr
            .filter(r => !r.status || r.status === 'pending')
            .map(r => [r.id, r] as [string, RequestEntry])
        );
        if (prevPendingIdsRef.current !== null) {
          const newReqs = [...pendingMap.values()].filter(r => !prevPendingIdsRef.current!.has(r.id));
          if (newReqs.length > 0 && Notification.permission === 'granted') {
            const r = newReqs[0];
            new Notification('新着依頼があります', {
              body: `${r.requester_name}さんから ${formatSlotDate(r.slot_date)} ${r.slot_start}–${r.slot_end} の依頼`,
              icon: '/choicrew-mark.svg',
              tag: 'choicrew-new-request',
            });
          }
        }
        prevPendingIdsRef.current = new Set(pendingMap.keys());
      } else {
        // 依頼者: 自分の依頼のステータス変化を検知
        const sentIds = loadSentRequestIds(shareId);
        const newStatusMap = new Map<string, { status: string; id: string }>();
        for (const [key, reqId] of sentIds.entries()) {
          const req = reqArr.find(r => r.id === reqId);
          if (req) {
            const prevStatus = myStatusRef.current.get(key);
            const newStatus = req.status || 'pending';
            newStatusMap.set(key, { status: newStatus, id: reqId });
            if (prevStatus !== undefined && prevStatus !== newStatus) {
              const msgs: Record<string, string> = {
                approved: '依頼が承認されました！',
                declined: '依頼が辞退されました',
                cancelled: '依頼がキャンセルされました',
              };
              if ('Notification' in window && Notification.permission === 'granted' && msgs[newStatus]) {
                new Notification(msgs[newStatus], { icon: '/choicrew-mark.svg', tag: 'choicrew-status-change' });
              }
            }
            myStatusRef.current.set(key, newStatus);
          }
        }
        if (newStatusMap.size > 0) setMyRequestStatuses(newStatusMap);
      }
    });
    return () => unsub();
  }, [shareId]);

  // FP+IP: オーナーなら登録（既存シェアの移行含む）、非オーナーなら照合
  useEffect(() => {
    if (loading) return;
    if (isOwner) {
      // オーナーがブラウザで開いた → FP+IPを登録/更新
      registerOwnerFingerprint(shareId);
    } else if (!fpChecked && !isNotOwnerDismissed(shareId)) {
      // 非オーナー → FP+IP照合
      setFpChecked(true);
      checkOwnerFingerprint(shareId).then(match => {
        if (match) setFpOwnerPrompt(true);
      });
    }
  }, [loading, isOwner, shareId, fpChecked]);

  // FCM Web Push: オーナーのみ、許可済みならトークンを取得
  useEffect(() => {
    if (!isOwner || fcmRegisteredRef.current) return;
    fcmRegisteredRef.current = true;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      registerFCMToken();
    }
  }, [isOwner, shareId]);

  const unregisterFCMToken = async () => {
    try {
      await updateDoc(doc(db, 'mini_shares', shareId), { fcm_token: null });
    } catch { /* ignore */ }
    try { localStorage.setItem(`mini_notif_${shareId}`, 'off'); } catch { /* */ }
  };

  const registerFCMToken = async () => {
    if (!messaging) return;
    const vapidKey = (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey) return;
    try {
      const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });
      if (token) {
        await updateDoc(doc(db, 'mini_shares', shareId), { fcm_token: token });
      }
    } catch (err) {
      console.error('FCM registration failed:', err);
    }
  };

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

  const handleSent = (slot: { date: string; start: string; end: string }, requestId: string) => {
    const key = slotKey(slot);
    saveSentRequestId(shareId, key, requestId);
    const next = saveSentSlot(shareId, key, sentSlots);
    setSentSlots(next);
    setRequestSlot(null);
    toast.show('依頼を送信しました', 'success');
  };

  const requestsForSlot = (s: { date: string; start: string; end: string }) =>
    requests.filter(r => r.slot_date === s.date && r.slot_start === s.start && r.slot_end === s.end);

  // exclusiveモード時、同じ枠の他pendingをdeclinedに
  const handleApprove = async (requestId: string) => {
    try {
      const req = requests.find(r => r.id === requestId);
      if (!req) return;
      await updateDoc(doc(db, 'mini_requests', requestId), { status: 'approved' });
      if (share?.bookingMode !== 'multiple') {
        // 同じ枠の他pendingをdeclinedに
        const sameSlotPending = requests.filter(r =>
          r.id !== requestId &&
          r.slot_date === req.slot_date &&
          r.slot_start === req.slot_start &&
          r.slot_end === req.slot_end &&
          (!r.status || r.status === 'pending')
        );
        for (const r of sameSlotPending) {
          await updateDoc(doc(db, 'mini_requests', r.id), { status: 'declined' });
        }
      }
      toast.show('承認しました', 'success');
    } catch (err) {
      console.error(err);
      toast.show('エラーが発生しました', 'error');
    }
  };

  const handleDecline = async (requestId: string) => {
    try {
      await updateDoc(doc(db, 'mini_requests', requestId), { status: 'declined' });
      toast.show('辞退しました', 'success');
    } catch (err) {
      console.error(err);
      toast.show('エラーが発生しました', 'error');
    }
  };

  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  // exclusiveモード時、同じ枠のdeclinedをpendingに戻す
  const handleCancel = async (requestId: string) => {
    try {
      const req = requests.find(r => r.id === requestId);
      if (!req) return;
      await updateDoc(doc(db, 'mini_requests', requestId), { status: 'pending' });
      if (share?.bookingMode !== 'multiple') {
        // 同じ枠のdeclinedをpendingに戻す
        const sameSlotDeclined = requests.filter(r =>
          r.id !== requestId &&
          r.slot_date === req.slot_date &&
          r.slot_start === req.slot_start &&
          r.slot_end === req.slot_end &&
          r.status === 'declined'
        );
        for (const r of sameSlotDeclined) {
          await updateDoc(doc(db, 'mini_requests', r.id), { status: 'pending' });
        }
      }
      setConfirmCancelId(null);
      toast.show('承認を取り消しました', 'success');
    } catch (err) {
      console.error(err);
      toast.show('エラーが発生しました', 'error');
    }
  };

  const handleChangeTheme = async (newTheme: ThemeKey) => {
    if (!share) return;
    try {
      await updateDoc(doc(db, 'mini_shares', shareId), { theme: newTheme });
      setShare(prev => prev ? { ...prev, theme: newTheme } : prev);
      setShowThemePicker(false);
      toast.show('テーマを変更しました', 'success');
    } catch (err) {
      console.error('theme change error:', err);
      toast.show('変更に失敗しました', 'error');
    }
  };

  const handleSaveSlots = async () => {
    setSavingSlots(true);
    try {
      const validSlots = draftSlots
        .filter(s => isValidSlotRange(s.start, s.end))
        .map(({ date, start, end }) => ({ date, start, end }));
      if (validSlots.length === 0) {
        toast.show('有効な時間帯がありません', 'error');
        setSavingSlots(false);
        return;
      }
      await updateDoc(doc(db, 'mini_shares', shareId), { slots: validSlots });
      setShare(prev => prev ? { ...prev, slots: validSlots } : prev);
      // dateRangeをlocalStorageに反映
      const newDateRange = computeDateRange(validSlots);
      const newLastDate = [...validSlots].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || '';
      saveOwnedShare(shareId, share?.title || share?.name || '', newDateRange, newLastDate);
      setEditingSlots(false);
      toast.show('時間を更新しました', 'success');
    } catch (err) {
      console.error(err);
      toast.show('更新に失敗しました', 'error');
    } finally {
      setSavingSlots(false);
    }
  };

  const handleDeleteShare = async () => {
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'mini_shares', shareId));
      try {
        const raw = localStorage.getItem('mini_owned_shares');
        if (raw) {
          const entries = JSON.parse(raw) as OwnedShareEntry[];
          localStorage.setItem('mini_owned_shares', JSON.stringify(entries.filter(e => e.id !== shareId)));
        }
      } catch { /* */ }
      window.location.href = '/mini/';
    } catch (err) {
      console.error(err);
      toast.show('削除に失敗しました', 'error');
      setDeleting(false);
    }
  };

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

  // 非公開（下書き）の場合、オーナー以外には表示しない
  if (isDraft && !isOwner) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <p className="text-slate-700 text-lg font-semibold mb-1">このページは非公開です</p>
          <p className="text-slate-400 text-sm mb-6">現在、作成者によって非公開に設定されています</p>
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

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const sortedSlots = [...share.slots]
    .filter(s => s.date >= todayStr)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.start.localeCompare(b.start);
    });

  const groupedSlots: Record<string, typeof sortedSlots> = {};
  for (const slot of sortedSlots) {
    if (!groupedSlots[slot.date]) groupedSlots[slot.date] = [];
    groupedSlots[slot.date].push(slot);
  }

  const expiryLabel = share.expires_at ? format(share.expires_at.toDate(), 'M/d(E)', { locale: ja }) : '';
  const canShareNative = typeof navigator.share === 'function';
  const themeKey: ThemeKey = (share.theme || 'simple') as ThemeKey;
  const T = THEMES[themeKey] || THEMES.simple;

  return (
    <div className={`min-h-screen ${T.pageBg} print:bg-white relative overflow-x-hidden`}>
      {toast.UI}
      {/* ── テーマ背景画像（absolute + 大きめサイズでモバイルのカクつき防止） ── */}
      {themeKey === 'darkbg' && (
        <div
          className="pointer-events-none print:hidden"
          aria-hidden="true"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: '200vh', minHeight: '100%',
            zIndex: 0,
            backgroundImage: "url('/dark-bg.jpg')",
            backgroundSize: 'cover', backgroundPosition: 'center top',
            opacity: 0.55,
            willChange: 'transform',
          }}
        />
      )}
      {themeKey === 'konbini' && (
        <div
          className="pointer-events-none print:hidden"
          aria-hidden="true"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: '200vh', minHeight: '100%',
            zIndex: 0,
            backgroundImage: "url('/konbini-bg.jpg')",
            backgroundSize: 'cover', backgroundPosition: 'center top',
            opacity: 0.18,
            willChange: 'transform',
          }}
        />
      )}
      {themeKey === 'himawari' && (
        <div
          className="pointer-events-none print:hidden"
          aria-hidden="true"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: '200vh', minHeight: '100%',
            zIndex: 0,
            backgroundImage: "url('/himawari-bg.jpg')",
            backgroundSize: 'cover', backgroundPosition: 'center top',
            opacity: 0.22,
            willChange: 'transform',
          }}
        />
      )}
      {/* ── アニメテーマ装飾 ── */}
      {themeKey === 'anime' && (
        <div className="pointer-events-none select-none print:hidden" aria-hidden="true">
          {/* 左上の桜 */}
          <span className="fixed top-4 left-2 text-4xl opacity-30 animate-[spin_12s_linear_infinite]">🌸</span>
          <span className="fixed top-20 left-6 text-2xl opacity-20 animate-[spin_18s_linear_infinite_reverse]">✿</span>
          {/* 右上 */}
          <span className="fixed top-8 right-3 text-3xl opacity-25 animate-[spin_15s_linear_infinite]">⭐</span>
          <span className="fixed top-28 right-8 text-xl opacity-20">✨</span>
          {/* 左下 */}
          <span className="fixed bottom-16 left-4 text-3xl opacity-20 animate-[spin_20s_linear_infinite_reverse]">🌸</span>
          <span className="fixed bottom-32 left-10 text-lg opacity-15">★</span>
          {/* 右下 */}
          <span className="fixed bottom-10 right-4 text-2xl opacity-20 animate-[spin_10s_linear_infinite]">✿</span>
          {/* スピードライン SVG */}
          <svg className="fixed inset-0 w-full h-full opacity-[0.04]" viewBox="0 0 400 800" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
            {[0,40,80,120,160,200,240,280,320,360].map((y,i) => (
              <line key={i} x1="0" y1={y} x2="400" y2={y+30} stroke="#f472b6" strokeWidth="1.5" />
            ))}
          </svg>
        </div>
      )}
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

        {/* Owner: compact URL strip */}
        {isOwner && (
          <div className="flex items-center gap-2 mb-5 print:hidden">
            <button
              onClick={handleCopy}
              className="flex-1 flex items-center gap-2 bg-white/80 backdrop-blur border border-slate-200 rounded-xl px-3 py-2 text-sm hover:bg-white transition min-w-0"
            >
              <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              <span className="truncate text-xs text-slate-400 font-mono">{url.replace('https://', '')}</span>
              <span className={`shrink-0 text-xs font-semibold ml-auto ${copied ? 'text-teal-600' : 'text-slate-500'}`}>{copied ? '✓ コピー済み' : 'コピー'}</span>
            </button>
            <div className="relative shrink-0">
              <button
                onClick={() => setShowOwnerMenu(v => !v)}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition text-lg"
                aria-label="メニュー"
              >
                ⋯
              </button>
              {showOwnerMenu && (
                <div className="absolute right-0 top-11 bg-white border border-slate-200 rounded-xl shadow-xl py-1 min-w-[170px] z-20 animate-[fadeIn_0.15s_ease-out]">
                  <button onClick={() => { setDraftSlots((share?.slots || []).map(s => ({ id: genId(6), ...s }))); setEditingSlots(true); setShowOwnerMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">✏️ 時間を編集</button>
                  <button onClick={() => { setShowThemePicker(true); setShowOwnerMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">🎨 テーマを変更</button>
                  <button onClick={() => { setEmailInput(share.notify_email || ''); setPlatinumCode(''); setEmailCodeError(''); setShowEmailModal(true); setShowOwnerMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                    📧 メール通知{share.notify_email ? <span className="ml-2 text-[10px] text-teal-600 bg-teal-50 rounded-full px-1.5 py-0.5 font-medium">登録済</span> : null}
                  </button>
                  
                    <button onClick={() => { setShowMgmtQr(true); setShowOwnerMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">📱管理を引きつぐ</button>
                  
                  {'Notification' in window && Notification.permission !== 'denied' && (
                    <button style={{ display: 'none' }} 
                      onClick={async () => {
                        setShowOwnerMenu(false);
                        if (notifEnabled) {
                          await unregisterFCMToken(); setNotifEnabled(false);
                        } else {
                          if (Notification.permission === 'granted') {
                            try { localStorage.removeItem(`mini_notif_${shareId}`); } catch { /* */ }
                            setNotifEnabled(true); registerFCMToken();
                          } else {
                            const perm = await Notification.requestPermission();
                            if (perm === 'granted') {
                              try { localStorage.removeItem(`mini_notif_${shareId}`); } catch { /* */ }
                              setNotifEnabled(true); registerFCMToken();
                            }
                          }
                        }
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <BellIcon className="w-3.5 h-3.5" />
                      依頼通知 {notifEnabled ? <span className="text-[10px] text-teal-600 bg-teal-50 rounded-full px-1.5 py-0.5 font-medium">ON</span> : <span className="text-[10px] text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5 font-medium">OFF</span>}
                    </button>
                  )}
                  <hr className="my-1 border-slate-100" />
                  <button onClick={() => { setShowDeleteConfirm(true); setShowOwnerMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50">削除する</button>
                </div>
              )}
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
          <div className="inline-flex items-center gap-2">
            <h1 className={`text-2xl font-bold ${T.headingText} tracking-tight`}>
              {share.title || share.name + 'さんの空き時間'}
            </h1>
            {isOwner && (
              <button
                onClick={() => { setEditTitleVal(share.title || ''); setEditDisplayNameVal(share.displayName || share.name); setShowEditTitle(true); }}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-teal-500 hover:bg-teal-50 transition -mt-0.5"
                aria-label="タイトルを編集"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              </button>
            )}
          </div>
          <p className={`text-sm ${T.subText} mt-1`}>
            作成者：{share.displayName || share.name}
          </p>
          {isOwner && requests.filter(r => !r.status || r.status === 'pending' || r.status === 'approved').length > 0 && (
            <p className="text-sm text-teal-600 font-medium mt-1">{requests.filter(r => !r.status || r.status === 'pending' || r.status === 'approved').length}件の依頼</p>
          )}
        </div>

        {/* Edit title modal */}
        {showEditTitle && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowEditTitle(false)}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-800">タイトルと名前を編集</h2>
                <button onClick={() => setShowEditTitle(false)} className="text-slate-400 hover:text-slate-600 text-xl px-2">✕</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">タイトル</label>
                  <input
                    type="text"
                    value={editTitleVal}
                    onChange={e => setEditTitleVal(e.target.value)}
                    placeholder={share.name + 'さんの空き時間'}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                    maxLength={60}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">表示名（作成者）</label>
                  <input
                    type="text"
                    value={editDisplayNameVal}
                    onChange={e => setEditDisplayNameVal(e.target.value)}
                    placeholder={share.name}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                    maxLength={30}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    元の名前: <span className="font-medium text-slate-500">{share.name}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={handleSaveTitle}
                className="mt-5 w-full bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 active:scale-95 transition-all"
              >
                保存する
              </button>
            </div>
          </div>
        )}

        {editingRequesterName && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditingRequesterName(null)}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-800">プロフィール</h2>
                <button onClick={() => setEditingRequesterName(null)} className="text-slate-400 hover:text-slate-600 text-xl px-2">×</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">相手の表示名</label>
                  <input
                    type="text"
                    value={editingRequesterAliasValue}
                    onChange={e => setEditingRequesterAliasValue(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                    maxLength={40}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    元の名前: <span className="font-medium text-slate-500">{editingRequesterName.name}</span>
                  </p>
                </div>
                <p className="text-xs text-slate-400">
                  これはこの予定表に保存されます。別端末でも同じ予定表を開けば反映されます。
                </p>
              </div>
              <div className="flex gap-3 mt-5">
                <button
                  onClick={async () => {
                    const ok = await handleSaveRequesterAlias(
                      editingRequesterName.name,
                      editingRequesterAliasValue
                    );
                    if (ok) setEditingRequesterName(null);
                  }}
                  className="flex-1 bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 active:scale-95 transition-all"
                >
                  保存
                </button>
                <button
                  onClick={() => setEditingRequesterName(null)}
                  className="flex-1 rounded-xl border border-slate-200 text-slate-600 py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Owner: Request summary */}
        {isOwner && requests.filter(r => !r.status || r.status === 'pending' || r.status === 'approved').length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6 print:hidden">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700">依頼一覧</h2>
              <button
                className="text-xs text-teal-600 border border-teal-200 rounded-lg px-2 py-1 hover:bg-teal-50 transition"
                onClick={() => setShowRequestList(v => !v)}
              >
                {showRequestList ? '非表示' : '表示'}
              </button>
            </div>
            {showRequestList && (
              <div className="space-y-2">
                {requests
                  .filter(r => !r.status || r.status === 'pending' || r.status === 'approved')
                  .sort((a, b) => b.created_at.toMillis() - a.created_at.toMillis())
                  .map(r => (
                  <div key={r.id} className={`flex items-start gap-3 p-2.5 rounded-xl ${
                    r.status === 'approved' ? 'bg-blue-50 border border-blue-100' :
                    'bg-slate-50'
                  }`}>
                    <Avatar name={getRequesterAlias(r.requester_name)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setEditingRequesterName({ id: r.id, name: r.requester_name })}
                          className="text-sm font-semibold text-slate-700 hover:text-teal-600 transition text-left"
                        >
                          {getRequesterAlias(r.requester_name)}
                        </button>
                        {requesterAliases[r.requester_name]?.trim() ? (
                          <span className="text-[11px] text-slate-400">元: {r.requester_name}</span>
                        ) : null}
                        <span className="text-[11px] text-slate-400">
                          {formatSlotDate(r.slot_date)} {r.slot_start}–{r.slot_end}
                        </span>
                        {r.status === 'approved' && (
                          <span className="text-[11px] font-medium text-blue-600 bg-blue-100 rounded-full px-2 py-0.5">承認済み</span>
                        )}
                        {r.status === 'declined' && (
                          <span className="text-[11px] font-medium text-slate-500 bg-slate-200 rounded-full px-2 py-0.5">辞退済み</span>
                        )}
                        {r.status === 'cancelled' && (
                          <span className="text-[11px] font-medium text-red-500 bg-red-100 rounded-full px-2 py-0.5">キャンセル済み</span>
                        )}
                      </div>
                      {r.message && (
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{r.message}</p>
                      )}
                      {(!r.status || r.status === 'pending') ? (
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => handleApprove(r.id)}
                            className="px-3 py-1 rounded-lg bg-blue-500 text-white text-xs font-medium hover:bg-blue-600 active:scale-95 transition-all"
                          >承認</button>
                          <button
                            onClick={() => handleDecline(r.id)}
                            className="px-3 py-1 rounded-lg bg-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-300 active:scale-95 transition-all"
                          >辞退</button>
                        </div>
                      ) : r.status === 'approved' ? (
                        <div className="flex gap-2 mt-2">
                          {confirmCancelId === r.id ? (
                            <>
                              <span className="text-xs text-slate-500 self-center">本当に取り消しますか？</span>
                              <button
                                onClick={() => handleCancel(r.id)}
                                className="px-3 py-1 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 active:scale-95 transition-all"
                              >取り消す</button>
                              <button
                                onClick={() => setConfirmCancelId(null)}
                                className="px-3 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs font-medium hover:bg-slate-200 active:scale-95 transition-all"
                              >戻る</button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirmCancelId(r.id)}
                              className="px-3 py-1 rounded-lg bg-red-50 text-red-500 text-xs font-medium hover:bg-red-100 active:scale-95 transition-all border border-red-100"
                            >承認を取り消す</button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Visitor: brief instruction + pending summary */}
        {!isOwner && !expired && sortedSlots.length > 0 && (
          <div className="text-center mb-4 space-y-1">
            <p className="text-sm text-slate-400">希望の時間帯を選んで依頼できます</p>
            {myRequestStatuses.size > 0 && (() => {
              const pendingCount = [...myRequestStatuses.values()].filter(v => v.status === 'pending').length;
              return pendingCount > 0 ? (
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-4 py-1">
                  <span className="animate-pulse">✨</span> リクエスト中 {pendingCount}件
                </p>
              ) : null;
            })()}
          </div>
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
                  <h2 className={`text-base font-bold tracking-wide ${today ? 'text-teal-600' : 'text-slate-600'}`}>
                    {formatSlotDate(date)}
                    {today && <span className="ml-2 text-xs font-semibold bg-teal-100 text-teal-600 rounded-full px-2 py-0.5">今日</span>}
                  </h2>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>

                {/* Slots for this date */}
                <div className="space-y-2.5">
                  {dateSlots.map((slot, i) => {
                    const key = slotKey(slot);
                    const sent = sentSlots.has(key);
                    const reqs = requestsForSlot(slot).filter(r => !r.status || r.status === 'pending' || r.status === 'approved');
                    // exclusiveモード: 1人でもapprovedがいれば他は依頼不可
                    const isExclusive = share?.bookingMode !== 'multiple';
                    const hasApproved = reqs.some(r => r.status === 'approved');
                    const myReqStatus = !isOwner ? myRequestStatuses.get(key) : undefined;
                    const isFilledByOther = !isOwner && isExclusive && hasApproved && myReqStatus?.status !== 'approved';
                    const borderClass = isOwner && reqs.length > 0
                      ? 'border-teal-200 border-l-[3px] border-l-teal-400'
                      : myReqStatus?.status === 'approved'
                      ? 'border-blue-200 border-l-[3px] border-l-blue-400'
                      : isFilledByOther
                      ? 'border-slate-100'
                      : 'border-slate-200';
                    return (
                      <div key={i} className={`${T.card} rounded-2xl p-4 print:border-slate-300 transition-colors ${borderClass}${isFilledByOther ? ' opacity-50' : ''}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className={`text-2xl font-semibold tracking-tight ${T.timeText}`}>
                              {slot.start}<span className="text-slate-300 mx-1.5">–</span>{slot.end}
                            </p>
                            <TimeBar start={slot.start} end={slot.end} />
                            {!expired && reqs.length > 0 && !isOwner && (
                              isExclusive && hasApproved ? (
                                myReqStatus?.status === 'approved' ? (
                                  <p className="text-xs text-blue-600 font-medium mt-2">あなたのリクエストが承認されました</p>
                                ) : (
                                  <p className="text-xs text-blue-600 font-medium mt-2">他の人の依頼で枠が埋まりました</p>
                                )
                              ) : (
                                <p className="text-xs text-teal-600 font-medium mt-2">{reqs.length}人が希望</p>
                              )
                            )}
                          </div>
                          <div className="ml-3 shrink-0 print:hidden">
                            {isOwner ? (
                              reqs.length > 0 ? (
                                <span className="text-sm text-teal-700 font-medium bg-teal-50 px-3 py-1.5 rounded-lg">
                                  {share.bookingMode === 'multiple'
                                    ? `${reqs.filter(r => r.status === 'approved').length}/${reqs.length}人`
                                    : `${reqs.length}件`}
                                </span>
                              ) : null
                            ) : expired ? (
                              <span className="text-xs text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg">期限切れ</span>
                            ) : myReqStatus?.status === 'approved' ? (
                              <span className="text-sm text-blue-600 font-bold bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg">
                                承認済み ✓
                              </span>
                            ) : myReqStatus?.status === 'declined' ? (
                              <span className="text-sm text-slate-500 font-medium bg-slate-100 px-3 py-1.5 rounded-lg">
                                辞退されました
                              </span>
                            ) : myReqStatus?.status === 'cancelled' ? (
                              <span className="text-sm text-red-400 font-medium bg-red-50 px-3 py-1.5 rounded-lg">
                                キャンセル済み
                              </span>
                            ) : sent ? (
                              <span className="inline-flex items-center gap-1 text-sm text-teal-700 font-semibold bg-gradient-to-r from-teal-50 to-cyan-50 border border-teal-200 px-3 py-1.5 rounded-lg">
                                <span className="animate-pulse">✨</span> リクエスト中
                              </span>
                            ) : isPaused ? (
                              <span className="text-sm text-slate-400 font-medium bg-slate-100 px-3 py-1.5 rounded-lg">
                                閲覧のみ
                              </span>
                            ) : isExclusive && hasApproved ? null : (
                              <button
                                onClick={() => setRequestSlot(slot)}
                                className={`${T.accentBtn} text-sm font-medium rounded-xl px-5 py-2.5 transition-all shadow-sm`}
                                disabled={isExclusive && reqs.some(r => r.status === 'pending')}
                                title={isExclusive && reqs.some(r => r.status === 'pending') ? '希望者がいます' : ''}
                              >
                                {isExclusive && reqs.some(r => r.status === 'pending') ? '希望者あり' : '依頼する'}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Owner: requester avatars */}
                        {isOwner && reqs.filter(r => !r.status || r.status === 'pending' || r.status === 'approved').length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-100">
                            <div className="flex flex-wrap gap-2">
                              {reqs.filter(r => !r.status || r.status === 'pending' || r.status === 'approved').map(r => (
                                <div key={r.id} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full pl-1 pr-2.5 py-1" title={r.message || undefined}>
                                  <Avatar name={getRequesterAlias(r.requester_name)} />
                                  <button
                                    type="button"
                                    onClick={() => setEditingRequesterName({ id: r.id, name: r.requester_name })}
                                    className="text-xs font-medium text-slate-600 hover:text-teal-600 transition text-left"
                                  >
                                    {getRequesterAlias(r.requester_name)}
                                  </button>
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

        {/* 閲覧用メッセージ */}
        {!isOwner && isPaused && (
          <div className="mx-4 mb-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-center">
            <p className="text-sm text-slate-500">閲覧用として公開されています。確認がしたい場合は、予定の作成者に直接ご連絡ください。</p>
          </div>
        )}

        {/* FP+IP一致: オーナー確認モーダル（第2層） */}
        {fpOwnerPrompt && !isOwner && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-[fadeIn_0.2s_ease-out] print:hidden">
            <div className="bg-white rounded-2xl p-6 mx-6 max-w-sm w-full shadow-xl">
              <p className="font-semibold text-slate-800 text-base mb-2">この予定の管理者ですか？</p>
              <p className="text-sm text-slate-500 mb-5">別のブラウザで作成した予定と同じ端末からのアクセスを検知しました</p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const dateRange = share ? computeDateRange(share.slots) : '';
                    const lastDate = share ? [...share.slots].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || '' : '';
                    saveOwnedShare(shareId, share?.title || share?.name || '', dateRange, lastDate);
                    setFpOwnerPrompt(false);
                    setTokenVerified(true);
                    toast.show('管理者として復帰しました', 'success');
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition"
                >
                  はい、管理者です
                </button>
                <button
                  onClick={() => {
                    setNotOwnerDismissed(shareId);
                    setFpOwnerPrompt(false);
                  }}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-medium hover:bg-slate-50 transition"
                >
                  いいえ
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer CTA (visitor) */}
        {!isOwner && (
          <div className="text-center border-t border-slate-100 pt-8 mt-4 print:hidden">
            <p className="text-sm text-slate-500 mb-3">あなたも空き時間を共有しませんか？</p>
            <a
              href="/mini/"
              className="inline-block bg-amber-200 text-white rounded-xl px-4 py-1
                         font-medium hover:bg-amber-300 transition shadow-sm"
            >
              空き時間を作成する
            </a>
            {/* 第3層フォールバック: ブラウザで開いてください */}
            <p className="mt-6 text-xs text-slate-300 hover:text-slate-400 transition cursor-default">
              管理者の方は<button
                onClick={() => {
                  const ua = navigator.userAgent || '';
                  const isLine = /Line/i.test(ua);
                  const isInApp = /Line|FBAN|FBAV|Instagram|Twitter/i.test(ua);
                  if (isLine) {
                    // LINE内ブラウザ → openExternalBrowser=1 で外部ブラウザへ
                    const url = new URL(window.location.href);
                    url.searchParams.set('openExternalBrowser', '1');
                    window.location.href = url.toString();
                  } else if (isInApp) {
                    // その他アプリ内ブラウザ
                    const url = window.location.href;
                    window.open(url, '_blank');
                    toast.show('ブラウザで開いて管理してください', 'success');
                  } else {
                    toast.show('このブラウザで作成した予定は自動的に管理者になります', 'success');
                  }
                }}
                className="underline text-slate-400 hover:text-slate-500 transition"
              >ブラウザで開いてください</button>
            </p>
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

      {/* 状態ボタン（オーナーのみ・右下固定） */}
      {isOwner && (
        <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-1.5 print:hidden">
          <button
            onClick={() => setShowStatusModal(true)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium transition-all ${
              isDraft
                ? 'bg-slate-500 text-white hover:bg-slate-600'
                : isPaused
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span className={`w-3 h-3 rounded-full ${isDraft ? 'bg-slate-300' : isPaused ? 'bg-white' : 'bg-teal-500'}`} />
            {isDraft ? '下書き（非公開）' : isPaused ? '閲覧専用' : '依頼受付中'}
          </button>

        </div>
      )}

      {/* 状態変更モーダル */}
      {showStatusModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50"
          onClick={() => setShowStatusModal(false)}
        >
          <div className="bg-white rounded-2xl p-4 w-full max-w-sm mx-4 shadow-2xl mb-4 sm:mb-0 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-slate-800">公開状態を変更</h2>
              <button onClick={() => setShowStatusModal(false)} className="text-slate-400 hover:text-slate-600 text-xl px-2">✕</button>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => handleChangeStatus('active')}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${!isPaused && !isDraft ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-teal-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">依頼受付中</p>
                </div>
                {!isPaused && !isDraft && <span className="text-teal-500 text-xs font-bold shrink-0">現在</span>}
              </button>
              <button
                onClick={() => handleChangeStatus('view_only')}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${isPaused && !isDraft ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">表示のみにする</p>
                </div>
                {isPaused && !isDraft && <span className="text-amber-500 text-xs font-bold shrink-0">現在</span>}
              </button>
              <button
                onClick={() => handleChangeStatus('draft')}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${isDraft ? 'border-slate-500 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">下書きにする</p>
                </div>
                {isDraft && <span className="text-slate-500 text-xs font-bold shrink-0">現在</span>}
              </button>
            </div>
            {/* 承認モード切り替え */}
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-500 mb-2">承認モード</p>
              <div className="flex flex-col gap-1.5">
                {(['exclusive', 'multiple'] as const).map(mode => {
                  const current = share?.bookingMode || 'exclusive';
                  const isActive = current === mode;
                  return (
                    <button
                      key={mode}
                      onClick={() => handleChangeBookingMode(mode)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${
                        isActive ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                        isActive ? 'border-teal-500 bg-teal-500' : 'border-slate-300'
                      }`}>
                        {isActive && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800">{mode === 'exclusive' ? '1つだけ承認' : '選んで承認'}</p>
                      </div>
                      {isActive && <span className="text-teal-500 text-xs font-bold shrink-0">現在</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 text-center">
              <button
                onClick={() => { setShowStatusModal(false); setShowDeleteConfirm(true); }}
                className="text-sm text-red-400 hover:text-red-600 transition"
              >
                この共有を削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* メール通知モーダル */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50" onClick={() => setShowEmailModal(false)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm mx-4 shadow-2xl mb-4 sm:mb-0" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-800">📧 メール通知</h2>
              <button onClick={() => setShowEmailModal(false)} className="text-slate-400 hover:text-slate-600 text-xl px-2">✕</button>
            </div>
            {share?.notify_email && (
              <p className="text-xs text-teal-600 bg-teal-50 rounded-xl px-3 py-2 mb-3">現在の通知先: {share.notify_email}</p>
            )}
            <p className="text-xs text-slate-400 mb-4">依頼が届いたときにメールでお知らせします。有効化には<span className="font-semibold text-slate-600">プレミアム機能</span>のため、プラチナコードが必要です。</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">通知先メールアドレス</label>
                <input
                  type="email"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">プラチナコード</label>
                <input
                  type="password"
                  value={platinumCode}
                  onChange={e => { setPlatinumCode(e.target.value); setEmailCodeError(''); }}
                  placeholder="コードを入力"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                />
              </div>
              {emailCodeError && <p className="text-xs text-red-500">{emailCodeError}</p>}
            </div>
            <button
              onClick={handleSaveNotifyEmail}
              disabled={emailSaving}
              className="mt-5 w-full bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 active:scale-95 transition-all disabled:opacity-50"
            >
              {emailSaving ? '登録中...' : '登録する'}
            </button>
          </div>
        </div>
      )}

      {/* 管理用QRモーダル */}
      {showMgmtQr && (() => {
        const token = share?.owner_token || loadOwnerToken(shareId);
        const mgmtUrl = token ? `${url}?owner=${token}` : url;
        return (
          <div
            className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50"
            onClick={() => setShowMgmtQr(false)}
          >
            <div className="bg-white rounded-3xl p-6 w-full max-w-sm mx-4 shadow-2xl mb-4 sm:mb-0 text-center" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-800">📱 引き継ぎ</h2>
                <button onClick={() => setShowMgmtQr(false)} className="text-slate-400 hover:text-slate-600 text-xl px-2">✕</button>
              </div>
              <p className="text-xs text-slate-500 mb-4">このQRコードをスマホで読み取ると<br />管理者として操作できます</p>
              <div className="flex justify-center mb-4">
                <img src={makeQrUrl(mgmtUrl, 200)} alt="管理用QR" className="w-48 h-48 rounded-xl border border-slate-100" />
              </div>
              <p className="text-[10px] text-slate-400 break-all mb-4">{mgmtUrl}</p>
              <button
                onClick={async () => {
                  try { await navigator.clipboard.writeText(mgmtUrl); toast.show('管理用URLをコピーしました', 'success'); }
                  catch { toast.show('コピーに失敗しました'); }
                }}
                className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition"
              >
                URLをコピー
              </button>
              <p className="text-[10px] text-red-400 mt-3">※このURLを知っている人は管理できます。信頼できる人にのみ共有してください</p>
            </div>
          </div>
        );
      })()}

      {requestSlot && (
        <RequestModal
          shareId={shareId}
          slot={requestSlot}
          onClose={() => setRequestSlot(null)}
          onSent={(requestId) => handleSent(requestSlot, requestId)}
          ownerName={share?.displayName || share?.name}
          hasEmail={!!share?.notify_email}
        />
      )}

      {/* 削除確認モーダル */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">この共有を削除しますか？</h3>
            <p className="text-sm text-slate-500 mb-5">削除すると復元できません。受け取った依頼も確認できなくなります。</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition"
              >
                キャンセル
              </button>
              <button
                onClick={handleDeleteShare}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 disabled:opacity-40 transition"
              >
                {deleting ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 時間帯編集オーバーレイ */}
      {showThemePicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowThemePicker(false)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-800">テーマを変更</h2>
              <button onClick={() => setShowThemePicker(false)} className="text-slate-400 hover:text-slate-600 text-xl px-2">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(Object.entries(THEMES) as [ThemeKey, typeof THEMES[ThemeKey]][]).map(([key, t]) => (
                <button
                  key={key}
                  onClick={() => handleChangeTheme(key)}
                  className={`relative rounded-2xl p-4 text-left border-2 transition-all ${themeKey === key ? 'border-teal-500 shadow-md scale-[1.02]' : 'border-slate-200 hover:border-slate-300'}`}
                  style={{  }}
                >
                  <div className="w-full h-12 rounded-xl mb-3" style={{ background: t.previewBg }} />
                  <p className="text-xs font-bold text-slate-700">{t.emoji} {t.label}</p>
                  {themeKey === key && <span className="absolute top-2 right-2 text-teal-500 text-xs font-bold">✓ 現在</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {editingSlots && (
        <div className="fixed inset-0 bg-white z-50 overflow-y-auto">
          <div className="max-w-lg mx-auto px-4 py-6 pb-28">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-800">時間帯を編集</h2>
              <button onClick={() => setEditingSlots(false)} className="text-slate-400 hover:text-slate-600 text-xl px-2">✕</button>
            </div>
            <div className="mb-4">
              <p className="text-xs text-slate-400">各日の時間帯を編集・追加・削除できます</p>
            </div>
            <div className="space-y-3">
              {getDays(7).map(day => {
                const daySlots = draftSlots.filter(s => s.date === day.date);
                return (
                  <div key={day.date} className={`rounded-xl p-4 border ${day.isToday ? 'border-teal-200 bg-teal-50/30' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <p className={`text-sm font-semibold ${day.isToday ? 'text-teal-700' : 'text-slate-600'}`}>
                        {day.isToday && <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500 mr-1.5 align-middle" />}
                        {day.label}
                      </p>
                      <button
                        onClick={() => setDraftSlots(prev => [...prev, { id: genId(6), date: day.date, start: '10:00', end: '17:00' }])}
                        className="text-xs text-teal-600 font-medium hover:text-teal-800 transition"
                      >
                        ＋追加
                      </button>
                    </div>
                    {daySlots.length === 0 && (
                      <p className="text-xs text-slate-300">時間帯なし</p>
                    )}
                    {daySlots.map(slot => (
                      <div key={slot.id} className="flex items-center gap-2 mb-2 animate-[fadeIn_0.15s_ease-out]">
                        <input
                          type="time"
                          value={slot.start}
                          onChange={e => setDraftSlots(prev => prev.map(s => s.id === slot.id ? { ...s, start: e.target.value } : s))}
                          className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm text-center bg-white"
                        />
                        <span className="text-slate-300 text-sm">–</span>
                        <input
                          type="time"
                          value={slot.end}
                          onChange={e => setDraftSlots(prev => prev.map(s => s.id === slot.id ? { ...s, end: e.target.value } : s))}
                          className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm text-center bg-white"
                        />
                        <button
                          onClick={() => setDraftSlots(prev => prev.filter(s => s.id !== slot.id))}
                          className="text-slate-300 hover:text-red-400 p-1.5 transition-colors rounded-lg"
                          aria-label="削除"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {daySlots.some(s => s.start >= s.end) && (
                      <p className="text-xs text-red-400 mt-1">開始は終了より前にしてください</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 p-4">
            <div className="max-w-lg mx-auto flex gap-3">
              <button
                onClick={() => setEditingSlots(false)}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition"
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveSlots}
                disabled={savingSlots}
                className="flex-1 py-3 rounded-xl bg-teal-600 text-white font-bold hover:bg-teal-700 disabled:opacity-40 transition"
              >
                {savingSlots ? '保存中...' : '保存する'}
              </button>
            </div>
          </div>
        </div>
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
  const [ownerTokenFromUrl, setOwnerTokenFromUrl] = useState<string | null>(null);
  const [showBadgeModal, setShowBadgeModal] = useState(false);
  const [badgeCounts, setBadgeCounts] = useState({ approved: 0, pending: 0 });

  useEffect(() => {
    const update = () => {
      const reqs: RequestEntry[] = (window as any).__mini_requests || [];
      // 自分が送ったリクエストIDだけをカウント
      const currentShareId = shareId || window.location.pathname.match(/^\/mini\/s\/([A-Za-z0-9]+)/)?.[1];
      if (!currentShareId) { setBadgeCounts({ approved: 0, pending: 0 }); return; }
      const sentIds = loadSentRequestIds(currentShareId);
      const myRequestIds = new Set(sentIds.values());
      const myReqs = reqs.filter(r => myRequestIds.has(r.id));
      const approved = myReqs.filter(r => r.status === 'approved').length;
      const pending = myReqs.filter(r => !r.status || r.status === 'pending').length;
      setBadgeCounts({ approved, pending });
    };
    window.addEventListener('mini_requests_update', update);
    return () => window.removeEventListener('mini_requests_update', update);
  }, [shareId]);

  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/mini\/s\/([A-Za-z0-9]+)/);
    if (match) {
      setShareId(match[1]);
      setView('share');
      const params = new URLSearchParams(window.location.search);
      setOwnerTokenFromUrl(params.get('owner'));
    }
    else { setView('create'); }
  }, []);

  useEffect(() => {
    const handlePop = () => {
      const path = window.location.pathname;
      const match = path.match(/^\/mini\/s\/([A-Za-z0-9]+)/);
      if (match) {
        setShareId(match[1]);
        setView('share');
        setJustCreated(false);
        const params = new URLSearchParams(window.location.search);
        setOwnerTokenFromUrl(params.get('owner'));
      }
      else { setView('create'); setJustCreated(false); setOwnerTokenFromUrl(null); }
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const handleCreated = (id: string, _name: string) => {
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

  const BadgeHeader = () => (
    <div className="fixed top-4 right-4 z-50 flex gap-3">
      {/* 依頼一覧バッジ（青） */}
      <button
        className="relative"
        onClick={() => setShowBadgeModal(true)}
        aria-label="承認済み依頼一覧"
      >
        <TaskIcon className="w-7 h-7 text-blue-500" />
        {badgeCounts.approved > 0 && (
          <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.5em] text-center border border-white">
            {badgeCounts.approved}
          </span>
        )}
      </button>
      {/* 通知ベルバッジ（赤） */}
      <button
        className="relative"
        onClick={() => setShowBadgeModal(true)}
        aria-label="未承認通知一覧"
      >
        <BellIcon className="w-7 h-7 text-red-500" />
        {badgeCounts.pending > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.5em] text-center border border-white animate-pulse">
            {badgeCounts.pending}
          </span>
        )}
      </button>
    </div>
  );

  const BadgeModal = () => (
    showBadgeModal ? (
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[100]" onClick={() => setShowBadgeModal(false)}>
        <div className="bg-white rounded-2xl p-6 min-w-[320px] max-w-[90vw] shadow-xl relative" onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-bold mb-3">依頼・通知一覧</h2>
          <div className="mb-2">
            <span className="inline-flex items-center gap-2 text-blue-600 font-semibold"><TaskIcon className="w-5 h-5" />確定した予定: {badgeCounts.approved}件</span>
          </div>
          <div className="mb-4">
            <span className="inline-flex items-center gap-2 text-teal-600 font-semibold"><BellIcon className="w-5 h-5" />✨ リクエスト中です: {badgeCounts.pending}件</span>
          </div>
          <button className="absolute top-2 right-2 text-slate-400 hover:text-red-400" onClick={() => setShowBadgeModal(false)} aria-label="閉じる">✕</button>
        </div>
      </div>
    ) : null
  );

  let content: React.ReactNode;
  switch (view) {
    case 'loading':
      content = <ShareViewSkeleton />;
      break;
    case 'create':
      content = <CreateView onCreated={handleCreated} />;
      break;
    case 'share':
      content = <ShareView shareId={shareId!} justCreated={justCreated} ownerToken={ownerTokenFromUrl} />;
      break;
    default:
      content = null;
  }

  return (
    <ErrorBoundary>
      {content}
      <BadgeHeader />
      <BadgeModal />
    </ErrorBoundary>
  );
}
