# -*- coding: utf-8 -*-
from pathlib import Path
path = Path('C:/Users/murat/Desktop/project/choicrew/src/App.tsx')
data = path.read_text(encoding='utf-8')
start = data.index('\n  if (isPublicView && publicUser) {') + 1
end_marker = '\n  return (\n    <div className="min-h-screen bg-[#F8FAFC] text-gray-900 font-sans"'
end = data.index(end_marker)
new_block = """
  if (isPublicView && publicUser) {
    const publicViewHeaderTitle = isFriendView ? "フレンドの予定" : `${publicUser.name}さんの予定`;
    const publicViewHeaderSubtitle = isFriendView
      ? (selectedFriendIds.length > 0 ? `${selectedFriendIds.length}人を選択中` : "左からフレンドを選んでください。")
      : (publicUser.search_id ? `ID: ${publicUser.search_id}` : "ID未設定");

    const renderAvailabilityCards = () => (
      <div className="grid gap-4">
        {isFriendView && selectedFriendIds.length === 0 ? (
          <div className="py-12 text-center bg-white rounded-3xl border border-dashed border-gray-200 text-gray-500 font-bold">
            フレンドを選ぶと予定が表示されます。
          </div>
        ) : isPublicHidden ? (
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
                  const owner = isFriendView ? selectedFriendLookup.get(a.user_id) : publicUser;
                  const isMyPendingRequest = isPendingMyRequest(a.id);
                  const isMyApprovedRequest = isApprovedMyRequest(a.id);
                  const myRequest = getMyRequest(a.id);
                  const otherPendingRequest = currentUser ? requests.some(r =>
                    r.availability_id === a.id &&
                    r.status === "pending" &&
                    r.manager_id !== currentUser.uid
                  ) : false;
                  const effectiveStatus = isMyPendingRequest
                    ? "pending"
                    : isMyApprovedRequest
                      ? "confirmed"
                      : otherPendingRequest
                        ? "pending"
                        : (a.status === "confirmed" ? "confirmed" : a.status === "busy" ? "busy" : "open");
                  const isBusy = effectiveStatus === "confirmed" || effectiveStatus === "busy" || effectiveStatus === "pending";
                  const buttonLabel = isMyPendingRequest
                    ? "依頼中"
                    : isMyApprovedRequest
                      ? "依頼確定"
                      : effectiveStatus === "confirmed"
                        ? "確定"
                        : effectiveStatus === "pending"
                          ? "やり取り中"
                          : "依頼を送る";
                  return (
                    <Card key={a.id} className={`p-4 sm:p-6 flex items-center justify-between gap-4 ${isBusy && !isMyPendingRequest && !isMyApprovedRequest ? "opacity-40 grayscale" : ""}`}>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-100 shrink-0">
                            <img
                              src={owner?.avatar_url || owner?.line_picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${owner?.name || a.user_id}`}
                              alt={owner?.name || "フレンド"}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-black text-gray-900 truncate">{owner?.name || "フレンド"}</p>
                            <p className="text-xs text-gray-500 truncate">{owner?.search_id ? `ID: ${owner.search_id}` : "ID未設定"}</p>
                          </div>
                        </div>
                        <p className="text-lg font-semibold text-gray-700">{a.start_time} - {a.end_time}</p>
                        {isMyPendingRequest && <p className="text-xs text-amber-600">依頼中</p>}
                        {isMyApprovedRequest && <p className="text-xs text-emerald-600">依頼確定</p>}
                        {!isMyPendingRequest && !isMyApprovedRequest && effectiveStatus === "confirmed" && <p className="text-xs text-emerald-600">確定</p>}
                        {!isMyPendingRequest && !isMyApprovedRequest && effectiveStatus === "pending" && <p className="text-xs text-amber-600">やり取り中</p>}
                      </div>
                      <button
                        onClick={async () => {
                          if (isMyPendingRequest) {
                            if (myRequest && window.confirm("依頼を取り消しますか？")) await handleCancelPendingRequest(myRequest);
                            return;
                          }
                          if (isMyApprovedRequest) {
                            return;
                          }
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
                          if (otherPendingRequest) {
                            alert("他のひとがやり取り中です。");
                            return;
                          }
                          if (!myRequest) openRequestModal(a);
                        }}
                        disabled={isOwnPreview || isMyApprovedRequest}
                        className={`px-4 py-3 rounded-2xl font-black border whitespace-nowrap ${isOwnPreview ? "border-gray-200 text-gray-300 bg-gray-50" : isMyApprovedRequest ? "border-emerald-200 text-emerald-700 bg-emerald-50" : isMyPendingRequest ? "border-amber-200 text-amber-700 bg-amber-50" : isBusy ? "border-gray-200 text-gray-300 bg-gray-50" : "border-blue-200 text-blue-600 bg-white"}`}
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
    );

    return (
      <div className={`min-h-screen bg-[#F8FAFC] ${isLoggedIn ? "lg:pl-72" : ""}`}>
        {isLoggedIn && desktopSidebarNode}
        <div className={`mx-auto ${isLoggedIn ? "max-w-[100rem] px-4 py-6 lg:px-12" : "max-w-2xl px-6 py-6"} space-y-8`}>
          {isFriendView ? (
            <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
              <Card className="p-5 sm:p-6 space-y-4 lg:sticky lg:top-6 h-fit">
                <div className="space-y-2">
                  <h2 className="text-xl font-black">フレンド一覧</h2>
                  <p className="text-sm text-gray-500">選んだフレンドの予定をまとめて表示します。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={selectAllFriends}
                    className="px-3 py-2 rounded-xl text-sm font-black border border-gray-200 bg-white text-gray-500 hover:border-blue-200 hover:text-blue-600"
                  >
                    全選択
                  </button>
                  <button
                    type="button"
                    onClick={clearSelectedFriends}
                    className="px-3 py-2 rounded-xl text-sm font-black border border-gray-200 bg-white text-gray-500 hover:border-blue-200 hover:text-blue-600"
                  >
                    解除
                  </button>
                </div>
                <div className="grid gap-3">
                  {connectionUsers.length > 0 ? connectionUsers.map(peer => {
                    const isSelected = selectedFriendIds.includes(peer.uid);
                    return (
                      <button
                        key={peer.uid}
                        type="button"
                        onClick={() => toggleSelectedFriend(peer.uid)}
                        className={`w-full rounded-2xl border p-3 text-left transition-all flex items-center gap-3 ${isSelected ? "border-blue-300 bg-blue-50 shadow-sm" : "border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/60"}`}
                      >
                        <div className="w-11 h-11 rounded-full overflow-hidden bg-gray-100 shrink-0">
                          <img
                            src={peer.avatar_url || peer.line_picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${peer.name}`}
                            alt={peer.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-black truncate">{peer.name}</p>
                          <p className="text-xs text-gray-500 truncate">ID: {peer.search_id || "未設定"}</p>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${isSelected ? "border-blue-600 bg-blue-600" : "border-gray-300 bg-white"}`}>
                          {isSelected && <span className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                      </button>
                    );
                  }) : (
                    <div className="px-4 py-8 text-center text-gray-400 font-bold bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                      フレンドがまだいません。
                    </div>
                  )}
                </div>
              </Card>

              <div className="space-y-6">
                <Card className="p-5 sm:p-8 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h1 className="text-3xl font-black tracking-tight">{publicViewHeaderTitle}</h1>
                      <p className="text-sm text-gray-500 mt-1">{publicViewHeaderSubtitle}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedFriendUsers.map(friend => (
                        <span key={friend.uid} className="px-3 py-2 rounded-full bg-blue-50 text-blue-700 text-xs font-black">
                          {friend.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setPublicFilterMode("all")}
                      className={`px-4 py-2 rounded-xl text-sm font-black border ${publicFilterMode === "all" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-400 border-gray-200"}`}
                    >
                      すべて
                    </button>
                    <button
                      onClick={() => setPublicFilterMode("open")}
                      className={`px-4 py-2 rounded-xl text-sm font-black border ${publicFilterMode === "open" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-400 border-gray-200"}`}
                    >
                      空きだけ
                    </button>
                    <button
                      onClick={() => setPublicFilterMode("my_requests")}
                      className={`px-4 py-2 rounded-xl text-sm font-black border ${publicFilterMode === "my_requests" ? "bg-amber-500 text-white border-amber-500" : "bg-white text-gray-400 border-gray-200"}`}
                    >
                      依頼中
                    </button>
                  </div>
                </Card>
                {renderAvailabilityCards()}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <Card className="p-5 sm:p-8 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h1 className="text-3xl font-black tracking-tight">{publicViewHeaderTitle}</h1>
                    <p className="text-sm text-gray-500 mt-1">{publicViewHeaderSubtitle}</p>
                  </div>
                  {publicUser.avatar_url || publicUser.line_picture ? (
                    <div className="w-14 h-14 rounded-full overflow-hidden bg-gray-100">
                      <img
                        src={publicUser.avatar_url || publicUser.line_picture || ""}
                        alt={publicUser.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setPublicFilterMode("all")}
                    className={`px-4 py-2 rounded-xl text-sm font-black border ${publicFilterMode === "all" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-400 border-gray-200"}`}
                  >
                    すべて
                  </button>
                  <button
                    onClick={() => setPublicFilterMode("open")}
                    className={`px-4 py-2 rounded-xl text-sm font-black border ${publicFilterMode === "open" ? "bg-blue-600 text-white border-blue-600" : "bg_WHITE text-gray-400 border-gray-200"}`}
                  >
                    空きだけ
                  </button>
                  <button
                    onClick={() => setPublicFilterMode("my_requests")}
                    className={`px-4 py-2 rounded-xl text-sm font-black border ${publicFilterMode === "my_requests" ? "bg-amber-500 text-white border-amber-500" : "bg-white text-gray-400 border-gray-200"}`}
                  >
                    依頼中
                  </button>
                </div>
              </Card>
              <div className="space-y-8">
                {renderAvailabilityCards()}
              </div>
            </div>
          )}
          <div className="pt-8 border-t border-gray-100 flex flex-col gap-3">
            {isOwnPreview ? (
              <Button onClick={() => window.close()} variant="outline">閉じる</Button>
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
        {requestModalNode}
        {statusMessageNode}
      </div>
    );
  }
"""
new_data = data[:start] + new_block + data[end:]
path.write_text(new_data, encoding='utf-8')
print('replaced')
