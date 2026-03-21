import React, { useState, useEffect, useCallback, useRef } from "react";
import { 
  Calendar, 
  Clock, 
  Share2, 
  Plus, 
  Bell, 
  ChevronRight, 
  ChevronLeft, 
  LogOut, 
  User, 
  Users,
  CalendarDays,
  Check, 
  X, 
  MessageCircle, 
  Settings,
  ArrowRight,
  Pencil,
  Eye,
  Link2,
  Repeat2,
  Copy,
  RefreshCcw,
  Key
} from "lucide-react";
import { 
  initializeApp,
  FirebaseError
} from "firebase/app";
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithPopup, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider, 
  signOut, 
  signInWithCustomToken,
  unlink,
  EmailAuthProvider,
  linkWithCredential,
  updateEmail,
  updatePassword
} from "firebase/auth";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  deleteDoc, 
  doc, 
  updateDoc, 
  getDoc, 
  setDoc,
  getDocs,
  deleteField,
  Timestamp,
  serverTimestamp,
  orderBy,
  limit,
  writeBatch
} from "firebase/firestore";
import { format, addDays, addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, isBefore, startOfDay, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";

// Firebase Config
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);
const CHOICREW_LOGO = "/choicrew-logo.svg";
const AUTH_ID_DOMAIN = "choicrew.local";
const avatarSeeds = [
  "fox","panda","sloth","koala","tiger","lion","eagle","dolphin","whale","penguin",
  "otter","owl","parrot","seal","shark","orca","hippo","rhino","giraffe","zebra",
  "camel","buffalo","bear","moose","deer","goat","sheep","hedgehog","raccoon","squirrel",
  "beaver","hamster","duck","flamingo","peacock","frog","gecko","dragon","yeti","goblin",
  "ghost","robot","ninja","wizard","personA","personB","personC","personD","monsterA","monsterB"
];
const presetAvatars = avatarSeeds.map(seed => `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${seed}&backgroundColor=transparent`);
const pickRandomAvatar = () => presetAvatars[Math.floor(Math.random() * presetAvatars.length)];

// Error Handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleFirestoreError = (error: Error | unknown, operationType: OperationType, path: string | null) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  if (errorMessage.includes("Quota exceeded")) {
    alert("Firebaseの無料枠の制限を超えました。しばらく時間をおいてから再度お試しください。");
  }

  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  // Snapshotsでのpermission-deniedがUIを落とさないように警告ログにとどめる
  console.warn('Firestore Error: ', JSON.stringify(errInfo));
};

// Types
type Role = "staff" | "manager";
interface UserProfile {
  uid: string;
  search_id: string;
  name: string;
  email: string;
  role: Role;
  current_role: Role;
  share_token: string;
  accept_requests: boolean;
  notification_pref?: "none" | "email" | "line" | "both";
  line_user_id?: string;
  line_picture?: string;
  avatar_url?: string;
  default_start?: string;
  default_end?: string;
  share_period_days?: 7 | 14 | 30;
  share_paused?: boolean;
}

interface Availability {
  id: string;
  user_id: string;
  user_name?: string;
  date: string;
  start_time: string;
  end_time: string;
  status: "open" | "pending" | "confirmed" | "busy";
  note?: string;
  is_private_note?: boolean;
  is_recurring?: boolean;
  loop_group_id?: string;
  created_at?: unknown;
}

interface ShiftRequest {
  id: string;
  staff_id: string;
  staff_name: string;
  manager_id: string;
  manager_name: string;
  availability_id: string;
  date: string;
  start_time: string;
  end_time: string;
  requested_start_time?: string;
  requested_end_time?: string;
  status: "pending" | "approved" | "canceled";
  created_at?: unknown;
}

interface Notification {
  id: string;
  user_id: string;
  type: "request" | "approval" | "decline" | "system";
  message: string;
  date?: string;
  timestamp: unknown;
  read: boolean;
}

interface Connection {
  id: string;
  user1_id: string;
  user2_id: string;
  status: "active" | "blocked";
  blocked_by?: string;
}

interface Preset {
  id: string;
  user_id: string;
  name: string;
  start: string;
  end: string;
}

type LineNotificationReason =
  | "delivered"
  | "config_missing"
  | "line_user_missing"
  | "invalid_token"
  | "not_authorized"
  | "not_following_or_blocked"
  | "profile_not_found"
  | "push_failed"
  | "network_error";

interface LineNotificationResult {
  success: boolean;
  reason: LineNotificationReason;
  details?: string;
  raw?: unknown;
}

// Components
const Card = ({
  children,
  className = "",
  onClick,
  interactive = false,
}: {
  children: React.ReactNode,
  className?: string,
  onClick?: () => void,
  interactive?: boolean
}) => (
  <div
    onClick={onClick}
    className={`bg-white/80 backdrop-blur-xl border border-white/20 rounded-3xl shadow-sm ${className} ${interactive ? "cursor-pointer transition-transform hover:-translate-y-0.5" : ""}`}
  >
    {children}
  </div>
);

const Button = ({ 
  children, 
  onClick, 
  variant = "primary", 
  className = "",
  disabled = false,
  icon: Icon
}: { 
  children: React.ReactNode, 
  onClick?: () => void, 
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "line",
  className?: string,
  disabled?: boolean,
  icon?: React.ElementType
}): JSX.Element => {
  const variants = {
    primary: "bg-blue-600 text-white shadow-lg shadow-blue-200 hover:bg-blue-700",
    secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
    outline: "bg-transparent border-2 border-gray-100 text-gray-600 hover:bg-gray-50",
    ghost: "bg-transparent text-gray-500 hover:bg-gray-100",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
    line: "bg-[#06C755] text-white hover:brightness-110"
  };

  return (
    <button 
      onClick={onClick} 
      disabled={disabled}
      className={`px-6 py-3 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {Icon && <Icon size={18} />}
      {children}
    </button>
  );
};

export default function App() {
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isPublicView, setIsPublicView] = useState(false);
  const [publicUser, setPublicUser] = useState<UserProfile | null>(null);
  const [isProcessingLine, setIsProcessingLine] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [registerName, setRegisterName] = useState("");
  const [authId, setAuthId] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionUsers, setConnectionUsers] = useState<UserProfile[]>([]);
  
  const [view, setView] = useState<"myboard" | "friends" | "settings">("myboard");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarMode, setCalendarMode] = useState<"day" | "week" | "month">(
    typeof window !== "undefined" && window.innerWidth < 768 ? "day" : "week"
  );
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showBellDropdown, setShowBellDropdown] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAvailability, setEditingAvailability] = useState<Availability | null>(null);
  const [draftDate, setDraftDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [draftTime, setDraftTime] = useState({ start: "10:00", end: "15:00" });
  const [draftNote, setDraftNote] = useState("");
  const [draftStatus, setDraftStatus] = useState<Availability["status"]>("open");
  const [draftIsRecurring, setDraftIsRecurring] = useState(false);
  const [lastNewDraft, setLastNewDraft] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    time: { start: "10:00", end: "15:00" },
    note: "",
    status: "open" as Availability["status"],
    isRecurring: false,
  });
  const [selectedAvatar, setSelectedAvatar] = useState("");
  const [showAllAvatars, setShowAllAvatars] = useState(false);
  const [showPastCalendarItems, setShowPastCalendarItems] = useState(false);
  const [notificationFeedback, setNotificationFeedback] = useState("");
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestTarget, setRequestTarget] = useState<Availability | null>(null);
  const [requestStart, setRequestStart] = useState("");
  const [requestEnd, setRequestEnd] = useState("");
  const [showScheduleList, setShowScheduleList] = useState(false);
  const [scheduleFilter, setScheduleFilter] = useState<"all" | "confirmed" | "open" | "request">("all");
  const [pendingRequestAction, setPendingRequestAction] = useState<{
    request: ShiftRequest;
    mode: "approve" | "reject";
  } | null>(null);
  const [showDayDetailModal, setShowDayDetailModal] = useState(false);
  const [showNameEditModal, setShowNameEditModal] = useState(false);
  const [nameEditValue, setNameEditValue] = useState("");
  const [showIdModal, setShowIdModal] = useState(false);
  const [idValue, setIdValue] = useState("");
  const [idPassword, setIdPassword] = useState("");
  const [showAvatarToast, setShowAvatarToast] = useState(false);

  const requestSectionRef = useRef<HTMLDivElement | null>(null);
  const confirmedSectionRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const dayScrollRef = useRef<HTMLDivElement | null>(null);
  const dayRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const isLineSignedIn = Boolean(auth.currentUser?.providerData.some(provider => provider.providerId === "oidc.line") || currentUser?.line_user_id);
  const isGoogleSignedIn = Boolean(
    auth.currentUser?.providerData.some(provider => provider.providerId === "google.com") ||
    currentUser?.google_email
  );
  const accountLabel = `${isLineSignedIn ? "LINE連携中" : "LINE未連携"} / ${isGoogleSignedIn ? "Google連携中" : "Google未連携"}`;
  const shareLink = currentUser ? `${window.location.origin}?share=${currentUser.share_token}` : "";
  const effectiveSharePeriodDays = publicUser?.share_period_days || currentUser?.share_period_days || 7;
  const publicSharePeriodDays = publicUser?.share_period_days || 7;
  const sharePeriodLabel = effectiveSharePeriodDays === 14 ? "2週間" : effectiveSharePeriodDays === 30 ? "1か月" : "1週間";
  const avatarSrc = selectedAvatar || currentUser?.avatar_url || "";
  const isOwnPreview = isPublicView && Boolean(currentUser?.uid && publicUser?.uid && currentUser.uid === publicUser.uid);
  const incomingRequests = currentUser
    ? requests.filter(r => r.staff_id === currentUser.uid && r.status === "pending")
    : [];
  const today = new Date();
  const displayedAvailabilities = [...availabilities].sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
  const scrollCalendarDays = Array.from(
    { length: endOfMonth(selectedDate).getDate() },
    (_, i) => addDays(startOfMonth(selectedDate), i)
  );
  const isBlockedByOwner = isPublicView && currentUser ? connections.some(c =>
    c.status === "blocked" &&
    c.blocked_by === publicUser?.uid &&
    ([c.user1_id, c.user2_id].includes(currentUser.uid))
  ) : false;
  const isPublicHidden = Boolean(publicUser?.share_paused || isBlockedByOwner);
  const publicUpcomingAvailabilities = availabilities
    .filter(() => !isPublicHidden)
    .filter(a => parseISO(a.date) >= new Date(new Date().setHours(0,0,0,0)))
    .filter(a => parseISO(a.date) < addDays(new Date(new Date().setHours(0,0,0,0)), publicSharePeriodDays))
    .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
  const groupedPublicAvailabilities = publicUpcomingAvailabilities.reduce<Record<string, Availability[]>>((acc, availability) => {
    (acc[availability.date] ||= []).push(availability);
    return acc;
  }, {});
  const publicScheduleDates = Array.from(new Set(publicUpcomingAvailabilities.map(a => a.date))).sort();
  const isPendingMyRequest = (availabilityId: string) =>
    requests.some(r => r.availability_id === availabilityId && r.staff_id === currentUser?.uid && r.status === "pending");
  const isApprovedMyRequest = (availabilityId: string) =>
    requests.some(r => r.availability_id === availabilityId && r.staff_id === currentUser?.uid && r.status === "approved");
  const selectedDayItems = displayedAvailabilities
    .filter(a => isSameDay(parseISO(a.date), selectedDate))
    .sort((a, b) => `${a.start_time}`.localeCompare(`${b.start_time}`));
  const openAvailabilityModal = (availability?: Availability, targetDate?: Date) => {
    if (availability) {
      setEditingAvailability(availability);
      setDraftDate(availability.date);
      setDraftTime({ start: availability.start_time, end: availability.end_time });
      setDraftNote(availability.note || "");
      setDraftStatus(availability.status);
      setDraftIsRecurring(Boolean(availability.is_recurring));
    } else {
      setEditingAvailability(null);
      const baseDate = targetDate || selectedDate || new Date();
      setDraftDate(format(baseDate, "yyyy-MM-dd"));
      setDraftTime(lastNewDraft.time);
      setDraftNote(lastNewDraft.note);
      setDraftStatus(lastNewDraft.status);
      setDraftIsRecurring(lastNewDraft.isRecurring);
    }
    setShowAddModal(true);
  };

  const openDayDetailModal = (day: Date) => {
    setSelectedDate(day);
    setShowDayDetailModal(true);
  };

  useEffect(() => {
    if (calendarMode !== "day") return;
    const key = format(selectedDate, "yyyy-MM-dd");
    const target = dayRowRefs.current[key];
    if (target) {
      window.requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: "auto", block: "center" });
      });
      return;
    }
    if (isSameDay(selectedDate, today)) {
      dayScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [selectedDate, calendarMode]);

  const openIdModal = () => {
    setIdValue(currentUser?.search_id || "");
    setIdPassword("");
    setShowIdModal(true);
  };

  const closeAvailabilityModal = () => {
    setShowAddModal(false);
    setEditingAvailability(null);
  };

  const statusLabel = (status: Availability["status"]) =>
    status === "open" ? "空き" : status === "pending" ? "依頼中" : status === "confirmed" ? "確定" : "予定あり";

  const statusColor = (status: Availability["status"]) =>
    status === "confirmed" ? "bg-red-500" : status === "pending" ? "bg-orange-500" : status === "busy" ? "bg-red-900" : "bg-gray-400";

  const normalizeAuthId = (value: string) => value.trim().toLowerCase();
  const toAuthEmail = (id: string) => `${normalizeAuthId(id)}@${AUTH_ID_DOMAIN}`;
  const formatCompactTime = (time: string) => {
    const [hour, minute] = time.split(":");
    if (minute === "00") return `${Number(hour)}`;
    return `${Number(hour)}:${minute}`;
  };
  const handleSaveIdLogin = async () => {
    if (!auth.currentUser || !currentUser) return;
    const normalizedId = normalizeAuthId(idValue);
    if (normalizedId.length < 8) {
      alert("IDは8文字以上にしてください。");
      return;
    }
    if (idPassword.length < 8) {
      alert("パスワードは8文字以上にしてください。");
      return;
    }
    const newEmail = toAuthEmail(normalizedId);
    try {
      // まだIDが無い場合は email/password を新規リンク
      if (!currentUser.search_id) {
        const credential = EmailAuthProvider.credential(newEmail, idPassword);
        await linkWithCredential(auth.currentUser, credential);
      } else {
        // IDを変える場合は email を更新
        if (currentUser.search_id !== normalizedId) {
          await updateEmail(auth.currentUser, newEmail);
        }
        // パスワードは毎回更新
        await updatePassword(auth.currentUser, idPassword);
      }
      await setDoc(doc(db, "users", currentUser.uid), {
        search_id: normalizedId,
        email: newEmail,
      }, { merge: true });
      setCurrentUser({ ...currentUser, search_id: normalizedId, email: newEmail });
      setShowIdModal(false);
      alert("ID/パスワードを更新しました。");
    } catch (err: unknown) {
      console.error("ID/Password update failed:", err);
      const fbErr = err as FirebaseError;
      if (fbErr?.code === "auth/operation-not-allowed") {
        alert("Firebaseコンソールで Email/Password 認証を有効にしてください。");
        return;
      }
      if (fbErr?.code === "auth/requires-recent-login") {
        alert("もう一度サインインしてから設定してください。（Google/LINEで一度サインインし直してください）");
        return;
      }
      if (fbErr?.code === "auth/credential-already-in-use" || fbErr?.code === "auth/email-already-in-use") {
        alert("そのIDは既に使われています。別のIDにしてください。");
        return;
      }
      alert("ID/パスワードの設定に失敗しました。");
    }
  };
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(selectedDate, { weekStartsOn: 0 }), i));
  const weekDayAvails = weekDays.map(day => displayedAvailabilities.filter(a => isSameDay(parseISO(a.date), day)));
  const lineAvatarOption = currentUser?.line_picture ? [currentUser.line_picture] : [];
  const avatarOptions = [...lineAvatarOption, ...presetAvatars];
  const visibleAvatars = showAllAvatars ? avatarOptions : avatarOptions.slice(0, 8);

  const createNotification = async (userId: string, type: Notification["type"], message: string, date?: string) => {
    await addDoc(collection(db, "notifications"), {
      user_id: userId,
      type,
      message,
      date,
      timestamp: serverTimestamp(),
      read: false
    });
  };

  const sendLineNotification = async (lineUserId: string | undefined, message: string): Promise<LineNotificationResult> => {
    if (!lineUserId) {
      return {
        success: false,
        reason: "line_user_missing",
        details: "受信側がLINE未連携のため通知していません。",
      };
    }

    try {
      const response = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId, message })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.success === false) {
        const reason = (data?.reason as LineNotificationReason | undefined) || "push_failed";
        const details = typeof data?.details === "string" ? data.details : response.statusText;
        console.warn("LINE notification failed:", JSON.stringify(data || { statusText: response.statusText }));
        return {
          success: false,
          reason,
          details,
          raw: data,
        };
      }
      return {
        success: true,
        reason: (data?.reason as LineNotificationReason | undefined) || "delivered",
        details: typeof data?.details === "string" ? data.details : "公式LINEから通知しました。",
        raw: data,
      };
    } catch (error: unknown) {
      console.warn("LINE notification failed:", error);
      return {
        success: false,
        reason: "network_error",
        details: "通知処理の通信に失敗したため送れませんでした。",
        raw: error,
      };
    }
  };

  const describeLineNotificationResult = (result: LineNotificationResult) => {
    switch (result.reason) {
      case "delivered":
        return "公式LINEから通知しました。";
      case "config_missing":
      case "invalid_token":
        return "公式LINEの設定不足で通知できませんでした。";
      case "line_user_missing":
        return "受信側がLINE未連携のため通知していません。";
      case "not_authorized":
        return "公式LINEの権限不足で通知できませんでした。";
      case "not_following_or_blocked":
        return "公式LINEはありますが、友だち追加されていないか、ブロックされています。";
      case "profile_not_found":
        return "通知先のLINEユーザーが見つからないため送れませんでした。";
      case "push_failed":
        return "公式LINEから通知できませんでした。";
      case "network_error":
      default:
        return "通知処理の通信に失敗したため送れませんでした。";
    }
  };

  const buildLineNotificationAlert = (result: LineNotificationResult) => {
    const statusLine = result.success ? "LINE通知: 送信できました。" : `LINE通知: ${describeLineNotificationResult(result)}`;
    const detailsLine = result.details && !statusLine.includes(result.details) ? `\n${result.details}` : "";
    return `${statusLine}${detailsLine}`;
  };

  const handleUnlinkLine = async () => {
    if (!currentUser) return;
    if (!isGoogleSignedIn && currentUser.line_user_id) {
      alert("LINE連携を解除するとログイン手段がなくなります。Google連携を先に追加してください。");
      return;
    }
    await updateDoc(doc(db, "users", currentUser.uid), {
      line_user_id: null,
      notification_pref: "none",
    });
    setCurrentUser({ ...currentUser, line_user_id: undefined, notification_pref: "none" });
    alert("LINE連携を解除しました。");
  };

  const handleUnlinkGoogle = async () => {
    if (!auth.currentUser) return;
    if (!isLineSignedIn && auth.currentUser.providerData.some(provider => provider.providerId === "google.com")) {
      alert("Google連携を解除するとログイン手段がなくなります。LINE連携を先に追加してください。");
      return;
    }
    try {
      await unlink(auth.currentUser, "google.com");
      await updateDoc(doc(db, "users", auth.currentUser.uid), { google_email: deleteField() });
      if (currentUser) setCurrentUser({ ...currentUser, google_email: undefined });
      alert("Google連携を解除しました。");
    } catch (error: unknown) {
      console.error("Google unlink error:", error);
      const errMsg = error instanceof Error && error.message.includes("requires-recent-login")
        ? "もう一度サインインしてから解除してください。"
        : "Google連携の解除に失敗しました。";
      alert(errMsg);
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    setSelectedAvatar(currentUser.avatar_url || pickRandomAvatar());
  }, [currentUser?.uid, currentUser?.avatar_url]);
  
  useEffect(() => {
    const handleResize = () => {}; // No longer needed for isDesktop
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Data Migration
  const migrateUserData = useCallback(async (oldUid: string, newUid: string) => {
    console.log(`Migrating data from ${oldUid} to ${newUid}`);
    const collectionsToMigrate = [
      { name: "availabilities", field: "user_id" },
      { name: "requests", field: "staff_id" },
      { name: "requests", field: "manager_id" },
      { name: "connections", field: "user1_id" },
      { name: "connections", field: "user2_id" },
      { name: "notifications", field: "user_id" },
      { name: "presets", field: "user_id" }
    ];

    for (const colInfo of collectionsToMigrate) {
      try {
        const snap = await getDocs(query(collection(db, colInfo.name), where(colInfo.field, "==", oldUid)));
        if (snap.empty) continue;
        const batch = writeBatch(db);
        snap.docs.forEach(d => {
          batch.update(doc(db, colInfo.name, d.id), { [colInfo.field]: newUid });
        });
        await batch.commit();
      } catch (err) {
        console.error(`Failed to migrate collection ${colInfo.name}:`, err);
      }
    }
  }, []);

  const processLineProfile = useCallback(async (profile: { userId: string, displayName: string, pictureUrl?: string }) => {
    if (!profile) return;
    setIsProcessingLine(true);
    try {
      const tokenRes = await fetch("/api/auth/line/firebase-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.customToken) {
        throw new Error(tokenData.error || "Failed to create custom token");
      }
      console.log("LINE token debug:", tokenData.debug);

      await signInWithCustomToken(auth, tokenData.customToken);
      
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error("Firebase login failed");
      
      const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
      if (userDoc.exists()) {
        const existingData = userDoc.data() as UserProfile;
        const updatedProfile = {
          ...existingData,
          uid: firebaseUser.uid,
          name: existingData.name || profile.displayName || "User",
          line_user_id: profile.userId,
          line_picture: profile.pictureUrl,
          avatar_url: existingData.avatar_url,
          notification_pref: "line"
        };
        await updateDoc(doc(db, "users", firebaseUser.uid), {
          line_user_id: profile.userId,
          line_picture: profile.pictureUrl,
          notification_pref: "line",
          name: existingData.name || profile.displayName || "User"
        });
        setCurrentUser(updatedProfile);
      } else {
        const newProfile: UserProfile = {
          uid: firebaseUser.uid,
          search_id: "",
          name: profile.displayName || "User",
          email: firebaseUser.email || "",
          role: "staff",
          current_role: "staff",
          share_token: Math.random().toString(36).substring(2, 15),
          accept_requests: true,
          line_user_id: profile.userId,
          line_picture: profile.pictureUrl,
          avatar_url: "",
          notification_pref: "line",
          share_period_days: 7,
          share_paused: false
        };
        await setDoc(doc(db, "users", firebaseUser.uid), newProfile);
        setCurrentUser(newProfile);
      }
      setIsLoggedIn(true);
    } catch (error: unknown) {
      console.error("LINE login processing error:", error);
    } finally {
      setIsProcessingLine(false);
      setIsAuthReady(true);
    }
  }, [migrateUserData]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          if (isProcessingLine) return;

          // If Googleで入ってきて、既存の本体アカウントがあればそちらに即切替
          const isGoogleProvider = user.providerData.some(p => p.providerId === "google.com");
          if (isGoogleProvider && user.email) {
            const existing = await getDocs(query(collection(db, "users"), where("google_email", "==", user.email)));
            if (!existing.empty) {
              const targetUid = existing.docs[0].data().uid || existing.docs[0].id;
              if (targetUid && targetUid !== user.uid) {
                try {
                  const tokenRes = await fetch("/api/auth/google/firebase-token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ uid: targetUid }),
                  });
                  const tokenData = await tokenRes.json();
                  if (tokenRes.ok && tokenData.customToken) {
                    await signInWithCustomToken(auth, tokenData.customToken);
                    return;
                  }
                } catch (linkErr) {
                  console.warn("Failed to swap to existing Google-linked account:", linkErr);
                }
              }
            }
          }

          let userDoc = await getDoc(doc(db, "users", user.uid));
          if (!userDoc.exists()) {
            const derivedId = (user.email || "").split("@")[0] || "";
            const newProfile: UserProfile = {
              uid: user.uid,
              search_id: derivedId,
              name: user.displayName || "クルー",
              email: user.email || "",
              role: "staff",
              current_role: "staff",
              share_token: Math.random().toString(36).substring(2, 15),
              accept_requests: true,
              avatar_url: "",
              share_period_days: 7,
              share_paused: false
            };
            await setDoc(doc(db, "users", user.uid), newProfile);
            userDoc = await getDoc(doc(db, "users", user.uid));
          }
          const profile = userDoc.data() as UserProfile;
          setCurrentUser(profile);
          setIsLoggedIn(true);
          setNewName(profile.name);
          setIsAuthReady(true);
        } else {
          setCurrentUser(null);
          setIsLoggedIn(false);
          setIsAuthReady(true);
        }
      } catch (error: unknown) {
        console.error("Auth error:", error);
      }
    });

    const urlParams = new URLSearchParams(window.location.search);
    const shareToken = urlParams.get('share');
    if (shareToken) {
      fetchPublicData(shareToken);
      setIsPublicView(true);
    }

    const lineUserParam = urlParams.get('line_user');
    if (lineUserParam && lineUserParam !== "undefined") {
      try {
        processLineProfile(JSON.parse(decodeURIComponent(lineUserParam)));
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (err) {
        console.error("Failed to parse line_user param:", err);
      }
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'LINE_AUTH_SUCCESS') {
        processLineProfile(event.data.profile);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => {
      unsubscribe();
      window.removeEventListener('message', handleMessage);
    };
  }, [isProcessingLine, processLineProfile]);

  // Real-time Listeners
  useEffect(() => {
    if (!currentUser?.uid || !auth.currentUser) return;

    const unsubAvail = onSnapshot(
      query(collection(db, "availabilities"), where("user_id", "==", currentUser.uid), orderBy("date", "asc")),
      (snap) => setAvailabilities(snap.docs.map(d => ({ id: d.id, ...d.data() } as Availability))),
      (err) => handleFirestoreError(err, OperationType.LIST, "availabilities")
    );

    const unsubStaffReq = onSnapshot(
      query(collection(db, "requests"), where("staff_id", "==", currentUser.uid)),
      (snap) => {
        const staffReqs = snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftRequest));
        setRequests(prev => {
          const others = prev.filter(r => r.manager_id === currentUser.uid && r.staff_id !== currentUser.uid);
          return [...staffReqs, ...others];
        });
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "requests")
    );

    const unsubManagerReq = onSnapshot(
      query(collection(db, "requests"), where("manager_id", "==", currentUser.uid)),
      (snap) => {
        const managerReqs = snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftRequest));
        setRequests(prev => {
          const others = prev.filter(r => r.staff_id === currentUser.uid && r.manager_id !== currentUser.uid);
          return [...others, ...managerReqs];
        });
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "requests")
    );

    // Non-realtime fetch to抑制 read 回数
    (async () => {
      try {
        const notifSnap = await getDocs(query(collection(db, "notifications"), where("user_id", "==", currentUser.uid), orderBy("timestamp", "desc"), limit(20)));
        setNotifications(notifSnap.docs.map(d => ({ id: d.id, ...d.data() } as Notification)));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, "notifications");
      }
      try {
        const c1snap = await getDocs(query(collection(db, "connections"), where("user1_id", "==", currentUser.uid)));
        const c2snap = await getDocs(query(collection(db, "connections"), where("user2_id", "==", currentUser.uid)));
        const c1 = c1snap.docs.map(d => ({ id: d.id, ...d.data() } as Connection));
        const c2 = c2snap.docs.map(d => ({ id: d.id, ...d.data() } as Connection));
        setConnections([...c1, ...c2]);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, "connections");
      }
      try {
        const presetSnap = await getDocs(query(collection(db, "presets"), where("user_id", "==", currentUser.uid)));
        setPresets(presetSnap.docs.map(d => ({ id: d.id, ...d.data() } as Preset)));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, "presets");
      }
    })();

    const unsubUser = onSnapshot(
      doc(db, "users", currentUser.uid),
      (snap) => {
        if (snap.exists()) {
          const profile = snap.data() as UserProfile;
          setCurrentUser(profile);
          setNewName(profile.name);
        }
      },
      (err) => handleFirestoreError(err, OperationType.READ, "users")
    );

    return () => {
      unsubAvail();
      unsubStaffReq();
      unsubManagerReq();
      unsubUser();
    };
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    getDocs(query(collection(db, "notifications"), where("user_id", "==", currentUser.uid))).then(snap => {
      const batch = writeBatch(db);
      let hasDeletes = false;
      snap.docs.forEach(d => {
        const data = d.data() as Notification;
        const ts = data.timestamp as Timestamp | Date | null | undefined;
        const time = ts instanceof Timestamp ? ts.toDate().getTime() : ts instanceof Date ? ts.getTime() : 0;
        if (time && time < cutoff) {
          batch.delete(doc(db, "notifications", d.id));
          hasDeletes = true;
        }
      });
      if (hasDeletes) return batch.commit();
    }).catch(() => {});
  }, [currentUser?.uid]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (bellRef.current && !bellRef.current.contains(target)) setShowBellDropdown(false);
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(target)) setShowMobileMenu(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) {
      setConnectionUsers([]);
      return;
    }

    const peerIds = Array.from(new Set(
      connections
        .map(conn => [conn.user1_id, conn.user2_id].find(id => id !== currentUser.uid))
        .filter((id): id is string => Boolean(id))
    ));

    Promise.all(peerIds.map(async (peerId) => {
      const snap = await getDoc(doc(db, "users", peerId));
      return snap.exists() ? (snap.data() as UserProfile) : null;
    })).then(users => {
      setConnectionUsers(users.filter((u): u is UserProfile => Boolean(u)));
    }).catch(err => {
      console.error("Failed to load connection users:", err);
    });
  }, [currentUser?.uid, connections]);

  useEffect(() => {
    if (!isPublicView || !currentUser?.uid || !publicUser?.uid) return;
    if (currentUser.uid === publicUser.uid) return;

    const pairId = [currentUser.uid, publicUser.uid].sort().join("_");
    setDoc(doc(db, "connections", pairId), {
      user1_id: currentUser.uid,
      user2_id: publicUser.uid,
      status: "active"
    }, { merge: true }).catch(err => {
      console.error("Auto follow failed:", err);
    });
  }, [isPublicView, currentUser?.uid, publicUser?.uid]);

  // Public View Listeners
  useEffect(() => {
    if (!isPublicView || !publicUser?.uid) return;

    const unsubPublicUser = onSnapshot(
      doc(db, "users", publicUser.uid),
      (snap) => {
        if (snap.exists()) {
          setPublicUser(snap.data() as UserProfile);
        }
      }
    );

    const unsubPublicAvail = onSnapshot(
      query(collection(db, "availabilities"), where("user_id", "==", publicUser.uid), orderBy("date", "asc")),
      (snap) => setAvailabilities(snap.docs.map(d => ({ id: d.id, ...d.data() } as Availability)))
    );

    return () => {
      unsubPublicUser();
      unsubPublicAvail();
    };
  }, [isPublicView, publicUser?.uid]);

  // Handlers
  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const sourceUid = auth.currentUser?.uid;
      const result = await signInWithPopup(auth, provider);
      const googleEmail = result.user.email || "";
      const matchingGoogleUser = googleEmail
        ? await getDocs(query(collection(db, "users"), where("google_email", "==", googleEmail)))
        : null;
      const targetUid = sourceUid || (!matchingGoogleUser?.empty ? matchingGoogleUser.docs[0].data().uid : result.user.uid);
      let migrationPerformed = false;

      if (result.user.uid !== targetUid) {
        const googleUserDoc = await getDoc(doc(db, "users", result.user.uid));
        if (googleUserDoc.exists()) {
          await migrateUserData(result.user.uid, targetUid);
          migrationPerformed = true;
          try {
            await deleteDoc(doc(db, "users", result.user.uid));
          } catch (cleanupError) {
            console.warn("Google auth user cleanup skipped:", cleanupError);
          }
        }
      }

      const tokenRes = await fetch("/api/auth/google/firebase-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: targetUid }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.customToken) {
        throw new Error(tokenData.error || "Failed to create google custom token");
      }

      await signInWithCustomToken(auth, tokenData.customToken);
      await setDoc(doc(db, "users", targetUid), {
        uid: targetUid,
        google_email: googleEmail,
      }, { merge: true });

      if (migrationPerformed) {
        alert("Google連携を本アカウントに統合しました。");
      }
    } catch (err) {
      console.error("Google login error:", err);
      alert("Google連携に失敗しました。別アカウントに既に連携済みの可能性があります。");
    }
  };
  const handleEmailAuth = async () => {
    setAuthMessage("");
    try {
      const id = normalizeAuthId(authId);
      const name = registerName.trim();
      if (id.length < 8) {
        setAuthMessage("IDは8文字以上にしてください。");
        return;
      }
      if (!authPassword) {
        setAuthMessage("パスワードを入力してください。");
        return;
      }
      if (authMode === "register") {
        if (!name) {
          setAuthMessage("名前を入力してください。");
          return;
        }
        const exists = await getDocs(query(collection(db, "users"), where("search_id", "==", id)));
        if (!exists.empty) {
          setAuthMessage("そのIDはすでに使われています。別のIDを指定してください。");
          return;
        }
        const cred = await createUserWithEmailAndPassword(auth, toAuthEmail(id), authPassword);
        await updateProfile(cred.user, { displayName: name });
        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          search_id: id,
          name,
          email: toAuthEmail(id),
          role: "staff",
          current_role: "staff",
          share_token: Math.random().toString(36).substring(2, 15),
          accept_requests: true,
          avatar_url: "",
          share_period_days: 7
        }, { merge: true });
      } else {
        await signInWithEmailAndPassword(auth, toAuthEmail(id), authPassword);
      }
    } catch (err) {
      console.error("Email auth error:", err);
      setAuthMessage(err instanceof Error ? err.message : (authMode === "register" ? "会員登録に失敗しました。" : "ログインに失敗しました。"));
    }
  };
  const handleLineLogin = async () => {
    try {
      const res = await fetch("/api/auth/line/url");
      const data = await res.json();
      if (data.url) {
        if (window.innerWidth < 768) window.location.href = data.url;
        else window.open(data.url, "line_auth", "width=500,height=600");
      }
    } catch (e) { console.error(e); }
  };

  const fetchPublicData = async (token: string) => {
    try {
      const q = query(collection(db, "users"), where("share_token", "==", token));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const userData = snap.docs[0].data() as UserProfile;
        setPublicUser(userData);
      }
    } catch (e) { console.error(e); }
  };

  const handleSaveAvailability = async () => {
    if (!currentUser) return;
    setIsSaving(true);
    try {
      const payload = {
        user_id: currentUser.uid,
        user_name: currentUser.name,
        date: draftDate,
        start_time: draftTime.start,
        end_time: draftTime.end,
        status: draftStatus,
        note: draftNote,
        is_recurring: draftIsRecurring,
      };

      if (editingAvailability) {
        if (editingAvailability.loop_group_id && draftIsRecurring && (draftTime.start !== editingAvailability.start_time || draftTime.end !== editingAvailability.end_time)) {
          const applyToSeries = window.confirm("この予定はループ予定です。変更を系列全体に反映しますか？\n「キャンセル」を押すとこの日だけ変更します。");
          if (applyToSeries) {
            const snap = await getDocs(query(collection(db, "availabilities"), where("loop_group_id", "==", editingAvailability.loop_group_id)));
            const batch = writeBatch(db);
            snap.docs.forEach(d => {
              const current = d.data() as Availability;
              batch.update(doc(db, "availabilities", d.id), {
                user_id: currentUser.uid,
                user_name: currentUser.name,
                start_time: payload.start_time,
                end_time: payload.end_time,
                status: payload.status,
                note: payload.note,
                is_recurring: payload.is_recurring,
              });
            });
            await batch.commit();
          } else {
            await updateDoc(doc(db, "availabilities", editingAvailability.id), payload);
          }
        } else {
          await updateDoc(doc(db, "availabilities", editingAvailability.id), payload);
        }
      } else {
        if (draftIsRecurring) {
          const loopGroupId = Math.random().toString(36).substring(2, 15);
          const batch = writeBatch(db);
          Array.from({ length: 8 }, (_, i) => addDays(parseISO(draftDate), i * 7)).forEach(date => {
            const ref = doc(collection(db, "availabilities"));
            batch.set(ref, {
              ...payload,
              date: format(date, "yyyy-MM-dd"),
              loop_group_id: loopGroupId,
              is_recurring: true,
              created_at: serverTimestamp(),
            });
          });
          await batch.commit();
        } else {
          await addDoc(collection(db, "availabilities"), {
            ...payload,
            created_at: serverTimestamp()
          });
        }
      }

      closeAvailabilityModal();
      setLastNewDraft({
        date: draftDate,
        time: draftTime,
        note: draftNote,
        status: draftStatus,
        isRecurring: draftIsRecurring,
      });
    } catch (e: unknown) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAvailability = async (id: string) => {
    try {
      await deleteDoc(doc(db, "availabilities", id));
    } catch (err: unknown) {
      console.error("Delete availability error:", err);
    }
  };

  const openRequestModal = (availability: Availability) => {
    setRequestTarget(availability);
    setRequestStart(availability.start_time);
    setRequestEnd(availability.end_time);
    setShowRequestModal(true);
  };

  const handleSendRequest = async (availability: Availability, startTime: string, endTime: string) => {
    if (!currentUser) return;
    try {
      const reqData = {
        staff_id: availability.user_id,
        staff_name: availability.user_name,
        manager_id: currentUser.uid,
        manager_name: currentUser.name,
        availability_id: availability.id,
        date: availability.date,
        start_time: availability.start_time,
        end_time: availability.end_time,
        requested_start_time: startTime,
        requested_end_time: endTime,
        status: "pending",
        created_at: serverTimestamp()
      };
      const requestRef = await addDoc(collection(db, "requests"), reqData);

      await createNotification(
        availability.user_id,
        "request",
        `${currentUser.name}さんから依頼が届きました。${availability.date} ${availability.start_time}-${availability.end_time}`, 
        availability.date
      );
      alert("依頼を送信しました。");
      console.log("request created:", requestRef.id);
    } catch (e: unknown) {
      console.error(e);
    }
  };

  const handleOpenNotifications = async () => {
    const opening = !showBellDropdown;
    setShowBellDropdown(opening);
    try {
      const unread = notifications.filter(n => !n.read);
      if (opening && unread.length > 0) {
        const batch = writeBatch(db);
        unread.forEach(n => batch.update(doc(db, "notifications", n.id), { read: true }));
        await batch.commit();
      }
    } catch (err) {
      console.error("Failed to mark notifications as read:", err);
    }
  };

  const handleApproveRequest = async (request: ShiftRequest) => {
    if (!currentUser) return;
    await updateDoc(doc(db, "requests", request.id), { status: "approved" });
    await updateDoc(doc(db, "availabilities", request.availability_id), { status: "confirmed" });
    await createNotification(
      request.manager_id,
      "approval",
      `${currentUser.name}さんが依頼を承認しました。${request.date} ${request.start_time}-${request.end_time}`, 
      request.date
    );
    alert("承認しました。");
  };

  const handleRejectRequest = async (request: ShiftRequest) => {
    if (!currentUser) return;
    await updateDoc(doc(db, "requests", request.id), { status: "canceled" });
    await updateDoc(doc(db, "availabilities", request.availability_id), { status: "open" });
    await createNotification(
      request.manager_id,
      "decline",
      `${currentUser.name}さんが依頼を削除しました。${request.date} ${request.start_time}-${request.end_time}`, 
      request.date
    );
    alert("辞退しました。");
  };

  const handleRefreshShareToken = async () => {
    if (!currentUser) return;
    const nextToken = Math.random().toString(36).substring(2, 15);
    await updateDoc(doc(db, "users", currentUser.uid), { share_token: nextToken });
    setCurrentUser({ ...currentUser, share_token: nextToken });
    alert("招待URLを更新しました。");
  };

  const handleSaveAvatar = async (avatarUrl: string) => {
    if (!currentUser) return;
    await updateDoc(doc(db, "users", currentUser.uid), { avatar_url: avatarUrl });
    setCurrentUser({ ...currentUser, avatar_url: avatarUrl });
    setSelectedAvatar(avatarUrl);
    setShowAvatarToast(true);
    setTimeout(() => setShowAvatarToast(false), 2500);
  };

  const handleUpdateSharePeriod = async (days: 7 | 14 | 30) => {
    if (!currentUser) return;
    await updateDoc(doc(db, "users", currentUser.uid), { share_period_days: days });
    setCurrentUser({ ...currentUser, share_period_days: days });
  };

  const handleUnfollow = async (peerId: string) => {
    if (!currentUser) return;
    const pairId = [currentUser.uid, peerId].sort().join("_");
    await deleteDoc(doc(db, "connections", pairId));
    setConnections(prev => prev.filter(c => !(c.user1_id === currentUser.uid && c.user2_id === peerId) && !(c.user2_id === currentUser.uid && c.user1_id === peerId)));
  };

  const handleBlock = async (peerId: string) => {
    if (!currentUser) return;
    const pairId = [currentUser.uid, peerId].sort().join("_");
    await setDoc(doc(db, "connections", pairId), {
      user1_id: currentUser.uid,
      user2_id: peerId,
      status: "blocked",
      blocked_by: currentUser.uid
    }, { merge: true });
  };

  const handleUnblock = async (peerId: string) => {
    if (!currentUser) return;
    const pairId = [currentUser.uid, peerId].sort().join("_");
    await setDoc(doc(db, "connections", pairId), {
      user1_id: currentUser.uid,
      user2_id: peerId,
      status: "active",
      blocked_by: ""
    }, { merge: true });
  };

  const handleToggleSharePause = async () => {
    if (!currentUser) return;
    const next = !currentUser.share_paused;
    await updateDoc(doc(db, "users", currentUser.uid), { share_paused: next });
    setCurrentUser({ ...currentUser, share_paused: next });
  };

  const scrollToSection = (target: React.RefObject<HTMLDivElement | null>) => {
    target.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const copyShareLink = () => {
    if (!currentUser) return;
    navigator.clipboard.writeText(shareLink);
    alert("共有リンクをコピーしました。");
  };

  // Renderers
  if (!isAuthReady) return (
    <div className="min-h-screen bg-blue-50 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!isLoggedIn && !isPublicView) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md space-y-12 text-center">
          <div className="space-y-4">
            <img
              src={CHOICREW_LOGO}
              alt="ChoiCrew logo"
              className="w-full max-w-[320px] mx-auto drop-shadow-[0_24px_40px_rgba(37,99,235,0.16)]"
            />
            <p className="text-xl text-gray-500 font-medium">
              空いた時間を、既知の相手にかんたんに公開できます。
            </p>
          </div>

          <div className="space-y-4 text-left">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setAuthMode("login")}
                  className={`py-3 rounded-2xl font-bold transition-colors ${authMode === "login" ? "bg-white shadow text-gray-900" : "text-gray-500"}`}
                >
                  ログイン
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("register")}
                  className={`py-3 rounded-2xl font-bold transition-colors ${authMode === "register" ? "bg-white shadow text-gray-900" : "text-gray-500"}`}
                >
                  会員登録
                </button>
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-bold text-gray-600">ID</span>
                <input
                  type="text"
                  value={authId}
                  onChange={(e) => setAuthId(e.target.value)}
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="8文字以上のID"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-bold text-gray-600">パスワード</span>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="8文字以上推奨"
                />
              </label>

              {authMode === "register" && (
                <>
                  <label className="block space-y-2">
                    <span className="text-sm font-bold text-gray-600">名前</span>
                    <input
                      type="text"
                      value={registerName}
                      onChange={(e) => setRegisterName(e.target.value)}
                      className="w-full rounded-2xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      placeholder="山田 太郎"
                    />
                  </label>
                </>
              )}

              <Button
                onClick={handleEmailAuth}
                variant="primary"
                icon={ArrowRight}
                className="py-5 text-lg w-full"
              >
                {authMode === "register" ? "IDで会員登録" : "IDでログイン"}
              </Button>
              {authMessage && <p className="text-sm text-red-500 font-medium">{authMessage}</p>}
            </div>

            {!isLoggedIn && (
              <>
                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
                  <div className="relative flex justify-center text-sm"><span className="px-4 bg-[#F8FAFC] text-gray-400">または</span></div>
                </div>

                <div className="grid gap-4">
                  <Button onClick={handleLineLogin} variant="line" icon={MessageCircle} className="py-5 text-lg">
                    LINEでログイン
                  </Button>
                  <Button onClick={handleGoogleLogin} variant="outline" icon={User} className="py-5 text-lg">
                    Googleでログイン
                  </Button>
                </div>
              </>
            )}
            {isLoggedIn && (
                <p className="text-center text-gray-500 font-medium mt-4">すでにサインイン済みです。</p>
              )}
          </div>

          <p className="text-sm text-gray-400">
            続行すると、利用規約とプライバシーポリシーに同意したことになります。
          </p>
        </div>
      </div>
    );
  }

  if (isPublicView && publicUser) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] p-6 lg:p-12">
        <div className="max-w-2xl mx-auto space-y-8">
          <div className="space-y-4">
            <img 
              src={CHOICREW_LOGO}
              alt="ChoiCrew logo"
              className="w-36 shrink-0 drop-shadow-[0_18px_32px_rgba(37,99,235,0.14)]"
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-black tracking-tight">{publicUser.name}さんの予定</h1>
                {isOwnPreview && (
                  <button
                    onClick={async () => {
                      if (!currentUser) return;
                      setNameEditValue(currentUser.name || publicUser.name || "");
                      setShowNameEditModal(true);
                    }}
                    className="p-2 rounded-full hover:bg-blue-50 text-blue-600"
                    aria-label="名前を編集"
                  >
                    <Pencil size={18} />
                  </button>
                )}
              </div>
              <p className="text-gray-500 font-medium">URLを共有して、予定を見てもらえます。</p>
              <p className="text-sm text-red-500 font-semibold">ユーザー設定により{publicSharePeriodDays}日分を表示しています。</p>
            </div>
          </div>

          {isOwnPreview && (
            <Card className="p-4 bg-blue-50 border-blue-100">
              <p className="font-bold text-blue-700 flex items-center gap-2"><Eye size={16} />ログイン中のあなたのページです。</p>
            </Card>
          )}

          <div className="space-y-4">
            <h3 className="text-xl font-black">公開中の空き時間</h3>
            <div className="grid gap-4">
              {isPublicHidden ? (
                <div className="py-12 text-center bg-white rounded-3xl border border-dashed border-gray-200 text-gray-500 font-bold">
                  現在このユーザーの予定は非公開です。
                </div>
              ) : publicScheduleDates.length > 0 ? (
                publicScheduleDates.map(date => (
                  <div key={date} className="space-y-3">
                    <div className="pb-2 border-b border-gray-200">
                      <p className="text-lg font-black">{format(parseISO(date), "M月d日 (E)", { locale: ja })}</p>
                    </div>
                    <div className="grid gap-3">
                      {groupedPublicAvailabilities[date].map(a => {
                        const isBusy = a.status === "confirmed" || a.status === "busy";
                        const isMyPendingRequest = isPendingMyRequest(a.id);
                        const isMyApprovedRequest = isApprovedMyRequest(a.id);
                        const buttonLabel = isBusy
                          ? "依頼を送る"
                          : isMyApprovedRequest
                            ? "キャンセル依頼"
                            : isMyPendingRequest
                              ? "交渉中"
                              : "依頼を送る";
                        return (
                        <Card key={a.id} className={`p-4 sm:p-6 flex items-center justify-between gap-4 ${isBusy ? "opacity-55 grayscale" : ""}`}>
                          <div className="min-w-0 flex-1">
                            <p className="text-xl font-black">{a.start_time} - {a.end_time}</p>
                            {a.note && <p className="text-sm text-red-500 font-semibold mt-1">{a.note}</p>}
                            {isBusy && <p className="text-xs text-gray-400 mt-1">予定あり</p>}
                            {isMyPendingRequest && <p className="text-xs text-blue-600 mt-1">交渉中</p>}
                            {isMyApprovedRequest && <p className="text-xs text-amber-600 mt-1">承認済み</p>}
                          </div>
                          <button
                            onClick={async () => {
                              if (isBusy) {
                                alert("この予定はすでに埋まっています。");
                                return;
                              }
                              if (isOwnPreview) {
                                alert("これは自分のプレビューです。依頼は不要です。");
                                return;
                              }
                              if (!isLoggedIn) {
                                alert("依頼を送るにはログインが必要です。");
                                return;
                              }
                              if (isMyPendingRequest) {
                                alert("他のひとが交渉中です。");
                                return;
                              }
                              if (isMyApprovedRequest) {
                                const req = requests.find(r => r.availability_id === a.id && r.staff_id === currentUser?.uid && r.status === "approved");
                                if (req && window.confirm("キャンセル依頼しますか？")) await handleRejectRequest(req);
                                return;
                              }
                              openRequestModal(a);
                            }}
                            className={`px-4 py-3 rounded-2xl font-black border whitespace-nowrap ${isBusy || isOwnPreview ? "border-blue-100 text-blue-300 bg-blue-50" : "border-blue-200 text-blue-600 bg-white"}`}
                          >
                            {buttonLabel}
                          </button>
                        </Card>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-12 text-center bg-white rounded-3xl border border-dashed border-gray-200 text-gray-400 font-bold">
                  予定はまだありません
                </div>
              )}
            </div>
          </div>

          <Card className="p-5 bg-blue-50 border-blue-100">
            <p className="text-sm font-black text-blue-700">使い方</p>
            <ul className="mt-2 space-y-1 text-sm text-blue-700 list-disc list-inside">
              <li>URLで共有</li>
              <li>空き時間を確認</li>
              <li>ログイン中は依頼、未ログインは確認のみ</li>
            </ul>
          </Card>

          <div className="pt-8 border-t border-gray-100 flex flex-col gap-3">
            {isOwnPreview ? (
              <Button onClick={() => window.location.href = window.location.origin} variant="outline">スケジュールに戻る</Button>
            ) : !isLoggedIn ? (
              <div className="px-4 py-3 rounded-2xl bg-blue-50 text-blue-700 text-sm font-semibold">ログインすると依頼ができます。</div>
            ) : null}
            {!isLoggedIn && (
              <div className="text-center">
                <p className="text-gray-400 mb-4 font-medium">あなたもChoiCrewで予定を管理してみませんか。</p>
                <Button onClick={() => window.location.href = window.location.origin} variant="primary">自分でも使ってみる</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-gray-900 font-sans">
      {/* Sidebar Desktop */}
      <aside className="fixed left-0 top-0 bottom-0 w-72 bg-white border-r border-gray-100 hidden lg:flex flex-col p-8 z-20">
        <div className="mb-12">
          <img
            src={CHOICREW_LOGO}
            alt="ChoiCrew logo"
            className="w-full max-w-[190px]"
          />
        </div>

        <nav className="space-y-2 flex-1">
          {[
            { id: "myboard", label: "マイボード", icon: Calendar },
            { id: "friends", label: "フレンド", icon: Users },
            { id: "settings", label: "設定", icon: Settings },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id as "myboard" | "friends" | "settings")}
              className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl font-bold transition-all ${view === item.id ? "bg-blue-50 text-blue-600" : "text-gray-400 hover:bg-gray-50 hover:text-gray-600"}`}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>

          <div className="pt-8 border-t border-gray-100">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-gray-100 rounded-full overflow-hidden flex items-center justify-center">
                {avatarSrc ? <img src={avatarSrc} alt="avatar" /> : <User size={24} className="text-gray-400" />}
              </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold truncate">{currentUser?.name}</p>
              <p className="text-xs text-gray-400 truncate">{accountLabel}</p>
            </div>
            </div>
          </div>
      </aside>

      {/* Main Content */}
      <main className={`lg:ml-72 min-h-screen pb-28 lg:pb-12`}>
        {/* Header */}
        <header className="sticky top-0 z-10 bg-[#F8FAFC]/80 backdrop-blur-md px-6 py-5 lg:px-12 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 lg:gap-3 min-w-0">
            <button
              className="lg:hidden w-11 h-11 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-gray-600"
              onClick={() => setShowMobileMenu(v => !v)}
            >
              <span className="sr-only">メニュー</span>
              <div className="space-y-1.5">
                <div className="w-4 h-0.5 bg-current rounded-full" />
                <div className="w-4 h-0.5 bg-current rounded-full" />
                <div className="w-4 h-0.5 bg-current rounded-full" />
              </div>
            </button>
            <img src={CHOICREW_LOGO} alt="ChoiCrew" className="lg:hidden h-10 w-auto shrink-0" />
            <h2 className="hidden lg:block text-sm font-bold text-gray-400 uppercase tracking-widest">
              {view === "myboard" ? "My Board" : view === "friends" ? "Friends" : "Preferences"}
            </h2>
            <h1 className="text-[0.95rem] lg:text-3xl font-black tracking-tight leading-none truncate">
              {view === "myboard" ? "マイボード" : view === "friends" ? "フレンド" : "設定"}
            </h1>
          </div>

          <div className="flex items-center gap-3 relative">
            <div ref={bellRef} className="relative">
              <button 
                onClick={handleOpenNotifications}
                className="w-12 h-12 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-50 relative"
              >
                <Bell size={20} />
                {notifications.some(n => !n.read) && (
                  <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
                )}
              </button>
              {showBellDropdown && (
                <div className="absolute right-0 top-14 z-20 w-[min(90vw,24rem)] bg-white rounded-3xl shadow-2xl border border-gray-100 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-black text-lg">通知</p>
                    <span className="text-xs text-gray-400">{notifications.length}件</span>
                  </div>
                  <div className="max-h-80 overflow-y-auto space-y-2">
                    {notifications.length > 0 ? notifications.map(notification => (
                      <div key={notification.id} className={`p-4 rounded-2xl border flex items-start justify-between gap-3 ${notification.read ? "bg-gray-50 border-gray-100" : "bg-blue-50 border-blue-100"}`}>
                        <div className="min-w-0">
                          <p className="text-sm font-bold">{notification.message}</p>
                          <p className="text-[11px] text-gray-400 mt-1">{notification.type}</p>
                        </div>
                        <button
                          onClick={async () => {
                            await deleteDoc(doc(db, "notifications", notification.id));
                            setNotificationFeedback("削除しました");
                            window.setTimeout(() => setNotificationFeedback(""), 1800);
                          }}
                          className="text-gray-300 hover:text-red-500"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )) : (
                      <p className="text-sm text-gray-400 p-4 text-center">通知はまだありません</p>
                    )}
                  </div>
                  {notificationFeedback && <p className="text-xs text-gray-400 px-1">{notificationFeedback}</p>}
                </div>
              )}
            </div>
            <Button onClick={() => openAvailabilityModal(undefined, selectedDate)} icon={Plus} className="hidden sm:flex">
              予定を追加
            </Button>
          </div>
        </header>

        <div className="px-4 sm:px-6 lg:px-12 max-w-[100rem] mx-auto">
          <AnimatePresence mode="wait">
            {view === "myboard" && (
              <motion.div 
                key="calendar"
                initial={false}
                animate={false}
                exit={false}
                className="grid grid-cols-1 lg:grid-cols-12 gap-8"
              >
                <Card className="lg:col-span-12 p-5 sm:p-8">
                  <div className="flex items-start justify-between mb-4 sm:mb-8 gap-3">
                    <div className="min-w-0">
                      {calendarMode === "day" ? (
                        <div className="leading-none">
                          <div className="text-[10px] sm:text-xs font-black text-gray-400">{format(selectedDate, "yyyy年", { locale: ja })}</div>
                          <h3 className="text-xl sm:text-2xl font-black leading-none">{format(selectedDate, "M月", { locale: ja })}</h3>
                        </div>
                      ) : (
                        <h3 className="text-xl sm:text-2xl font-black leading-none">{calendarMode === "week" ? format(selectedDate, "M月", { locale: ja }) : format(selectedDate, "yyyy年M月", { locale: ja })}</h3>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {["day", "week", "month"].map(mode => (
                        <button
                          key={mode}
                          onClick={() => setCalendarMode(mode as "day" | "week" | "month")}
                          className={`px-4 py-2 rounded-xl font-black ${calendarMode === mode ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-500"}`}
                        >
                          {mode === "day" ? "日" : mode === "week" ? "週" : "月"}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedDate(addMonths(selectedDate, -1))} className="p-3 rounded-xl hover:bg-gray-100"><ChevronLeft size={20}/></button>
                      <button onClick={() => setSelectedDate(addMonths(selectedDate, 1))} className="p-3 rounded-xl hover:bg-gray-100"><ChevronRight size={20}/></button>
                    </div>
                  </div>
                  
                  {calendarMode === "day" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => setSelectedDate(today)}
                          className="shrink-0 px-3 py-2 rounded-xl text-xs font-black bg-gray-50 text-gray-600 hover:bg-gray-100"
                        >
                          今日に戻る
                        </button>
                      </div>
                      <div ref={dayScrollRef} className="max-h-[72vh] overflow-y-auto pr-1 space-y-3 scroll-smooth">
                        {scrollCalendarDays.map((day, idx) => {
                          const items = displayedAvailabilities.filter(a => isSameDay(parseISO(a.date), day)).sort((a, b) => `${a.start_time}`.localeCompare(`${b.start_time}`));
                          const isToday = isSameDay(day, today);
                          const isPast = isBefore(startOfDay(day), startOfDay(today));
                          const isSelected = isSameDay(day, selectedDate);
                          return (
                            <div
                              key={day.toISOString()}
                              ref={el => { dayRowRefs.current[format(day, "yyyy-MM-dd")] = el; }}
                              className={`rounded-2xl border p-4 space-y-3 ${isSelected ? "border-blue-200 bg-blue-50/40 shadow-sm" : isPast ? "border-gray-200 bg-gray-100/80 opacity-70" : "border-gray-100 bg-gray-50/60"}`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className={`font-black text-base sm:text-lg ${isPast ? "text-gray-500" : day.getDay() === 0 ? "text-red-500" : day.getDay() === 6 ? "text-blue-500" : "text-gray-900"}`}>
                                    {format(day, "d(E)", { locale: ja })}
                                  </p>
                                  <p className="text-[11px] text-gray-400">
                                    {idx === 5 ? "今日" : isToday ? "現在" : isSelected ? "選択中" : ""}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button onClick={() => openAvailabilityModal(undefined, day)} variant="outline" className="px-3 py-2 h-9 text-xs" disabled={isPast}>追加</Button>
                                </div>
                              </div>
                              <div className="space-y-2">
                                {items.length > 0 ? items.map(item => (
                                  <button
                                    key={item.id}
                                    onClick={() => openAvailabilityModal(item)}
                                    className={`w-full text-left rounded-xl border px-3 py-2 shadow-sm transition-colors ${isPast ? "border-gray-200 bg-gray-50 text-gray-400" : item.status === "open" ? "border-dashed border-gray-300 bg-white text-gray-700" : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50"}`}
                                  >
                                    <div className="flex items-center justify-between gap-2 text-sm font-bold">
                                      <span>{item.start_time}-{item.end_time}</span>
                                      <span className="text-xs text-gray-500">{item.status === "confirmed" ? "確定" : item.status === "pending" ? "依頼中" : item.status === "busy" ? "予定あり" : "空き"}</span>
                                    </div>
                                    {item.note && <p className="text-xs text-gray-500 mt-1 truncate">{item.note}</p>}
                                  </button>
                                )) : (
                                  <div className="text-xs text-gray-400 bg-white border border-dashed border-gray-200 rounded-xl px-3 py-4 text-center">予定なし</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {calendarMode === "week" && (
                    <div className="mt-2 rounded-3xl border border-gray-100 bg-white/70 overflow-hidden">
                      <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-gray-900">週間ボード</p>
                          <p className="text-xs text-gray-400">空白時間は表示せず、予定ブロックだけを並べています。</p>
                        </div>
                        <p className="text-xs text-gray-400 font-medium">横幅広めで表示中</p>
                      </div>
                      <div className="overflow-x-auto">
                        <div className="min-w-[80rem] grid grid-cols-7 divide-x divide-gray-100">
                          {weekDays.map((day, dayIndex) => {
                            const items = weekDayAvails[dayIndex].slice().sort((a, b) => `${a.start_time}`.localeCompare(`${b.start_time}`));
                            return (
                              <div key={day.toISOString()} className="min-h-[20rem] p-4">
                                <div className="flex items-center justify-between gap-2 mb-3">
                                  <div>
                                    <p className={`text-sm font-black ${day.getDay() === 0 ? "text-red-500" : day.getDay() === 6 ? "text-blue-500" : "text-gray-900"}`}>
                                      {format(day, "M/d", { locale: ja })}
                                    </p>
                                    <p className="text-[10px] text-gray-400">{format(day, "E", { locale: ja })}</p>
                                  </div>
                                  <button onClick={() => openDayDetailModal(day)} className="text-[10px] font-black text-blue-600 hover:underline">
                                    詳細
                                  </button>
                                </div>
                                <div className="space-y-2">
                                  {items.length > 0 ? items.map((item, itemIndex) => (
                                    <button
                                      key={`${item.id}-${itemIndex}`}
                                      onClick={() => openAvailabilityModal(item)}
                                      className={`w-full rounded-2xl px-3 py-3 text-left text-xs font-bold shadow-sm border transition-all ${
                                        item.status === "confirmed"
                                          ? "bg-red-50 border-red-100 text-red-700"
                                          : item.status === "pending"
                                            ? "bg-orange-50 border-orange-100 text-orange-700"
                                            : item.status === "busy"
                                              ? "bg-red-100 border-red-200 text-red-900"
                                              : "bg-white border-dashed border-gray-300 text-gray-700"
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="truncate">{formatCompactTime(item.start_time)}-{formatCompactTime(item.end_time)}</span>
                                        <span className="shrink-0">{item.status === "confirmed" ? "確定" : item.status === "pending" ? "依頼中" : item.status === "busy" ? "予定あり" : "空き"}</span>
                                      </div>
                                      {item.is_recurring && (
                                        <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-black text-blue-600">
                                          <Repeat2 size={11} /> ループ
                                        </p>
                                      )}
                                      {item.note && <p className="mt-1 font-medium opacity-80 truncate">{item.note}</p>}
                                    </button>
                                  )) : (
                                    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 px-3 py-6 text-center text-xs text-gray-400">
                                      予定なし
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {calendarMode === "month" && (
                    <div className="overflow-x-hidden">
                      <div className="w-full max-w-[90vw] grid grid-cols-7 gap-2 mx-auto">
                        {["日", "月", "火", "水", "木", "金", "土"].map(d => {
                          const isSun = d === "日";
                          const isSat = d === "土";
                          return (
                            <div key={d} className={`relative text-center font-black uppercase pb-2 ${isSun ? "text-red-500" : isSat ? "text-blue-500" : "text-gray-900"}`}>
                              {d}
                            </div>
                          );
                        })}
                        {eachDayOfInterval({
                          start: startOfWeek(startOfMonth(selectedDate), { weekStartsOn: 0 }),
                          end: endOfWeek(endOfMonth(selectedDate), { weekStartsOn: 0 })
                        }).map(day => {
                          const dayAvails = displayedAvailabilities.filter(a => isSameDay(parseISO(a.date), day));
                          const isSelected = isSameDay(day, selectedDate);
                          const isToday = isSameDay(day, new Date());
                          const isOutsideCurrentMonth = day.getMonth() !== selectedDate.getMonth();
                          return (
                            <button 
                              key={day.toString()}
                              onClick={() => openDayDetailModal(day)}
                              className={`rounded-2xl flex flex-col items-center justify-start transition-all relative aspect-square justify-center gap-1 ${isSelected ? "bg-blue-600 text-white shadow-xl shadow-blue-200" : "hover:bg-gray-50"} ${isOutsideCurrentMonth && !isSelected ? "text-gray-300" : ""}`}
                            >
                              <div className="w-full flex items-center justify-between">
                                <span className={`text-lg sm:text-xl font-black ${isToday && !isSelected ? "text-blue-600" : ""} ${isOutsideCurrentMonth && !isSelected ? "opacity-40" : ""}`}>{format(day, "d")}</span>
                              </div>
                              {dayAvails.length > 0 && (
                                <div className="w-full mt-1 space-y-1 text-[10px] leading-tight">
                                  {dayAvails.slice(0, 2).map(a => (
                                    <div key={a.id} className={`truncate rounded-lg px-1.5 py-0.5 ${a.status === "confirmed" ? "bg-red-50 text-red-700" : a.status === "pending" ? "bg-orange-50 text-orange-700" : a.status === "busy" ? "bg-red-100 text-red-900" : "bg-white border border-dashed border-gray-300 text-gray-600"} ${isOutsideCurrentMonth ? "opacity-50" : ""}`}>
                                      {formatCompactTime(a.start_time)}-{formatCompactTime(a.end_time)}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="mt-auto flex items-center justify-center gap-0.5 sm:gap-1">
                                {dayAvails.slice(0, 3).map((a, idx) => (
                                  <span key={idx} className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${a.status === "confirmed" ? "bg-red-500" : a.status === "busy" ? "bg-red-900" : a.status === "pending" ? "bg-orange-500" : "bg-gray-400"} ${isOutsideCurrentMonth && !isSelected ? "opacity-40" : ""}`} />
                                ))}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </Card>
              </motion.div>
            )}

            {view === "friends" && (
              <motion.div
                key="friends"
                initial={false}
                animate={false}
                exit={false}
                className="space-y-6 max-w-6xl"
              >
                <Card className="p-6 sm:p-8 space-y-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">招待リンク</p>
                      <h3 className="text-xl font-black">フレンドにシェア</h3>
                      <p className="text-sm text-gray-500">リンクを送れば予定を見せられます。トークやメールでそのまま貼り付けてください。</p>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={copyShareLink} className="whitespace-nowrap" icon={Copy}>
                        リンクをコピー
                      </Button>
                      <Button onClick={handleRefreshShareToken} variant="outline" className="whitespace-nowrap" icon={RefreshCcw}>
                        招待URLを更新
                      </Button>
                      <Button onClick={handleToggleSharePause} variant={currentUser?.share_paused ? "secondary" : "outline"} className="whitespace-nowrap">
                        {currentUser?.share_paused ? "公開に戻す" : "全員に非公開"}
                      </Button>
                    </div>
                  </div>
                  <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl px-4 py-3 text-sm font-mono break-all text-gray-700">
                    {shareLink || "ログインすると招待リンクが表示されます"}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">共有期間</span>
                    <div className="flex gap-2">
                      {[7, 14, 30].map(days => (
                        <button
                          key={days}
                          onClick={() => handleUpdateSharePeriod(days as 7 | 14 | 30)}
                          className={`px-4 py-2 rounded-xl text-sm font-black ${currentUser?.share_period_days === days ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-600"}`}
                        >
                          {days === 7 ? "1週間" : days === 14 ? "2週間" : "1か月"}
                        </button>
                      ))}
                    </div>
                    <span className="text-xs text-gray-400">共有リンクで表示される日数を切り替えられます。</span>
                    {currentUser?.share_paused && <span className="text-xs text-red-500 font-bold">現在: 非公開モード</span>}
                  </div>
                </Card>

                <Card className="p-6 sm:p-8 space-y-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Friends</p>
                      <h3 className="text-xl font-black">フレンド一覧</h3>
                      <p className="text-sm text-gray-500">フォロー {connections.filter(c => c.user1_id === currentUser?.uid).length}件 / フォロワー {connections.filter(c => c.user2_id === currentUser?.uid).length}件</p>
                    </div>
                    <div className="text-xs text-gray-400">
                      招待された人は自動でフォローになります
                    </div>
                  </div>

                  {connectionUsers.length > 0 ? (
                    <div className="grid gap-3 sm:gap-4">
                      {connectionUsers.map(peer => {
                        const relation = connections.find(c =>
                          (c.user1_id === currentUser?.uid && c.user2_id === peer.uid) ||
                          (c.user2_id === currentUser?.uid && c.user1_id === peer.uid)
                        );
                        const isFollowing = relation?.user1_id === currentUser?.uid;
                        const isFollower = relation?.user2_id === currentUser?.uid;
                        const isBlocked = relation?.status === "blocked";
                        return (
                          <div
                            key={peer.uid}
                            className="p-4 sm:p-5 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-between gap-3 flex-wrap"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-12 h-12 rounded-full overflow-hidden bg-white">
                                <img
                                  src={peer.avatar_url || peer.line_picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${peer.name}`}
                                  alt={peer.name}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold truncate">{peer.name}</p>
                                <p className="text-xs text-gray-400 truncate">
                                  {isBlocked ? "ブロック中" : null}
                                  {!isBlocked && (
                                    <>
                                      {isFollowing && "フォロー中"}{isFollowing && isFollower ? " / " : ""}{isFollower && "フォロワー"}
                                    </>
                                  )}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {!isBlocked && (
                                <Button
                                  onClick={() => window.location.href = `${window.location.origin}?share=${peer.share_token}`}
                                  variant="outline"
                                  className="whitespace-nowrap"
                                  icon={CalendarDays}
                                >
                                  予定を開く
                                </Button>
                              )}
                              <Button
                                onClick={() => isBlocked ? handleUnblock(peer.uid) : handleBlock(peer.uid)}
                                variant={isBlocked ? "secondary" : "outline"}
                                className="whitespace-nowrap"
                              >
                                {isBlocked ? "ブロック解除" : "ブロック"}
                              </Button>
                              <Button
                                onClick={() => handleUnfollow(peer.uid)}
                                variant="ghost"
                                className="text-red-500 whitespace-nowrap"
                              >
                                フレンド解除
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-4 py-10 text-center text-gray-400 font-bold bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                      フレンドがまだいません。招待リンクを送ってみましょう。
                    </div>
                  )}
                </Card>
              </motion.div>
            )}

            {view === "settings" && (
              <motion.div 
                key="settings"
                initial={false}
                animate={false}
                exit={false}
                className="max-w-2xl space-y-8"
              >
                <Card className="p-8 space-y-8">
                  <section className="space-y-6">
                    <h3 className="text-xl font-black flex items-center gap-3">
                      <User size={24} className="text-blue-600" />
                      プロフィール
                    </h3>
                    <div className="p-5 bg-gray-50 border border-gray-100 rounded-2xl flex items-center gap-4 flex-wrap">
                      <div className="w-20 h-20 rounded-3xl overflow-hidden bg-white border border-gray-100">
                        <img src={selectedAvatar || avatarSrc || presetAvatars[0]} alt="avatar" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-[12rem] space-y-2">
                        {isEditingName ? (
                          <div className="flex gap-2">
                            <input 
                              value={newName} 
                              onChange={e => setNewName(e.target.value)}
                              className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <Button onClick={async () => {
                              if (!currentUser) return;
                              const nextName = newName.trim();
                              await setDoc(doc(db, "users", currentUser.uid), { name: nextName }, { merge: true });
                              setCurrentUser({ ...currentUser, name: nextName });
                              setNewName(nextName);
                              setIsEditingName(false);
                            }} icon={Check}>保存</Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-2xl font-black truncate">{currentUser?.name}</p>
                            <Button onClick={() => setIsEditingName(true)} variant="ghost">編集</Button>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-lg">
                          <MessageCircle size={18} className={isLineSignedIn ? "text-[#06C755]" : "text-gray-300"} />
                          <User size={18} className={isGoogleSignedIn ? "text-emerald-700" : "text-gray-300"} />
                          <Key size={18} className={currentUser?.search_id ? "text-blue-600" : "text-gray-300"} />
                        </div>
                        <p className="text-gray-400 font-medium">{accountLabel}</p>
                      </div>
                    </div>

                    <div className="pt-3 space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">アバターを選ぶ</label>
                      <div className="flex flex-wrap gap-3">
                        {visibleAvatars.map(url => (
                          <button
                            key={url}
                            onClick={() => handleSaveAvatar(url)}
                            className={`w-14 h-14 rounded-2xl border-2 overflow-hidden ${selectedAvatar === url ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-100"}`}
                          >
                            <img src={url} alt="avatar option" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => setShowAllAvatars(v => !v)}
                        className="text-xs text-blue-600 font-bold underline"
                      >
                        {showAllAvatars ? "閉じる" : "もっと見る"}
                      </button>
                    </div>

                  </section>

                  <section className="space-y-6 pt-8 border-t border-gray-100">
                    <h3 className="text-xl font-black flex items-center gap-3">
                      <MessageCircle size={24} className="text-[#06C755]" />
                      サインイン方法
                    </h3>
                    <p className="text-sm text-gray-500">
                      LINE / Google / ID のどれで入っても同じアカウントに紐づきます。
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className={`w-full p-4 rounded-2xl border flex flex-col gap-2 justify-center ${isLineSignedIn ? "bg-emerald-50 border-emerald-100" : "bg-gray-50 border-gray-100"}`}>
                        <div className={`flex items-center gap-2 font-bold ${isLineSignedIn ? "text-emerald-700" : "text-gray-500"}`}>
                          <Check size={18} className={isLineSignedIn ? "text-emerald-600" : "text-gray-300"} />
                          {isLineSignedIn ? "LINE連携中" : "LINE連携"}
                        </div>
                        <Button onClick={isLineSignedIn ? handleUnlinkLine : handleLineLogin} variant={isLineSignedIn ? "ghost" : "line"} className="w-full text-sm">
                          {isLineSignedIn ? "解除" : "ログイン"}
                        </Button>
                      </div>

                      <div className={`w-full p-4 rounded-2xl border flex flex-col gap-2 justify-center ${isGoogleSignedIn ? "bg-emerald-50 border-emerald-100" : "bg-gray-50 border-gray-100"}`}>
                        <div className={`flex items-center gap-2 font-bold ${isGoogleSignedIn ? "text-emerald-700" : "text-gray-500"}`}>
                          <Check size={18} className={isGoogleSignedIn ? "text-emerald-600" : "text-gray-300"} />
                          {isGoogleSignedIn ? "Google連携中" : "Google連携"}
                        </div>
                        <div className="text-xs space-y-1">
                          <p className={isGoogleSignedIn ? "text-emerald-600" : "text-gray-400"}>
                            {isGoogleSignedIn ? "連携済み" : "連携するとLINEなしでも入れます。"}
                          </p>
                          {isGoogleSignedIn && currentUser?.google_email && (
                            <p className="text-emerald-700 font-semibold break-all">連携メール: {currentUser.google_email}</p>
                          )}
                        </div>
                        <Button onClick={isGoogleSignedIn ? handleUnlinkGoogle : handleGoogleLogin} variant={isGoogleSignedIn ? "ghost" : "outline"} className="w-full text-sm">
                          {isGoogleSignedIn ? "解除" : "連携"}
                        </Button>
                      </div>

                      <div className={`w-full p-4 rounded-2xl border flex flex-col gap-2 justify-center ${currentUser?.search_id ? "bg-emerald-50 border-emerald-100" : "bg-gray-50 border-gray-100"}`}>
                        <div className={`flex items-center gap-2 font-bold ${currentUser?.search_id ? "text-emerald-700" : "text-gray-500"}`}>
                          <Eye size={18} />
                          {currentUser?.search_id ? `IDログイン設定済み` : "IDログイン未設定"}
                        </div>
                        <p className={`text-xs ${currentUser?.search_id ? "text-emerald-600" : "text-gray-400"}`}>
                          {currentUser?.search_id ? `ID: ${currentUser.search_id}` : "IDとパスワードを設定できます。"}
                        </p>
                        <Button onClick={openIdModal} variant={currentUser?.search_id ? "ghost" : "secondary"} className="w-full text-sm">
                          {currentUser?.search_id ? "変更" : "設定"}
                        </Button>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4 pt-8 border-t border-gray-100">
                    <h3 className="text-xl font-black flex items-center gap-3">
                      <LogOut size={24} className="text-blue-600" />
                      サインアウト
                    </h3>
                    <Button onClick={() => signOut(auth)} variant="danger" className="w-full" icon={LogOut}>
                      サインアウト
                    </Button>
                  </section>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {showMobileMenu && (
        <div ref={mobileMenuRef} className="lg:hidden fixed top-20 left-4 right-4 z-40 bg-white rounded-3xl shadow-2xl border border-gray-100 p-3">
          {[
            { id: "myboard", label: "マイボード", icon: Calendar },
            { id: "friends", label: "フレンド", icon: Users },
            { id: "settings", label: "設定", icon: Settings },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => { setView(item.id as "myboard" | "friends" | "settings"); setShowMobileMenu(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-gray-50 text-left font-bold"
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </div>
      )}

      {showAvatarToast && (
        <div className="fixed bottom-6 right-6 z-[80] bg-gray-900 text-white px-4 py-3 rounded-xl shadow-lg text-sm">
          プロフィール画像を更新しました。
        </div>
      )}

      {showIdModal && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowIdModal(false)} />
          <div className="relative w-full max-w-md bg-white rounded-[2rem] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-black">ID/パスワード設定</h4>
              <button onClick={() => setShowIdModal(false)} className="p-2 text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-600">ID（8文字以上）</label>
              <input
                value={idValue}
                onChange={e => setIdValue(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="your-id"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-600">パスワード（8文字以上）</label>
              <input
                type="password"
                value={idPassword}
                onChange={e => setIdPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="********"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => setShowIdModal(false)} variant="ghost" className="flex-1">キャンセル</Button>
              <Button onClick={handleSaveIdLogin} className="flex-1">保存する</Button>
            </div>
            <p className="text-[11px] text-gray-500">
              IDはこのアカウント専用のメールアドレスとして登録されます。UUIDはそのまま、データもそのままです。
            </p>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showNameEditModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowNameEditModal(false)}
            />
            <motion.div
              initial={false}
              animate={false}
              exit={false}
              className="relative w-full max-w-md bg-white rounded-[2rem] p-6 shadow-2xl"
            >
              <p className="text-lg font-black mb-4">アカウントの名前を変更しますか？</p>
              <input
                value={nameEditValue}
                onChange={e => setNameEditValue(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-3 mt-6">
                <Button
                  className="flex-1"
                  onClick={async () => {
                    if (!currentUser) return;
                    const trimmed = nameEditValue.trim();
                    if (!trimmed) return;
                    await setDoc(doc(db, "users", currentUser.uid), { name: trimmed }, { merge: true });
                    setCurrentUser({ ...currentUser, name: trimmed });
                    setNewName(trimmed);
                    setPublicUser(publicUser ? { ...publicUser, name: trimmed } : publicUser);
                    setShowNameEditModal(false);
                  }}
                >
                  変更
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setShowNameEditModal(false)}>
                  キャンセル
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDayDetailModal && (
          <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center p-0 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDayDetailModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={false}
              animate={false}
              exit={false}
              className="relative w-full max-w-2xl bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] p-6 sm:p-8 shadow-2xl max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-2xl font-black">{format(selectedDate, "M月d日(E)", { locale: ja })}</h3>
                  <p className="text-sm text-gray-400">この日の予定を確認・編集できます。</p>
                </div>
                <button onClick={() => setShowDayDetailModal(false)} className="p-2 rounded-full hover:bg-gray-100"><X size={18} /></button>
              </div>

              <div className="space-y-3">
                <Button onClick={() => { openAvailabilityModal(undefined, selectedDate); setShowDayDetailModal(false); }} className="w-full" icon={Plus}>
                  この日に予定を追加
                </Button>

                              {selectedDayItems.length > 0 ? (
                                selectedDayItems.map(item => (
                                  <Card key={item.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-lg font-black">{formatCompactTime(item.start_time)}-{formatCompactTime(item.end_time)}</p>
                            {item.is_recurring && <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-black"><Repeat2 size={12} />ループ</span>}
                          </div>
                          <p className="text-sm text-gray-500 font-medium mt-1">{statusLabel(item.status)}</p>
                          {item.note && <p className="text-sm text-red-500 font-medium mt-1">{item.note}</p>}
                        </div>
                        <Button
                          onClick={() => {
                            openAvailabilityModal(item);
                            setShowDayDetailModal(false);
                          }}
                          variant="outline"
                          className="shrink-0"
                        >
                          編集
                        </Button>
                      </div>
                    </Card>
                  ))
                ) : (
                  <div className="py-10 text-center text-gray-400 font-bold border border-dashed border-gray-200 rounded-3xl">
                    この日は予定がありません
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingRequestAction && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setPendingRequestAction(null)}
            />
            <motion.div
              initial={false}
              animate={false}
              exit={false}
              className="relative w-full max-w-md bg-white rounded-[2rem] p-6 shadow-2xl"
            >
              <p className="text-lg font-black mb-2">
                {pendingRequestAction.mode === "approve" ? "承認しますか？" : "辞退しますか？"}
              </p>
              <p className="text-sm text-gray-500">
                {format(parseISO(pendingRequestAction.request.date), "M月d日(E)", { locale: ja })} {pendingRequestAction.request.start_time}-{pendingRequestAction.request.end_time}
              </p>
              <div className="flex gap-3 mt-6">
                <Button
                  className="flex-1"
                  onClick={async () => {
                    const action = pendingRequestAction;
                    setPendingRequestAction(null);
                    if (action.mode === "approve") {
                      await handleApproveRequest(action.request);
                    } else {
                      await handleRejectRequest(action.request);
                    }
                  }}
                >
                  {pendingRequestAction.mode === "approve" ? "承認" : "辞退"}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setPendingRequestAction(null)}>
                  キャンセル
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showRequestModal && requestTarget && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowRequestModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={false}
              animate={false}
              exit={false}
              className="relative w-full max-w-lg bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-black">依頼</h3>
                <button onClick={() => setShowRequestModal(false)} className="p-2 rounded-full hover:bg-gray-100"><X size={18} /></button>
              </div>
              <div className="space-y-4">
                <div className="rounded-2xl bg-gray-50 p-4">
                  <p className="font-bold">{format(parseISO(requestTarget.date), "M月d日(E)", { locale: ja })}</p>
                  <p className="text-sm text-gray-500">{requestTarget.start_time}-{requestTarget.end_time}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">依頼時間</label>
                  <div className="grid grid-cols-2 gap-3">
                    <input type="time" value={requestStart} onChange={e => setRequestStart(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold" />
                    <input type="time" value={requestEnd} onChange={e => setRequestEnd(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button
                    className="flex-1"
                    onClick={async () => {
                      await handleSendRequest(requestTarget, requestStart, requestEnd);
                      setShowRequestModal(false);
                    }}
                  >
                    送信
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setShowRequestModal(false)}>
                    キャンセル
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeAvailabilityModal}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={false}
              animate={false}
              exit={false}
              className="relative w-full max-w-lg bg-white rounded-t-[2rem] sm:rounded-[2rem] p-4 sm:p-7 shadow-2xl overflow-hidden max-h-[85vh] overflow-y-auto"
            >
              <div className="w-10 h-1.5 bg-gray-100 rounded-full mx-auto mb-4 sm:hidden" />
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h3 className="text-xl sm:text-2xl font-black tracking-tight">{editingAvailability ? "予定を編集" : "予定を追加"}</h3>
                <button onClick={closeAvailabilityModal} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X/></button>
              </div>

              <div className="space-y-4 sm:space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">日付</label>
                  <input
                    type="date"
                    value={draftDate}
                    onChange={e => setDraftDate(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">状態</label>
                  <div className="flex flex-wrap gap-2">
                    {["open", "busy"].map(status => (
                      <button
                        key={status}
                        onClick={() => setDraftStatus(status as Availability["status"])}
                        className={`px-3 py-2 rounded-xl text-sm font-black ${draftStatus === status ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-600"}`}
                      >
                        {status === "open" ? "空き" : "予定有り"}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={draftIsRecurring}
                    onChange={e => setDraftIsRecurring(e.target.checked)}
                    className="w-5 h-5 accent-blue-600"
                  />
                  <span className="text-sm font-bold text-gray-700">毎週ループさせる</span>
                </label>
                <p className="text-xs text-gray-500 leading-snug">ループ予定にはマークが付きます。編集時は系列全体か、その日だけかを確認します。</p>

                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">開始</label>
                    <input
                      type="time"
                      value={draftTime.start}
                      onChange={e => setDraftTime({ ...draftTime, start: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">終了</label>
                    <input
                      type="time"
                      value={draftTime.end}
                      onChange={e => setDraftTime({ ...draftTime, end: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">予定名 (任意)</label>
                  <input
                    type="text"
                    placeholder="例: 手伝う内容など"
                    value={draftNote}
                    onChange={e => setDraftNote(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs font-semibold text-red-600 leading-snug">カレンダーを共有したときにも表示されます。</p>
                </div>

                <div className="flex gap-3 pt-2 sm:pt-4">
                  <Button
                    onClick={handleSaveAvailability}
                    className="flex-1 py-3 font-black"
                    disabled={isSaving}
                  >
                    {editingAvailability ? "保存する" : "予定を登録"}
                  </Button>
                  <Button
                    onClick={closeAvailabilityModal}
                    variant="outline"
                    className="flex-1 py-3 font-black"
                    disabled={isSaving}
                    >
                    キャンセル
                  </Button>
                </div>
                {editingAvailability && (
                  <div className="pt-2 border-t border-gray-100">
                    <Button
                      onClick={async () => {
                        if (!editingAvailability) return;
                        if (editingAvailability.status === "confirmed") {
                          alert("確定のため削除できません。(相手がいる予定の場合直接キャンセルをお知らせください)");
                          return;
                        }
                        if (!window.confirm("この予定を削除しますか？")) return;
                        await handleDeleteAvailability(editingAvailability.id);
                        closeAvailabilityModal();
                      }}
                      variant="danger"
                    className="w-full py-3"
                    disabled={isSaving}
                  >
                    削除
                    </Button>
                    {editingAvailability.status === "confirmed" && (
                      <p className="text-xs text-gray-500 mt-2">確定のため削除できません。(相手がいる予定の場合直接キャンセルをお知らせください)</p>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}



