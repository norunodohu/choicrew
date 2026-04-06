import { useState, useEffect, useRef, useCallback, Component, ReactNode } from 'react';

/* ================================================================
   Error Boundary 窶・繧ｯ繝ｩ繝・す繝･譎ゅ↓逋ｽ逕ｻ髱｢縺ｫ縺ｪ繧峨↑縺・ｈ縺・↓
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
            <p className="text-slate-700 text-lg font-semibold mb-2">陦ｨ遉ｺ繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆</p>
            <p className="text-slate-400 text-sm mb-6">繝壹・繧ｸ繧偵Μ繝ｭ繝ｼ繝峨＠縺ｦ縺ｿ縺ｦ縺上□縺輔＞</p>
            <button onClick={() => window.location.reload()}
              className="bg-teal-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-teal-700 transition">
              繝ｪ繝ｭ繝ｼ繝・
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// 繝√Ε繝ｳ繧ｯ繧ｨ繝ｩ繝ｼ譎ゅ・閾ｪ蜍輔Μ繧ｫ繝舌Μ
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
  requested_start?: string;
  requested_end?: string;
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
    else if (i === 1) prefix = '譏取律 ';
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
  const text = `${name}縺ｮ遨ｺ縺肴凾髢薙ｒ繝√ぉ繝・け燥\n${url}`;
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

function slotKey(s: { date: string; start: string; end: string }): string {
  return `${s.date}_${s.start}_${s.end}`;
}

function isValidSlotRange(start: string, end: string): boolean {
  if (start === end) return false;
  // 譌･繧偵∪縺溘＄・井ｾ・ 8:00・・:00・峨ｂ險ｱ螳ｹ
  if (end === '24:00' || end === '00:00') return true;
  return start < end;
}

function normalizeTime(value: string): string {
  const [h = '00', m = '00'] = value.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

function replaceShareSlot(
  slots: { date: string; start: string; end: string }[],
  target: { date: string; start: string; end: string },
  next: { start: string; end: string }
) {
  return slots.map(s =>
    s.date === target.date && s.start === target.start && s.end === target.end
      ? { ...s, start: next.start, end: next.end }
      : s
  );
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
  return `${format(first, 'M/d', { locale: ja })}窶・{format(last, 'M/d', { locale: ja })}`;
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

/* 笏笏 繝・ヰ繧､繧ｹ繝輔ぅ繝ｳ繧ｬ繝ｼ繝励Μ繝ｳ繝・笏笏 */
function getDeviceFingerprintRaw(): string {
  const parts = [
    screen.width,
    screen.height,
    window.devicePixelRatio,
    // hardwareConcurrency 縺ｯ Brave 遲峨〒蛛ｽ陬・＆繧後ｋ縺溘ａ髯､螟・
    // navigator.platform 縺ｯ繝悶Λ繧ｦ繧ｶ髢薙〒蠕ｮ螯吶↓逡ｰ縺ｪ繧九◆繧・勁螟・
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
  // 繧ｷ繝ｳ繝励Ν縺ｪ繝上ャ繧ｷ繝･・・jb2・・
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
  } catch { /* 騾夂衍螟ｱ謨励・辟｡隕穆uru */ }
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
      // 譌｢蟄倥お繝ｳ繝医Μ縺ｮdateRange/lastDate繧呈峩譁ｰ
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

/* 笏笏 WheelColumn: iOS繧ｹ繧ｿ繧､繝ｫ縺ｮ繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ繝斐ャ繧ｫ繝ｼ蛻・笏笏 */
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
  { label: '蜊亥燕', start: '09:00', end: '12:00', sub: '9窶・2' },
  { label: '蜊亥ｾ・, start: '13:00', end: '17:00', sub: '13窶・7' },
  { label: '螟墓婿', start: '17:00', end: '21:00', sub: '17窶・1' },
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
    label: '繧ｷ繝ｳ繝励Ν', emoji: '諺',
    pageBg: 'bg-slate-50', card: 'bg-white border border-slate-200',
    accentBtn: 'bg-teal-600 text-white hover:bg-teal-700 active:scale-95',
    accentText: 'text-teal-600', headingText: 'text-slate-800',
    subText: 'text-slate-400', timeText: 'text-slate-800', labelText: 'text-slate-600',
    cardPreviewFrom: '#2dd4bf', cardPreviewTo: '#0d9488',
    previewBg: '#f8fafc', previewCard: '#ffffff', previewBorder: '#e2e8f0',
  },
  dark: {
    label: '繝繝ｼ繧ｯ', emoji: '嫌',
    pageBg: 'bg-slate-900', card: 'bg-slate-800 border border-slate-700',
    accentBtn: 'bg-teal-400 text-slate-900 hover:bg-teal-300 active:scale-95',
    accentText: 'text-teal-400', headingText: 'text-white',
    subText: 'text-slate-500', timeText: 'text-white', labelText: 'text-slate-300',
    cardPreviewFrom: '#2dd4bf', cardPreviewTo: '#134e4a',
    previewBg: '#0f172a', previewCard: '#1e293b', previewBorder: '#334155',
  },
  pop: {
    label: '繝昴ャ繝・, emoji: '耳',
    pageBg: 'bg-fuchsia-50', card: 'bg-white border-2 border-fuchsia-200',
    accentBtn: 'bg-fuchsia-500 text-white hover:bg-fuchsia-600 active:scale-95',
    accentText: 'text-fuchsia-500', headingText: 'text-fuchsia-900',
    subText: 'text-fuchsia-400', timeText: 'text-fuchsia-900', labelText: 'text-fuchsia-700',
    cardPreviewFrom: '#e879f9', cardPreviewTo: '#f97316',
    previewBg: '#fdf4ff', previewCard: '#ffffff', previewBorder: '#f0abfc',
  },
  modern: {
    label: '繝｢繝繝ｳ', emoji: '笞ｫ',
    pageBg: 'bg-white', card: 'bg-gray-50 border border-gray-200',
    accentBtn: 'bg-gray-900 text-white hover:bg-gray-700 active:scale-95',
    accentText: 'text-gray-900', headingText: 'text-gray-900',
    subText: 'text-gray-400', timeText: 'text-gray-900', labelText: 'text-gray-700',
    cardPreviewFrom: '#374151', cardPreviewTo: '#111827',
    previewBg: '#ffffff', previewCard: '#f9fafb', previewBorder: '#e5e7eb',
  },
  anime: {
    label: '繧｢繝九Γ', emoji: '減',
    pageBg: 'bg-gradient-to-br from-pink-100 via-purple-50 to-sky-100',
    card: 'bg-white border-2 border-pink-300 shadow-[4px_4px_0px_#f472b6]',
    accentBtn: 'bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:from-pink-600 hover:to-purple-600 active:scale-95 shadow-[2px_2px_0px_#be185d]',
    accentText: 'text-pink-500', headingText: 'text-purple-900',
    subText: 'text-pink-400', timeText: 'text-purple-800', labelText: 'text-purple-700',
    cardPreviewFrom: '#f472b6', cardPreviewTo: '#a855f7',
    previewBg: 'linear-gradient(135deg,#fce7f3,#ede9fe,#e0f2fe)', previewCard: '#ffffff', previewBorder: '#f9a8d4',
  },
  konbini: {
    label: '繧ｳ繝ｳ繝薙ル', emoji: '宵',
    pageBg: 'bg-sky-50',
    card: 'bg-white/90 backdrop-blur border border-sky-200',
    accentBtn: 'bg-sky-500 text-white hover:bg-sky-600 active:scale-95',
    accentText: 'text-sky-600', headingText: 'text-sky-900',
    subText: 'text-sky-400', timeText: 'text-sky-900', labelText: 'text-sky-700',
    cardPreviewFrom: '#38bdf8', cardPreviewTo: '#0284c7',
    previewBg: 'linear-gradient(135deg,#e0f2fe,#bae6fd,#f0fdf4)', previewCard: 'rgba(255,255,255,0.85)', previewBorder: '#bae6fd',
  },
  himawari: {
    label: '縺ｲ縺ｾ繧上ｊ', emoji: '現',
    pageBg: 'bg-amber-50',
    card: 'bg-white/80 border border-yellow-200',
    accentBtn: 'bg-gradient-to-r from-yellow-400 to-orange-400 text-white hover:from-yellow-500 hover:to-orange-500 active:scale-95',
    accentText: 'text-yellow-600', headingText: 'text-amber-900',
    subText: 'text-yellow-500', timeText: 'text-amber-900', labelText: 'text-amber-700',
    cardPreviewFrom: '#fbbf24', cardPreviewTo: '#f97316',
    previewBg: 'linear-gradient(135deg,#fef9c3,#fef3c7,#fff7ed)', previewCard: '#ffffff', previewBorder: '#fde68a',
  },
  darkbg: {
    label: '繝繝ｼ繧ｯ繝輔か繝・, emoji: '激',
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
  // Firebase縺九ｉ莠亥ｮ壼錐繧貞叙蠕励☆繧九◆繧√・state
  const [ownedShares, setOwnedShares] = useState<OwnedShareEntry[]>([]);
  const [loadingOwned, setLoadingOwned] = useState(true);

  // Firebase縺九ｉ莠亥ｮ壼錐繧貞叙蠕・
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
      // FP+IP逋ｻ骭ｲ・育ｬｬ2螻､繧ｪ繝ｼ繝翫・隱崎ｨｼ逕ｨ・・
      registerOwnerFingerprint(id);
      onCreated(id, title.trim());
    } catch (err) {
      console.error('Failed to create share:', err);
      toast.show('菴懈・縺ｫ螟ｱ謨励＠縺ｾ縺励◆縲ゅｂ縺・ｸ蠎ｦ縺願ｩｦ縺励￥縺縺輔＞縲・);
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
              <span className="text-sm text-teal-600 font-medium">・・/span>
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
                <button onClick={() => setExpandedDays(prev => { const n = new Set(prev); n.delete(day.date); return n; })} className="text-xs text-slate-400 hover:text-slate-600 transition">髢峨§繧・/button>
              )}
            </div>
            {daySlots.map(slot => (
              <div key={slot.id} className="mb-3 animate-[fadeIn_0.15s_ease-out]">
                <div className="flex items-center gap-2">
                  <TimeSpinner value={slot.start} onChange={v => updateSlot(slot.id, 'start', v)} />
                  <span className="text-slate-300 text-sm">窶・/span>
                  <TimeSpinner value={slot.end} onChange={v => updateSlot(slot.id, 'end', v)} isEnd />
                  <button onClick={() => removeSlot(slot.id)} className="text-slate-300 hover:text-red-400 p-1.5 transition-colors rounded-lg" aria-label="蜑企勁">笨・/button>
                </div>
                {isValidSlotRange(slot.start, slot.end) && <TimeBar start={slot.start} end={slot.end} />}
                {!isValidSlotRange(slot.start, slot.end) && <p className="text-xs text-red-500 mt-1">髢句ｧ九・邨ゆｺ・ｈ繧雁燕縺ｫ縺励※縺上□縺輔＞</p>}
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5 mt-1">
              {TIME_PRESETS.map(p => (
                <button key={p.label} onClick={() => addSlot(day.date, p.start, p.end)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-100/50 transition">
                  {p.label}<span className="text-teal-400">{p.sub}</span>
                </button>
              ))}
              <button onClick={() => addSlot(day.date)} className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-100/50 transition">繧ｫ繧ｹ繧ｿ繝</button>
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
            {step > s ? '笨・ : s}
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
          <p className="text-slate-400 mt-2 text-xs tracking-wide">繝ｭ繧ｰ繧､繝ｳ荳崎ｦ√〒萓晞ｼ蜿嶺ｻ倥∪縺ｧ</p>
        </div>

        {/* 笏笏 菴懈・貂医∩縺ｮ莠亥ｮ壹Μ繧ｹ繝茨ｼ亥ｸｸ譎り｡ｨ遉ｺ・・笏笏 */}
        {(() => {
          const todayStr = format(new Date(), 'yyyy-MM-dd');
          const activeShares = ownedShares.filter(e => e.name && (!e.lastDate || e.lastDate >= todayStr));
          if (loadingOwned) {
            return (
              <div className="mb-6">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 px-1">縺ゅ↑縺溘・菴懈・貂医∩莠亥ｮ・/p>
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
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5 px-1">縺ゅ↑縺溘・菴懈・貂医∩莠亥ｮ・/p>
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
                        <span className="text-slate-300 group-hover:text-teal-500 transition text-sm">竊・/span>
                      </div>
                    </a>
                    {confirmDeleteShareId === entry.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => removeOwnedShare(entry.id)} className="text-xs px-2 py-1 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition">蜑企勁</button>
                        <button onClick={() => setConfirmDeleteShareId(null)} className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-500 font-medium hover:bg-slate-200 transition">謌ｻ繧・/button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteShareId(entry.id)}
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-slate-300 hover:text-red-400 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                        aria-label="蜑企勁"
                      >笨・/button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-slate-100" />
              <p className="text-center text-xs text-slate-400 mt-3 mb-1">縺ｾ縺溘・譁ｰ縺励￥菴懈・縺吶ｋ</p>
            </div>
          );
        })()}

        <StepIndicator />

        {/* 笏笏 Step 1: Title + DisplayName 笏笏 */}
        {step === 1 && (
          <div className="animate-[fadeIn_0.2s_ease-out]">
            <h2 className="text-xl font-bold text-slate-800 mb-1">莠亥ｮ夊｡ｨ繧剃ｽ懈・・茨ｼ鷹ｱ髢灘・・・/h2>
            <p className="text-sm text-slate-400 mb-5">蜈ｬ髢九＆繧後ｋ莠亥ｮ夊｡ｨ繧ｿ繧､繝医Ν縺ｨ蜷榊燕繧貞・蜉帙＠縺ｦ縺上□縺輔＞</p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">繧ｿ繧､繝医Ν</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="遨ｺ縺・※縺ｾ縺・
                  className="w-full rounded-xl border border-slate-200 px-4 py-3.5 text-lg focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent placeholder:text-slate-300 bg-white"
                  maxLength={40}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">陦ｨ遉ｺ蜷・蜈ｬ髢狗嶌謇九↓蛻・°繧後・OK)</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && title.trim() && displayName.trim()) setStep(2); }}
                  placeholder="繧・∪縺"
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
              谺｡縺ｸ 竊・
            </button>


            <p>
              窶ｻ驕弱℃縺滉ｺ亥ｮ壹・閾ｪ蜍輔〒蜑企勁縺輔ｌ縺ｾ縺吶・br />
              <br />
              窶ｻ菴懈・縺励◆繝・ヰ繧､繧ｹ縺ｧ縺ｮ縺ｿ邱ｨ髮・′邯壹￠繧峨ｌ縺ｾ縺・
            </p>
          </div>
        )}

        {/* 笏笏 Step 2: Mode selection or Quick slot picker 笏笏 */}
        {step === 2 && (
          <div className="animate-[fadeIn_0.2s_ease-out]">
            {createMode === null ? (
              <>
                <h2 className="text-xl font-bold text-slate-800 mb-1">菴懊ｊ譁ｹ繧帝∈繧薙〒縺上□縺輔＞</h2>
                <p className="text-sm text-slate-400 mb-6">譎る俣蟶ｯ繧偵←縺・ｿｽ蜉縺励∪縺吶°・・/p>
                <div className="space-y-3">
                  <button onClick={() => setCreateMode('quick')}
                    className="w-full text-left bg-white border-2 border-teal-200 rounded-2xl p-5 hover:border-teal-400 hover:shadow-md transition-all group">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center text-xl shrink-0 group-hover:bg-teal-200 transition">笞｡</div>
                      <div>
                        <p className="font-bold text-slate-800 text-base">縺九ｓ縺溘ｓ菴懈・</p>
                        <p className="text-sm text-slate-500 mt-0.5">1騾ｱ髢薙・遨ｺ縺肴棧繧定・蛻・〒驕ｸ繧薙〒霑ｽ蜉</p>
                      </div>
                    </div>
                  </button>
                  <button onClick={() => { setCreateMode('custom'); setStep(3); }}
                    className="w-full text-left bg-white border-2 border-slate-200 rounded-2xl p-5 hover:border-slate-400 hover:shadow-md transition-all group">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-xl shrink-0 group-hover:bg-slate-200 transition">寺</div>
                      <div>
                        <p className="font-bold text-slate-800 text-base">繧ｫ繧ｹ繧ｿ繝菴懈・</p>
                        <p className="text-sm text-slate-500 mt-0.5">繝・じ繧､繝ｳ繝ｻ繝ｪ繧ｯ繧ｨ繧ｹ繝域婿豕輔↑縺ｩ邏ｰ縺九￥險ｭ螳壹☆繧・br />窶ｻ蠕後°繧峨〒繧ょ､画峩蜿ｯ閭ｽ</p>
                      </div>
                    </div>
                  </button>
                </div>
                <button onClick={() => setStep(1)} className="w-full mt-3 py-2.5 text-sm text-slate-400 hover:text-slate-600 transition">竊・謌ｻ繧・/button>
              </>
            ) : (
              // Quick mode: 7-day blank slot picker
              <>
                <h2 className="text-xl font-bold text-slate-800 mb-1">遨ｺ縺肴凾髢薙ｒ霑ｽ蜉</h2>
                <p className="text-sm text-slate-400 mb-5">蟶梧悍縺ｮ譌･譎ゅｒ繧ｿ繝・・縺励※霑ｽ蜉縺励※縺上□縺輔＞</p>
                <SlotPicker />
                <button
                  onClick={handleCreate}
                  disabled={validSlots.length === 0 || saving}
                  className="w-full bg-teal-600 text-white rounded-xl py-3.5 font-bold hover:bg-teal-700 disabled:opacity-40 transition text-base shadow-sm"
                >
                  {saving
                    ? <span className="inline-flex items-center justify-center gap-2"><Spinner /> 菴懈・荳ｭ...</span>
                    : validSlots.length > 0 ? `脂 蜈ｱ譛峨Μ繝ｳ繧ｯ繧剃ｽ懈・・・{validSlots.length}譫・荏 : '譎る俣蟶ｯ繧定ｿｽ蜉縺励※縺上□縺輔＞'}
                </button>
                <button onClick={() => { setCreateMode(null); setSlots([]); setExpandedDays(new Set()); }} className="w-full mt-3 py-2.5 text-sm text-slate-400 hover:text-slate-600 transition">竊・謌ｻ繧・/button>
              </>
            )}
          </div>
        )}

        {/* 笏笏 Step 3 (custom): Design + Booking mode 笏笏 */}
        {step === 3 && createMode === 'custom' && (
          <div className="animate-[fadeIn_0.2s_ease-out]">
            <h2 className="text-xl font-bold text-slate-800 mb-1">繝・じ繧､繝ｳ縺ｨ蜿励￠譁ｹ繧帝∈縺ｶ</h2>
            <p className="text-sm text-slate-400 mb-5">閾ｪ蛻・・莠亥ｮ夊｡ｨ縺ｨ逶ｸ謇九′隕九ｋ逕ｻ髱｢縺ｫ蜿肴丐縺輔ｌ縺ｾ縺・/p>
            {/* Design grid */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              {(Object.entries(THEMES) as [ThemeKey, typeof THEMES[ThemeKey]][]).map(([key, t]) => (
                <button key={key} onClick={() => setTheme(key as ThemeKey)}
                  className={`relative rounded-2xl overflow-hidden transition-all ${theme === key ? 'ring-2 ring-teal-500 ring-offset-2 shadow-lg scale-[1.02]' : 'ring-1 ring-slate-200 hover:ring-slate-400'}`}>
                  {key === 'anime' ? (
                    /* 繧｢繝九Γ繝・・繝槫ｰら畑繝励Ξ繝薙Η繝ｼ */
                    <div style={{ background: 'linear-gradient(135deg,#fce7f3,#ede9fe,#e0f2fe)', position: 'relative', overflow: 'hidden', paddingBottom: 0 }}>
                      <svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', display: 'block' }}>
                        {/* 閭梧勹繧ｰ繝ｩ繝・*/}
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
                        {/* 繧ｹ繝斐・繝峨Λ繧､繝ｳ */}
                        {[0,15,30,45,60,75].map(y => (
                          <line key={y} x1="0" y1={y} x2="160" y2={y+8} stroke="#f9a8d4" strokeWidth="0.5" opacity="0.4" />
                        ))}
                        {/* 繧ｫ繝ｼ繝・*/}
                        <rect x="10" y="10" width="140" height="40" rx="6" fill="white" stroke="#f472b6" strokeWidth="2" />
                        <rect x="10" y="10" width="140" height="40" rx="6" fill="none" stroke="#f472b6" strokeWidth="2" />
                        {/* 繧ｿ繧､繝医Ν繝舌・ */}
                        <rect x="16" y="16" width="80" height="8" rx="3" fill="url(#animePink)" />
                        {/* 繧ｵ繝悶ユ繧ｭ繧ｹ繝育ｷ・*/}
                        <rect x="16" y="30" width="50" height="4" rx="2" fill="#f9a8d4" />
                        <rect x="16" y="38" width="35" height="4" rx="2" fill="#e9d5ff" />
                        {/* 笘・stars */}
                        <text x="108" y="36" fontSize="14" fill="#f472b6">笘・/text>
                        <text x="124" y="28" fontSize="10" fill="#a855f7">笨ｦ</text>
                        {/* 繝懊ち繝ｳ */}
                        <rect x="10" y="58" width="140" height="18" rx="5" fill="url(#animePink)" />
                        <text x="80" y="70" textAnchor="middle" fontSize="7" fill="white" fontWeight="bold">萓晞ｼ縺吶ｋ 笙｡</text>
                        {/* 譯・*/}
                        <text x="6" y="20" fontSize="12" opacity="0.7">減</text>
                        <text x="138" y="82" fontSize="10" opacity="0.6">笨ｿ</text>
                        <text x="2" y="88" fontSize="9" opacity="0.5">減</text>
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
                      <p className="font-bold text-slate-800">{mode === 'multiple' ? '隍・焚莠ｺ縺九ｉ蜿励￠繧・ : '1莠ｺ豎ｺ縺ｾ縺｣縺溘ｉ邱繧∝・繧・}</p>
                      <p className="text-sm text-slate-500 mt-0.5">{mode === 'multiple' ? '隍・焚縺ｮ萓晞ｼ繧貞女縺大叙縺｣縺ｦ縲∬・蛻・〒驕ｸ繧薙〒謇ｿ隱阪☆繧・ : '譛蛻昴↓謇ｿ隱阪＠縺滓凾轤ｹ縺ｧ閾ｪ蜍慕噪縺ｫ邱繧∝・繧峨ｌ繧・}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setStep(4)} className="w-full bg-teal-600 text-white rounded-xl py-3.5 font-bold hover:bg-teal-700 transition">谺｡縺ｸ 竊・/button>
            <button onClick={() => { setStep(2); setCreateMode(null); }} className="w-full mt-3 py-2.5 text-sm text-slate-400 hover:text-slate-600 transition">竊・謌ｻ繧・/button>
          </div>
        )}

        {/* 笏笏 Step 4 (custom): Time slots 笏笏 */}
        {step === 4 && createMode === 'custom' && (
          <div className="animate-[fadeIn_0.2s_ease-out]">
            <h2 className="text-xl font-bold text-slate-800 mb-1">遨ｺ縺肴凾髢薙ｒ霑ｽ蜉</h2>
            <p className="text-sm text-slate-400 mb-5">蟶梧悍縺ｮ譌･譎ゅｒ繧ｿ繝・・縺励※霑ｽ蜉縺励※縺上□縺輔＞</p>
            <SlotPicker />
            <button
              onClick={handleCreate}
              disabled={validSlots.length === 0 || saving}
              className="w-full bg-teal-600 text-white rounded-xl py-3.5 font-bold hover:bg-teal-700 disabled:opacity-40 transition text-base shadow-sm"
            >
              {saving
                ? <span className="inline-flex items-center justify-center gap-2"><Spinner /> 菴懈・荳ｭ...</span>
                : validSlots.length > 0 ? `脂 蜈ｱ譛峨Μ繝ｳ繧ｯ繧剃ｽ懈・・・{validSlots.length}譫・荏 : '譎る俣蟶ｯ繧定ｿｽ蜉縺励※縺上□縺輔＞'}
            </button>
            <button onClick={() => setStep(3)} className="w-full mt-3 py-2.5 text-sm text-slate-400 hover:text-slate-600 transition">竊・謌ｻ繧・/button>
          </div>
        )}

      </div>

      {/* Sticky create button 窶・mobile quick slot step */}
      {step === 2 && createMode === 'quick' && validSlots.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-sm border-t border-slate-100 p-4 sm:hidden z-30">
          <div className="max-w-lg mx-auto">
            <button onClick={handleCreate} disabled={saving} className="w-full bg-teal-600 text-white rounded-xl py-3.5 font-bold hover:bg-teal-700 transition text-base">
              {saving ? '菴懈・荳ｭ...' : `脂 菴懈・・・{validSlots.length}譫・荏}
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
  const [requestStart, setRequestStart] = useState(normalizeTime(slot.start));
  const [requestEnd, setRequestEnd] = useState(normalizeTime(slot.end));
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
    const normalizedStart = normalizeTime(requestStart);
    const normalizedEnd = normalizeTime(requestEnd);
    if (!isValidSlotRange(normalizedStart, normalizedEnd)) {
      setError('萓晞ｼ譎る俣縺ｮ遽・峇縺梧ｭ｣縺励￥縺ゅｊ縺ｾ縺帙ｓ縲・);
      return;
    }
    setSending(true);
    setError('');
    try {
      const reqRef = await addDoc(collection(db, 'mini_requests'), {
        share_id: shareId,
        slot_date: slot.date,
        slot_start: slot.start,
        slot_end: slot.end,
        requested_start: normalizedStart,
        requested_end: normalizedEnd,
        requester_name: name.trim(),
        message: message.trim(),
        status: 'pending',
        created_at: Timestamp.fromDate(new Date()),
      });
      // 繧ｪ繝ｼ繝翫・縺ｫFCM繝励ャ繧ｷ繝･騾夂衍繧帝∽ｿ｡
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
              title: '譁ｰ逹萓晞ｼ縺後≠繧翫∪縺・,
              body: `${name.trim()}縺輔ｓ縺九ｉ萓晞ｼ縺悟ｱ翫″縺ｾ縺励◆`,
              url: shareUrl,
            }),
          });
        }
        // 繝｡繝ｼ繝ｫ騾夂衍
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
        }).catch(() => { /* 騾夂衍螟ｱ謨励・辟｡隕・*/ });
      } catch { /* 騾夂衍螟ｱ謨励・辟｡隕・*/ }
      saveRequesterName(name.trim());
      onSent(reqRef.id);
    } catch (err) {
      console.error('Failed to send request:', err);
      setError('騾∽ｿ｡縺ｫ螟ｱ謨励＠縺ｾ縺励◆縲ゅｂ縺・ｸ蠎ｦ縺願ｩｦ縺励￥縺縺輔＞縲・);
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
        {/* Drag handle 窶・mobile */}
        <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto -mt-1 mb-2 sm:hidden" />

        <h3 className="text-lg font-bold text-slate-800">依頼を送る</h3>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">元の空き</p>
              <p className="text-base font-semibold tracking-tight text-slate-800">
                {formatSlotDate(slot.date)} {slot.start} - {slot.end}
              </p>
            </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
                ここから依頼できます
              </span>
          </div>
          <TimeBar start={slot.start} end={slot.end} />
        </div>

        <div className="rounded-2xl border border-teal-100 bg-teal-50/60 p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-500">依頼する時間</p>
            <p className="text-sm text-slate-600">必要なら開始と終了を変えて送れます。</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="req-start" className="block text-sm font-medium text-slate-700 mb-1">
                開始
              </label>
              <input
                id="req-start"
                type="time"
                value={requestStart}
                onChange={e => setRequestStart(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
              />
            </div>
            <div>
              <label htmlFor="req-end" className="block text-sm font-medium text-slate-700 mb-1">
                終了
              </label>
              <input
                id="req-end"
                type="time"
                value={requestEnd}
                onChange={e => setRequestEnd(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
              />
            </div>
          </div>
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
            placeholder="名前を入力"
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
            placeholder="ひとこと添える"
            maxLength={200}
          />
        </div>

        {hasEmail && ownerName && (
          <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
            {ownerName}さんはメール通知を設定しています
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
  // 萓晞ｼ荳隕ｧ縺ｮ陦ｨ遉ｺ/髱櫁｡ｨ遉ｺ
  const [showRequestList, setShowRequestList] = useState(false);
    // 譛滄剞蛻・ｌ萓晞ｼ繧奪B縺九ｉ蜑企勁
    useEffect(() => {
      const deleteExpiredRequests = async () => {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        try {
          const reqQ = query(collection(db, 'mini_requests'), where('share_id', '==', shareId));
          const snap = await getDoc(doc(db, 'mini_shares', shareId)); // 繧ｷ繧ｧ繧｢縺悟ｭ伜惠縺吶ｋ縺狗｢ｺ隱・
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
          // 1蝗槭□縺大ｮ溯｡後＠縺ｦunsubscribe
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
      setEmailCodeError('繝励Λ繝√リ繧ｳ繝ｼ繝峨′豁｣縺励￥縺ゅｊ縺ｾ縺帙ｓ');
      return;
    }
    if (!emailInput.trim()) { setEmailCodeError('繝｡繝ｼ繝ｫ繧｢繝峨Ξ繧ｹ繧貞・蜉帙＠縺ｦ縺上□縺輔＞'); return; }
    setEmailSaving(true);
    setEmailCodeError('');
    const newEmail = emailInput.trim();
    try {
      await updateDoc(doc(db, 'mini_shares', shareId), { notify_email: newEmail });
      setShare(prev => prev ? { ...prev, notify_email: newEmail } : prev);
      // 遒ｺ隱阪Γ繝ｼ繝ｫ騾∽ｿ｡
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
        toast.show('逋ｻ骭ｲ螳御ｺ・ｼ∫｢ｺ隱阪Γ繝ｼ繝ｫ繧帝∽ｿ｡縺励∪縺励◆', 'success');
      } else {
        const errBody = await confirmRes.json().catch(() => ({}));
        toast.show(`逋ｻ骭ｲ縺励∪縺励◆縺後Γ繝ｼ繝ｫ騾∽ｿ｡縺ｫ螟ｱ謨・ ${errBody.error || confirmRes.status}`, 'error');
      }
      setShowEmailModal(false);
    } catch { toast.show('逋ｻ骭ｲ縺ｫ螟ｱ謨励＠縺ｾ縺励◆', 'error'); }
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
      toast.show('繧ｿ繧､繝医Ν繧呈峩譁ｰ縺励∪縺励◆', 'success');
    } catch { toast.show('譖ｴ譁ｰ縺ｫ螟ｱ謨励＠縺ｾ縺励◆', 'error'); }
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
      const msgs = { active: '萓晞ｼ蜿嶺ｻ倥ｒ蜀埼幕縺励∪縺励◆', view_only: '髢ｲ隕ｧ蟆ら畑縺ｫ螟画峩縺励∪縺励◆', draft: '荳区嶌縺搾ｼ磯撼蜈ｬ髢具ｼ峨↓螟画峩縺励∪縺励◆' };
      toast.show(msgs[newStatus], 'success');
      setShowStatusModal(false);
    } catch {
      toast.show('譖ｴ譁ｰ縺ｫ螟ｱ謨励＠縺ｾ縺励◆');
    }
  };

  const handleChangeBookingMode = async (mode: 'multiple' | 'exclusive') => {
    if (!share) return;
    const currentMode = share.bookingMode || 'exclusive';
    if (currentMode === mode) return;
    // exclusive 縺ｫ蛻・ｊ譖ｿ縺域凾: 蜷後§譫縺ｫ2莉ｶ莉･荳蛎pproved縺後≠繧後・繝悶Ο繝・け
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
        toast.show('蜷後§譫縺ｫ隍・焚縺ｮ謇ｿ隱阪′縺ゅｊ縺ｾ縺吶ょ・縺ｫ謇ｿ隱阪ｒ謨ｴ逅・＠縺ｦ縺上□縺輔＞', 'error');
        return;
      }
    }
    try {
      await updateDoc(doc(db, 'mini_shares', shareId), { bookingMode: mode });
      setShare(prev => prev ? { ...prev, bookingMode: mode } : prev);
      toast.show(mode === 'exclusive' ? '縲・縺､縺縺第価隱阪阪↓螟画峩縺励∪縺励◆' : '縲碁∈繧薙〒謇ｿ隱阪阪↓螟画峩縺励∪縺励◆', 'success');
    } catch {
      toast.show('螟画峩縺ｫ螟ｱ謨励＠縺ｾ縺励◆', 'error');
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
        // URL 縺ｫ ?owner=TOKEN 縺御ｻ倥＞縺ｦ縺・ｌ縺ｰ辣ｧ蜷医＠縺ｦ繧ｪ繝ｼ繝翫・讓ｩ髯舌ｒ蠑輔″邯吶＄
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
      // window縺ｫrequests繧偵そ繝・ヨ縺励う繝吶Φ繝育匱轣ｫ・・iniApp縺ｧ繝舌ャ繧ｸ逕ｨ縺ｫ蜿ら・・・
      (window as any).__mini_requests = reqArr;
      window.dispatchEvent(new Event('mini_requests_update'));
      // 繝壹・繧ｸ蜀・夂衍: 譁ｰ逹pending萓晞ｼ繧呈､懃衍
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
            new Notification('譁ｰ逹萓晞ｼ縺後≠繧翫∪縺・, {
              body: `${r.requester_name}縺輔ｓ縺九ｉ ${formatSlotDate(r.slot_date)} ${r.slot_start}窶・{r.slot_end} 縺ｮ萓晞ｼ`,
              icon: '/choicrew-mark.svg',
              tag: 'choicrew-new-request',
            });
          }
        }
        prevPendingIdsRef.current = new Set(pendingMap.keys());
      } else {
        // 萓晞ｼ閠・ 閾ｪ蛻・・萓晞ｼ縺ｮ繧ｹ繝・・繧ｿ繧ｹ螟牙喧繧呈､懃衍
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
                approved: '萓晞ｼ縺梧価隱阪＆繧後∪縺励◆・・,
                declined: '萓晞ｼ縺瑚ｾ樣縺輔ｌ縺ｾ縺励◆',
                cancelled: '萓晞ｼ縺後く繝｣繝ｳ繧ｻ繝ｫ縺輔ｌ縺ｾ縺励◆',
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

  // FP+IP: 繧ｪ繝ｼ繝翫・縺ｪ繧臥匳骭ｲ・域里蟄倥す繧ｧ繧｢縺ｮ遘ｻ陦悟性繧・峨・撼繧ｪ繝ｼ繝翫・縺ｪ繧臥・蜷・
  useEffect(() => {
    if (loading) return;
    if (isOwner) {
      // 繧ｪ繝ｼ繝翫・縺後ヶ繝ｩ繧ｦ繧ｶ縺ｧ髢九＞縺・竊・FP+IP繧堤匳骭ｲ/譖ｴ譁ｰ
      registerOwnerFingerprint(shareId);
    } else if (!fpChecked && !isNotOwnerDismissed(shareId)) {
      // 髱槭が繝ｼ繝翫・ 竊・FP+IP辣ｧ蜷・
      setFpChecked(true);
      checkOwnerFingerprint(shareId).then(match => {
        if (match) setFpOwnerPrompt(true);
      });
    }
  }, [loading, isOwner, shareId, fpChecked]);

  // FCM Web Push: 繧ｪ繝ｼ繝翫・縺ｮ縺ｿ縲∬ｨｱ蜿ｯ貂医∩縺ｪ繧峨ヨ繝ｼ繧ｯ繝ｳ繧貞叙蠕・
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
    const shared = await nativeShare(`${share?.name}縺輔ｓ縺ｮ遨ｺ縺肴凾髢伝, url);
    if (!shared) handleCopy();
  };

  const handleSent = (slot: { date: string; start: string; end: string }, requestId: string) => {
    const key = slotKey(slot);
    saveSentRequestId(shareId, key, requestId);
    const next = saveSentSlot(shareId, key, sentSlots);
    setSentSlots(next);
    setRequestSlot(null);
    toast.show('萓晞ｼ繧帝∽ｿ｡縺励∪縺励◆', 'success');
  };

  const requestsForSlot = (s: { date: string; start: string; end: string }) =>
    requests.filter(r =>
      r.slot_date === s.date && (
        (r.status === 'approved'
          ? (normalizeTime(r.requested_start || r.slot_start) === normalizeTime(s.start) && normalizeTime(r.requested_end || r.slot_end) === normalizeTime(s.end))
          : (r.slot_start === s.start && r.slot_end === s.end))
      )
    );

  // exclusive繝｢繝ｼ繝画凾縲∝酔縺俶棧縺ｮ莉朴ending繧壇eclined縺ｫ
  const handleApprove = async (requestId: string) => {
    try {
      const req = requests.find(r => r.id === requestId);
      if (!req) return;
      const nextStart = normalizeTime(req.requested_start || req.slot_start);
      const nextEnd = normalizeTime(req.requested_end || req.slot_end);
      await updateDoc(doc(db, 'mini_shares', shareId), {
        slots: replaceShareSlot(
          share?.slots || [],
          { date: req.slot_date, start: req.slot_start, end: req.slot_end },
          { start: nextStart, end: nextEnd }
        ),
      });
      setShare(prev => prev ? {
        ...prev,
        slots: replaceShareSlot(
          prev.slots || [],
          { date: req.slot_date, start: req.slot_start, end: req.slot_end },
          { start: nextStart, end: nextEnd }
        ),
      } : prev);
      await updateDoc(doc(db, 'mini_requests', requestId), { status: 'approved' });
      if (share?.bookingMode !== 'multiple') {
        // 蜷後§譫縺ｮ莉朴ending繧壇eclined縺ｫ
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
      toast.show('謇ｿ隱阪＠縺ｾ縺励◆', 'success');
    } catch (err) {
      console.error(err);
      toast.show('繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆', 'error');
    }
  };

  const handleDecline = async (requestId: string) => {
    try {
      await updateDoc(doc(db, 'mini_requests', requestId), { status: 'declined' });
      toast.show('霎樣縺励∪縺励◆', 'success');
    } catch (err) {
      console.error(err);
      toast.show('繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆', 'error');
    }
  };

  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const confirmCancelRequest = confirmCancelId ? requests.find(r => r.id === confirmCancelId) : null;

  // exclusive繝｢繝ｼ繝画凾縲∝酔縺俶棧縺ｮdeclined繧恥ending縺ｫ謌ｻ縺・
  const handleCancel = async (requestId: string) => {
    try {
      const req = requests.find(r => r.id === requestId);
      if (!req) return;
      await updateDoc(doc(db, 'mini_shares', shareId), {
        slots: replaceShareSlot(
          share?.slots || [],
          {
            date: req.slot_date,
            start: normalizeTime(req.requested_start || req.slot_start),
            end: normalizeTime(req.requested_end || req.slot_end),
          },
          { start: normalizeTime(req.slot_start), end: normalizeTime(req.slot_end) }
        ),
      });
      setShare(prev => prev ? {
        ...prev,
        slots: replaceShareSlot(
          prev.slots || [],
          {
            date: req.slot_date,
            start: normalizeTime(req.requested_start || req.slot_start),
            end: normalizeTime(req.requested_end || req.slot_end),
          },
          { start: normalizeTime(req.slot_start), end: normalizeTime(req.slot_end) }
        ),
      } : prev);
      await updateDoc(doc(db, 'mini_requests', requestId), { status: 'cancelled' });
      if (share?.bookingMode !== 'multiple') {
        // 蜷後§譫縺ｮdeclined繧恥ending縺ｫ謌ｻ縺・
        const sameSlotApproved = requests.filter(r =>
          r.id !== requestId &&
          r.slot_date === req.slot_date &&
          r.slot_start === req.slot_start &&
          r.slot_end === req.slot_end &&
          r.status === 'approved'
        );
        for (const r of sameSlotApproved) {
          await updateDoc(doc(db, 'mini_requests', r.id), { status: 'cancelled' });
        }
      }
      setConfirmCancelId(null);
      toast.show('謇ｿ隱阪ｒ蜿悶ｊ豸医＠縺ｾ縺励◆', 'success');
    } catch (err) {
      console.error(err);
      toast.show('繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆', 'error');
    }
  };

  const handleChangeTheme = async (newTheme: ThemeKey) => {
    if (!share) return;
    try {
      await updateDoc(doc(db, 'mini_shares', shareId), { theme: newTheme });
      setShare(prev => prev ? { ...prev, theme: newTheme } : prev);
      setShowThemePicker(false);
      toast.show('繝・・繝槭ｒ螟画峩縺励∪縺励◆', 'success');
    } catch (err) {
      console.error('theme change error:', err);
      toast.show('螟画峩縺ｫ螟ｱ謨励＠縺ｾ縺励◆', 'error');
    }
  };

  const handleSaveSlots = async () => {
    setSavingSlots(true);
    try {
      const validSlots = draftSlots
        .filter(s => isValidSlotRange(s.start, s.end))
        .map(({ date, start, end }) => ({ date, start, end }));
      if (validSlots.length === 0) {
        toast.show('譛牙柑縺ｪ譎る俣蟶ｯ縺後≠繧翫∪縺帙ｓ', 'error');
        setSavingSlots(false);
        return;
      }
      await updateDoc(doc(db, 'mini_shares', shareId), { slots: validSlots });
      setShare(prev => prev ? { ...prev, slots: validSlots } : prev);
      // dateRange繧値ocalStorage縺ｫ蜿肴丐
      const newDateRange = computeDateRange(validSlots);
      const newLastDate = [...validSlots].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || '';
      saveOwnedShare(shareId, share?.title || share?.name || '', newDateRange, newLastDate);
      setEditingSlots(false);
      toast.show('譎る俣繧呈峩譁ｰ縺励∪縺励◆', 'success');
    } catch (err) {
      console.error(err);
      toast.show('譖ｴ譁ｰ縺ｫ螟ｱ謨励＠縺ｾ縺励◆', 'error');
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
      toast.show('蜑企勁縺ｫ螟ｱ謨励＠縺ｾ縺励◆', 'error');
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
          <p className="text-slate-700 text-lg font-semibold mb-1">繝ｪ繝ｳ繧ｯ縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ</p>
          <p className="text-slate-400 text-sm mb-6">譛滄剞蛻・ｌ縺ｾ縺溘・辟｡蜉ｹ縺ｪ繝ｪ繝ｳ繧ｯ縺ｧ縺・/p>
          <a
            href="/mini/"
            className="inline-block bg-teal-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-teal-700 transition"
          >
            遨ｺ縺肴凾髢薙ｒ菴懈・縺吶ｋ
          </a>
        </div>
      </div>
    );
  }

  if (!share) return null;

  // 髱槫・髢具ｼ井ｸ区嶌縺搾ｼ峨・蝣ｴ蜷医√が繝ｼ繝翫・莉･螟悶↓縺ｯ陦ｨ遉ｺ縺励↑縺・
  if (isDraft && !isOwner) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <p className="text-slate-700 text-lg font-semibold mb-1">縺薙・繝壹・繧ｸ縺ｯ髱槫・髢九〒縺・/p>
          <p className="text-slate-400 text-sm mb-6">迴ｾ蝨ｨ縲∽ｽ懈・閠・↓繧医▲縺ｦ髱槫・髢九↓險ｭ螳壹＆繧後※縺・∪縺・/p>
          <a
            href="/mini/"
            className="inline-block bg-teal-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-teal-700 transition"
          >
            遨ｺ縺肴凾髢薙ｒ菴懈・縺吶ｋ
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
      {/* 笏笏 繝・・繝櫁レ譎ｯ逕ｻ蜒擾ｼ・bsolute + 螟ｧ縺阪ａ繧ｵ繧､繧ｺ縺ｧ繝｢繝舌う繝ｫ縺ｮ繧ｫ繧ｯ縺､縺埼亟豁｢・・笏笏 */}
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
      {/* 笏笏 繧｢繝九Γ繝・・繝櫁｣・｣ｾ 笏笏 */}
      {themeKey === 'anime' && (
        <div className="pointer-events-none select-none print:hidden" aria-hidden="true">
          {/* 蟾ｦ荳翫・譯・*/}
          <span className="fixed top-4 left-2 text-4xl opacity-30 animate-[spin_12s_linear_infinite]">減</span>
          <span className="fixed top-20 left-6 text-2xl opacity-20 animate-[spin_18s_linear_infinite_reverse]">笨ｿ</span>
          {/* 蜿ｳ荳・*/}
          <span className="fixed top-8 right-3 text-3xl opacity-25 animate-[spin_15s_linear_infinite]">箝・/span>
          <span className="fixed top-28 right-8 text-xl opacity-20">笨ｨ</span>
          {/* 蟾ｦ荳・*/}
          <span className="fixed bottom-16 left-4 text-3xl opacity-20 animate-[spin_20s_linear_infinite_reverse]">減</span>
          <span className="fixed bottom-32 left-10 text-lg opacity-15">笘・/span>
          {/* 蜿ｳ荳・*/}
          <span className="fixed bottom-10 right-4 text-2xl opacity-20 animate-[spin_10s_linear_infinite]">笨ｿ</span>
          {/* 繧ｹ繝斐・繝峨Λ繧､繝ｳ SVG */}
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
            <p className="font-semibold text-teal-900">菴懈・縺励∪縺励◆</p>
            <p className="text-sm text-teal-700 mt-1">繝ｪ繝ｳ繧ｯ繧堤嶌謇九↓蜈ｱ譛峨＠縺ｦ縺上□縺輔＞</p>
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
              <span className={`shrink-0 text-xs font-semibold ml-auto ${copied ? 'text-teal-600' : 'text-slate-500'}`}>{copied ? '笨・繧ｳ繝斐・貂医∩' : '繧ｳ繝斐・'}</span>
            </button>
            <div className="relative shrink-0">
              <button
                onClick={() => setShowOwnerMenu(v => !v)}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition text-lg"
                aria-label="繝｡繝九Η繝ｼ"
              >
                站ｯ
              </button>
              {showOwnerMenu && (
                <div className="absolute right-0 top-11 bg-white border border-slate-200 rounded-xl shadow-xl py-1 min-w-[170px] z-20 animate-[fadeIn_0.15s_ease-out]">
                  <button onClick={() => { setDraftSlots((share?.slots || []).map(s => ({ id: genId(6), ...s }))); setEditingSlots(true); setShowOwnerMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">笨擾ｸ・譎る俣繧堤ｷｨ髮・/button>
                  <button onClick={() => { setShowThemePicker(true); setShowOwnerMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">耳 繝・・繝槭ｒ螟画峩</button>
                  <button onClick={() => { setEmailInput(share.notify_email || ''); setPlatinumCode(''); setEmailCodeError(''); setShowEmailModal(true); setShowOwnerMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                    透 繝｡繝ｼ繝ｫ騾夂衍{share.notify_email ? <span className="ml-2 text-[10px] text-teal-600 bg-teal-50 rounded-full px-1.5 py-0.5 font-medium">逋ｻ骭ｲ貂・/span> : null}
                  </button>
                  
                    <button onClick={() => { setShowMgmtQr(true); setShowOwnerMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">導邂｡逅・ｒ蠑輔″縺､縺・/button>
                  
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
                      萓晞ｼ騾夂衍 {notifEnabled ? <span className="text-[10px] text-teal-600 bg-teal-50 rounded-full px-1.5 py-0.5 font-medium">ON</span> : <span className="text-[10px] text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5 font-medium">OFF</span>}
                    </button>
                  )}
                  <hr className="my-1 border-slate-100" />
                  <button onClick={() => { setShowDeleteConfirm(true); setShowOwnerMenu(false); }} className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50">蜑企勁縺吶ｋ</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Expired warning */}
        {expired && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5 print:hidden">
            <p className="font-medium text-amber-800">縺薙・蜈ｱ譛峨・譛滄剞蛻・ｌ縺ｧ縺・/p>
            <p className="text-sm text-amber-600 mt-1">萓晞ｼ縺ｮ騾∽ｿ｡縺ｯ縺ｧ縺阪∪縺帙ｓ</p>
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2">
            <h1 className={`text-2xl font-bold ${T.headingText} tracking-tight`}>
              {share.title || share.name + '縺輔ｓ縺ｮ遨ｺ縺肴凾髢・}
            </h1>
            {isOwner && (
              <button
                onClick={() => { setEditTitleVal(share.title || ''); setEditDisplayNameVal(share.displayName || share.name); setShowEditTitle(true); }}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-teal-500 hover:bg-teal-50 transition -mt-0.5"
                aria-label="繧ｿ繧､繝医Ν繧堤ｷｨ髮・
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              </button>
            )}
          </div>
          <p className={`text-sm ${T.subText} mt-1`}>
            菴懈・閠・ｼ嘴share.displayName || share.name}
          </p>
          {isOwner && requests.filter(r => !r.status || r.status === 'pending' || r.status === 'approved').length > 0 && (
            <p className="text-sm text-teal-600 font-medium mt-1">{requests.filter(r => !r.status || r.status === 'pending' || r.status === 'approved').length}莉ｶ縺ｮ萓晞ｼ</p>
          )}
        </div>

        {/* Edit title modal */}
        {showEditTitle && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowEditTitle(false)}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-800">繧ｿ繧､繝医Ν縺ｨ蜷榊燕繧堤ｷｨ髮・/h2>
                <button onClick={() => setShowEditTitle(false)} className="text-slate-400 hover:text-slate-600 text-xl px-2">笨・/button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">繧ｿ繧､繝医Ν</label>
                  <input
                    type="text"
                    value={editTitleVal}
                    onChange={e => setEditTitleVal(e.target.value)}
                    placeholder={share.name + '縺輔ｓ縺ｮ遨ｺ縺肴凾髢・}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                    maxLength={60}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">陦ｨ遉ｺ蜷搾ｼ井ｽ懈・閠・ｼ・/label>
                  <input
                    type="text"
                    value={editDisplayNameVal}
                    onChange={e => setEditDisplayNameVal(e.target.value)}
                    placeholder={share.name}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                    maxLength={30}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    蜈・・蜷榊燕: <span className="font-medium text-slate-500">{share.name}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={handleSaveTitle}
                className="mt-5 w-full bg-teal-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-teal-600 active:scale-95 transition-all"
              >
                菫晏ｭ倥☆繧・
              </button>
            </div>
          </div>
        )}

        {editingRequesterName && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditingRequesterName(null)}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-800">繝励Ο繝輔ぅ繝ｼ繝ｫ</h2>
                <button onClick={() => setEditingRequesterName(null)} className="text-slate-400 hover:text-slate-600 text-xl px-2">ﾃ・/button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">逶ｸ謇九・陦ｨ遉ｺ蜷・/label>
                  <input
                    type="text"
                    value={editingRequesterAliasValue}
                    onChange={e => setEditingRequesterAliasValue(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                    maxLength={40}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    蜈・・蜷榊燕: <span className="font-medium text-slate-500">{editingRequesterName.name}</span>
                  </p>
                </div>
                <p className="text-xs text-slate-400">
                  縺薙ｌ縺ｯ縺薙・莠亥ｮ夊｡ｨ縺ｫ菫晏ｭ倥＆繧後∪縺吶ょ挨遶ｯ譛ｫ縺ｧ繧ょ酔縺倅ｺ亥ｮ夊｡ｨ繧帝幕縺代・蜿肴丐縺輔ｌ縺ｾ縺吶・                </p>
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
                  菫晏ｭ・                </button>
                <button
                  onClick={() => setEditingRequesterName(null)}
                  className="flex-1 rounded-xl border border-slate-200 text-slate-600 py-2.5 text-sm font-semibold hover:bg-slate-50 transition"
                >
                  繧ｭ繝｣繝ｳ繧ｻ繝ｫ
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Owner: Request summary */}
        {isOwner && requests.filter(r => !r.status || r.status === 'pending' || r.status === 'approved').length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6 print:hidden">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700">萓晞ｼ荳隕ｧ</h2>
              <button
                className="text-xs text-teal-600 border border-teal-200 rounded-lg px-2 py-1 hover:bg-teal-50 transition"
                onClick={() => setShowRequestList(v => !v)}
              >
                {showRequestList ? '髱櫁｡ｨ遉ｺ' : '陦ｨ遉ｺ'}
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
                          <span className="text-[11px] text-slate-400">蜈・ {r.requester_name}</span>
                        ) : null}
                        <span className="text-[11px] text-slate-400">
                          {formatSlotDate(r.slot_date)} {r.slot_start}窶怒r.slot_end}
                        </span>
                        {r.status === 'approved' && (
                          <span className="text-[11px] font-medium text-blue-600 bg-blue-100 rounded-full px-2 py-0.5">謇ｿ隱肴ｸ医∩</span>
                        )}
                        {r.status === 'declined' && (
                          <span className="text-[11px] font-medium text-slate-500 bg-slate-200 rounded-full px-2 py-0.5">霎樣貂医∩</span>
                        )}
                        {r.status === 'cancelled' && (
                          <span className="text-[11px] font-medium text-red-500 bg-red-100 rounded-full px-2 py-0.5">繧ｭ繝｣繝ｳ繧ｻ繝ｫ貂医∩</span>
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
                          >謇ｿ隱・/button>
                          <button
                            onClick={() => handleDecline(r.id)}
                            className="px-3 py-1 rounded-lg bg-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-300 active:scale-95 transition-all"
                          >霎樣</button>
                        </div>
                      ) : r.status === 'approved' ? (
                        <div className="flex gap-2 mt-2">
                          {confirmCancelId === r.id ? (
                            <>
                              <span className="text-xs text-slate-500 self-center">譛ｬ蠖薙↓蜿悶ｊ豸医＠縺ｾ縺吶°・・/span>
                              <button
                                onClick={() => handleCancel(r.id)}
                                className="px-3 py-1 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 active:scale-95 transition-all"
                              >蜿悶ｊ豸医☆</button>
                              <button
                                onClick={() => setConfirmCancelId(null)}
                                className="px-3 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs font-medium hover:bg-slate-200 active:scale-95 transition-all"
                              >謌ｻ繧・/button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirmCancelId(r.id)}
                              className="px-3 py-1 rounded-lg bg-red-50 text-red-500 text-xs font-medium hover:bg-red-100 active:scale-95 transition-all border border-red-100"
                            >謇ｿ隱阪ｒ蜿悶ｊ豸医☆</button>
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
            <p className="text-sm text-slate-400">蟶梧悍縺ｮ譎る俣蟶ｯ繧帝∈繧薙〒萓晞ｼ縺ｧ縺阪∪縺・/p>
            {myRequestStatuses.size > 0 && (() => {
              const pendingCount = [...myRequestStatuses.values()].filter(v => v.status === 'pending').length;
              return pendingCount > 0 ? (
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-4 py-1">
                  <span className="animate-pulse">笨ｨ</span> 繝ｪ繧ｯ繧ｨ繧ｹ繝井ｸｭ {pendingCount}莉ｶ
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
                              {slot.start}<span className="text-slate-300 mx-1.5">-</span>{slot.end}
                            </p>
                            <TimeBar start={slot.start} end={slot.end} />
                            {!expired && reqs.length > 0 && !isOwner && (
                              isExclusive && hasApproved ? (
                                myReqStatus?.status === 'approved' ? (
                                  <p className="text-xs text-blue-600 font-medium mt-2">あなたのリクエストが承認されました</p>
                                ) : (
                                  <p className="text-xs text-blue-600 font-medium mt-2">他の人の承認で枠が埋まりました</p>
                                )
                              ) : (
                                <p className="text-xs text-teal-600 font-medium mt-2">{reqs.length}件の依頼</p>
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
                                承認済み
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
                                <span className="animate-pulse">●</span> リクエスト中
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
                                title={isExclusive && reqs.some(r => r.status === 'pending') ? '他の人が依頼中です' : ''}
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
                                <div key={r.id} className={`flex items-center gap-1.5 bg-white border rounded-full pl-1 pr-2.5 py-1 ${r.status === 'approved' ? 'border-blue-200 bg-blue-50/70' : 'border-slate-200'}`} title={r.message || undefined}>
                                  <Avatar name={getRequesterAlias(r.requester_name)} />
                                  <button
                                    type="button"
                                    onClick={() => setEditingRequesterName({ id: r.id, name: r.requester_name })}
                                    className="text-xs font-medium text-slate-600 hover:text-teal-600 transition text-left"
                                  >
                                    {getRequesterAlias(r.requester_name)}
                                  </button>
                                  {r.status === 'approved' && (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmCancelId(r.id)}
                                      className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5 hover:bg-blue-200 transition"
                                    >
                                      承認済み
                                    </button>
                                  )}
                                  {(!r.status || r.status === 'pending') && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 bg-teal-100 rounded-full px-2 py-0.5">
                                      依頼中
                                    </span>
                                  )}
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
              <p className="text-slate-400">遨ｺ縺肴凾髢薙′逋ｻ骭ｲ縺輔ｌ縺ｦ縺・∪縺帙ｓ</p>
            </div>
          )}
        </div>

        {confirmCancelRequest && (
          <div
            className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center print:hidden"
            onClick={() => setConfirmCancelId(null)}
          >
            <div className="bg-white w-full max-w-sm mx-4 rounded-2xl p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
              <p className="text-sm font-semibold text-slate-800 mb-1">この依頼をキャンセルしますか？</p>
              <p className="text-xs text-slate-500 mb-4">
                {getRequesterAlias(confirmCancelRequest.requester_name)} の依頼を取り消します。
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="flex-1 rounded-xl bg-red-500 text-white text-sm font-medium px-4 py-2.5 hover:bg-red-600 transition"
                  onClick={() => handleCancel(confirmCancelRequest.id)}
                >
                  キャンセルする
                </button>
                <button
                  className="flex-1 rounded-xl bg-slate-100 text-slate-600 text-sm font-medium px-4 py-2.5 hover:bg-slate-200 transition"
                  onClick={() => setConfirmCancelId(null)}
                >
                  戻る
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Print-only section */}
        <div className="hidden print:flex print:flex-col print:items-center print:mt-8 print:pt-6 print:border-t print:border-slate-300">
          <img src={makeQrUrl(url)} alt="QR Code" className="w-32 h-32 mb-2" />
          <p className="text-xs text-slate-500 break-all text-center max-w-xs">{url}</p>
          <p className="text-xs text-slate-400 mt-2">QR繧ｳ繝ｼ繝峨ｒ隱ｭ縺ｿ蜿悶ｋ縺ｨ遨ｺ縺肴凾髢薙ｒ遒ｺ隱阪〒縺阪∪縺・/p>
        </div>

        {/* 髢ｲ隕ｧ逕ｨ繝｡繝・そ繝ｼ繧ｸ */}
        {!isOwner && isPaused && (
          <div className="mx-4 mb-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-center">
            <p className="text-sm text-slate-500">髢ｲ隕ｧ逕ｨ縺ｨ縺励※蜈ｬ髢九＆繧後※縺・∪縺吶ら｢ｺ隱阪′縺励◆縺・ｴ蜷医・縲∽ｺ亥ｮ壹・菴懈・閠・↓逶ｴ謗･縺秘｣邨｡縺上□縺輔＞縲・/p>
          </div>
        )}

        {/* FP+IP荳閾ｴ: 繧ｪ繝ｼ繝翫・遒ｺ隱阪Δ繝ｼ繝繝ｫ・育ｬｬ2螻､・・*/}
        {fpOwnerPrompt && !isOwner && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-[fadeIn_0.2s_ease-out] print:hidden">
            <div className="bg-white rounded-2xl p-6 mx-6 max-w-sm w-full shadow-xl">
              <p className="font-semibold text-slate-800 text-base mb-2">縺薙・莠亥ｮ壹・邂｡逅・・〒縺吶°・・/p>
              <p className="text-sm text-slate-500 mb-5">蛻･縺ｮ繝悶Λ繧ｦ繧ｶ縺ｧ菴懈・縺励◆莠亥ｮ壹→蜷後§遶ｯ譛ｫ縺九ｉ縺ｮ繧｢繧ｯ繧ｻ繧ｹ繧呈､懃衍縺励∪縺励◆</p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const dateRange = share ? computeDateRange(share.slots) : '';
                    const lastDate = share ? [...share.slots].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || '' : '';
                    saveOwnedShare(shareId, share?.title || share?.name || '', dateRange, lastDate);
                    setFpOwnerPrompt(false);
                    setTokenVerified(true);
                    toast.show('邂｡逅・・→縺励※蠕ｩ蟶ｰ縺励∪縺励◆', 'success');
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition"
                >
                  縺ｯ縺・∫ｮ｡逅・・〒縺・
                </button>
                <button
                  onClick={() => {
                    setNotOwnerDismissed(shareId);
                    setFpOwnerPrompt(false);
                  }}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-medium hover:bg-slate-50 transition"
                >
                  縺・＞縺・
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer CTA (visitor) */}
        {!isOwner && (
          <div className="text-center border-t border-slate-100 pt-8 mt-4 print:hidden">
            <p className="text-sm text-slate-500 mb-3">縺ゅ↑縺溘ｂ遨ｺ縺肴凾髢薙ｒ蜈ｱ譛峨＠縺ｾ縺帙ｓ縺具ｼ・/p>
            <a
              href="/mini/"
              className="inline-block bg-amber-200 text-white rounded-xl px-4 py-1
                         font-medium hover:bg-amber-300 transition shadow-sm"
            >
              遨ｺ縺肴凾髢薙ｒ菴懈・縺吶ｋ
            </a>
            {/* 隨ｬ3螻､繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ: 繝悶Λ繧ｦ繧ｶ縺ｧ髢九＞縺ｦ縺上□縺輔＞ */}
            <p className="mt-6 text-xs text-slate-300 hover:text-slate-400 transition cursor-default">
              邂｡逅・・・譁ｹ縺ｯ<button
                onClick={() => {
                  const ua = navigator.userAgent || '';
                  const isLine = /Line/i.test(ua);
                  const isInApp = /Line|FBAN|FBAV|Instagram|Twitter/i.test(ua);
                  if (isLine) {
                    // LINE蜀・ヶ繝ｩ繧ｦ繧ｶ 竊・openExternalBrowser=1 縺ｧ螟夜Κ繝悶Λ繧ｦ繧ｶ縺ｸ
                    const url = new URL(window.location.href);
                    url.searchParams.set('openExternalBrowser', '1');
                    window.location.href = url.toString();
                  } else if (isInApp) {
                    // 縺昴・莉悶い繝励Μ蜀・ヶ繝ｩ繧ｦ繧ｶ
                    const url = window.location.href;
                    window.open(url, '_blank');
                    toast.show('繝悶Λ繧ｦ繧ｶ縺ｧ髢九＞縺ｦ邂｡逅・＠縺ｦ縺上□縺輔＞', 'success');
                  } else {
                    toast.show('縺薙・繝悶Λ繧ｦ繧ｶ縺ｧ菴懈・縺励◆莠亥ｮ壹・閾ｪ蜍慕噪縺ｫ邂｡逅・・↓縺ｪ繧翫∪縺・, 'success');
                  }
                }}
                className="underline text-slate-400 hover:text-slate-500 transition"
              >繝悶Λ繧ｦ繧ｶ縺ｧ髢九＞縺ｦ縺上□縺輔＞</button>
            </p>
          </div>
        )}

        {isOwner && (
          <div className="text-center print:hidden">
            <a href="/mini/" className="text-sm text-slate-400 hover:text-slate-600 transition">
              竊・譁ｰ縺励￥菴懈・縺吶ｋ
            </a>
          </div>
        )}

      </div>

      {/* 迥ｶ諷九・繧ｿ繝ｳ・医が繝ｼ繝翫・縺ｮ縺ｿ繝ｻ蜿ｳ荳句崋螳夲ｼ・*/}
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
            {isDraft ? '荳区嶌縺搾ｼ磯撼蜈ｬ髢具ｼ・ : isPaused ? '髢ｲ隕ｧ蟆ら畑' : '萓晞ｼ蜿嶺ｻ倅ｸｭ'}
          </button>

        </div>
      )}

      {/* 迥ｶ諷句､画峩繝｢繝ｼ繝繝ｫ */}
      {showStatusModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50"
          onClick={() => setShowStatusModal(false)}
        >
          <div className="bg-white rounded-2xl p-4 w-full max-w-sm mx-4 shadow-2xl mb-4 sm:mb-0 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-slate-800">蜈ｬ髢狗憾諷九ｒ螟画峩</h2>
              <button onClick={() => setShowStatusModal(false)} className="text-slate-400 hover:text-slate-600 text-xl px-2">笨・/button>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => handleChangeStatus('active')}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${!isPaused && !isDraft ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-teal-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">萓晞ｼ蜿嶺ｻ倅ｸｭ</p>
                </div>
                {!isPaused && !isDraft && <span className="text-teal-500 text-xs font-bold shrink-0">迴ｾ蝨ｨ</span>}
              </button>
              <button
                onClick={() => handleChangeStatus('view_only')}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${isPaused && !isDraft ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">陦ｨ遉ｺ縺ｮ縺ｿ縺ｫ縺吶ｋ</p>
                </div>
                {isPaused && !isDraft && <span className="text-amber-500 text-xs font-bold shrink-0">迴ｾ蝨ｨ</span>}
              </button>
              <button
                onClick={() => handleChangeStatus('draft')}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${isDraft ? 'border-slate-500 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">荳区嶌縺阪↓縺吶ｋ</p>
                </div>
                {isDraft && <span className="text-slate-500 text-xs font-bold shrink-0">迴ｾ蝨ｨ</span>}
              </button>
            </div>
            {/* 謇ｿ隱阪Δ繝ｼ繝牙・繧頑崛縺・*/}
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-500 mb-2">謇ｿ隱阪Δ繝ｼ繝・/p>
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
                        <p className="text-sm font-bold text-slate-800">{mode === 'exclusive' ? '1縺､縺縺第価隱・ : '驕ｸ繧薙〒謇ｿ隱・}</p>
                      </div>
                      {isActive && <span className="text-teal-500 text-xs font-bold shrink-0">迴ｾ蝨ｨ</span>}
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
                縺薙・蜈ｱ譛峨ｒ蜑企勁縺吶ｋ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 繝｡繝ｼ繝ｫ騾夂衍繝｢繝ｼ繝繝ｫ */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50" onClick={() => setShowEmailModal(false)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm mx-4 shadow-2xl mb-4 sm:mb-0" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-800">透 繝｡繝ｼ繝ｫ騾夂衍</h2>
              <button onClick={() => setShowEmailModal(false)} className="text-slate-400 hover:text-slate-600 text-xl px-2">笨・/button>
            </div>
            {share?.notify_email && (
              <p className="text-xs text-teal-600 bg-teal-50 rounded-xl px-3 py-2 mb-3">迴ｾ蝨ｨ縺ｮ騾夂衍蜈・ {share.notify_email}</p>
            )}
            <p className="text-xs text-slate-400 mb-4">萓晞ｼ縺悟ｱ翫＞縺溘→縺阪↓繝｡繝ｼ繝ｫ縺ｧ縺顔衍繧峨○縺励∪縺吶よ怏蜉ｹ蛹悶↓縺ｯ<span className="font-semibold text-slate-600">繝励Ξ繝溘い繝讖溯・</span>縺ｮ縺溘ａ縲√・繝ｩ繝√リ繧ｳ繝ｼ繝峨′蠢・ｦ√〒縺吶・/p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">騾夂衍蜈医Γ繝ｼ繝ｫ繧｢繝峨Ξ繧ｹ</label>
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
                <label className="text-xs font-medium text-slate-500 mb-1 block">繝励Λ繝√リ繧ｳ繝ｼ繝・/label>
                <input
                  type="password"
                  value={platinumCode}
                  onChange={e => { setPlatinumCode(e.target.value); setEmailCodeError(''); }}
                  placeholder="繧ｳ繝ｼ繝峨ｒ蜈･蜉・
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
              {emailSaving ? '逋ｻ骭ｲ荳ｭ...' : '逋ｻ骭ｲ縺吶ｋ'}
            </button>
          </div>
        </div>
      )}

      {/* 邂｡逅・畑QR繝｢繝ｼ繝繝ｫ */}
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
                <h2 className="text-base font-bold text-slate-800">導 蠑輔″邯吶℃</h2>
                <button onClick={() => setShowMgmtQr(false)} className="text-slate-400 hover:text-slate-600 text-xl px-2">笨・/button>
              </div>
              <p className="text-xs text-slate-500 mb-4">縺薙・QR繧ｳ繝ｼ繝峨ｒ繧ｹ繝槭・縺ｧ隱ｭ縺ｿ蜿悶ｋ縺ｨ<br />邂｡逅・・→縺励※謫堺ｽ懊〒縺阪∪縺・/p>
              <div className="flex justify-center mb-4">
                <img src={makeQrUrl(mgmtUrl, 200)} alt="邂｡逅・畑QR" className="w-48 h-48 rounded-xl border border-slate-100" />
              </div>
              <p className="text-[10px] text-slate-400 break-all mb-4">{mgmtUrl}</p>
              <button
                onClick={async () => {
                  try { await navigator.clipboard.writeText(mgmtUrl); toast.show('邂｡逅・畑URL繧偵さ繝斐・縺励∪縺励◆', 'success'); }
                  catch { toast.show('繧ｳ繝斐・縺ｫ螟ｱ謨励＠縺ｾ縺励◆'); }
                }}
                className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition"
              >
                URL繧偵さ繝斐・
              </button>
              <p className="text-[10px] text-red-400 mt-3">窶ｻ縺薙・URL繧堤衍縺｣縺ｦ縺・ｋ莠ｺ縺ｯ邂｡逅・〒縺阪∪縺吶ゆｿ｡鬆ｼ縺ｧ縺阪ｋ莠ｺ縺ｫ縺ｮ縺ｿ蜈ｱ譛峨＠縺ｦ縺上□縺輔＞</p>
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

      {/* 蜑企勁遒ｺ隱阪Δ繝ｼ繝繝ｫ */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">縺薙・蜈ｱ譛峨ｒ蜑企勁縺励∪縺吶°・・/h3>
            <p className="text-sm text-slate-500 mb-5">蜑企勁縺吶ｋ縺ｨ蠕ｩ蜈・〒縺阪∪縺帙ｓ縲ょ女縺大叙縺｣縺滉ｾ晞ｼ繧ら｢ｺ隱阪〒縺阪↑縺上↑繧翫∪縺吶・/p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition"
              >
                繧ｭ繝｣繝ｳ繧ｻ繝ｫ
              </button>
              <button
                onClick={handleDeleteShare}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 disabled:opacity-40 transition"
              >
                {deleting ? '蜑企勁荳ｭ...' : '蜑企勁縺吶ｋ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 譎る俣蟶ｯ邱ｨ髮・が繝ｼ繝舌・繝ｬ繧､ */}
      {showThemePicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowThemePicker(false)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-800">繝・・繝槭ｒ螟画峩</h2>
              <button onClick={() => setShowThemePicker(false)} className="text-slate-400 hover:text-slate-600 text-xl px-2">笨・/button>
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
                  {themeKey === key && <span className="absolute top-2 right-2 text-teal-500 text-xs font-bold">笨・迴ｾ蝨ｨ</span>}
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
              <h2 className="text-lg font-bold text-slate-800">譎る俣蟶ｯ繧堤ｷｨ髮・/h2>
              <button onClick={() => setEditingSlots(false)} className="text-slate-400 hover:text-slate-600 text-xl px-2">笨・/button>
            </div>
            <div className="mb-4">
              <p className="text-xs text-slate-400">蜷・律縺ｮ譎る俣蟶ｯ繧堤ｷｨ髮・・霑ｽ蜉繝ｻ蜑企勁縺ｧ縺阪∪縺・/p>
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
                        ・玖ｿｽ蜉
                      </button>
                    </div>
                    {daySlots.length === 0 && (
                      <p className="text-xs text-slate-300">譎る俣蟶ｯ縺ｪ縺・/p>
                    )}
                    {daySlots.map(slot => (
                      <div key={slot.id} className="flex items-center gap-2 mb-2 animate-[fadeIn_0.15s_ease-out]">
                        <input
                          type="time"
                          value={slot.start}
                          onChange={e => setDraftSlots(prev => prev.map(s => s.id === slot.id ? { ...s, start: e.target.value } : s))}
                          className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm text-center bg-white"
                        />
                        <span className="text-slate-300 text-sm">窶・/span>
                        <input
                          type="time"
                          value={slot.end}
                          onChange={e => setDraftSlots(prev => prev.map(s => s.id === slot.id ? { ...s, end: e.target.value } : s))}
                          className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm text-center bg-white"
                        />
                        <button
                          onClick={() => setDraftSlots(prev => prev.filter(s => s.id !== slot.id))}
                          className="text-slate-300 hover:text-red-400 p-1.5 transition-colors rounded-lg"
                          aria-label="蜑企勁"
                        >
                          笨・
                        </button>
                      </div>
                    ))}
                    {daySlots.some(s => s.start >= s.end) && (
                      <p className="text-xs text-red-400 mt-1">髢句ｧ九・邨ゆｺ・ｈ繧雁燕縺ｫ縺励※縺上□縺輔＞</p>
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
                繧ｭ繝｣繝ｳ繧ｻ繝ｫ
              </button>
              <button
                onClick={handleSaveSlots}
                disabled={savingSlots}
                className="flex-1 py-3 rounded-xl bg-teal-600 text-white font-bold hover:bg-teal-700 disabled:opacity-40 transition"
              >
                {savingSlots ? '菫晏ｭ倅ｸｭ...' : '菫晏ｭ倥☆繧・}
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
      // 閾ｪ蛻・′騾√▲縺溘Μ繧ｯ繧ｨ繧ｹ繝・D縺縺代ｒ繧ｫ繧ｦ繝ｳ繝・
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
      {/* 萓晞ｼ荳隕ｧ繝舌ャ繧ｸ・磯搨・・*/}
      <button
        className="relative"
        onClick={() => setShowBadgeModal(true)}
        aria-label="謇ｿ隱肴ｸ医∩萓晞ｼ荳隕ｧ"
      >
        <TaskIcon className="w-7 h-7 text-blue-500" />
        {badgeCounts.approved > 0 && (
          <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.5em] text-center border border-white">
            {badgeCounts.approved}
          </span>
        )}
      </button>
      {/* 騾夂衍繝吶Ν繝舌ャ繧ｸ・郁ｵ､・・*/}
      <button
        className="relative"
        onClick={() => setShowBadgeModal(true)}
        aria-label="譛ｪ謇ｿ隱埼夂衍荳隕ｧ"
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
          <h2 className="text-lg font-bold mb-3">萓晞ｼ繝ｻ騾夂衍荳隕ｧ</h2>
          <div className="mb-2">
            <span className="inline-flex items-center gap-2 text-blue-600 font-semibold"><TaskIcon className="w-5 h-5" />遒ｺ螳壹＠縺滉ｺ亥ｮ・ {badgeCounts.approved}莉ｶ</span>
          </div>
          <div className="mb-4">
            <span className="inline-flex items-center gap-2 text-teal-600 font-semibold"><BellIcon className="w-5 h-5" />笨ｨ 繝ｪ繧ｯ繧ｨ繧ｹ繝井ｸｭ縺ｧ縺・ {badgeCounts.pending}莉ｶ</span>
          </div>
          <button className="absolute top-2 right-2 text-slate-400 hover:text-red-400" onClick={() => setShowBadgeModal(false)} aria-label="髢峨§繧・>笨・/button>
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



