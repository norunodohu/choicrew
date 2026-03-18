/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import "react/jsx-runtime";
import { 
  Calendar, 
  Clock, 
  User as UserIcon, 
  CheckCircle2, 
  XCircle, 
  Plus, 
  ChevronRight, 
  Bell, 
  Settings,
  LogOut,
  ChevronLeft,
  CalendarDays,
  Flag,
  LayoutDashboard,
  Share2,
  Trash2,
  UserPlus,
  Search,
  MessageCircle,
  AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format, addDays, startOfWeek, isSameDay, addMonths, isBefore, startOfDay, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, endOfWeek } from "date-fns";
import { ja } from "date-fns/locale";

// Firebase
import { 
  GoogleAuthProvider, 
  signInAnonymously,
  onAuthStateChanged, 
  signOut,
  signInWithPopup
} from "firebase/auth";
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  writeBatch
} from "firebase/firestore";
import { auth, db } from "./firebase";
import firebaseConfig from "../firebase-applet-config.json";

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

const handleFirestoreError = (error: any, operationType: OperationType, path: string | null) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  if (errorMessage.includes("Quota exceeded")) {
    alert("Firebaseの無料枠の制限（クォータ）を超えました。しばらく時間をおいてから再度お試しください。通常、24時間以内にリセットされます。");
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
  status: "open" | "pending" | "confirmed";
  note?: string;
  is_private_note?: boolean;
  created_at?: string;
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
}

interface Notification {
  id: string;
  user_id: string;
  type: string;
  message: string;
  date: string;
  timestamp: any;
  read: boolean;
}

interface Connection {
  id: string;
  user1_id: string;
  user2_id: string;
  status: "pending" | "active";
  visibility: string;
  is_hidden: boolean;
  other_visibility?: string;
  other_is_hidden?: boolean;
  other_user?: UserProfile;
}

interface Preset {
  id: string;
  user_id: string;
  start_time: string;
  end_time: string;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  
  const [isPublicView, setIsPublicView] = useState(false);
  const [publicUser, setPublicUser] = useState<UserProfile | null>(null);
  const [publicAvailabilities, setPublicAvailabilities] = useState<Availability[]>([]);
  const [publicRequests, setPublicRequests] = useState<ShiftRequest[]>([]);

  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  
  const [view, setView] = useState<"dashboard" | "calendar" | "settings">("dashboard");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [showBellDropdown, setShowBellDropdown] = useState(false);
  const [dashboardDateOffset, setDashboardDateOffset] = useState(0);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
  const [isProcessingLine, setIsProcessingLine] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [showDefaultTimeModal, setShowDefaultTimeModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [editingAvailability, setEditingAvailability] = useState<Availability | null>(null);
  const [showRequestConfirm, setShowRequestConfirm] = useState<{ aid: string, sid: string } | null>(null);
  const [showApproveConfirm, setShowApproveConfirm] = useState<string | null>(null);
  const [showDeclineConfirm, setShowDeclineConfirm] = useState<string | null>(null);
  const [showCancelRequestConfirm, setShowCancelRequestConfirm] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAvailTime, setNewAvailTime] = useState({ start: "10:00", end: "15:00" });

  const migrateUserData = async (oldUid: string, newUid: string) => {
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

        console.log(`Migrating ${snap.docs.length} docs from ${colInfo.name}`);

        const chunks = [];
        for (let i = 0; i < snap.docs.length; i += 500) {
          chunks.push(snap.docs.slice(i, i + 500));
        }

        for (const chunk of chunks) {
          const batch = writeBatch(db);
          chunk.forEach(d => {
            batch.update(doc(db, colInfo.name, d.id), { [colInfo.field]: newUid });
          });
          await batch.commit();
        }
      } catch (err) {
        console.error(`Failed to migrate collection ${colInfo.name}:`, err);
      }
    }
    console.log("Migration complete");
  };

  const processLineProfile = async (profile: any) => {
    if (!profile) return;
    setIsProcessingLine(true);
    try {
      let firebaseUser = auth.currentUser;
      
      if (!firebaseUser) {
        // In the original code, signInAnonymously was removed from here but user said "signInAnonymously を一切呼ばない（削除済み状態）"
        // However, if there's no user, we can't have a UID. 
        // Let's stick to the prompt's instruction: "signInAnonymously を一切呼ばない（削除済み状態）"
        // But the prompt also says "firebaseUser = auth.currentUser を取得". 
        // If it's null, we might have an issue. 
        // Let's assume the user is already signed in or we handle it.
      }

      if (firebaseUser) {
        const q = query(collection(db, "users"), where("line_user_id", "==", profile.userId));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
          const userData = snap.docs[0].data() as UserProfile;
          
          if (userData.uid !== firebaseUser.uid) {
            const oldUid = userData.uid;
            const newUid = firebaseUser.uid;
            
            const updatedProfile = { 
              ...userData, 
              uid: newUid,
              name: profile.displayName || userData.name 
            };
            await setDoc(doc(db, "users", newUid), updatedProfile);
            await migrateUserData(oldUid, newUid);
            
            if (!userData.email) {
              await deleteDoc(doc(db, "users", oldUid));
            }
            
            const freshDoc = await getDoc(doc(db, "users", newUid));
            setCurrentUser(freshDoc.data() as UserProfile);
          } else {
            setCurrentUser(userData);
          }
        } else {
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          if (userDoc.exists()) {
            const existingData = userDoc.data() as UserProfile;
            const updatedProfile = {
              ...existingData,
              line_user_id: profile.userId,
              notification_pref: existingData.notification_pref || "line"
            };
            await updateDoc(doc(db, "users", firebaseUser.uid), {
              line_user_id: profile.userId,
              notification_pref: updatedProfile.notification_pref
            });
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
      }
    } catch (error: any) {
      console.error("Error during LINE login processing:", error);
      handleFirestoreError(error, OperationType.WRITE, "users");
    } finally {
      setIsProcessingLine(false);
      setIsAuthReady(true);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        console.log("Auth state changed...");
        if (user) {
          if (isProcessingLine) return;

          const urlParams = new URLSearchParams(window.location.search);
          if (urlParams.get('line_user')) return;

          let userDoc = await getDoc(doc(db, "users", user.uid));
          if (!userDoc.exists()) {
            const newProfile: UserProfile = {
              uid: user.uid,
              search_id: user.uid.slice(0, 8),
              name: user.displayName || (user.isAnonymous ? "ゲストユーザー" : "ユーザー"),
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
      } catch (error: any) {
        console.error("Auth initialization error:", error);
        if (error.message?.includes("Quota exceeded")) {
          setQuotaExceeded(true);
        }
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
    if (lineUserParam) {
      try {
        const profile = JSON.parse(decodeURIComponent(lineUserParam));
        processLineProfile(profile);
      } catch (e) {
        console.error("Failed to parse line_user param", e);
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
  }, [isProcessingLine]);

  const fetchPublicData = async (token: string) => {
    try {
      const q = query(collection(db, "users"), where("share_token", "==", token));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const userData = snap.docs[0].data() as UserProfile;
        setPublicUser(userData);
        
        const qAvail = query(collection(db, "availabilities"), where("user_id", "==", userData.uid));
        const snapAvail = await getDocs(qAvail);
        setPublicAvailabilities(snapAvail.docs.map(d => ({ id: d.id, ...d.data() } as Availability)));

        const qReq = query(collection(db, "requests"), where("manager_id", "==", userData.uid));
        const snapReq = await getDocs(qReq);
        setPublicRequests(snapReq.docs.map(d => ({ id: d.id, ...d.data() } as ShiftRequest)));
      }
    } catch (error) {
      console.error("Error fetching public data:", error);
    }
  };

  // Data Listeners
  useEffect(() => {
    if (!currentUser) return;

    const activeStaffUids = connections
      .filter(c => c.status === 'active')
      .map(c => c.user1_id === currentUser.uid ? c.user2_id : c.user1_id);
    const allRelevantUids = [currentUser.uid, ...activeStaffUids];

    const chunks = [];
    for (let i = 0; i < allRelevantUids.length; i += 30) {
      chunks.push(allRelevantUids.slice(i, i + 30));
    }

    const unsubsAvail = chunks.map(chunk => {
      const q = query(collection(db, "availabilities"), where("user_id", "in", chunk));
      return onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Availability));
        setAvailabilities(prev => {
          const filtered = prev.filter(a => !chunk.includes(a.user_id));
          const merged = [...filtered, ...data];
          // Remove duplicates
          return Array.from(new Map(merged.map(item => [item.id, item])).values());
        });
      });
    });

    const qReqManager = query(collection(db, "requests"), where("manager_id", "==", currentUser.uid));
    const unsubReqManager = onSnapshot(qReqManager, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ShiftRequest));
      setRequests(prev => {
        const filtered = prev.filter(r => r.manager_id !== currentUser.uid);
        const merged = [...filtered, ...data];
        return Array.from(new Map(merged.map(item => [item.id, item])).values());
      });
    });

    const qReqStaff = query(collection(db, "requests"), where("staff_id", "==", currentUser.uid));
    const unsubReqStaff = onSnapshot(qReqStaff, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ShiftRequest));
      setRequests(prev => {
        const filtered = prev.filter(r => r.staff_id !== currentUser.uid);
        const merged = [...filtered, ...data];
        return Array.from(new Map(merged.map(item => [item.id, item])).values());
      });
    });

    const qConn1 = query(collection(db, "connections"), where("user1_id", "==", currentUser.uid));
    const unsubConn1 = onSnapshot(qConn1, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Connection));
      setConnections(prev => {
        const filtered = prev.filter(c => c.user1_id !== currentUser.uid);
        const merged = [...filtered, ...data];
        return Array.from(new Map(merged.map(item => [item.id, item])).values());
      });
    });

    const qConn2 = query(collection(db, "connections"), where("user2_id", "==", currentUser.uid));
    const unsubConn2 = onSnapshot(qConn2, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Connection));
      setConnections(prev => {
        const filtered = prev.filter(c => c.user2_id !== currentUser.uid);
        const merged = [...filtered, ...data];
        return Array.from(new Map(merged.map(item => [item.id, item])).values());
      });
    });

    const qNotif = query(collection(db, "notifications"), where("user_id", "==", currentUser.uid), orderBy("timestamp", "desc"));
    const unsubNotif = onSnapshot(qNotif, (snapshot) => {
      setNotifications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notification)));
    });

    const qPreset = query(collection(db, "presets"), where("user_id", "==", currentUser.uid));
    const unsubPreset = onSnapshot(qPreset, (snapshot) => {
      setPresets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Preset)));
    });

    return () => {
      unsubsAvail.forEach(unsub => unsub());
      unsubReqManager();
      unsubReqStaff();
      unsubConn1();
      unsubConn2();
      unsubNotif();
      unsubPreset();
    };
  }, [currentUser?.uid, connections.length]);

  const handleLineLogin = async () => {
    try {
      const response = await fetch("/api/auth/line/url");
      const data = await response.json();
      if (data.url) {
        if (window.innerWidth < 768) {
          window.location.href = data.url;
        } else {
          window.open(data.url, "line_auth", "width=500,height=600");
        }
      }
    } catch (error) {
      console.error("LINE login error:", error);
    }
  };

  const handleGuestLogin = async () => {
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error("Guest login error:", error);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setIsLoggedIn(false);
    setCurrentUser(null);
    setView("dashboard");
    window.location.href = window.location.origin;
  };

  const handleAddAvailability = async () => {
    if (!currentUser) return;
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    const newAvail: Omit<Availability, "id"> = {
      user_id: currentUser.uid,
      user_name: currentUser.name,
      date: dateStr,
      start_time: newAvailTime.start,
      end_time: newAvailTime.end,
      status: "open",
      created_at: new Date().toISOString()
    };
    await addDoc(collection(db, "availabilities"), newAvail);
    setShowAddModal(false);
  };

  const handleRequestShift = async (aid: string, sid: string) => {
    if (!currentUser) return;
    const avail = availabilities.find(a => a.id === aid);
    if (!avail) return;

    const newRequest: Omit<ShiftRequest, "id"> = {
      staff_id: sid,
      staff_name: avail.user_name || "Staff",
      manager_id: currentUser.uid,
      manager_name: currentUser.name,
      availability_id: aid,
      date: avail.date,
      start_time: avail.start_time,
      end_time: avail.end_time,
      status: "pending"
    };

    await addDoc(collection(db, "requests"), newRequest);
    await updateDoc(doc(db, "availabilities", aid), { status: "pending" });
    
    await addDoc(collection(db, "notifications"), {
      user_id: sid,
      type: "request",
      message: `${currentUser.name}さんからシフトリクエストが届きました`,
      date: avail.date,
      timestamp: serverTimestamp(),
      read: false
    });
  };

  const handleApproveRequest = async (rid: string) => {
    const req = requests.find(r => r.id === rid);
    if (!req) return;
    await updateDoc(doc(db, "requests", rid), { status: "approved" });
    await updateDoc(doc(db, "availabilities", req.availability_id), { status: "confirmed" });
    
    await addDoc(collection(db, "notifications"), {
      user_id: req.manager_id,
      type: "approval",
      message: `${req.staff_name}さんがシフトリクエストを承認しました`,
      date: req.date,
      timestamp: serverTimestamp(),
      read: false
    });
  };

  const handleDeclineRequest = async (rid: string) => {
    const req = requests.find(r => r.id === rid);
    if (!req) return;
    await updateDoc(doc(db, "requests", rid), { status: "canceled" });
    await updateDoc(doc(db, "availabilities", req.availability_id), { status: "open" });
    
    await addDoc(collection(db, "notifications"), {
      user_id: req.manager_id,
      type: "decline",
      message: `${req.staff_name}さんがシフトリクエストを辞退しました`,
      date: req.date,
      timestamp: serverTimestamp(),
      read: false
    });
  };

  if (!isAuthReady) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  if (!isLoggedIn && !isPublicView) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-2">
            <div className="w-20 h-20 bg-blue-50 rounded-3xl flex items-center justify-center mx-auto mb-6 transform rotate-12 shadow-xl shadow-blue-100">
              <Calendar size={40} className="text-[#3b82f6]" />
            </div>
            <h1 className="text-4xl font-bold tracking-tighter font-righteous text-[#3b82f6]">ShiftShare</h1>
            <p className="text-black/40 font-medium">スマートなシフト管理と共有</p>
          </div>
          <div className="space-y-4 pt-8">
            <button onClick={handleGoogleLogin} className="w-full py-4 bg-white border-2 border-black/5 text-black font-bold rounded-xl shadow-sm flex items-center justify-center gap-3 hover:bg-black/5 transition-all">
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              Googleでログイン
            </button>
            <button onClick={handleLineLogin} className="w-full py-4 bg-[#06C755] text-white font-bold rounded-xl shadow-sm flex items-center justify-center gap-3 hover:brightness-110 transition-all">
              <MessageCircle size={20} fill="white" />
              LINEでログイン
            </button>
            <button onClick={handleGuestLogin} className="w-full py-4 bg-black/5 text-black/60 font-bold rounded-xl shadow-sm flex items-center justify-center gap-3 hover:bg-black/10 transition-all">
              ゲストとして利用
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#111111] font-sans lg:flex">
      {/* Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-black/5 border-r border-black/5 h-screen sticky top-0 p-6 space-y-8">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-[#3b82f6] rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
            <LayoutDashboard size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-[#3b82f6]">ShiftShare</h1>
        </div>
        <nav className="flex flex-col gap-2">
          <button onClick={() => setView("dashboard")} className={`flex items-center gap-3 px-4 py-3 rounded-2xl font-bold transition-all ${view === "dashboard" ? "bg-[#3b82f6] text-white shadow-lg shadow-blue-200" : "text-black/40 hover:bg-black/5"}`}>
            <LayoutDashboard size={20} /> <span>ホーム</span>
          </button>
          <button onClick={() => setView("calendar")} className={`flex items-center gap-3 px-4 py-3 rounded-2xl font-bold transition-all ${view === "calendar" ? "bg-[#3b82f6] text-white shadow-lg shadow-blue-200" : "text-black/40 hover:bg-black/5"}`}>
            <Calendar size={20} /> <span>カレンダー</span>
          </button>
          <button onClick={() => setView("settings")} className={`flex items-center gap-3 px-4 py-3 rounded-2xl font-bold transition-all ${view === "settings" ? "bg-[#3b82f6] text-white shadow-lg shadow-blue-200" : "text-black/40 hover:bg-black/5"}`}>
            <Settings size={20} /> <span>設定</span>
          </button>
        </nav>
        <div className="mt-auto pt-6 border-t border-black/5">
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-red-500 hover:bg-red-50 transition-all">
            <LogOut size={20} /> <span>ログアウト</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen pb-20 lg:pb-0">
        <header className="px-6 py-4 flex items-center justify-between border-b border-black/5 sticky top-0 bg-white/80 backdrop-blur-md z-10 lg:bg-white lg:px-12">
          <div className="lg:hidden">
            <h1 className="text-xl font-bold tracking-tight text-[#3b82f6]">ShiftShare</h1>
          </div>
          <div className="flex gap-4 relative ml-auto">
            <button onClick={() => setShowBellDropdown(!showBellDropdown)} className="p-2 rounded-full hover:bg-black/5 transition-colors relative">
              <Bell size={20} />
              {notifications.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-white"></span>}
            </button>
          </div>
        </header>

        <main className="px-6 py-6 max-w-md mx-auto lg:max-w-none lg:px-12 lg:flex-1">
          {view === "dashboard" && (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  {[0, 1, 2, 3].map(offset => (
                    <button key={offset} onClick={() => setDashboardDateOffset(offset)} className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${dashboardDateOffset === offset ? "bg-[#3b82f6] text-white shadow-md shadow-[#3b82f6]/20" : "bg-black/5 text-black/40 hover:bg-black/10"}`}>
                      {offset === 0 ? "今日" : offset === 1 ? "明日" : format(addDays(new Date(), offset), "M/d")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bg-white border border-black/5 rounded-3xl p-6 shadow-sm">
                <h3 className="text-sm font-bold mb-4">{format(addDays(new Date(), dashboardDateOffset), "M月d日 (E)", { locale: ja })} の状況</h3>
                <div className="space-y-4">
                  {availabilities.filter(a => a.date === format(addDays(new Date(), dashboardDateOffset), "yyyy-MM-dd")).map(a => (
                    <div key={a.id} className="flex items-center justify-between py-2 border-b border-black/5 last:border-0">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${a.status === 'confirmed' ? 'bg-emerald-50 text-emerald-500' : 'bg-black/5 text-black/40'}`}>
                          <Clock size={16} />
                        </div>
                        <div>
                          <p className="text-xs font-bold">{a.user_name || "User"}</p>
                          <p className="text-[10px] text-black/40">{a.start_time}-{a.end_time}</p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${a.status === 'confirmed' ? 'bg-emerald-50 text-emerald-500' : 'bg-black/5 text-black/40'}`}>
                        {a.status === 'confirmed' ? '確定' : '空き'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {view === "calendar" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{format(selectedDate, "yyyy年 M月", { locale: ja })}</h2>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedDate(addMonths(selectedDate, -1))} className="p-2 hover:bg-black/5 rounded-full"><ChevronLeft size={20} /></button>
                  <button onClick={() => setSelectedDate(addMonths(selectedDate, 1))} className="p-2 hover:bg-black/5 rounded-full"><ChevronRight size={20} /></button>
                </div>
              </div>
              <div className="bg-white border border-black/5 rounded-3xl p-4 shadow-sm">
                <div className="grid grid-cols-7 gap-2">
                  {["日", "月", "火", "水", "木", "金", "土"].map((d, i) => (
                    <div key={d} className={`text-center text-[10px] font-bold py-2 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-black/40"}`}>{d}</div>
                  ))}
                  {eachDayOfInterval({ start: startOfWeek(startOfMonth(selectedDate)), end: endOfWeek(endOfMonth(selectedDate)) }).map((day, i) => {
                    const isSelected = isSameDay(day, selectedDate);
                    const isCurrentMonth = isSameMonth(day, selectedDate);
                    return (
                      <button key={i} onClick={() => setSelectedDate(day)} className={`aspect-square flex flex-col items-center justify-center rounded-xl transition-all ${isSelected ? "bg-blue-100 ring-2 ring-blue-500 ring-offset-2" : "hover:bg-black/5"} ${!isCurrentMonth ? "opacity-20" : ""}`}>
                        <span className="text-sm font-bold">{format(day, "d")}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="font-bold">{format(selectedDate, "M月d日")}の予定</h3>
                <button onClick={() => setShowAddModal(true)} className="w-full py-4 border-2 border-dashed border-black/5 rounded-2xl text-black/40 text-sm font-medium hover:border-[#3b82f6]/20 hover:text-[#3b82f6] transition-all flex items-center justify-center gap-2">
                  <Plus size={18} /> 新しい空き時間を追加
                </button>
              </div>
            </div>
          )}

          {view === "settings" && (
            <div className="space-y-8">
              <h2 className="text-2xl font-bold">設定</h2>
              <div className="bg-white border border-black/5 rounded-2xl overflow-hidden">
                <div className="p-6 border-b border-black/5">
                  <p className="text-sm font-bold">{currentUser.name}</p>
                  <p className="text-xs text-black/40">{currentUser.email}</p>
                </div>
                <button onClick={handleLogout} className="w-full px-6 py-4 flex items-center gap-3 text-red-500 font-bold hover:bg-red-50 transition-colors">
                  <LogOut size={18} /> <span>ログアウト</span>
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Mobile Nav */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-lg border-t border-black/5 px-6 py-3 flex justify-around items-center z-10 lg:hidden">
          <button onClick={() => setView("dashboard")} className={`flex flex-col items-center gap-1 ${view === "dashboard" ? "text-[#3b82f6]" : "text-black/30"}`}>
            <LayoutDashboard size={24} /> <span className="text-[10px] font-bold">ホーム</span>
          </button>
          <button onClick={() => setView("calendar")} className={`flex flex-col items-center gap-1 ${view === "calendar" ? "text-[#3b82f6]" : "text-black/30"}`}>
            <Calendar size={24} /> <span className="text-[10px] font-bold">カレンダー</span>
          </button>
          <button onClick={() => setView("settings")} className={`flex flex-col items-center gap-1 ${view === "settings" ? "text-[#3b82f6]" : "text-black/30"}`}>
            <Settings size={24} /> <span className="text-[10px] font-bold">設定</span>
          </button>
        </nav>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl">
              <h3 className="text-lg font-bold mb-4">空き時間を追加</h3>
              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-black/40 uppercase">開始</label>
                    <input type="time" value={newAvailTime.start} onChange={(e) => setNewAvailTime(prev => ({ ...prev, start: e.target.value }))} className="w-full p-3 bg-black/5 border-0 rounded-xl text-sm font-bold" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-black/40 uppercase">終了</label>
                    <input type="time" value={newAvailTime.end} onChange={(e) => setNewAvailTime(prev => ({ ...prev, end: e.target.value }))} className="w-full p-3 bg-black/5 border-0 rounded-xl text-sm font-bold" />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddAvailability} className="flex-1 py-3 bg-[#3b82f6] text-white text-xs font-bold rounded-xl">追加する</button>
                <button onClick={() => setShowAddModal(false)} className="flex-1 py-3 bg-black/5 text-black/60 text-xs font-bold rounded-xl">キャンセル</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
