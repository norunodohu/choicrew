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
  deleted?: boolean;
  deleted_at?: Timestamp;
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
      if (!res.ok) { 
        let errorMsg = data.error || '更新失敗';
        if (errorMsg.includes('already-exists')) {
          errorMsg = 'このメールアドレスは既に登録されています。';
        }
        setErr(errorMsg); 
        return; 
      }
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
      if (!res.ok) { 
        alert(`❌ 削除失敗: ${data.error || '不明'}`); 
        return; 
      }
      alert(`✅ 削除しました。${data.deletedShares ? `（予定 ${data.deletedShares} 件も削除）` : ''}`);
      onDeleted(user.email);
    } catch {
      alert('❌ ネットワークエラーが発生しました');
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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'requests' | 'migrate' | 'shares' | 'accounts'>('dashboard');
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
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
  // アカウント新規作成フォーム
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createName, setCreateName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

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
          // deleted フラグが true でない場合のみ表示
          if (!data.deleted) {
            items.push({
              id: d.id,
              title: data.title || data.name || '(無題)',
              displayName: data.displayName || data.name || '',
              creator_email: data.creator_email || '',
              notify_email: data.notify_email || '',
              created_at: data.created_at,
            });
          }
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

  // アカウント一覧（mini_users）を取得 — サーバーAPI経由（Firestoreルール制限回避）
  useEffect(() => {
    if (!authenticated) return;
    const loadMiniUsers = async () => {
      setMiniUsersLoading(true);
      try {
        const [usersRes, sharesSnap] = await Promise.all([
          fetch('/api/mini/admin/users', { headers: { 'x-admin-secret': ADMIN_SECRET } }),
          getDocs(collection(db, 'mini_shares')),
        ]);
        const usersData = await usersRes.json();
        // メール → シェア数のマップ
        const shareCountMap: Record<string, number> = {};
        sharesSnap.forEach(d => {
          const email = (d.data().creator_email || d.data().notify_email || '').toLowerCase();
          if (email) shareCountMap[email] = (shareCountMap[email] || 0) + 1;
        });
        const items: MiniUser[] = (usersData.users || []).map((u: any) => ({
          email: u.email,
          name: u.name || '',
          created_at: u.created_at,
          email_verified: u.email_verified ?? false,
          shareCount: shareCountMap[u.email.toLowerCase()] || 0,
        }));
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
    setLoading(true);
    setError('');
    try {
      await updateDoc(doc(db, 'mini_shares', shareId), {
        creator_email: trimmed,
        notify_email: trimmed,
      });
      setShares(prev => prev.map(s => s.id === shareId ? { ...s, creator_email: trimmed, notify_email: trimmed } : s));
      setEditingShareId(null);
      setEditingEmail('');
      alert(`✅ メールアドレスを設定しました`);
    } catch (err) {
      let errorMsg = `更新失敗: ${err instanceof Error ? err.message : '不明'}`;
      if (errorMsg.includes('permission')) {
        errorMsg = 'この予定の更新権限がありません。';
      }
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // 予定を削除
  const handleDeleteShare = async (shareId: string, title: string) => {
    if (!window.confirm(`「${title}」を削除しますか？\nこの操作は取り消せません。`)) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/mini/admin/delete-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
        body: JSON.stringify({ shareId }),
      });
      const data = await res.json();
      if (!res.ok) { 
        let errorMsg = data.error || '削除失敗';
        if (errorMsg.includes('permission')) {
          errorMsg = 'この予定を削除する権限がありません。';
        }
        setError(errorMsg); 
        return; 
      }
      setShares(prev => prev.filter(s => s.id !== shareId));
      alert(`✅ 予定「${title}」を削除しました（依頼 ${data.deletedRequests} 件も削除）`);
    } catch (err) {
      setError(`削除失敗: ${err instanceof Error ? err.message : '不明'}`);
    } finally {
      setLoading(false);
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

  const handleVerifyEmail = async (user: MiniUser) => {
    if (!user.email) return;
    
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/mini/admin/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
        body: JSON.stringify({ email: user.email }),
      });
      const data = await res.json();
      if (!res.ok) { 
        // エラーメッセージを日本語化
        let errorMsg = data.error || 'メール有効化失敗';
        if (errorMsg.includes('already-in-use') || errorMsg.includes('invalid-email')) {
          errorMsg = 'このメールアドレスは既に別のアカウントで登録されています。';
        } else if (errorMsg.includes('user-not-found')) {
          errorMsg = 'ユーザーが見つかりません。';
        }
        setError(errorMsg); 
        return; 
      }
      setMiniUsers(prev => prev.map(u => u.email === user.email ? { ...u, email_verified: true } : u));
      alert(`✅ ${user.name || user.email} のメールを有効化しました`);
    } catch (err) {
      setError(`エラー: ${err instanceof Error ? err.message : '不明'}`);
    } finally {
      setLoading(false);
    }
  };

  // ユーザーを移行
  const handleMigrateUser = async (email: string, name: string) => {
    setMigratingEmails(prev => new Set([...prev, email]));
    setError('');
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
        alert(`✅ ${email} を移行しました。パスワードリセットメールを送信しました。`);
      } else {
        let errorMsg = data.error || '移行失敗';
        if (errorMsg.includes('already-exists')) {
          errorMsg = `${email} は既に新システムに登録されています。`;
        }
        setError(`移行失敗 (${email}): ${errorMsg}`);
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
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-teal-900 to-slate-800 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md border border-slate-200">
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">🔐</div>
            <h1 className="text-3xl font-bold text-slate-900">Admin Panel</h1>
            <p className="text-sm text-slate-500 mt-2">管理者用ログイン</p>
          </div>
          <form onSubmit={handleAuth}>
            <input
              type="password"
              placeholder="パスワードを入力"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
            {error && <p className="text-red-600 text-sm mb-4 bg-red-50 p-3 rounded-lg">{error}</p>}
            <button
              type="submit"
              className="w-full bg-teal-600 text-white font-semibold py-3 rounded-lg hover:bg-teal-700 transition shadow-lg hover:shadow-xl"
            >
              ログイン
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-4">
            <div className="text-4xl">⚙️</div>
            <div>
              <h1 className="text-4xl font-bold text-slate-900">Admin Panel</h1>
              <p className="text-sm text-slate-500 mt-1">choicrew 管理ダッシュボード</p>
            </div>
          </div>
          <button
            onClick={() => setAuthenticated(false)}
            className="px-4 py-2 text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition font-medium"
          >
            ログアウト
          </button>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-lg text-red-700 flex items-start gap-3">
            <span className="text-lg mt-0.5">⚠️</span>
            <div>{error}</div>
          </div>
        )}

        {/* タブ */}
        <div className="flex gap-1 mb-8 border-b border-slate-200 overflow-x-auto">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-3 font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'dashboard'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📊 ダッシュボード
          </button>
          <button
            onClick={() => setActiveTab('requests')}
            className={`px-4 py-3 font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'requests'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📋 依頼管理
          </button>
          <button
            onClick={() => setActiveTab('shares')}
            className={`px-4 py-3 font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'shares'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📅 予定一覧 ({shares.length})
          </button>
          <button
            onClick={() => setActiveTab('accounts')}
            className={`px-4 py-3 font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'accounts'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🔑 アカウント ({miniUsers.length})
          </button>
          <button
            onClick={() => setActiveTab('migrate')}
            className={`px-4 py-3 font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'migrate'
                ? 'text-teal-600 border-b-2 border-teal-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🔄 ユーザー移行 ({existingUsers.length})
          </button>
        </div>

        {/* ダッシュボードタブ */}
        {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* 統計カード */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6 border border-blue-200">
              <div className="text-sm text-blue-600 font-semibold mb-2">👥 総ユーザー</div>
              <div className="text-3xl font-bold text-blue-900">{miniUsers.length}</div>
              <div className="text-xs text-blue-600 mt-2">
                ✅ 有効化済み: {miniUsers.filter(u => u.email_verified).length}
              </div>
            </div>

            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-6 border border-green-200">
              <div className="text-sm text-green-600 font-semibold mb-2">📅 予定</div>
              <div className="text-3xl font-bold text-green-900">{shares.length}</div>
              <div className="text-xs text-green-600 mt-2">
                📧 オーナー設定済み: {shares.filter(s => s.creator_email || s.notify_email).length}
              </div>
            </div>

            <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg p-6 border border-amber-200">
              <div className="text-sm text-amber-600 font-semibold mb-2">⏳ 依頼</div>
              <div className="text-3xl font-bold text-amber-900">{requests.length}</div>
              <div className="text-xs text-amber-600 mt-2">
                ⚪ 未処理: {requests.filter(r => r.status === 'pending').length}
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-6 border border-purple-200">
              <div className="text-sm text-purple-600 font-semibold mb-2">🔄 移行待ち</div>
              <div className="text-3xl font-bold text-purple-900">{existingUsers.length}</div>
              <div className="text-xs text-purple-600 mt-2">レガシーユーザー</div>
            </div>
          </div>

          {/* 警告・アラート */}
          <div className="space-y-3">
            {/* オーナー未設定予定 */}
            {shares.filter(s => !s.creator_email && !s.notify_email).length > 0 && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                <div className="flex gap-3">
                  <span className="text-2xl">⚠️</span>
                  <div>
                    <div className="font-semibold text-red-900">オーナー未設定の予定</div>
                    <div className="text-sm text-red-700 mt-1">
                      {shares.filter(s => !s.creator_email && !s.notify_email).length} 件の予定がオーナーメールアドレスなしです。
                      <a href="#shares" onClick={e => { e.preventDefault(); setActiveTab('shares'); }} className="font-bold underline ml-1">予定一覧で設定</a>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 未有効化ユーザー */}
            {miniUsers.filter(u => !u.email_verified).length > 0 && (
              <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded">
                <div className="flex gap-3">
                  <span className="text-2xl">⏳</span>
                  <div>
                    <div className="font-semibold text-amber-900">メール未確認ユーザー</div>
                    <div className="text-sm text-amber-700 mt-1">
                      {miniUsers.filter(u => !u.email_verified).length} 人のユーザーがメール確認を完了していません。
                      <a href="#accounts" onClick={e => { e.preventDefault(); setActiveTab('accounts'); }} className="font-bold underline ml-1">アカウント一覧で確認</a>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 移行待ちユーザー */}
            {existingUsers.length > 0 && (
              <div className="bg-purple-50 border-l-4 border-purple-500 p-4 rounded">
                <div className="flex gap-3">
                  <span className="text-2xl">🔄</span>
                  <div>
                    <div className="font-semibold text-purple-900">ユーザー移行が待機中</div>
                    <div className="text-sm text-purple-700 mt-1">
                      {existingUsers.length} 人のレガシーユーザーが新しいシステムに移行待ちです。
                      <a href="#migrate" onClick={e => { e.preventDefault(); setActiveTab('migrate'); }} className="font-bold underline ml-1">ユーザー移行で実行</a>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 最近のアクティビティ */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-4">📊 最近の依頼（最新10件）</h3>
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
              {requests.slice(0, 10).length === 0 ? (
                <div className="p-8 text-center text-slate-500">依頼がありません</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-slate-700">依頼者</th>
                      <th className="px-4 py-2 text-left font-semibold text-slate-700">日時</th>
                      <th className="px-4 py-2 text-left font-semibold text-slate-700">ステータス</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.slice(0, 10).map(req => (
                      <tr key={req.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-900">{req.requester_name}</td>
                        <td className="px-4 py-2 text-slate-600 text-xs">
                          {format(req.created_at.toDate(), 'MM/dd HH:mm', { locale: ja })}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            req.status === 'approved' ? 'bg-green-100 text-green-700' :
                            req.status === 'declined' ? 'bg-red-100 text-red-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {req.status === 'approved' ? '承認' : req.status === 'declined' ? '辞退' : '保留中'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
        )}

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

          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 flex gap-3">
            <span className="text-lg">ℹ️</span>
            <div>
              <strong>紐づけについて：</strong> 複数の依頼を選択して「紐づけ」をクリックすると、新しいグループIDが生成され、それらの依頼が同じユーザーグループとして扱われます。
            </div>
          </div>
        </div>
        )}

        {/* ユーザー管理タブ */}
        {activeTab === 'users' && (
        <div className="space-y-6">
          {/* このタブは削除されました */}
        </div>
        )}

        {/* ユーザー移行タブ */}
        {activeTab === 'migrate' && (
        <div className="space-y-4">
          <div className="bg-purple-50 border-l-4 border-purple-500 p-4 rounded-lg">
            <div className="flex gap-3">
              <span className="text-2xl">🔄</span>
              <div>
                <div className="font-bold text-purple-900">レガシーユーザーシステム移行</div>
                <div className="text-sm text-purple-700 mt-1">
                  旧システムから登録されたユーザーを新しいシステムに移行します。
                </div>
              </div>
            </div>
          </div>

          {existingUsers.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-8 text-center text-slate-500">
              移行対象のユーザーがありません
            </div>
          ) : (
            <>
              {existingUsers.map((user, idx) => (
                <div key={idx} className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 hover:shadow-md transition">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-bold text-slate-900">{user.name}</h3>
                      <p className="text-xs text-slate-600 mt-1">
                        <code className="bg-slate-100 px-2 py-0.5 rounded">{user.email}</code>
                      </p>
                    </div>
                    <button
                      onClick={() => handleMigrateUser(user.email, user.name)}
                      disabled={migratingEmails.has(user.email)}
                      className={`px-4 py-2 font-medium rounded-lg transition whitespace-nowrap ${
                        migratingEmails.has(user.email)
                          ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                          : 'bg-teal-600 text-white hover:bg-teal-700'
                      }`}
                    >
                      {migratingEmails.has(user.email) ? '移行中...' : '移行'}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        )}
        {/* 予定一覧タブ */}
        {activeTab === 'shares' && (
        <div className="space-y-6">
          {sharesLoading ? (
            <div className="bg-white rounded-xl shadow-md p-8 text-center text-slate-500">読み込み中...</div>
          ) : shares.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-8 text-center text-slate-500">予定がありません</div>
          ) : (
            <>
              {/* オーナー設定済み */}
              {shares.filter(s => s.creator_email || s.notify_email).length > 0 && (
                <section>
                  <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">
                    ✅ オーナー設定済み ({shares.filter(s => s.creator_email || s.notify_email).length})
                  </h2>
                  <div className="grid gap-3">
                    {shares.filter(s => s.creator_email || s.notify_email).map(share => {
                      const email = share.creator_email || share.notify_email || '';
                      return (
                        <div 
                          key={share.id} 
                          className="bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition p-4"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <a
                                href={`/share/${share.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-base font-bold text-teal-600 hover:text-teal-700 underline"
                              >
                                {share.title}
                              </a>
                              <div className="text-xs text-slate-500 mt-1">
                                📧 <code className="bg-slate-100 px-2 py-0.5 rounded">{email}</code>
                              </div>
                              <div className="text-xs text-slate-400 mt-1">
                                🕐 {share.created_at 
                                  ? format(share.created_at.toDate(), 'yyyy/MM/dd HH:mm', { locale: ja })
                                  : '-'
                                }
                              </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <button
                                onClick={() => { setEditingShareId(share.id); setEditingEmail(email); }}
                                className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-medium rounded hover:bg-slate-200 transition whitespace-nowrap"
                              >
                                変更
                              </button>
                              <button
                                onClick={() => handleDeleteShare(share.id, share.title)}
                                className="px-3 py-1.5 bg-red-100 text-red-700 text-xs font-medium rounded hover:bg-red-200 transition whitespace-nowrap"
                              >
                                削除
                              </button>
                            </div>
                          </div>
                          {editingShareId === share.id && (
                            <div className="mt-3 pt-3 border-t border-slate-200 flex gap-2">
                              <input
                                type="email"
                                value={editingEmail}
                                onChange={e => setEditingEmail(e.target.value)}
                                placeholder="email@example.com"
                                className="border border-slate-300 rounded px-2 py-1 text-xs flex-1 focus:outline-none focus:ring-2 focus:ring-teal-500"
                                autoFocus
                                onKeyDown={e => { if (e.key === 'Enter') handleAssignEmail(share.id); if (e.key === 'Escape') { setEditingShareId(null); setEditingEmail(''); } }}
                              />
                              <button 
                                onClick={() => handleAssignEmail(share.id)} 
                                className="px-2 py-1 bg-teal-600 text-white text-xs rounded hover:bg-teal-700 transition whitespace-nowrap"
                              >
                                保存
                              </button>
                              <button 
                                onClick={() => { setEditingShareId(null); setEditingEmail(''); }} 
                                className="px-2 py-1 bg-slate-200 text-slate-700 text-xs rounded hover:bg-slate-300 transition"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* オーナー未設定 */}
              {shares.filter(s => !s.creator_email && !s.notify_email).length > 0 && (
                <section>
                  <h2 className="text-sm font-bold text-red-600 uppercase tracking-wide mb-3">
                    ⚠️ オーナー未設定 ({shares.filter(s => !s.creator_email && !s.notify_email).length})
                  </h2>
                  <div className="grid gap-3">
                    {shares.filter(s => !s.creator_email && !s.notify_email).map(share => (
                      <div 
                        key={share.id} 
                        className="bg-red-50 rounded-lg border border-red-200 shadow-sm hover:shadow-md transition p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <a
                              href={`/share/${share.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-base font-bold text-red-600 hover:text-red-700 underline"
                            >
                              {share.title}
                            </a>
                            <div className="text-xs text-red-600 font-medium mt-1">
                              📧 メールアドレス未設定
                            </div>
                            <div className="text-xs text-red-500 mt-1">
                              🕐 {share.created_at 
                                ? format(share.created_at.toDate(), 'yyyy/MM/dd HH:mm', { locale: ja })
                                : '-'
                              }
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {editingShareId === share.id ? (
                              <div className="flex gap-2">
                                <input
                                  type="email"
                                  value={editingEmail}
                                  onChange={e => setEditingEmail(e.target.value)}
                                  placeholder="email@example.com"
                                  className="border border-slate-300 rounded px-2 py-1 text-xs w-32 focus:outline-none focus:ring-2 focus:ring-teal-500"
                                  autoFocus
                                  onKeyDown={e => { if (e.key === 'Enter') handleAssignEmail(share.id); if (e.key === 'Escape') { setEditingShareId(null); setEditingEmail(''); } }}
                                />
                                <button 
                                  onClick={() => handleAssignEmail(share.id)} 
                                  className="px-2 py-1 bg-teal-600 text-white text-xs rounded hover:bg-teal-700 transition whitespace-nowrap"
                                >
                                  保存
                                </button>
                                <button 
                                  onClick={() => { setEditingShareId(null); setEditingEmail(''); }} 
                                  className="px-2 py-1 bg-slate-200 text-slate-700 text-xs rounded hover:bg-slate-300 transition"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={() => { setEditingShareId(share.id); setEditingEmail(''); }}
                                  className="px-3 py-1.5 bg-teal-600 text-white text-xs font-medium rounded hover:bg-teal-700 transition whitespace-nowrap"
                                >
                                  設定
                                </button>
                                <button
                                  onClick={() => handleDeleteShare(share.id, share.title)}
                                  className="px-3 py-1.5 bg-red-100 text-red-700 text-xs font-medium rounded hover:bg-red-200 transition whitespace-nowrap"
                                >
                                  削除
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
            <strong>💡 予定管理について：</strong> オーナー未設定の予定は利用者が自動認識されません。すべての予定にオーナーメールアドレスを設定してください。
          </div>
        </div>
        )}

        {/* アカウント一覧タブ */}
        {activeTab === 'accounts' && (
        <div className="space-y-6">
          {/* アカウント新規作成 */}
          <div className="bg-white rounded-xl shadow-md p-4 border border-slate-200">
            <button
              onClick={() => { setShowCreateUser(v => !v); setCreateError(''); }}
              className="w-full text-left font-semibold text-teal-700 flex items-center gap-2"
            >
              <span className="text-xl">➕</span> アカウントを追加
            </button>
            {showCreateUser && (
              <div className="mt-4 space-y-3">
                <input
                  type="text" placeholder="名前" value={createName} onChange={e => setCreateName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                <input
                  type="email" placeholder="メールアドレス" value={createEmail} onChange={e => setCreateEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                <input
                  type="text" placeholder="パスワード（6文字以上）" value={createPassword} onChange={e => setCreatePassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                {createError && <p className="text-xs text-red-600">{createError}</p>}
                <button
                  disabled={createLoading || !createEmail || !createName || !createPassword}
                  onClick={async () => {
                    setCreateLoading(true); setCreateError('');
                    try {
                      const res = await fetch('/api/mini/admin/create-user', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
                        body: JSON.stringify({ email: createEmail.trim(), name: createName.trim(), password: createPassword }),
                      });
                      const data = await res.json();
                      if (!res.ok) { setCreateError(data.error || '作成失敗'); return; }
                      setMiniUsers(prev => [{ email: createEmail.trim().toLowerCase(), name: createName.trim(), email_verified: true, shareCount: 0 }, ...prev]);
                      setCreateEmail(''); setCreateName(''); setCreatePassword('');
                      setShowCreateUser(false);
                    } catch { setCreateError('ネットワークエラー'); }
                    finally { setCreateLoading(false); }
                  }}
                  className="w-full py-2 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-700 transition disabled:opacity-50 text-sm"
                >
                  {createLoading ? '作成中...' : '作成する'}
                </button>
              </div>
            )}
          </div>

          {miniUsersLoading ? (
            <div className="bg-white rounded-xl shadow-md p-8 text-center text-slate-500">読み込み中...</div>
          ) : miniUsers.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-8 text-center text-slate-500">アカウントがありません</div>
          ) : (
            <>
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                <strong>💡 アカウント管理について：</strong> ここは登録済みユーザーアカウント（mini_users）の管理です。編集・削除ができます。
                <div className="mt-2 text-xs">
                  ℹ️ email_verified は mini_users の値で判定しています。予定（mini_shares）の email_verified は使用していません。
                </div>
              </div>

              {/* 有効化済み */}
              {miniUsers.filter(u => u.email_verified).length > 0 && (
                <section>
                  <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">
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
                  <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">
                    ⏳ メール未確認 ({miniUsers.filter(u => !u.email_verified).length})
                  </h2>
                  <div className="space-y-2">
                    {miniUsers.filter(u => !u.email_verified).map(user => (
                      <div key={user.email} className="relative">
                        <AccountCard
                          user={user}
                          onUpdated={(oldEmail, updated) =>
                            setMiniUsers(prev => prev.map(u => u.email === oldEmail ? { ...u, ...updated, email: updated.email ?? u.email } : u))
                          }
                          onDeleted={(email) => setMiniUsers(prev => prev.filter(u => u.email !== email))}
                        />
                        <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-700 flex gap-2">
                          <span>ℹ️</span>
                          <button
                            onClick={() => handleVerifyEmail(user)}
                            disabled={loading}
                            className="font-bold underline hover:text-yellow-900"
                          >
                            クリック
                          </button>
                          <span>で有効化</span>
                        </div>
                      </div>
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
