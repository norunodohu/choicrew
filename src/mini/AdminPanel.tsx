import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, updateDoc, doc, Timestamp, setDoc, getDocs } from 'firebase/firestore';
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

export default function AdminPanel() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'requests' | 'users' | 'migrate'>('requests');
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [existingUsers, setExistingUsers] = useState<Array<{ email: string; name: string; migrated: boolean }>>([]);
  const [migratingEmails, setMigratingEmails] = useState<Set<string>>(new Set());

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
        const snap = await getDocs(collection(db, 'mini_shares'));
        const existingUsersMap: Record<string, { email: string; name: string }> = {};
        
        snap.forEach((doc) => {
          const data = doc.data();
          const email = data.notify_email;
          const name = data.displayName || data.name || 'Unknown';
          
          if (email && name) {
            existingUsersMap[email] = { email, name };
          }
        });
        
        // mini_users と比較して、未移行ユーザーのみ抽出
        const toMigrate: typeof existingUsers = [];
        for (const [email, { name }] of Object.entries(existingUsersMap)) {
          // 実装の都合上、全て「未移行」と仮定（サーバーで存在確認）
          toMigrate.push({ email, name, migrated: false });
        }
        
        setExistingUsers(toMigrate);
      } catch (err) {
        console.error('既存ユーザー検出失敗:', err);
      }
    };

    detectExistingUsers();
  }, [authenticated]);

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
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
      </div>
    </div>
  );
}
