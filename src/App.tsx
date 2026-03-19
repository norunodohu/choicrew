import React, { useState, useEffect, useCallback, useRef } from "react";
import { 
  Calendar, 
  Clock, 
  Settings, 
  Share2, 
  Plus, 
  Trash2, 
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
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showBellDropdown, setShowBellDropdown] = useState(false);
  const [dashboardDateOffset, setDashboardDateOffset] = useState(0);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAvailability, setEditingAvailability] = useState<Availability | null>(null);
  const [newAvailDate, setNewAvailDate] = useState(format(selectedDate, "yyyy-MM-dd"));
  const [newAvailTime, setNewAvailTime] = useState({ start: "10:00", end: "15:00" });
  const [newAvailNote, setNewAvailNote] = useState("");
  const [newAvailStatus, setNewAvailStatus] = useState<Availability["status"]>("open");
  const [newAvatarUrl, setNewAvatarUrl] = useState("");
  const [showPastCalendarItems, setShowPastCalendarItems] = useState(false);

  const requestSectionRef = useRef<HTMLDivElement | null>(null);
  const confirmedSectionRef = useRef<HTMLDivElement | null>(null);

  const isGuestUser = !currentUser?.email && !currentUser?.line_user_id;
  const accountLabel = isGuestUser ? "ゲストユーザー" : "クルー";
  const shareLink = currentUser ? `${window.location.origin}?share=${currentUser.share_token}` : "";
  const avatarSrc = currentUser?.avatar_url || currentUser?.line_picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser?.name || "choicrew"}`;
  const isOwnPreview = isPublicView && Boolean(currentUser?.uid && publicUser?.uid && currentUser.uid === publicUser.uid);
  const incomingRequests = currentUser
    ? requests.filter(r => r.staff_id === currentUser.uid && r.status === "pending")
    : [];
  const confirmedAvailabilities = availabilities
    .filter(a => a.status === "confirmed")
    .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
  const monthlyAvailabilities = availabilities
    .filter(a => {
      const d = parseISO(a.date);
      return d.getFullYear() === selectedDate.getFullYear() && d.getMonth() === selectedDate.getMonth();
    })
    .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
  const openAvailabilityModal = (availability?: Availability) => {
    if (availability) {
      setEditingAvailability(availability);
      setNewAvailDate(availability.date);
      setNewAvailTime({ start: availability.start_time, end: availability.end_time });
      setNewAvailNote(availability.note || "");
      setNewAvailStatus(availability.status);
    } else {
      setEditingAvailability(null);
      setNewAvailDate(format(selectedDate, "yyyy-MM-dd"));
      setNewAvailTime({ start: "10:00", end: "15:00" });
      setNewAvailNote("");
      setNewAvailStatus("open");
    }
    setShowAddModal(true);
  };

  const closeAvailabilityModal = () => {
    setShowAddModal(false);
    setEditingAvailability(null);
  };

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
          name: profile.displayName || existingData.name,
          line_user_id: profile.userId,
          line_picture: profile.pictureUrl,
          avatar_url: existingData.avatar_url,
          notification_pref: "line"
        };
        await updateDoc(doc(db, "users", firebaseUser.uid), {
          line_user_id: profile.userId,
          line_picture: profile.pictureUrl,
          notification_pref: "line",
          name: updatedProfile.name
        });
        setCurrentUser(updatedProfile);
      } else {
        const newProfile: UserProfile = {
          uid: firebaseUser.uid,
          search_id: firebaseUser.uid.slice(0, 8),
          name: profile.displayName || "User",
          email: firebaseUser.email || "",
          role: "staff",
          current_role: "staff",
          share_token: Math.random().toString(36).substring(2, 15),
          accept_requests: true,
          line_user_id: profile.userId,
          line_picture: profile.pictureUrl,
          avatar_url: "",
          notification_pref: "line"
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
            const newProfile: UserProfile = {
              uid: user.uid,
              search_id: user.uid.slice(0, 8),
              name: user.displayName || (user.isAnonymous ? "ゲストユーザー" : "クルー"),
              email: user.email || "",
              role: "staff",
              current_role: "staff",
              share_token: Math.random().toString(36).substring(2, 15),
              accept_requests: !user.isAnonymous,
              avatar_url: ""
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
        date: newAvailDate,
        start_time: newAvailTime.start,
        end_time: newAvailTime.end,
        status: newAvailStatus,
        note: newAvailNote,
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
      setNewAvailNote("");
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

  const handleSendRequest = async (availability: Availability) => {
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
        status: "pending",
        created_at: serverTimestamp()
      };
      const requestRef = await addDoc(collection(db, "requests"), reqData);

      const staffDoc = await getDoc(doc(db, "users", availability.user_id));
      const staffData = staffDoc.data() as UserProfile;

      await createNotification(
        availability.user_id,
        "request",
        `${currentUser.name}さんから依頼が届きました。${availability.date} ${availability.start_time}-${availability.end_time}`, 
        availability.date
      );

      if (staffData?.line_user_id) {
        const lineResult = await sendLineNotification(
          staffData.line_user_id,
          `${currentUser.name}さんから依頼が届きました。\n${availability.date} ${availability.start_time}-${availability.end_time}`
        );
        alert(`依頼を送信しました。\n${buildLineNotificationAlert(lineResult)}`);
      } else {
        alert(`依頼を送信しました。\nLINE通知: ${describeLineNotificationResult({
          success: false,
          reason: "line_user_missing",
        })}`);
      }
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

    const managerDoc = await getDoc(doc(db, "users", request.manager_id));
    const managerData = managerDoc.data() as UserProfile;
    await createNotification(
      request.manager_id,
      "approval",
      `${currentUser.name}さんが依頼を承認しました。${request.date} ${request.start_time}-${request.end_time}`, 
      request.date
    );

    let lineResult: LineNotificationResult = {
      success: false,
      reason: "line_user_missing",
    };
    if (managerData?.line_user_id) {
      lineResult = await sendLineNotification(
        managerData.line_user_id,
        `${currentUser.name}さんが依頼を承認しました。\n${request.date} ${request.start_time}-${request.end_time}`
      );
    }
    alert(`承認しました。\n${buildLineNotificationAlert(lineResult)}`);
  };

  const handleRejectRequest = async (request: ShiftRequest) => {
    if (!currentUser) return;
    await updateDoc(doc(db, "requests", request.id), { status: "canceled" });
    await updateDoc(doc(db, "availabilities", request.availability_id), { status: "open" });

    const managerDoc = await getDoc(doc(db, "users", request.manager_id));
    const managerData = managerDoc.data() as UserProfile;
    await createNotification(
      request.manager_id,
      "decline",
      `${currentUser.name}さんが依頼を削除しました。${request.date} ${request.start_time}-${request.end_time}`, 
      request.date
    );

    let lineResult: LineNotificationResult = {
      success: false,
      reason: "line_user_missing",
    };
    if (managerData?.line_user_id) {
      lineResult = await sendLineNotification(
        managerData.line_user_id,
        `${currentUser.name}さんが依頼を削除しました。\n${request.date} ${request.start_time}-${request.end_time}`
      );
    }
    alert(`削除しました。\n${buildLineNotificationAlert(lineResult)}`);
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

  const handleCreateTemplateAvailabilities = async (mode: "weekend" | "weekday") => {
    if (!currentUser) return;
    const startTime = currentUser.default_start || "09:00";
    const endTime = currentUser.default_end || "17:00";
    const today = new Date();
    const batchDates: string[] = [];
    for (let i = 0; i < 56; i++) {
      const date = addDays(today, i);
      const weekIndex = Math.floor(i / 7);
      const isAltWeek = weekIndex % 2 === 0;
      const day = date.getDay();
      const matches = mode === "weekend"
        ? (day === 0 || day === 6)
        : (day >= 1 && day <= 5);
      if (matches && isAltWeek) {
        batchDates.push(format(date, "yyyy-MM-dd"));
      }
    }

    for (const date of batchDates) {
      await addDoc(collection(db, "availabilities"), {
        user_id: currentUser.uid,
        user_name: currentUser.name,
        date,
        start_time: startTime,
        end_time: endTime,
        status: "open",
        note: mode === "weekend" ? "隔週土日テンプレ" : "隔週平日テンプレ",
        created_at: serverTimestamp()
      });
    }
    alert("テンプレ予定を追加しました。");
  };

  const handleDeleteOpenAvailabilities = async () => {
    if (!currentUser) return;
    const openSnap = await getDocs(
      query(collection(db, "availabilities"), where("user_id", "==", currentUser.uid), where("status", "==", "open"))
    );
    const batch = writeBatch(db);
    openSnap.docs.forEach(d => batch.delete(doc(db, "availabilities", d.id)));
    await batch.commit();
    alert("空き時間をすべて削除しました。");
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
      <motion.div 
        animate={{ rotate: 360 }} 
        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full"
      />
    </div>
  );

  if (!isLoggedIn && !isPublicView) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md space-y-12 text-center"
        >
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
        </motion.div>
      </div>
    );
  }

  if (isPublicView && publicUser) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] p-6 lg:p-12">
        <div className="max-w-2xl mx-auto space-y-8">
          <div className="flex items-center gap-6">
            <img
              src={CHOICREW_LOGO}
              alt="ChoiCrew logo"
              className="w-28 shrink-0 drop-shadow-[0_18px_32px_rgba(37,99,235,0.14)]"
            />
              <div>
                <h1 className="text-3xl font-black tracking-tight">{publicUser.name}さんの予定</h1>
                <p className="text-gray-500 font-medium">空き時間を確認して、依頼を送れます。</p>
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
              {availabilities.length > 0 ? (
                availabilities.map(a => (
                  <Card key={a.id} className="p-6 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                      <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                        <Clock size={24} />
                      </div>
                      <div>
                        <p className="text-lg font-bold">{format(parseISO(a.date), "M月d日 (E)", { locale: ja })}</p>
                        <p className="text-2xl font-black">{a.start_time} - {a.end_time}</p>
                      </div>
                    </div>
                    {isOwnPreview ? (
                      <Button variant="outline" disabled>プレビュー中</Button>
                    ) : isLoggedIn ? (
                      <Button onClick={() => handleSendRequest(a)} variant="outline">依頼する</Button>
                    ) : (
                      <Button onClick={() => alert("依頼を送るにはログインが必要です。") } variant="outline">依頼する</Button>
                    )}
                  </Card>
                ))
              ) : (
                <div className="py-12 text-center bg-white rounded-3xl border border-dashed border-gray-200 text-gray-400 font-bold">
                  予定はまだありません
                </div>
              )}
            </div>
          </div>

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
            <div className="w-12 h-12 bg-gray-100 rounded-full overflow-hidden">
              <img
                src={avatarSrc}
                alt="avatar"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold truncate">{currentUser?.name}</p>
              <p className="text-xs text-gray-400 truncate">{accountLabel}</p>
            </div>
          </div>
          <Button onClick={() => signOut(auth)} variant="danger" className="w-full" icon={LogOut}>
            ログアウト
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`lg:ml-72 min-h-screen pb-32 lg:pb-12`}>
        {/* Header */}
        <header className="sticky top-0 z-10 bg-[#F8FAFC]/80 backdrop-blur-md px-6 py-6 lg:px-12 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest">
              {view === "dashboard" ? "Overview" : view === "calendar" ? "Schedule" : "Preferences"}
            </h2>
            <h1 className="text-3xl font-black tracking-tight">
              {view === "dashboard" ? "ダッシュボード" : view === "calendar" ? "カレンダー" : "設定"}
            </h1>
          </div>

          <div className="flex items-center gap-3 relative">
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
              <div className="absolute right-6 top-24 z-20 w-[min(90vw,24rem)] bg-white rounded-3xl shadow-2xl border border-gray-100 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-black text-lg">通知</p>
                  <span className="text-xs text-gray-400">{notifications.length}件</span>
                </div>
                <div className="max-h-80 overflow-y-auto space-y-2">
                  {notifications.length > 0 ? notifications.map(notification => (
                    <div key={notification.id} className={`p-4 rounded-2xl border ${notification.read ? "bg-gray-50 border-gray-100" : "bg-blue-50 border-blue-100"}`}>
                      <p className="text-sm font-bold">{notification.message}</p>
                      <p className="text-[11px] text-gray-400 mt-1">{notification.type}</p>
                    </div>
                  )) : (
                    <p className="text-sm text-gray-400 p-4 text-center">通知はまだありません</p>
                  )}
                </div>
              </div>
            )}
            <Button onClick={() => openAvailabilityModal()} icon={Plus} className="hidden sm:flex">
              予定を追加
            </Button>
          </div>
        </header>

        <div className="px-6 lg:px-12">
          <AnimatePresence mode="wait">
            {view === "dashboard" && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                {/* Quick Actions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="p-8 bg-blue-600 text-white border-none relative overflow-hidden group">
                    <div className="relative z-10 space-y-4">
                      <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                        <Share2 size={24} />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold">空き情報を共有</h3>
                        <p className="text-blue-100 text-sm">このリンクからあなたの予定が共有されます。一度プレビューでご確認ください。</p>
                      </div>
                      <input
                        readOnly
                        value={shareLink}
                        className="w-full px-4 py-3 rounded-2xl bg-white/95 text-blue-700 text-sm font-mono border border-white/30 outline-none"
                      />
                      <Button onClick={copyShareLink} variant="secondary" className="w-full bg-white text-blue-600">
                        共有リンクをコピー
                      </Button>
                      <Button onClick={handleRefreshShareToken} variant="ghost" className="w-full text-white/90 border border-white/20">
                        <Link2 size={18} />
                        招待URLを更新
                      </Button>
                    </div>
                    <Share2 size={120} className="absolute -right-8 -bottom-8 text-white/10 group-hover:scale-110 transition-transform" />
                  </Card>

                  <Card className="p-8 space-y-4" interactive onClick={() => scrollToSection(confirmedSectionRef)}>
                    <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                      <Check size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">確定件数</h3>
                      <p className="text-gray-400 text-sm">確定している予定の数</p>
                    </div>
                      <p className="text-4xl font-black">{availabilities.filter(a => a.status === "confirmed").length}<span className="text-lg font-bold ml-1">件</span></p>
                  </Card>

                  <Card className="p-8 space-y-4" interactive onClick={() => scrollToSection(requestSectionRef)}>
                    <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center">
                      <Clock size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">受信リクエスト</h3>
                      <p className="text-gray-400 text-sm">承認待ちの依頼</p>
                    </div>
                    <p className="text-4xl font-black">{incomingRequests.length}<span className="text-lg font-bold ml-1">件</span></p>
                  </Card>

                  <Card className="p-8 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center">
                        <Settings size={24} />
                      </div>
                      <button 
                        onClick={async () => {
                          if (isGuestUser) return;
                          if (!currentUser) return;
                          const newVal = !currentUser.accept_requests;
                          await updateDoc(doc(db, "users", currentUser.uid), { accept_requests: newVal });
                          setCurrentUser({ ...currentUser, accept_requests: newVal });
                        }}
                        disabled={isGuestUser}
                        className={`w-12 h-6 rounded-full transition-all relative ${isGuestUser ? "bg-gray-200 opacity-60" : currentUser?.accept_requests ? "bg-blue-600" : "bg-gray-200"}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isGuestUser ? "left-1" : currentUser?.accept_requests ? "left-7" : "left-1"}`} />
                      </button>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">依頼受付</h3>
                      <p className="text-gray-400 text-sm">新規リクエストの許可</p>
                    </div>
                    <p className="text-lg font-black text-gray-700">{isGuestUser ? "ゲストは不可" : currentUser?.accept_requests ? "受付中" : "停止中"}</p>
                    {isGuestUser && <p className="text-xs text-gray-400">ゲストユーザーは依頼の受信と承認はできません。</p>}
                  </Card>
                </div>

                {isGuestUser && (
                  <Card className="p-6 border-amber-100 bg-amber-50/70">
                    <p className="font-bold text-amber-900">ゲストユーザーは予定の作成・変更・削除のみできます。依頼の受信や承認はクルーでログインしたときに使えます。</p>
                    <p className="text-sm text-amber-700 mt-2">ログインすると通知センターも使えます。LINE連携済みなら通知が届きます。</p>
                  </Card>
                )}

                {incomingRequests.length > 0 && (
                  <div className="space-y-4" ref={requestSectionRef}>
                    <div className="flex items-center justify-between">
                      依頼の受信
                      <span className="text-sm text-gray-400 font-bold">{incomingRequests.length}件</span>
                    </div>
                    <div className="grid gap-4">
                      {incomingRequests.map(request => (
                        <Card key={request.id} className="p-6 space-y-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-lg font-black">{request.date} {request.start_time}-{request.end_time}</p>
                              <p className="text-sm text-gray-400 font-medium">{request.manager_name}さんからの依頼</p>
                            </div>
                            <span className="px-3 py-1 rounded-full bg-orange-50 text-orange-600 text-xs font-black">承認待ち</span>
                          </div>
                          <div className="flex gap-3">
                            <Button onClick={() => handleApproveRequest(request)} className="flex-1" icon={Check}>承認</Button>
                            <Button onClick={() => handleRejectRequest(request)} variant="outline" className="flex-1" icon={X}>削除</Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Today's Schedule */}
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-black tracking-tight">今日の予定</h3>
                    <div className="flex gap-2">
                      {[0, 1, 2].map(offset => (
                        <button 
                          key={offset}
                          onClick={() => setDashboardDateOffset(offset)}
                          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${dashboardDateOffset === offset ? "bg-gray-900 text-white" : "bg-white text-gray-400 border border-gray-100"}`}
                        >
                          {offset === 0 ? "今日" : offset === 1 ? "明日" : format(addDays(new Date(), offset), "M/d")}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4">
                    {availabilities
                      .filter(a => isSameDay(parseISO(a.date), addDays(new Date(), dashboardDateOffset)))
                      .length > 0 ? (
                        availabilities
                          .filter(a => isSameDay(parseISO(a.date), addDays(new Date(), dashboardDateOffset)))
                          .map(a => (
                            <Card key={a.id} className="p-6 flex items-center justify-between group">
                              <div className="flex items-center gap-6">
                                <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center ${
                                  a.status === "confirmed" ? "bg-red-50 text-red-600" : 
                                  a.status === "pending" ? "bg-orange-50 text-orange-600" : 
                                  a.status === "busy" ? "bg-red-900/10 text-red-900" : "bg-blue-50 text-blue-600"
                                }`}>
                                  <Clock size={20} />
                                </div>
                                <div>
                                  <p className="text-xl font-black">{a.start_time} - {a.end_time}</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className={`w-2 h-2 rounded-full ${
                                      a.status === "confirmed" ? "bg-red-500" : 
                                      a.status === "pending" ? "bg-orange-500" : 
                                      a.status === "busy" ? "bg-red-900" : "bg-blue-500"
                                    }`}></span>
                                  <p className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                                    {a.status === "open" ? "空き" : a.status === "pending" ? "依頼中" : a.status === "confirmed" ? "確定" : "予定あり"}
                                  </p>
                                    {a.note && <span className="text-xs text-gray-300 font-medium ml-2">| {a.note}</span>}
                                  </div>
                                </div>
                              </div>
                              <button onClick={() => handleDeleteAvailability(a.id)} className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100">
                                <Trash2 size={20} />
                              </button>
                            </Card>
                          ))
                      ) : (
                        <div className="py-12 text-center space-y-4 bg-white rounded-3xl border border-dashed border-gray-200">
                          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto text-gray-300">
                            <Calendar size={32} />
                          </div>
                          <p className="text-gray-400 font-bold">予定がありません</p>
                          <Button onClick={() => openAvailabilityModal()} variant="outline" icon={Plus}>予定を追加する</Button>
                        </div>
                      )}
                  </div>
                </div>
              </motion.div>
            )}

            {view === "calendar" && (
              <motion.div 
                key="calendar"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="grid grid-cols-1 lg:grid-cols-12 gap-8"
              >
                <Card className="lg:col-span-8 p-8">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-2xl font-black">{format(selectedDate, "yyyy年 M月", { locale: ja })}</h3>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedDate(addMonths(selectedDate, -1))} className="p-3 rounded-xl hover:bg-gray-100"><ChevronLeft size={20}/></button>
                      <button onClick={() => setSelectedDate(addMonths(selectedDate, 1))} className="p-3 rounded-xl hover:bg-gray-100"><ChevronRight size={20}/></button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-7 gap-2 sm:gap-4">
                    {["日", "月", "火", "水", "木", "金", "土"].map(d => (
                      <div key={d} className="text-center text-xs font-black text-gray-400 uppercase pb-4">{d}</div>
                    ))}
                    {eachDayOfInterval({
                      start: startOfMonth(selectedDate),
                      end: endOfMonth(selectedDate)
                    }).map(day => {
                      const dayAvails = availabilities.filter(a => isSameDay(parseISO(a.date), day));
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
                          className={`aspect-square rounded-2xl flex flex-col items-center justify-center gap-1 transition-all relative ${isSelected ? "bg-blue-600 text-white shadow-xl shadow-blue-200" : "hover:bg-gray-50"}`}
                        >
                          <span className={`text-lg font-black ${isToday && !isSelected ? "text-blue-600" : ""}`}>{format(day, "d")}</span>
                          {chipText && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full text-white font-bold ${isSelected ? "bg-white/20" : chipColor}`}>
                              {chipText}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </Card>

                <div className="lg:col-span-4 space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black">{format(selectedDate, "M/d (E)", { locale: ja })}の予定</h3>
                    <Button onClick={() => openAvailabilityModal()} variant="outline" icon={Plus} className="p-2 h-10 w-10 rounded-full" />
                  </div>
                  
                  <div className="space-y-4">
                    {availabilities
                      .filter(a => isSameDay(parseISO(a.date), selectedDate))
                      .length > 0 ? (
                        availabilities
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
                                  <button onClick={() => openAvailabilityModal(a)} className="text-gray-300 hover:text-blue-500 transition-colors">
                                    <Pencil size={16} />
                                  </button>
                                  <button onClick={() => handleDeleteAvailability(a.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                              {a.note && <p className="text-sm text-gray-500 font-medium">{a.note}</p>}
                              <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                                <span className={`text-[10px] font-bold uppercase tracking-widest ${
                                  a.status === "confirmed" ? "text-red-500" : 
                                  a.status === "pending" ? "text-orange-500" : 
                                  a.status === "busy" ? "text-red-900" : "text-gray-400"
                                }`}>
                                  {a.status === "open" ? "空き" : a.status === "pending" ? "依頼中" : a.status === "confirmed" ? "確定" : "予定あり"}
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
                      <h3 className="text-lg font-black">1か月分の予定</h3>
                      <button
                        onClick={() => setShowPastCalendarItems(v => !v)}
                        className="text-sm font-bold text-blue-600 hover:underline"
                      >
                        {showPastCalendarItems ? "過去分を隠す" : "過去分を表示"}
                      </button>
                    </div>
                    <div className="space-y-3">
                      {(showPastCalendarItems ? monthlyAvailabilities : monthlyAvailabilities.filter(a => parseISO(a.date) >= new Date(new Date().setHours(0,0,0,0)))).map(a => (
                        <Card key={a.id} className="p-4 flex items-center justify-between">
                          <div>
                            <p className="font-black">{format(parseISO(a.date), "M/d (E)", { locale: ja })}</p>
                            <p className="text-sm text-gray-500">{a.start_time} - {a.end_time}</p>
                          </div>
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                            {a.status === "open" ? "空き" : a.status === "pending" ? "依頼中" : a.status === "confirmed" ? "確定" : "予定あり"}
                          </span>
                        </Card>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {view === "settings" && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
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
                        <img
                          src={avatarSrc}
                          alt="avatar"
                        />
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
                               await updateDoc(doc(db, "users", currentUser.uid), { name: newName });
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
                        <p className="text-xs text-blue-600 font-semibold">ログイン中は通知センターが使えます。LINE連携でプッシュ通知も届きます。</p>
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
                      <Clock size={24} className="text-blue-600" />
                      時間プリセット
                    </h3>
                    <p className="text-sm text-gray-400">テンプレ予定として、隔週の土日や平日をまとめて空きにできます。空きだけ一括削除もできます。</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {presets.length > 0 ? (
                        presets.map(p => (
                          <div key={p.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-between">
                            <div>
                              <p className="font-bold">{p.name}</p>
                              <p className="text-sm text-gray-400">{p.start} - {p.end}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-gray-400 text-sm italic">登録されているプリセットはありません</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Button onClick={() => handleCreateTemplateAvailabilities("weekend")} variant="outline">隔週土日を追加</Button>
                      <Button onClick={() => handleCreateTemplateAvailabilities("weekday")} variant="outline">隔週平日を追加</Button>
                      <Button onClick={handleDeleteOpenAvailabilities} variant="danger">空き時間をすべて削除</Button>
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
                        <p className="text-sm text-emerald-700">LINEで通知を受け取れます。友だち追加済みの公式アカウント宛てに送信します。</p>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Button onClick={handleTestLineNotification} variant="outline" className="border-emerald-200 text-emerald-700">
                            通知テスト
                          </Button>
                          <Button variant="ghost" className="text-emerald-600">解除</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-gray-500">LINEと連携すると、リクエストや通知をリアルタイムで受け取れます。通知を使うには公式アカウントの友だち追加が必要です。</p>
                        <Button onClick={handleLineLogin} variant="line" icon={MessageCircle} className="w-full">
                          LINEと連携する
                        </Button>
                      </div>
                    )}
                  </section>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Mobile Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-gray-100 px-6 py-4 flex items-center justify-between lg:hidden z-30">
        {[
          { id: "dashboard", icon: LayoutDashboard },
          { id: "calendar", icon: CalendarDays },
          { id: "add", icon: Plus, special: true },
          { id: "share", icon: Share2 },
          { id: "settings", icon: Settings },
        ].map(item => (
          <button
            key={item.id}
            onClick={() => {
              if (item.id === "add") openAvailabilityModal();
              else if (item.id === "share") copyShareLink();
              else setView(item.id as "dashboard" | "calendar" | "settings");
            }}
            className={`p-4 rounded-2xl transition-all ${item.special ? "bg-blue-600 text-white shadow-xl shadow-blue-200 -mt-12" : view === item.id ? "text-blue-600" : "text-gray-400"}`}
          >
            <item.icon size={24} />
          </button>
        ))}
      </nav>

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
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
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
                    value={newAvailDate}
                    onChange={e => setNewAvailDate(e.target.value)}
                    className="w-full p-4 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">プリセット</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "朝 (9-13)", start: "09:00", end: "13:00" },
                      { label: "昼 (13-17)", start: "13:00", end: "17:00" },
                      { label: "夕 (17-21)", start: "17:00", end: "21:00" },
                      { label: "夜 (21-24)", start: "21:00", end: "00:00" },
                      { label: "フル (9-21)", start: "09:00", end: "21:00" },
                    ].map(p => (
                      <button
                        key={p.label}
                        onClick={() => setNewAvailTime({ start: p.start, end: p.end })}
                        className="px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-100 transition-colors"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">開始</label>
                    <input
                      type="time"
                      value={newAvailTime.start}
                      onChange={e => setNewAvailTime({ ...newAvailTime, start: e.target.value })}
                      className="w-full p-4 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">終了</label>
                    <input
                      type="time"
                      value={newAvailTime.end}
                      onChange={e => setNewAvailTime({ ...newAvailTime, end: e.target.value })}
                      className="w-full p-4 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">状態</label>
                  <select
                    value={newAvailStatus}
                    onChange={e => setNewAvailStatus(e.target.value as Availability["status"])}
                    className="w-full p-4 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="open">空き</option>
                    <option value="pending">依頼中</option>
                    <option value="confirmed">確定</option>
                    <option value="busy">予定あり</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">予定名 (任意)</label>
                  <input
                    type="text"
                    placeholder="例: 授業、サークルなど"
                    value={newAvailNote}
                    onChange={e => setNewAvailNote(e.target.value)}
                    className="w-full p-4 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
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
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}



