import React, { useState, useEffect, useCallback, useRef } from "react";
import { 
  Calendar, 
  Clock, 
  Settings, 
  Share2, 
  Plus, 
  Bell, 
  ChevronRight, 
  ChevronLeft, 
  LogOut, 
  User, 
  Users,
  Check, 
  X, 
  MessageCircle, 
  LayoutDashboard,
  CalendarDays,
  ArrowRight,
  Pencil,
  Eye,
  Link2
} from "lucide-react";
import { 
  initializeApp 
} from "firebase/app";
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithPopup, 
  signInAnonymously,
  GoogleAuthProvider, 
  signOut, 
  signInWithCustomToken
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
  Timestamp,
  serverTimestamp,
  orderBy,
  limit,
  writeBatch
} from "firebase/firestore";
import { format, addDays, addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";

// Firebase Config
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);
const CHOICREW_LOGO = "/choicrew-logo.svg";

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
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
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
  guest_password?: string;
  share_period_days?: 7 | 14 | 30;
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
  status: "active";
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

  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionUsers, setConnectionUsers] = useState<UserProfile[]>([]);
  
  const [view, setView] = useState<"dashboard" | "calendar" | "settings">("dashboard");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarMode, setCalendarMode] = useState<"month" | "week">(
    typeof window !== "undefined" && window.innerWidth < 768 ? "week" : "month"
  );
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showBellDropdown, setShowBellDropdown] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [dashboardDateOffset, setDashboardDateOffset] = useState(0);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAvailability, setEditingAvailability] = useState<Availability | null>(null);
  const [draftDate, setDraftDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [draftTime, setDraftTime] = useState({ start: "10:00", end: "15:00" });
  const [draftNote, setDraftNote] = useState("");
  const [draftStatus, setDraftStatus] = useState<Availability["status"]>("open");
  const [lastNewDraft, setLastNewDraft] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    time: { start: "10:00", end: "15:00" },
    note: "",
    status: "open" as Availability["status"],
  });
  const [newAvatarUrl, setNewAvatarUrl] = useState("");
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
  const [showWeekdayTemplate, setShowWeekdayTemplate] = useState(false);
  const [showWeekendTemplate, setShowWeekendTemplate] = useState(false);
  const [showNameEditModal, setShowNameEditModal] = useState(false);
  const [nameEditValue, setNameEditValue] = useState("");

  const requestSectionRef = useRef<HTMLDivElement | null>(null);
  const confirmedSectionRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);

  const isGuestUser = !currentUser?.email && !currentUser?.line_user_id;
  const accountLabel = isGuestUser ? "ゲストユーザー" : "クルー";
  const shareLink = currentUser ? `${window.location.origin}?share=${currentUser.share_token}` : "";
  const sharePeriodLabel = currentUser?.share_period_days === 14 ? "2週間" : currentUser?.share_period_days === 30 ? "1か月" : "1週間";
  const avatarSrc = currentUser?.avatar_url || currentUser?.line_picture || "";
  const avatarIsGuestDefault = isGuestUser && !currentUser?.avatar_url && !currentUser?.line_picture;
  const isOwnPreview = isPublicView && Boolean(currentUser?.uid && publicUser?.uid && currentUser.uid === publicUser.uid);
  const incomingRequests = currentUser
    ? requests.filter(r => r.staff_id === currentUser.uid && r.status === "pending")
    : [];
  const monthlyAvailabilities = availabilities
    .filter(a => {
      const d = parseISO(a.date);
      return d.getFullYear() === selectedDate.getFullYear() && d.getMonth() === selectedDate.getMonth();
    })
    .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
  const today = new Date();
  const templateAvailabilities = [
    ...(showWeekdayTemplate ? Array.from({ length: 14 }, (_, i) => addDays(today, i)).filter(date => date.getDay() >= 1 && date.getDay() <= 5).map(date => ({
      id: `weekday-${format(date, "yyyy-MM-dd")}`,
      user_id: currentUser?.uid || "",
      user_name: currentUser?.name,
      date: format(date, "yyyy-MM-dd"),
      start_time: currentUser?.default_start || "09:00",
      end_time: currentUser?.default_end || "17:00",
      status: "open" as const,
      note: "隔週平日テンプレ",
    })) : []),
    ...(showWeekendTemplate ? Array.from({ length: 14 }, (_, i) => addDays(today, i)).filter(date => date.getDay() === 0 || date.getDay() === 6).map(date => ({
      id: `weekend-${format(date, "yyyy-MM-dd")}`,
      user_id: currentUser?.uid || "",
      user_name: currentUser?.name,
      date: format(date, "yyyy-MM-dd"),
      start_time: currentUser?.default_start || "09:00",
      end_time: currentUser?.default_end || "17:00",
      status: "open" as const,
      note: "隔週土日テンプレ",
    })) : []),
  ] as Availability[];
  const displayedAvailabilities = [...availabilities, ...templateAvailabilities].sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
  const nextFiveDays = Array.from({ length: 5 }, (_, i) => addDays(today, i));
  const scheduleListDays = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const publicUpcomingAvailabilities = availabilities
    .filter(a => parseISO(a.date) >= new Date(new Date().setHours(0,0,0,0)))
    .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
  const isPendingMyRequest = (availabilityId: string) =>
    requests.some(r => r.availability_id === availabilityId && r.staff_id === currentUser?.uid && r.status === "pending");
  const isApprovedMyRequest = (availabilityId: string) =>
    requests.some(r => r.availability_id === availabilityId && r.staff_id === currentUser?.uid && r.status === "approved");
  const openAvailabilityModal = (availability?: Availability, targetDate?: Date) => {
    if (availability) {
      setEditingAvailability(availability);
      setDraftDate(availability.date);
      setDraftTime({ start: availability.start_time, end: availability.end_time });
      setDraftNote(availability.note || "");
      setDraftStatus(availability.status);
    } else {
      setEditingAvailability(null);
      const baseDate = targetDate || selectedDate || new Date();
      setDraftDate(format(baseDate, "yyyy-MM-dd"));
      setDraftTime(lastNewDraft.time);
      setDraftNote(lastNewDraft.note);
      setDraftStatus(lastNewDraft.status);
    }
    setShowAddModal(true);
  };

  const closeAvailabilityModal = () => {
    setShowAddModal(false);
    setEditingAvailability(null);
  };

  const statusLabel = (status: Availability["status"]) =>
    status === "open" ? "空き" : status === "pending" ? "依頼中" : status === "confirmed" ? "確定" : "予定あり";

  const statusColor = (status: Availability["status"]) =>
    status === "confirmed" ? "bg-red-500" : status === "pending" ? "bg-orange-500" : status === "busy" ? "bg-red-900" : "bg-gray-400";

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

  const handleTestLineNotification = async () => {
    if (!currentUser) return;
    const result = await sendLineNotification(
      currentUser.line_user_id,
      "ChoiCrewのLINE通知テストです。"
    );
    alert(`通知テスト結果\n${buildLineNotificationAlert(result)}`);
  };

  useEffect(() => {
    if (!currentUser) return;
    setNewAvatarUrl(currentUser.avatar_url || currentUser.line_picture || "");
  }, [currentUser?.uid, currentUser?.avatar_url, currentUser?.line_picture]);
  
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
          share_period_days: 7
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
          let userDoc = await getDoc(doc(db, "users", user.uid));
          if (!userDoc.exists()) {
            const guestId = user.isAnonymous ? Math.random().toString(36).slice(2, 7) : "";
            const newProfile: UserProfile = {
              uid: user.uid,
              search_id: guestId,
              name: user.displayName || (user.isAnonymous ? "ゲストユーザー" : "クルー"),
              email: user.email || "",
              role: "staff",
              current_role: "staff",
              share_token: Math.random().toString(36).substring(2, 15),
              accept_requests: !user.isAnonymous,
              avatar_url: "",
              guest_password: user.isAnonymous ? Math.random().toString(36).slice(2, 10) : undefined,
              share_period_days: 7
            };
            await setDoc(doc(db, "users", user.uid), newProfile);
            userDoc = await getDoc(doc(db, "users", user.uid));
          }
          const profile = userDoc.data() as UserProfile;
          setCurrentUser(profile);
          setIsLoggedIn(true);
          setNewName(profile.name);
        } else {
          setCurrentUser(null);
          setIsLoggedIn(false);
        }
      } catch (error: unknown) {
        console.error("Auth error:", error);
      } finally {
        setIsAuthReady(true);
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
      }
    );

    const unsubManagerReq = onSnapshot(
      query(collection(db, "requests"), where("manager_id", "==", currentUser.uid)),
      (snap) => {
        const managerReqs = snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftRequest));
        setRequests(prev => {
          const others = prev.filter(r => r.staff_id === currentUser.uid && r.manager_id !== currentUser.uid);
          return [...others, ...managerReqs];
        });
      }
    );

    const unsubNotif = onSnapshot(
      query(collection(db, "notifications"), where("user_id", "==", currentUser.uid), orderBy("timestamp", "desc"), limit(20)),
      (snap) => setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() } as Notification))),
      (err) => handleFirestoreError(err, OperationType.LIST, "notifications")
    );

    const unsubConn1 = onSnapshot(
      query(collection(db, "connections"), where("user1_id", "==", currentUser.uid)),
      (snap) => {
        const c1 = snap.docs.map(d => ({ id: d.id, ...d.data() } as Connection));
        setConnections(prev => {
          const others = prev.filter(c => c.user2_id === currentUser.uid && c.user1_id !== currentUser.uid);
          return [...c1, ...others];
        });
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "connections")
    );

    const unsubConn2 = onSnapshot(
      query(collection(db, "connections"), where("user2_id", "==", currentUser.uid)),
      (snap) => {
        const c2 = snap.docs.map(d => ({ id: d.id, ...d.data() } as Connection));
        setConnections(prev => {
          const others = prev.filter(c => c.user1_id === currentUser.uid && c.user2_id !== currentUser.uid);
          return [...others, ...c2];
        });
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "connections")
    );

    const unsubPreset = onSnapshot(
      query(collection(db, "presets"), where("user_id", "==", currentUser.uid)),
      (snap) => setPresets(snap.docs.map(d => ({ id: d.id, ...d.data() } as Preset))),
      (err) => handleFirestoreError(err, OperationType.LIST, "presets")
    );

    const unsubUser = onSnapshot(
      doc(db, "users", currentUser.uid),
      (snap) => {
        if (snap.exists()) {
          const profile = snap.data() as UserProfile;
          setCurrentUser(profile);
          setNewName(profile.name);
        }
      }
    );

    return () => {
      unsubAvail();
      unsubStaffReq();
      unsubManagerReq();
      unsubNotif();
      unsubConn1();
      unsubConn2();
      unsubPreset();
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
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      console.error("Google login error:", err);
    }
  };
  const handleGuestLoginSafe = async () => {
    try {
      await signInAnonymously(auth);
    } catch (err) {
      console.error("Guest login error:", err);
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
      };

      if (editingAvailability) {
        await updateDoc(doc(db, "availabilities", editingAvailability.id), payload);
      } else {
        await addDoc(collection(db, "availabilities"), {
          ...payload,
          created_at: serverTimestamp()
        });
      }

      closeAvailabilityModal();
      setLastNewDraft({
        date: draftDate,
        time: draftTime,
        note: draftNote,
        status: draftStatus,
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

  const handleSaveAvatar = async () => {
    if (!currentUser) return;
    await updateDoc(doc(db, "users", currentUser.uid), { avatar_url: newAvatarUrl.trim() });
    setCurrentUser({ ...currentUser, avatar_url: newAvatarUrl.trim() });
    alert("プロフィール画像を更新しました。");
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
              空いた時間で、予定をかんたんに共有できます。スケジュールを見やすく整理して使えます。
            </p>
          </div>

          <div className="grid gap-4">
            <Button onClick={handleLineLogin} variant="line" icon={MessageCircle} className="py-5 text-lg">
              LINEログイン
            </Button>
            <Button onClick={handleGoogleLogin} variant="outline" icon={User} className="py-5 text-lg">
              Googleログイン
            </Button>
            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
              <div className="relative flex justify-center text-sm"><span className="px-4 bg-[#F8FAFC] text-gray-400">または</span></div>
            </div>
            <Button onClick={handleGuestLoginSafe} variant="secondary" icon={ArrowRight} className="py-5 text-lg">
              ゲストで続ける
            </Button>
          </div>

          <p className="text-sm text-gray-400">
            ログインすることで、利用規約とプライバシーポリシーに同意したことになります。
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
              className="w-28 shrink-0 drop-shadow-[0_18px_32px_rgba(37,99,235,0.14)]"
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
              <p className="text-gray-500 font-medium">このページをURLで共有することで、空き時間を確認して連絡を待つことができます。</p>
              <p className="text-sm text-red-500 font-semibold">共有URLでは、共有期間は{sharePeriodLabel}として表示されています。</p>
              <p className="text-sm text-gray-600 mt-2">
                ログインしている場合は、共有相手は依頼を送れます。ログインしていない場合は、予定の確認のみ行えます。
              </p>
              <p className="text-sm text-gray-600 mt-1">
                ゲストユーザーの場合は、共有までが可能です。アカウントを有効化して依頼を受付けましょう。予定のみ共有でもOKです。
              </p>
            </div>
          </div>

          {isOwnPreview && (
            <Card className="p-4 bg-blue-50 border-blue-100">
              <p className="font-bold text-blue-700 flex items-center gap-2"><Eye size={16} />ログイン中のあなたのページです。ここはプレビュー表示なので、依頼ボタンは使えません。</p>
            </Card>
          )}

          <div className="space-y-4">
            <h3 className="text-xl font-black">公開中の空き時間</h3>
            <div className="grid gap-4">
              {publicUpcomingAvailabilities.length > 0 ? (
                publicUpcomingAvailabilities.map(a => {
                  const isBusy = a.status === "confirmed" || a.status === "busy";
                  const isMyPendingRequest = isPendingMyRequest(a.id);
                  const isMyApprovedRequest = isApprovedMyRequest(a.id);
                  const buttonLabel = isBusy
                    ? "依頼"
                    : isMyApprovedRequest
                      ? "キャンセル依頼"
                      : isMyPendingRequest
                        ? "依頼中"
                        : "依頼";
                  return (
                  <Card key={a.id} className={`p-6 flex items-center justify-between ${isBusy ? "opacity-55 grayscale" : ""}`}>
                    <div className="flex items-center gap-6">
                      <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                        <Clock size={24} />
                      </div>
                      <div>
                        <p className="text-lg font-bold">{format(parseISO(a.date), "M月d日 (E)", { locale: ja })}</p>
                        <p className="text-2xl font-black">{a.start_time} - {a.end_time}</p>
                        {a.note && <p className="text-sm text-red-500 font-semibold mt-1">{a.note}</p>}
                        {isBusy && <p className="text-xs text-gray-400 mt-1">埋まっている予定です。</p>}
                        {isMyPendingRequest && <p className="text-xs text-blue-600 mt-1">依頼中です。</p>}
                        {isMyApprovedRequest && <p className="text-xs text-amber-600 mt-1">承認済みです。キャンセル依頼は相手の同意を得てください。気づかない場合は直接連絡するのがおすすめです。</p>}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        if (isBusy) {
                          alert("これはプレビューなので、依頼はできません。埋まっている予定です。");
                          return;
                        }
                        if (isOwnPreview) {
                          alert("これはプレビューなので、依頼はできません。埋まっている予定です。");
                          return;
                        }
                        if (!isLoggedIn) {
                          alert("依頼を送るにはログインが必要です。");
                          return;
                        }
                        if (isMyPendingRequest) {
                          const req = requests.find(r => r.availability_id === a.id && r.staff_id === currentUser?.uid && r.status === "pending");
                          if (req && window.confirm("キャンセルしますか？")) await handleRejectRequest(req);
                          return;
                        }
                        if (isMyApprovedRequest) {
                          const req = requests.find(r => r.availability_id === a.id && r.staff_id === currentUser?.uid && r.status === "approved");
                          if (req && window.confirm("キャンセル依頼しますか？")) await handleRejectRequest(req);
                          return;
                        }
                        openRequestModal(a);
                      }}
                      className={`px-5 py-3 rounded-2xl font-black border ${isBusy || isOwnPreview ? "border-blue-100 text-blue-300 bg-blue-50" : "border-blue-200 text-blue-600 bg-white"}`}
                    >
                      {buttonLabel}
                    </button>
                  </Card>
                  );
                })
              ) : (
                <div className="py-12 text-center bg-white rounded-3xl border border-dashed border-gray-200 text-gray-400 font-bold">
                  予定はまだありません
                </div>
              )}
            </div>
          </div>

          <Card className="p-5 bg-blue-50 border-blue-100">
            <p className="text-sm font-black text-blue-700">使い方</p>
            <p className="text-sm text-blue-700 mt-1">このページをURLで共有する。空き時間を確認して連絡を待つ。ログインしている場合は、共有相手は依頼を送れます。ログインしていない場合は予定の確認のみ行えます。ゲストユーザーの場合は、共有までが可能です。アカウントを有効化して依頼を受付けましょう。予定のみ共有でもOKです。</p>
            <p className="text-xs text-blue-700 mt-2">依頼が飛ぶと承認でお互いが確認した状態になります。必要ならキャンセル依頼を使ってください。気づかない場合は直接連絡するのがおすすめです。</p>
          </Card>

          {!isLoggedIn && (
            <div className="pt-8 border-t border-gray-100 text-center">
              <p className="text-gray-400 mb-4 font-medium">あなたもChoiCrewで予定を管理してみませんか。</p>
              <Button onClick={() => window.location.href = window.location.origin} variant="primary">自分でも使ってみる</Button>
            </div>
          )}
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
            { id: "dashboard", label: "ダッシュボード", icon: LayoutDashboard },
            { id: "calendar", label: "カレンダー", icon: CalendarDays },
            { id: "settings", label: "設定", icon: Settings },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id as "dashboard" | "calendar" | "settings")}
              className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl font-bold transition-all ${view === item.id ? "bg-blue-50 text-blue-600" : "text-gray-400 hover:bg-gray-50 hover:text-gray-600"}`}
            >
              <item.icon size={22} />
              {item.label}
            </button>
          ))}
        </nav>

          <div className="pt-8 border-t border-gray-100">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-gray-100 rounded-full overflow-hidden flex items-center justify-center">
                {avatarIsGuestDefault ? <User size={24} className="text-gray-400" /> : <img src={avatarSrc} alt="avatar" />}
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
              {view === "dashboard" ? "Overview" : view === "calendar" ? "Schedule" : "Preferences"}
            </h2>
            <h1 className="text-[0.95rem] lg:text-3xl font-black tracking-tight leading-none truncate">
              {view === "dashboard" ? "ダッシュボード" : view === "calendar" ? "スケジュール" : "設定"}
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

        <div className="px-4 sm:px-6 lg:px-12 max-w-5xl mx-auto">
          <AnimatePresence mode="wait">
            {view === "dashboard" && (
              <motion.div 
                key="dashboard"
                initial={false}
                animate={false}
                exit={false}
                className="space-y-8"
              >
                {incomingRequests.length > 0 && (
                  <div className="space-y-4" ref={requestSectionRef}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-black">リクエスト通知</h3>
                      <span className="text-sm text-gray-400 font-bold">{incomingRequests.length}件</span>
                    </div>
                    <div className="grid gap-4">
                      {incomingRequests.map(request => (
                        <Card key={request.id} className="p-6 space-y-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="text-lg font-black truncate">{format(parseISO(request.date), "M月d日(E)", { locale: ja })}</p>
                              <p className="text-sm text-gray-400 font-medium truncate">{request.manager_name}さんから</p>
                              <p className="text-sm font-bold">{request.requested_start_time || request.start_time}-{request.requested_end_time || request.end_time}</p>
                              {(request.requested_start_time && request.requested_start_time !== request.start_time) && (
                                <p className="text-xs text-blue-600 font-semibold">時間変更でリクエストを受けています</p>
                              )}
                            </div>
                            <span className="px-3 py-1 rounded-full bg-orange-50 text-orange-600 text-xs font-black">承認待ち</span>
                          </div>
                          <div className="flex gap-3">
                            <Button onClick={() => setPendingRequestAction({ request, mode: "approve" })} className="flex-1" icon={Check}>承認</Button>
                            <Button onClick={() => setPendingRequestAction({ request, mode: "reject" })} variant="outline" className="flex-1" icon={X}>辞退</Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <button
                    onClick={() => setShowScheduleList(v => !v)}
                    className="text-sm font-bold text-blue-600 hover:underline"
                  >
                    {showScheduleList ? "予定一覧を閉じる" : "予定を一覧で表示"}
                  </button>
                  {showScheduleList && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: "all", label: "全部" },
                          { id: "confirmed", label: "確定のみ" },
                          { id: "open", label: "空きのみ" },
                          { id: "request", label: "リクエストのみ" },
                        ].map(tab => (
                          <button
                            key={tab.id}
                            onClick={() => setScheduleFilter(tab.id as typeof scheduleFilter)}
                            className={`px-3 py-2 rounded-xl text-sm font-black ${scheduleFilter === tab.id ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-600"}`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      {scheduleListDays.map(day => {
                        const dayItems = displayedAvailabilities
                          .filter(a => isSameDay(parseISO(a.date), day))
                          .filter(a => parseISO(a.date) >= new Date(new Date().setHours(0,0,0,0)))
                          .filter(a => {
                            if (scheduleFilter === "confirmed") return a.status === "confirmed";
                            if (scheduleFilter === "open") return a.status === "open";
                            if (scheduleFilter === "request") return a.status === "pending";
                            return true;
                          })
                          .sort((a, b) => `${a.start_time}`.localeCompare(`${b.start_time}`));
                        return (
                          <div key={day.toISOString()} className="pb-4 border-b border-gray-200 last:border-b-0 last:pb-0">
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <p className={`font-black ${day.getDay() === 0 ? "text-red-500" : day.getDay() === 6 ? "text-blue-500" : "text-gray-900"}`}>
                                {format(day, "M月d日(E)", { locale: ja })}
                              </p>
                              <Button onClick={() => openAvailabilityModal(undefined, day)} variant="outline" className="px-3 py-2 h-9 text-xs">
                                登録
                              </Button>
                            </div>
                            {dayItems.length > 0 ? (
                              <div className="space-y-2">
                                {dayItems.map(item => (
                                  <div key={item.id} className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="font-bold text-sm truncate">{item.start_time}-{item.end_time}</p>
                                      <p className="text-[11px] text-gray-400 truncate">{item.note || statusLabel(item.status)}</p>
                                    </div>
                                    <span className={`text-sm font-black ${item.status === "confirmed" ? "text-red-500" : "text-gray-500"}`}>{item.status === "confirmed" ? "確" : "空"}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-400">予定の登録なし</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <Card className="p-5 bg-blue-50 border-blue-100">
                  <p className="text-sm font-black text-blue-700">ワンポイント</p>
                  <p className="text-sm text-blue-700 mt-1">予定を共有すると、相手はあなたの空き時間を見て依頼できます。迷ったらまず共有リンクをコピーしておくと便利です。</p>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={copyShareLink} className="px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-black">
                      共有リンクをコピー
                    </button>
                    <button onClick={() => window.location.href = `${window.location.origin}?share=${currentUser?.share_token || ""}`} className="px-3 py-2 rounded-xl bg-white text-blue-600 text-sm font-black border border-blue-100">
                      プレビュー
                    </button>
                  </div>
                  <p className="text-xs text-blue-700 mt-2">注意: 1週間分が表示されます。設定から共有期間を確認できます。</p>
                </Card>
              </motion.div>
            )}

            {view === "calendar" && (
              <motion.div 
                key="calendar"
                initial={false}
                animate={false}
                exit={false}
                className="grid grid-cols-1 lg:grid-cols-12 gap-8"
              >
                <Card className="lg:col-span-8 p-5 sm:p-8">
                  <div className="flex items-start justify-between mb-4 sm:mb-8 gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] sm:hidden font-black text-gray-400 leading-none">{format(selectedDate, "yyyy年", { locale: ja })}</div>
                      <h3 className="text-xl sm:text-2xl font-black leading-none">{calendarMode === "week" ? format(selectedDate, "M月", { locale: ja }) : format(selectedDate, "yyyy年M月", { locale: ja })}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setCalendarMode("week")} className={`p-3 rounded-xl ${calendarMode === "week" ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-500"}`}>
                        <Calendar size={18} />
                      </button>
                      <button onClick={() => setCalendarMode("month")} className={`p-3 rounded-xl ${calendarMode === "month" ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-500"}`}>
                        <CalendarDays size={18} />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedDate(addMonths(selectedDate, -1))} className="p-3 rounded-xl hover:bg-gray-100"><ChevronLeft size={20}/></button>
                      <button onClick={() => setSelectedDate(addMonths(selectedDate, 1))} className="p-3 rounded-xl hover:bg-gray-100"><ChevronRight size={20}/></button>
                    </div>
                  </div>
                  
                  <div className={`grid grid-cols-7 gap-1 sm:gap-4 ${calendarMode === "week" ? "text-[11px]" : ""}`}>
                    {["日", "月", "火", "水", "木", "金", "土"].map(d => {
                      const isSun = d === "日";
                      const isSat = d === "土";
                      return (
                        <div key={d} className={`relative text-center font-black uppercase pb-1 sm:pb-4 ${isSun ? "text-red-500" : isSat ? "text-blue-500" : "text-gray-900"}`}>
                          {d}
                        </div>
                      );
                    })}
                    {eachDayOfInterval(
                      calendarMode === "week"
                        ? { start: startOfWeek(selectedDate, { weekStartsOn: 0 }), end: endOfWeek(selectedDate, { weekStartsOn: 0 }) }
                        : { start: startOfMonth(selectedDate), end: endOfMonth(selectedDate) }
                    ).map(day => {
                      const dayAvails = displayedAvailabilities.filter(a => isSameDay(parseISO(a.date), day));
                      const isSelected = isSameDay(day, selectedDate);
                      const isToday = isSameDay(day, new Date());

                      // Determine chip text and color
                      let chipText = "";
                      let chipColor = "";
                      if (dayAvails.length > 0) {
                        const hasConfirmed = dayAvails.some(a => a.status === "confirmed");
                        const hasPending = dayAvails.some(a => a.status === "pending");
                        const hasBusy = dayAvails.some(a => a.status === "busy");
                        
                          if (hasConfirmed) {
                            chipText = "確定";
                            chipColor = "bg-red-500";
                          } else if (hasPending) {
                            chipText = "依頼中";
                            chipColor = "bg-orange-500";
                          } else if (hasBusy) {
                            chipText = "予定あり";
                            chipColor = "bg-red-900";
                          } else {
                            chipText = "空き";
                            chipColor = "bg-gray-400";
                          }
                      }

                      return (
                        <button 
                          key={day.toString()}
                          onClick={() => setSelectedDate(day)}
                          className={`rounded-2xl flex flex-col items-center justify-start transition-all relative ${calendarMode === "week" ? "h-10 sm:h-14 px-1 py-0.5" : "aspect-square justify-center gap-1"} ${isSelected ? "bg-blue-600 text-white shadow-xl shadow-blue-200" : "hover:bg-gray-50"}`}
                        >
                          <div className="w-full flex items-center justify-between">
                            <span className={`text-lg sm:text-xl font-black ${isToday && !isSelected ? "text-blue-600" : ""}`}>{format(day, "d")}</span>
                          </div>
                          <div className="mt-auto flex items-center justify-center gap-0.5 sm:gap-1">
                            {dayAvails.slice(0, 3).map((a, idx) => (
                              <span key={idx} className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${a.status === "confirmed" ? "bg-red-500" : a.status === "busy" ? "bg-red-900" : a.status === "pending" ? "bg-orange-500" : "bg-gray-400"}`} />
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Card>

                <div className="lg:col-span-4 space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black">{format(selectedDate, "M/d (E)", { locale: ja })}の予定</h3>
                    <Button onClick={() => openAvailabilityModal(undefined, selectedDate)} variant="outline" icon={Plus} className="p-2 h-10 w-10 rounded-full" />
                  </div>
                  
                  <div className="space-y-4">
                    {displayedAvailabilities
                      .filter(a => isSameDay(parseISO(a.date), selectedDate))
                      .length > 0 ? (
                        displayedAvailabilities
                          .filter(a => isSameDay(parseISO(a.date), selectedDate))
                          .map(a => (
                            <Card key={a.id} className="p-5 space-y-3 group relative">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className={`w-2 h-2 rounded-full ${
                                    a.status === "confirmed" ? "bg-red-500" : 
                                    a.status === "pending" ? "bg-orange-500" : 
                                    a.status === "busy" ? "bg-red-900" : "bg-gray-400"
                                  }`}></div>
                                  <p className="text-lg font-black">{a.start_time} - {a.end_time}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button onClick={() => a.status === "confirmed" ? alert("確定のため変更できません。") : openAvailabilityModal(a)} className={`transition-colors ${a.status === "confirmed" ? "text-gray-200" : "text-gray-300 hover:text-blue-500"}`}>
                                    <Pencil size={16} />
                                  </button>
                                </div>
                              </div>
                              {a.note && <p className="text-sm text-red-500 font-medium">{a.note}</p>}
                              <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                              <span className={`text-[10px] font-bold uppercase tracking-widest ${
                                  a.status === "confirmed" ? "text-red-500" : 
                                  a.status === "pending" ? "text-orange-500" : 
                                  a.status === "busy" ? "text-red-900" : "text-gray-400"
                                }`}>
                                  {a.status === "confirmed" ? "確定済み" : statusLabel(a.status)}
                              </span>
                              </div>
                            </Card>
                          ))
                      ) : (
                        <div className="py-12 text-center space-y-4 bg-white rounded-3xl border border-dashed border-gray-200">
                          <p className="text-gray-400 font-bold">予定がありません</p>
                        </div>
                      )}
                  </div>

                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-black">ちょい先の予定</h3>
                    </div>
                    <div className="space-y-3">
                      {Array.from({ length: 3 }, (_, i) => addDays(new Date(), i + 1)).map(day => {
                        const dayItems = displayedAvailabilities
                          .filter(a => isSameDay(parseISO(a.date), day))
                          .filter(a => parseISO(a.date) >= new Date(new Date().setHours(0,0,0,0)))
                          .sort((a, b) => `${a.start_time}`.localeCompare(`${b.start_time}`));
                        return (
                          <div key={day.toISOString()} className="pt-3 border-t border-gray-100 first:border-t-0 first:pt-0">
                            <p className={`font-black ${day.getDay() === 0 ? "text-red-500" : day.getDay() === 6 ? "text-blue-500" : "text-gray-900"}`}>
                              {format(day, "M月d日(E)", { locale: ja })}
                            </p>
                            {dayItems.length > 0 ? (
                              <div className="mt-2 space-y-2">
                                {dayItems.map(a => (
                                  <div key={a.id} className="flex items-center justify-between">
                                    <p className="text-sm text-gray-600">{a.start_time} - {a.end_time}</p>
                                    <span className={`text-xs font-black ${a.status === "confirmed" ? "text-red-500" : "text-gray-400"}`}>{a.status === "confirmed" ? "確" : "空"}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-400 mt-2">予定の登録なし</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
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
                    <div className="flex items-center gap-6">
                      <div className="w-20 h-20 bg-gray-100 rounded-3xl overflow-hidden">
                        {avatarIsGuestDefault ? (
                          <div className="w-full h-full flex items-center justify-center">
                            <User size={38} className="text-gray-400" />
                          </div>
                        ) : (
                          <img src={avatarSrc} alt="avatar" />
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        {isEditingName ? (
                          <div className="flex gap-2">
                            <input 
                              value={newName} 
                              onChange={e => setNewName(e.target.value)}
                              className="flex-1 px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                          <div className="flex items-center justify-between">
                            <p className="text-2xl font-black">{currentUser?.name}</p>
                            <Button onClick={() => setIsEditingName(true)} variant="ghost">編集</Button>
                          </div>
                        )}
                        <p className="text-gray-400 font-medium">{accountLabel}</p>
                        {isGuestUser && <p className="text-xs text-gray-500 font-semibold">ゲストIDは設定から確認できます。</p>}
                        {isGuestUser && (
                          <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4 text-sm space-y-1">
                            <p className="font-bold">ID: {currentUser?.search_id}</p>
                            <p className="font-bold">PASS: {currentUser?.guest_password || "未設定"}</p>
                            <Button
                              onClick={async () => {
                                if (!currentUser) return;
                                const nextPassword = Math.random().toString(36).slice(2, 10);
                                await updateDoc(doc(db, "users", currentUser.uid), { guest_password: nextPassword });
                                setCurrentUser({ ...currentUser, guest_password: nextPassword });
                              }}
                              variant="outline"
                              className="w-full mt-2"
                            >
                              パスワード更新
                            </Button>
                          </div>
                        )}
                        <div className="pt-3 space-y-2">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">プロフィール画像URL</label>
                          <div className="flex gap-2">
                            <input
                              value={newAvatarUrl}
                              onChange={e => setNewAvatarUrl(e.target.value)}
                              placeholder="https://..."
                              className="flex-1 px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <Button onClick={handleSaveAvatar} variant="outline">保存</Button>
                          </div>
                        </div>
                        <div className="pt-3 space-y-2">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">共有期間</label>
                          <div className="flex gap-2">
                            {[7, 14, 30].map(days => (
                              <button
                                key={days}
                                onClick={async () => {
                                  if (!currentUser) return;
                                  await updateDoc(doc(db, "users", currentUser.uid), { share_period_days: days });
                                  setCurrentUser({ ...currentUser, share_period_days: days as 7 | 14 | 30 });
                                }}
                                className={`px-4 py-3 rounded-xl text-sm font-black ${currentUser?.share_period_days === days ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-600"}`}
                              >
                                {days === 7 ? "1週間" : days === 14 ? "2週間" : "1か月"}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="pt-3 space-y-2">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">表示トグル</label>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setShowWeekdayTemplate(v => !v)}
                              className={`px-4 py-3 rounded-xl text-sm font-black ${showWeekdayTemplate ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-600"}`}
                            >
                              隔週平日
                            </button>
                            <button
                              onClick={() => setShowWeekendTemplate(v => !v)}
                              className={`px-4 py-3 rounded-xl text-sm font-black ${showWeekendTemplate ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-600"}`}
                            >
                              隔週土日
                            </button>
                          </div>
                          <p className="text-xs text-gray-500">オンのときだけ空きとして表示され、オフにすると消えます。依頼は通常どおりDBに登録されます。</p>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-6 pt-8 border-t border-gray-100">
                    <h3 className="text-xl font-black flex items-center gap-3">
                      <Users size={24} className="text-blue-600" />
                      フォロー / フォロワー
                    </h3>
                    <div className="space-y-4">
                      <p className="text-gray-600 font-bold">
                        フォロー {connections.filter(c => c.user1_id === currentUser?.uid).length}件 / フォロワー {connections.filter(c => c.user2_id === currentUser?.uid).length}件
                      </p>
                      <p className="text-sm text-gray-400">フォロワーはあなたの予定を見られます。招待URLから自動でフォローされます。</p>
                      {connectionUsers.length > 0 ? (
                        <div className="space-y-3">
                          {connectionUsers.map(peer => (
                            <div key={peer.uid} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-full overflow-hidden bg-white">
                                  <img
                                    src={peer.avatar_url || peer.line_picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${peer.name}`}
                                    alt={peer.name}
                                  />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-bold truncate">{peer.name}</p>
                                  <p className="text-xs text-gray-400 truncate">{peer.current_role === "manager" ? "マネージャー" : "クルー"}</p>
                                </div>
                              </div>
                              <Button
                                onClick={() => window.location.href = `${window.location.origin}?share=${peer.share_token}`}
                                variant="outline"
                                icon={CalendarDays}
                                className="shrink-0"
                              >
                                予定を見る
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-gray-400 text-sm italic">フォローはまだありません</p>
                      )}
                    </div>
                  </section>

                  <section className="space-y-6 pt-8 border-t border-gray-100">
                    <h3 className="text-xl font-black flex items-center gap-3">
                      <MessageCircle size={24} className="text-[#06C755]" />
                      LINE連携
                    </h3>
                    {currentUser?.line_user_id ? (
                      <div className="bg-emerald-50 p-6 rounded-3xl flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-[#06C755]">
                            <Check size={24} />
                          </div>
                          <div>
                            <p className="font-bold text-emerald-900">連携済み</p>
                        <p className="text-sm text-emerald-700">連携済みです。</p>
                          </div>
                        </div>
                        <Button variant="ghost" className="text-emerald-600">解除</Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-gray-500">設定からLINE連携やGoogle連携を案内します。</p>
                        <Button onClick={handleLineLogin} variant="line" icon={MessageCircle} className="w-full">
                          LINEと連携する
                        </Button>
                      </div>
                    )}
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
            { id: "dashboard", label: "ダッシュボード", icon: LayoutDashboard },
            { id: "calendar", label: "スケジュール", icon: CalendarDays },
            { id: "settings", label: "設定", icon: Settings },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => { setView(item.id as "dashboard" | "calendar" | "settings"); setShowMobileMenu(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-gray-50 text-left font-bold"
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
          <button onClick={() => { openAvailabilityModal(undefined, new Date()); setShowMobileMenu(false); }} className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-blue-600 text-white font-black mt-2">
            <Plus size={18} />
            予定の追加
          </button>
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
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
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
              className="relative w-full max-w-lg bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] p-8 sm:p-10 shadow-2xl overflow-hidden"
            >
              <div className="w-12 h-1.5 bg-gray-100 rounded-full mx-auto mb-6 sm:hidden" />
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-black tracking-tight">{editingAvailability ? "予定を編集" : "予定を追加"}</h3>
                <button onClick={closeAvailabilityModal} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X/></button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">日付</label>
                  <input
                    type="date"
                    value={draftDate}
                    onChange={e => setDraftDate(e.target.value)}
                    className="w-full p-4 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">状態</label>
                  <div className="flex flex-wrap gap-2">
                    {["open", "busy"].map(status => (
                      <button
                        key={status}
                        onClick={() => setDraftStatus(status as Availability["status"])}
                        className={`px-4 py-3 rounded-xl text-sm font-black ${draftStatus === status ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-600"}`}
                      >
                        {status === "open" ? "空き" : "予定有り"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">開始</label>
                    <input
                      type="time"
                      value={draftTime.start}
                      onChange={e => setDraftTime({ ...draftTime, start: e.target.value })}
                      className="w-full p-4 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">終了</label>
                    <input
                      type="time"
                      value={draftTime.end}
                      onChange={e => setDraftTime({ ...draftTime, end: e.target.value })}
                      className="w-full p-4 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="w-full p-4 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs font-semibold text-red-600">カレンダーを共有したときにも表示されます。</p>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button
                    onClick={handleSaveAvailability}
                    className="flex-1 py-4 font-black"
                    disabled={isSaving}
                  >
                    {editingAvailability ? "保存する" : "予定を登録"}
                  </Button>
                  <Button
                    onClick={closeAvailabilityModal}
                    variant="outline"
                    className="flex-1 py-4 font-black"
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
                      className="w-full"
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



