import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, updateDoc, doc, Timestamp, setDoc, getDocs, orderBy } from 'firebase/firestore';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

interface RequestEntry {
  id: string;
  share_id: string;
  slot_date: string;
  slot_start: string;
  slot_end: string;
  requester_name: string;
  requester_email?: string;
  message: string;
  status?: 'pending' | 'approved' | 'declined' | 'cancelled';
  created_at: Timestamp;
  user_group_id?: string;
}

interface UserInfo {
  displayName: string;
  notify_email?: string;
  email_verified?: boolean;
  shareCount: number;
  shares: Array<{ id: string }>;
}

interface ShareItem {
  id: string;
  title: string;
  displayName: string;
  creator_email?: string;
  notify_email?: string;
  created_at?: Timestamp;
}

interface MiniUser {
  email: string;
  name: string;
  created_at?: Timestamp;
  email_verified?: boolean;
  shareCount?: number;
}

const ADMIN_SECRET = 'choicrew-admin-1234';

function AccountCard({
  user,
  onUpdated,
  onDeleted,
}: {
  user: MiniUser;
  onUpdated: (oldEmail: string, updated: Partial<MiniUser>) => void;
  onDeleted: (email: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(user.name);
  const [editEmail, setEditEmail] = useState(user.email);
  const [editVerified, setEditVerified] = useState(user.email_verified ?? false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/mini/admin/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
        body: JSON.stringify({
          email: user.email,
          newEmail: editEmail.trim() !== user.email ? editEmail.trim() : undefined,
          name: editName.trim(),
          email_verified: editVerified,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || '更新失敗'); return; }
      onUpdated(user.email, { email: editEmail.trim(), name: editName.trim(), email_verified: editVerified });
      setEditing(false);
    } catch (e) {
      setErr('ネットワークエラー');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const shareInfo = user.shareCount ? `予定 ${user.shareCount} 件とその依頼もすべて削除されます。` : '';
    if (!window.confirm(`${user.email} を削除しますか？\n${shareInfo}\nこの操作は取り消せません。`)) return;
    try {
      const res = await fetch('/api/mini/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
        body: JSON.stringify({ email: user.email }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || '削除失敗'); return; }
      alert(`削除しました。${data.deletedShares ? `（予定 ${data.deletedShares} 件も削除）` : ''}`);
      onDeleted(user.email);
    } catch {
      alert('ネットワークエラー');
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      {editing ? (
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">表示名</label>
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">メールアドレス</label>
              <input
                type="email"
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={editVerified}
              onChange={e => setEditVerified(e.target.checked)}
              className="w-4 h-4 text-teal-600"
            />
            メール確認済みにする
          </label>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition disabled:opacity-50">
              {saving ? '保存中...' : '保存'}
            </button>
            <button onClick={() => { setEditing(false); setErr(''); setEditName(user.name); setEditEmail(user.email); setEditVerified(user.email_verified ?? false); }} className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-200 transition">
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-900 text-sm">{user.name || <span className="text-slate-400">（名前なし）</span>}</span>
              {user.email_verified
                ? <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">確認済み</span>
                : <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">未確認</span>}
              <span className="text-xs text-slate-400">予定 {user.shareCount}件</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{user.email}</div>
            {user.created_at && (
              <div className="text-xs text-slate-400 mt-0.5">
                登録: {format(user.created_at.toDate(), 'yyyy/MM/dd HH:mm', { locale: ja })}
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setEditing(true)} className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-200 transition">
              編集
            </button>
            <button onClick={handleDelete} className="px-3 py-1.5 bg-red-100 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-200 transition">
              削除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPanel() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'requests' | 'users' | 'migrate' | 'shares' | 'accounts'>('requests');
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [existingUsers, setExistingUsers] = useState<Array<{ email: string; name: string; migrated: boolean }>>([]);
  const [migratingEmails, setMigratingEmails] = useState<Set<string>>(new Set());
  // 予定一覧
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [editingShareId, setEditingShareId] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState('');
  // アカウント一覧
  const [miniUsers, setMiniUsers] = useState<MiniUser[]>([]);
  const [miniUsersLoading, setMiniUsersLoading] = useState(false);

  // Firestore リスナー - 依頼
  useEffect(() => {
    if (!authenticated) return;

    const q = query(collection(db, 'mini_requests'));
    const unsub = onSnapshot(q, (snap) => {
      const arr: RequestEntry[] = [];
      snap.forEach((doc) => {
        arr.push({ id: doc.id, ...doc.data() } as RequestEntry);
      });
      // 新しい順にソート
      arr.sort((a, b) => b.created_at.toMillis() - a.created_at.toMillis());
      setRequests(arr);
    });

    return () => unsub();
  }, [authenticated]);

  // Firestore リスナー - ユーザー
  useEffect(() => {
    if (!authenticated) return;

    const loadUsers = async () => {
      try {
        const snap = await getDocs(collection(db, 'mini_shares'));
        const userMap: Record<string, UserInfo> = {};
        
        snap.forEach((doc) => {
          const data = doc.data();
          const displayName = data.displayName || data.name || 'Unknown';
          
          if (!userMap[displayName]) {
            userMap[displayName] = {
              displayName,
              notify_email: data.notify_email,
              email_verified: data.email_verified,
              shareCount: 0,
              shares: [],
            };
          }
          
          userMap[displayName].shareCount++;
          userMap[displayName].shares.push({ id: doc.id });
          // 最新のメール情報で上書き（複数の予定がある場合）
          if (data.notify_email) {
            userMap[displayName].notify_email = data.notify_email;
            userMap[displayName].email_verified = data.email_verified;
          }
        });
        
        setUsers(Object.values(userMap).sort((a, b) => b.shareCount - a.shareCount));
      } catch (err) {
        console.error('ユーザー取得失敗:', err);
      }
    };

    loadUsers();
    const interval = setInterval(loadUsers, 5000);
    return () => clearInterval(interval);
  }, [authenticated]);

  // 既存ユーザーを検出
  useEffect(() => {
    if (!authenticated) return;

    const detectExistingUsers = async () => {
      try {
        const [sharesSnap, accountsSnap] = await Promise.all([
          getDocs(collection(db, 'mini_shares')),
          getDocs(collection(db, 'mini_users')),
        ]);

        // 既にアカウントが存在するメールアドレスのセット
        const registeredEmails = new Set<string>();
        accountsSnap.forEach(d => registeredEmails.add(d.id.toLowerCase()));

        const existingUsersMap: Record<string, { email: string; name: string }> = {};
        sharesSnap.forEach((doc) => {
          const data = doc.data();
          const email = data.notify_email;
          const name = data.displayName || data.name || 'Unknown';
          if (email && name && !registeredEmails.has(email.toLowerCase())) {
            existingUsersMap[email] = { email, name };
          }
        });
        
        // mini_users に存在しないメールアドレスのみ移行対象として表示
        const toMigrate = Object.values(existingUsersMap).map(({ email, name }) => ({ email, name, migrated: false }));
        setExistingUsers(toMigrate);
      } catch (err) {
        console.error('既存ユーザー検出失敗:', err);
      }
    };

    detectExistingUsers();
  }, [authenticated]);

  // 予定一覧を取得
  useEffect(() => {
    if (!authenticated) return;
    const loadShares = async () => {
      setSharesLoading(true);
      try {
        const snap = await getDocs(query(collection(db, 'mini_shares'), orderBy('created_at', 'desc')));
        const items: ShareItem[] = [];
        snap.forEach(d => {
          const data = d.data();
          items.push({
            id: d.id,
            title: data.title || data.name || '(無題)',
            displayName: data.displayName || data.name || '',
            creator_email: data.creator_email || '',
            notify_email: data.notify_email || '',
            created_at: data.created_at,
          });
        });
        setShares(items);
      } catch (err) {
        console.error(err);
      } finally {
        setSharesLoading(false);
      }
    };
    loadShares();
  }, [authenticated]);

  // アカウント一覧（mini_users）を取得
  useEffect(() => {
    if (!authenticated) return;
    const loadMiniUsers = async () => {
      setMiniUsersLoading(true);
      try {
        const [usersSnap, sharesSnap] = await Promise.all([
          getDocs(query(collection(db, 'mini_users'), orderBy('created_at', 'desc'))),
          getDocs(collection(db, 'mini_shares')),
        ]);
        // メール → シェア数のマップ
        const shareCountMap: Record<string, number> = {};
        sharesSnap.forEach(d => {
          const email = (d.data().creator_email || d.data().notify_email || '').toLowerCase();
          if (email) shareCountMap[email] = (shareCountMap[email] || 0) + 1;
        });
        const items: MiniUser[] = [];
        usersSnap.forEach(d => {
          const data = d.data();
          items.push({
            email: d.id,
            name: data.name || '',
            created_at: data.created_at,
            email_verified: data.email_verified ?? false,
            shareCount: shareCountMap[d.id.toLowerCase()] || 0,
          });
        });
        setMiniUsers(items);
      } catch (err) {
        console.error(err);
      } finally {
        setMiniUsersLoading(false);
      }
    };
    loadMiniUsers();
  }, [authenticated]);

  // 予定にメールアドレスを手動で設定
  const handleAssignEmail = async (shareId: string) => {
    const trimmed = editingEmail.trim().toLowerCase();
    if (!trimmed) return;
    try {
      await updateDoc(doc(db, 'mini_shares', shareId), {
        creator_email: trimmed,
        notify_email: trimmed,
      });
      setShares(prev => prev.map(s => s.id === shareId ? { ...s, creator_email: trimmed, notify_email: trimmed } : s));
      setEditingShareId(null);
      setEditingEmail('');
    } catch (err) {
      setError(`更新失敗: ${err instanceof Error ? err.message : '不明'}`);
    }
  };

  const handleAuth = (e: React.FormEvent) => {    e.preventDefault();
    if (password === '1234') {
      setAuthenticated(true);
      setError('');
    } else {
      setError('パスワードが間違っています');
    }
  };

  const handleVerifyEmail = async (user: UserInfo) => {
    if (!user.notify_email) return;
    
    setLoading(true);
    try {
      await Promise.all(
        user.shares.map(share =>
          updateDoc(doc(db, 'mini_shares', share.id), { email_verified: true })
        )
      );
      alert(`${user.displayName} さんのメール有効化が完了しました`);
    } catch (err) {
      setError(`エラー: ${err instanceof Error ? err.message : '不明'}`);
    } finally {
      setLoading(false);
    }
  };

  // ユーザーを移行
  const handleMigrateUser = async (email: string, name: string) => {
    setMigratingEmails(prev => new Set([...prev, email]));
    try {
      const res = await fetch('/api/mini/migrate-existing-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name }),
      });
      
      const data = await res.json();
      if (res.ok) {
        // UI から削除
        setExistingUsers(prev => prev.filter(u => u.email !== email));
        alert(`${email} を移行しました。パスワードリセットメールを送信しました。`);
      } else {
        setError(`移行失敗 (${email}): ${data.error}`);
      }
    } catch (err) {
      setError(`エラー: ${err instanceof Error ? err.message : '不明'}`);
    } finally {
      setMigratingEmails(prev => {
        const next = new Set(prev);
        next.delete(email);
        return next;
      });
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    if (selected.size === requests.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(requests.map(r => r.id)));
    }
  };

  const handleLink = async () => {
    if (selected.size === 0) {
      setError('依頼を選択してください');
      return;
    }

    setLoading(true);
    try {
      // 新しいグループ ID を生成
      const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // グループ情報を記録（last_updated を付与）
      await setDoc(doc(db, 'user_groups', groupId), {
        group_id: groupId,
        created_at: Timestamp.now(),
        last_updated: Timestamp.now(),
        request_count: selected.size,
      });

      // 選択された依頼を全て更新（古い user_group_id を削除して新しいものを設定）
      await Promise.all(
        Array.from(selected).map((id) =>
          updateDoc(doc(db, 'mini_requests', id), { 
            user_group_id: groupId
          })
        )
      );

      setError('');
      setSelected(new Set());
      alert(`紐づけ完了: ${groupId}`);
    } catch (err) {
      setError(`エラー: ${err instanceof Error ? err.message : '不明'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlink = async () => {
    if (selected.size === 0) {
      setError('依頼を選択してください');
      return;
    }

    if (!window.confirm(`${selected.size}個の依頼の紐づけを解除しますか？`)) {
      return;
    }

    setLoading(true);
    try {
      // 選択された依頼の user_group_id を削除
      await Promise.all(
        Array.from(selected).map((id) =>
          updateDoc(doc(db, 'mini_requests', id), { 
            user_group_id: null
          })
        )
      );

      setError('');
      setSelected(new Set());
      alert('紐づけを解除しました');
    } catch (err) {
      setError(`エラー: ${err instanceof Error ? err.message : '不明'}`);
    } finally {
      setLoading(false);
    }
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <h1 className="text-2xl font-bold text-slate-900 mb-6 text-center">Admin Panel</h1>
          <form onSubmit={handleAuth}>
            <input
              type="password"
              placeholder="パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
            <button
              type="submit"
              className="w-full bg-teal-600 text-white font-semibold py-3 rounded-lg hover:bg-teal-700 transition"
            >
              ログイン
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Admin Panel</h1>
          <button
            onClick={() => setAuthenticated(false)}
            className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg transition"
          >
            ログアウト
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* タブ */}
        <div className="flex gap-2 mb-6 border-b border-slate-200">
          <button
            onClick={() => setActiveTab('requests')}
            className={`px-4 py-3 font-semibold transition-colors ${
              activeTab === 'requests'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            依頼管理
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-3 font-semibold transition-colors ${
              activeTab === 'users'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ユーザー管理
          </button>
          <button
            onClick={() => setActiveTab('migrate')}
            className={`px-4 py-3 font-semibold transition-colors ${
              activeTab === 'migrate'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ユーザー移行 ({existingUsers.length})
          </button>
          <button
            onClick={() => setActiveTab('shares')}
            className={`px-4 py-3 font-semibold transition-colors ${
              activeTab === 'shares'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            予定一覧 ({shares.length})
          </button>
          <button
            onClick={() => setActiveTab('accounts')}
            className={`px-4 py-3 font-semibold transition-colors ${
              activeTab === 'accounts'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            アカウント ({miniUsers.length})
          </button>
        </div>

        {/* 依頼管理タブ */}
        {activeTab === 'requests' && (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          {/* ツールバー */}
          <div className="p-4 border-b border-slate-200 flex items-center gap-4">
            <input
              type="checkbox"
              checked={selected.size === requests.length && requests.length > 0}
              onChange={selectAll}
              className="w-5 h-5 text-teal-600 rounded"
            />
            <span className="text-sm text-slate-600">
              {selected.size > 0 ? `${selected.size}個選択` : '全選択'}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={handleUnlink}
                disabled={selected.size === 0 || loading}
                className={`px-4 py-2 font-semibold rounded-lg transition ${
                  selected.size === 0 || loading
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}
              >
                {loading ? '処理中...' : '解除'}
              </button>
              <button
                onClick={handleLink}
                disabled={selected.size === 0 || loading}
                className={`px-6 py-2 font-semibold rounded-lg transition ${
                  selected.size === 0 || loading
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-teal-600 text-white hover:bg-teal-700'
                }`}
              >
                {loading ? '処理中...' : '紐づけ'}
              </button>
            </div>
          </div>

          {/* 依頼一覧 */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-100 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input type="checkbox" className="w-5 h-5 text-teal-600 rounded" disabled />
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">依頼者名</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">メアド</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">依頼日時</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">依頼内容</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">ステータス</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">グループID</th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      依頼がありません
                    </td>
                  </tr>
                ) : (
                  requests.map((req) => (
                    <tr
                      key={req.id}
                      className={`border-b border-slate-200 hover:bg-slate-50 transition ${
                        selected.has(req.id) ? 'bg-teal-50' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(req.id)}
                          onChange={() => toggleSelect(req.id)}
                          className="w-5 h-5 text-teal-600 rounded"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        {req.requester_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{req.requester_email || '-'}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {format(req.created_at.toDate(), 'yyyy/MM/dd HH:mm', { locale: ja })}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate">
                        {req.slot_date} {req.slot_start}–{req.slot_end}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            req.status === 'approved'
                              ? 'bg-green-100 text-green-700'
                              : req.status === 'declined'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {req.status === 'approved'
                            ? '承認'
                            : req.status === 'declined'
                            ? '辞退'
                            : '保留中'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        <code className="bg-slate-100 px-2 py-1 rounded text-xs break-all">
                          {req.user_group_id || '-'}
                        </code>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            <strong>紐づけについて：</strong> 複数の依頼を選択して「紐づけ」をクリックすると、新しいグループIDが生成され、それらの依頼が同じユーザーグループとして扱われます。
          </div>
        </div>
        )}

        {/* ユーザー管理タブ */}
        {activeTab === 'users' && (
        <div className="space-y-4">
          {users.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-8 text-center text-slate-500">
              ユーザーが見つかりません
            </div>
          ) : (
            users.map((user, idx) => (
              <div key={idx} className="bg-white rounded-xl shadow-md p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{user.displayName}</h3>
                    <p className="text-sm text-slate-600">予定数: {user.shareCount}</p>
                  </div>
                  {user.notify_email && !user.email_verified && (
                    <button
                      onClick={() => handleVerifyEmail(user)}
                      disabled={loading}
                      className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                    >
                      {loading ? '処理中...' : 'メール有効化'}
                    </button>
                  )}
                  {user.email_verified && (
                    <span className="px-4 py-2 bg-green-100 text-green-700 font-medium rounded-lg">
                      ✓ 有効化済み
                    </span>
                  )}
                  {!user.notify_email && (
                    <span className="px-4 py-2 bg-slate-100 text-slate-600 font-medium rounded-lg">
                      メール未設定
                    </span>
                  )}
                </div>
                {user.notify_email && (
                  <div className="text-sm text-slate-600">
                    メール: <code className="bg-slate-100 px-2 py-1 rounded">{user.notify_email}</code>
                    {!user.email_verified && <span className="ml-2 text-orange-600 font-medium">確認待ち</span>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        )}

        {/* ユーザー移行タブ */}
        {activeTab === 'migrate' && (
        <div className="space-y-4">
          {existingUsers.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-8 text-center text-slate-500">
              移行対象のユーザーがありません
            </div>
          ) : (
            <>
              <div className="bg-blue-50 border border-blue-300 rounded-lg p-4 text-sm text-blue-700">
                <strong>既存ユーザー移行:</strong> 以下のユーザーをログインシステムに移行します。移行後、各ユーザーにパスワード再設定メールが送信されます。
              </div>
              {existingUsers.map((user, idx) => (
                <div key={idx} className="bg-white rounded-xl shadow-md p-5 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{user.name}</h3>
                    <p className="text-sm text-slate-600">
                      <code className="bg-slate-100 px-2 py-1 rounded">{user.email}</code>
                    </p>
                  </div>
                  <button
                    onClick={() => handleMigrateUser(user.email, user.name)}
                    disabled={migratingEmails.has(user.email)}
                    className={`px-4 py-2 font-medium rounded-lg transition ${
                      migratingEmails.has(user.email)
                        ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                        : 'bg-teal-600 text-white hover:bg-teal-700'
                    }`}
                  >
                    {migratingEmails.has(user.email) ? '移行中...' : '移行'}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
        )}
        {/* 予定一覧タブ */}
        {activeTab === 'shares' && (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          {sharesLoading ? (
            <div className="p-8 text-center text-slate-500">読み込み中...</div>
          ) : shares.length === 0 ? (
            <div className="p-8 text-center text-slate-500">予定がありません</div>
          ) : (
            <table className="w-full">
              <thead className="bg-slate-100 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">ID</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">タイトル</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">紐づきメール</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">操作</th>
                </tr>
              </thead>
              <tbody>
                {shares.map(share => {
                  const email = share.creator_email || share.notify_email || '';
                  const hasEmail = !!email;
                  return (
                    <tr key={share.id} className={`border-b border-slate-100 hover:bg-slate-50 ${!hasEmail ? 'bg-red-50' : ''}`}>
                      <td className="px-4 py-3 text-xs text-slate-400 font-mono">{share.id}</td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{share.title}</td>
                      <td className="px-4 py-3 text-sm">
                        {hasEmail ? (
                          <span className="text-slate-700">{email}</span>
                        ) : (
                          <span className="text-red-500 font-medium">未設定</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editingShareId === share.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="email"
                              value={editingEmail}
                              onChange={e => setEditingEmail(e.target.value)}
                              placeholder="email@example.com"
                              className="border border-slate-300 rounded px-2 py-1 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-teal-500"
                              autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') handleAssignEmail(share.id); if (e.key === 'Escape') { setEditingShareId(null); setEditingEmail(''); } }}
                            />
                            <button onClick={() => handleAssignEmail(share.id)} className="px-3 py-1 bg-teal-600 text-white text-sm rounded hover:bg-teal-700 transition">保存</button>
                            <button onClick={() => { setEditingShareId(null); setEditingEmail(''); }} className="px-3 py-1 bg-slate-200 text-slate-700 text-sm rounded hover:bg-slate-300 transition">キャンセル</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingShareId(share.id); setEditingEmail(email); }}
                            className="px-3 py-1 bg-slate-100 text-slate-700 text-sm rounded hover:bg-slate-200 transition"
                          >
                            {hasEmail ? '変更' : '設定'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="p-4 bg-amber-50 border-t border-amber-200 text-sm text-amber-700">
            <strong>赤背景</strong>はメール未設定の予定です。設定するとオーナーがログイン時に自動認識されます。
          </div>
        </div>
        )}

        {/* アカウント一覧タブ */}
        {activeTab === 'accounts' && (
        <div className="space-y-6">
          {miniUsersLoading ? (
            <div className="bg-white rounded-xl shadow-md p-8 text-center text-slate-500">読み込み中...</div>
          ) : miniUsers.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-8 text-center text-slate-500">アカウントがありません</div>
          ) : (
            <>
              {/* 有効化済み */}
              {miniUsers.filter(u => u.email_verified).length > 0 && (
                <section>
                  <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-2">
                    ✅ 有効化済み ({miniUsers.filter(u => u.email_verified).length})
                  </h2>
                  <div className="space-y-2">
                    {miniUsers.filter(u => u.email_verified).map(user => (
                      <AccountCard
                        key={user.email}
                        user={user}
                        onUpdated={(oldEmail, updated) =>
                          setMiniUsers(prev => prev.map(u => u.email === oldEmail ? { ...u, ...updated, email: updated.email ?? u.email } : u))
                        }
                        onDeleted={(email) => setMiniUsers(prev => prev.filter(u => u.email !== email))}
                      />
                    ))}
                  </div>
                </section>
              )}
              {/* 未確認 */}
              {miniUsers.filter(u => !u.email_verified).length > 0 && (
                <section>
                  <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-2">
                    ⏳ メール未確認 ({miniUsers.filter(u => !u.email_verified).length})
                  </h2>
                  <div className="space-y-2">
                    {miniUsers.filter(u => !u.email_verified).map(user => (
                      <AccountCard
                        key={user.email}
                        user={user}
                        onUpdated={(oldEmail, updated) =>
                          setMiniUsers(prev => prev.map(u => u.email === oldEmail ? { ...u, ...updated, email: updated.email ?? u.email } : u))
                        }
                        onDeleted={(email) => setMiniUsers(prev => prev.filter(u => u.email !== email))}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
        )}

      </div>
    </div>
  );
}
