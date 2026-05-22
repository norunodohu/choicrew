import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, updateDoc, doc, Timestamp } from 'firebase/firestore';
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

export default function AdminPanel() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Firestore リスナー
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

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === '1234') {
      setAuthenticated(true);
      setError('');
    } else {
      setError('パスワードが間違っています');
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

      // 選択された依頼を全て更新
      await Promise.all(
        Array.from(selected).map((id) =>
          updateDoc(doc(db, 'mini_requests', id), { user_group_id: groupId })
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
          <h1 className="text-3xl font-bold text-slate-900">依頼管理</h1>
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
            <button
              onClick={handleLink}
              disabled={selected.size === 0 || loading}
              className={`ml-auto px-6 py-2 font-semibold rounded-lg transition ${
                selected.size === 0 || loading
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-teal-600 text-white hover:bg-teal-700'
              }`}
            >
              {loading ? '処理中...' : '紐づけ'}
            </button>
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
                        <code className="bg-slate-100 px-2 py-1 rounded text-xs">
                          {req.user_group_id ? req.user_group_id.substring(0, 12) + '...' : '-'}
                        </code>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 情報 */}
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
          <strong>紐づけについて：</strong> 複数の依頼を選択して「紐づけ」をクリックすると、新しいグループIDが生成され、それらの依頼が同じユーザーグループとして扱われます。
        </div>
      </div>
    </div>
  );
}
