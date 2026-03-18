import React, { useState, useEffect, useCallback } from "react";
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
  ArrowRight
} from "lucide-react";
import { 
  initializeApp 
} from "firebase/app";
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  signInAnonymously
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
  serverTimestamp,
  orderBy,
  limit,
  writeBatch
} from "firebase/firestore";
import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";

// Firebase Config
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);

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

// Components
const Card = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <div className={`bg-white/80 backdrop-blur-xl border border-white/20 rounded-3xl shadow-sm ${className}`}>
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
  
  const [view, setView] = useState<"dashboard" | "calendar" | "settings">("dashboard");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showBellDropdown, setShowBellDropdown] = useState(false);
  const [dashboardDateOffset, setDashboardDateOffset] = useState(0);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newAvailTime, setNewAvailTime] = useState({ start: "10:00", end: "15:00" });
  const [newAvailNote, setNewAvailNote] = useState("");
  
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
      let firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        const res = await signInAnonymously(auth);
        firebaseUser = res.user;
      }
      
      const q = query(collection(db, "users"), where("line_user_id", "==", profile.userId));
      const snap = await getDocs(q);
      
      if (!snap.empty) {
        const userData = snap.docs[0].data() as UserProfile;
        if (userData.uid !== firebaseUser.uid) {
          await migrateUserData(userData.uid, firebaseUser.uid);
          const updatedProfile = { 
            ...userData, 
            uid: firebaseUser.uid, 
            name: profile.displayName || userData.name,
            line_name: profile.displayName,
            line_picture: profile.pictureUrl
          };
          await setDoc(doc(db, "users", firebaseUser.uid), updatedProfile);
          if (!userData.email) await deleteDoc(doc(db, "users", userData.uid));
          setCurrentUser(updatedProfile);
        } else {
          setCurrentUser(userData);
        }
      } else {
        const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
        if (userDoc.exists()) {
          const existingData = userDoc.data() as UserProfile;
          const updatedProfile = { ...existingData, line_user_id: profile.userId, notification_pref: "line" };
          await updateDoc(doc(db, "users", firebaseUser.uid), { line_user_id: profile.userId, notification_pref: "line" });
          setCurrentUser(updatedProfile);
        } else {
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            search_id: firebaseUser.uid.slice(0, 8),
            name: profile.displayName || "User",
            email: "",
            role: "staff",
            current_role: "staff",
            share_token: Math.random().toString(36).substring(2, 15),
            accept_requests: true,
            line_user_id: profile.userId,
            notification_pref: "line"
          };
          await setDoc(doc(db, "users", firebaseUser.uid), newProfile);
          setCurrentUser(newProfile);
        }
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
              name: user.displayName || (user.isAnonymous ? "ゲスト" : "ユーザー"),
              email: user.email || "",
              role: "staff",
              current_role: "staff",
              share_token: Math.random().toString(36).substring(2, 15),
              accept_requests: !user.isAnonymous
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
  const handleGuestLogin = async () => {
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

  const handleAddAvailability = async (status: "open" | "busy") => {
    if (!currentUser) return;
    setIsSaving(true);
    try {
      await addDoc(collection(db, "availabilities"), {
        user_id: currentUser.uid,
        user_name: currentUser.name,
        date: format(selectedDate, "yyyy-MM-dd"),
        start_time: newAvailTime.start,
        end_time: newAvailTime.end,
        status: status,
        note: newAvailNote,
        created_at: serverTimestamp()
      });
      setShowAddModal(false);
      setNewAvailNote("");
    } catch (e: unknown) { console.error(e); }
    finally { setIsSaving(false); }
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
      await addDoc(collection(db, "requests"), reqData);
      
      // Notify via LINE if possible
      const staffDoc = await getDoc(doc(db, "users", availability.user_id));
      const staffData = staffDoc.data() as UserProfile;
      if (staffData?.line_user_id) {
        await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lineUserId: staffData.line_user_id,
            message: `${currentUser.name}さんからシフト依頼が届きました！\n日時: ${availability.date} ${availability.start_time}-${availability.end_time}`
          })
        });
      }
      
      alert("依頼を送信しました！");
    } catch (e: unknown) { console.error(e); }
  };

  const copyShareLink = () => {
    if (!currentUser) return;
    const link = `${window.location.origin}?share=${currentUser.share_token}`;
    navigator.clipboard.writeText(link);
    alert("共有リンクをコピーしました！");
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
            <div className="w-24 h-24 bg-blue-600 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-blue-200 rotate-12">
              <Calendar size={48} className="text-white" />
            </div>
            <h1 className="text-5xl font-black tracking-tighter text-gray-900">choicrew</h1>
<p className="text-xl text-gray-500 font-medium">
空き時間で、仲間をサポート。<br/>スキマ時間を楽しく活用
</p>
          </div>

          <div className="grid gap-4">
            <Button onClick={handleLineLogin} variant="line" icon={MessageCircle} className="py-5 text-lg">
              LINEでログイン
            </Button>
            <Button onClick={handleGoogleLogin} variant="outline" icon={User} className="py-5 text-lg">
              Googleでログイン
            </Button>
            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
              <div className="relative flex justify-center text-sm"><span className="px-4 bg-[#F8FAFC] text-gray-400">または</span></div>
            </div>
            <Button onClick={handleGuestLogin} variant="secondary" icon={ArrowRight} className="py-5 text-lg">
              ゲストとして今すぐ開始
            </Button>
          </div>

          <p className="text-sm text-gray-400">
            ログインすることで、<a href="#" className="underline">利用規約</a>と<a href="#" className="underline">プライバシーポリシー</a>に同意したことになります。
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
            <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center shadow-xl shadow-blue-100">
              <Calendar size={40} className="text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight">{publicUser.name}さんの予定</h1>
              <p className="text-gray-500 font-medium">空き時間を確認して依頼を送りましょう</p>
            </div>
          </div>

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
                    {isLoggedIn ? (
                      <Button onClick={() => handleSendRequest(a)} variant="outline">依頼する</Button>
                    ) : (
                      <Button onClick={() => alert("依頼を送るにはログインが必要です。")} variant="outline">依頼する</Button>
                    )}
                  </Card>
                ))
              ) : (
                <div className="py-12 text-center bg-white rounded-3xl border border-dashed border-gray-200 text-gray-400 font-bold">
                  公開中の予定はありません
                </div>
              )}
            </div>
          </div>

          <div className="pt-8 border-t border-gray-100 text-center">
            <p className="text-gray-400 mb-4 font-medium">あなたもchoicrewで予定を管理しませんか？</p>
            <Button onClick={() => window.location.href = window.location.origin} variant="primary">自分も使ってみる</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-gray-900 font-sans">
      {/* Sidebar Desktop */}
      <aside className="fixed left-0 top-0 bottom-0 w-72 bg-white border-r border-gray-100 hidden lg:flex flex-col p-8 z-20">
        <div className="flex items-center gap-3 mb-12">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-100">
            <Calendar size={20} className="text-white" />
          </div>
          <span className="text-2xl font-black tracking-tighter">choicrew</span>
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
              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser?.name}`} alt="avatar" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold truncate">{currentUser?.name}</p>
              <p className="text-xs text-gray-400 truncate">{currentUser?.email || "ゲストユーザー"}</p>
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
              {view === "dashboard" ? "こんにちは！" : view === "calendar" ? "カレンダー" : "設定"}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowBellDropdown(!showBellDropdown)}
              className="w-12 h-12 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-50 relative"
            >
              <Bell size={20} />
              {notifications.some(n => !n.read) && (
                <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
              )}
            </button>
            <Button onClick={() => setShowAddModal(true)} icon={Plus} className="hidden sm:flex">
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
                        <h3 className="text-xl font-bold">予定を共有</h3>
                        <p className="text-blue-100 text-sm">リンクを送るだけで調整完了</p>
                      </div>
                      <Button onClick={copyShareLink} variant="secondary" className="w-full bg-white text-blue-600">
                        リンクをコピー
                      </Button>
                    </div>
                    <Share2 size={120} className="absolute -right-8 -bottom-8 text-white/10 group-hover:scale-110 transition-transform" />
                  </Card>

                  <Card className="p-8 space-y-4">
                    <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                      <Check size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">確定済み</h3>
                      <p className="text-gray-400 text-sm">今週の確定シフト</p>
                    </div>
                    <p className="text-4xl font-black">{availabilities.filter(a => a.status === "confirmed").length}<span className="text-lg font-bold ml-1">件</span></p>
                  </Card>

                  <Card className="p-8 space-y-4">
                    <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center">
                      <Clock size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">リクエスト</h3>
                      <p className="text-gray-400 text-sm">承認待ちの依頼</p>
                    </div>
                    <p className="text-4xl font-black">{requests.filter(r => r.status === "pending").length}<span className="text-lg font-bold ml-1">件</span></p>
                  </Card>

                  <Card className="p-8 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center">
                        <Settings size={24} />
                      </div>
                      <button 
                        onClick={async () => {
                          if (!currentUser) return;
                          const newVal = !currentUser.accept_requests;
                          await updateDoc(doc(db, "users", currentUser.uid), { accept_requests: newVal });
                          setCurrentUser({ ...currentUser, accept_requests: newVal });
                        }}
                        className={`w-12 h-6 rounded-full transition-all relative ${currentUser?.accept_requests ? "bg-blue-600" : "bg-gray-200"}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${currentUser?.accept_requests ? "left-7" : "left-1"}`} />
                      </button>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">依頼受付</h3>
                      <p className="text-gray-400 text-sm">新規リクエストの許可</p>
                    </div>
                    <p className="text-lg font-black text-gray-700">{currentUser?.accept_requests ? "受付中" : "停止中"}</p>
                  </Card>
                </div>

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
                                      {a.status === "open" ? "空き" : a.status === "pending" ? "リクエスト中" : a.status === "confirmed" ? "確定" : "予定あり"}
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
                          <Button onClick={() => setShowAddModal(true)} variant="outline" icon={Plus}>予定を追加する</Button>
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
                      <button onClick={() => setSelectedDate(addDays(selectedDate, -7))} className="p-3 rounded-xl hover:bg-gray-100"><ChevronLeft size={20}/></button>
                      <button onClick={() => setSelectedDate(addDays(selectedDate, 7))} className="p-3 rounded-xl hover:bg-gray-100"><ChevronRight size={20}/></button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-7 gap-2 sm:gap-4">
                    {["日", "月", "火", "水", "木", "金", "土"].map(d => (
                      <div key={d} className="text-center text-xs font-black text-gray-400 uppercase pb-4">{d}</div>
                    ))}
                    {eachDayOfInterval({
                      start: startOfWeek(selectedDate),
                      end: endOfWeek(selectedDate)
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
                          chipText = "予定有";
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
                    <Button onClick={() => setShowAddModal(true)} variant="outline" icon={Plus} className="p-2 h-10 w-10 rounded-full" />
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
                                <button onClick={() => handleDeleteAvailability(a.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                                  <Trash2 size={16} />
                                </button>
                              </div>
                              {a.note && <p className="text-sm text-gray-500 font-medium">{a.note}</p>}
                              <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                                <span className={`text-[10px] font-bold uppercase tracking-widest ${
                                  a.status === "confirmed" ? "text-red-500" : 
                                  a.status === "pending" ? "text-orange-500" : 
                                  a.status === "busy" ? "text-red-900" : "text-gray-400"
                                }`}>
                                  {a.status === "open" ? "空き" : a.status === "pending" ? "リクエスト中" : a.status === "confirmed" ? "確定" : "予定あり"}
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
                        <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser?.name}`} alt="avatar" />
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
                        <p className="text-gray-400 font-medium">{currentUser?.email || "ゲストユーザー"}</p>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-6 pt-8 border-t border-gray-100">
                    <h3 className="text-xl font-black flex items-center gap-3">
                      <Users size={24} className="text-blue-600" />
                      コネクション
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {connections.length > 0 ? (
                        <p className="text-gray-600 font-bold">{connections.length}件のコネクションがあります</p>
                      ) : (
                        <p className="text-gray-400 text-sm italic">コネクションはありません</p>
                      )}
                    </div>
                  </section>

                  <section className="space-y-6 pt-8 border-t border-gray-100">
                    <h3 className="text-xl font-black flex items-center gap-3">
                      <Clock size={24} className="text-blue-600" />
                      時間プリセット
                    </h3>
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
                            <p className="text-sm text-emerald-700">LINEで通知を受け取れます</p>
                          </div>
                        </div>
                        <Button variant="ghost" className="text-emerald-600">解除</Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-gray-500">LINEと連携すると、シフトのリクエストや承認をリアルタイムで受け取ることができます。</p>
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
              if (item.id === "add") setShowAddModal(true);
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
              onClick={() => setShowAddModal(false)}
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
                <h3 className="text-2xl font-black tracking-tight">予定を追加</h3>
                <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X/></button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">日付</label>
                  <div className="p-4 bg-gray-50 rounded-2xl flex items-center justify-between">
                    <span className="font-bold">{format(selectedDate, "yyyy/MM/dd (E)", { locale: ja })}</span>
                    <Calendar size={18} className="text-gray-300" />
                  </div>
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
                      onChange={e => setNewAvailTime({...newAvailTime, start: e.target.value})}
                      className="w-full p-4 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">終了</label>
                    <input 
                      type="time" 
                      value={newAvailTime.end}
                      onChange={e => setNewAvailTime({...newAvailTime, end: e.target.value})}
                      className="w-full p-4 bg-gray-50 rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
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
                    onClick={() => handleAddAvailability("open")} 
                    className="flex-1 py-4 font-black" 
                    disabled={isSaving}
                  >
                    空きとして登録
                  </Button>
                  <Button 
                    onClick={() => handleAddAvailability("busy")} 
                    variant="outline"
                    className="flex-1 py-4 font-black border-red-100 text-red-500 hover:bg-red-50" 
                    disabled={isSaving}
                  >
                    予定あり(不可)
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
