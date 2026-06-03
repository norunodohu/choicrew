import express from "express";
import path from "path";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import bcryptjs from "bcryptjs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
path.dirname(__filename);

const app = express();
export default app;
const PORT = 3000;

function formatMiniShareEndDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(date);
}

const adminProjectId = process.env.FIREBASE_PROJECT_ID;
const adminClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const adminPrivateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!getApps().length && adminProjectId && adminClientEmail && adminPrivateKey) {
  initializeApp({
    credential: cert({
      projectId: adminProjectId,
      clientEmail: adminClientEmail,
      privateKey: adminPrivateKey,
    }),
  });
}

const mintCustomToken = async (uid: string) => {
  if (!getApps().length) {
    throw new Error("Firebase Admin SDK is not configured");
  }
  return getAdminAuth().createCustomToken(uid);
};

app.use(cors());
app.use(express.json());

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

// FCM Web Push 通知送信エンドポイント
app.post("/api/notify", async (req, res) => {
  const { token, title, body } = req.body as { token?: string; title?: string; body?: string };
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "token required" });
  }
  if (!getApps().length) {
    return res.status(503).json({ error: "admin not configured" });
  }
  const { url } = req.body as { url?: string };
  try {
    await getMessaging().send({
      token,
      notification: {
        title: title || "新着依頼があります",
        body: body || "依頼が届きました",
      },
      webpush: {
        data: { url: url || "/" },
        fcmOptions: { link: url || "/" },
      },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("FCM send error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    env: {
      hasClientId: !!process.env.LINE_CLIENT_ID,
      hasClientSecret: !!process.env.LINE_CLIENT_SECRET,
      appUrl: process.env.APP_URL || "not set",
    },
  });
});

app.get("/api/auth/line/url", (req, res) => {
  const clientId = process.env.LINE_CLIENT_ID;
  const clientSecret = process.env.LINE_CLIENT_SECRET;
  const appUrl = (process.env.APP_URL || "").trim().replace(/\/$/, "");

  if (!clientId || !clientSecret || !appUrl) {
    return res.status(500).json({ error: "Environment variables missing" });
  }

  const redirectUri = `${appUrl}/api/auth/line/callback`;
  const state = Math.random().toString(36).substring(7);
  const scope = "profile openid";
  const url = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${scope}&bot_prompt=aggressive`;
  res.json({ url });
});

app.get("/api/auth/line/callback", async (req, res) => {
  const { code } = req.query;
  const clientId = process.env.LINE_CLIENT_ID;
  const clientSecret = process.env.LINE_CLIENT_SECRET;
  const appUrl = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/auth/line/callback`;

  try {
    if (!code) throw new Error("No code received from LINE");
    if (!clientId || !clientSecret) throw new Error("LINE_CLIENT_ID or LINE_CLIENT_SECRET is missing");

    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code: code as string,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const tokenResponse = await axios.post(
      "https://api.line.me/oauth2/v2.1/token",
      params.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const profileResponse = await axios.get("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` }
    });

    const profile = profileResponse.data || {};

    res.send(`
      <html>
        <body>
          <script>
            const profile = ${JSON.stringify(profile)};
            if (window.opener) {
              window.opener.postMessage({ type: 'LINE_AUTH_SUCCESS', profile }, '*');
              window.close();
            } else {
              window.location.href = '/?line_user=' + encodeURIComponent(JSON.stringify(profile));
            }
          </script>
          <p>LINE連携が完了しました。このウィンドウを閉じてください。</p>
        </body>
      </html>
    `);
  } catch (error: unknown) {
    const err = error as { response?: { data?: Record<string, unknown> }, message?: string };
    const errorData = err.response?.data || { message: err.message };
    console.error("LINE Auth Error Details:", JSON.stringify(errorData));
    res.status(500).send(`
      <html>
        <body>
          <h1>Authentication failed</h1>
          <p>Error: ${errorData.error || "unknown"}</p>
          <p>Description: ${errorData.error_description || errorData.message || "No details provided"}</p>
          <button onclick="window.close()">Close</button>
        </body>
      </html>
    `);
  }
});

app.post("/api/notify", async (req, res) => {
  const { lineUserId, message } = req.body;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();

  if (!accessToken) {
    return res.status(503).json({
      success: false,
      reason: "config_missing",
      message: "LINE_CHANNEL_ACCESS_TOKEN not configured",
      details: "LINEの通知設定が不足しています。",
    });
  }
  if (!lineUserId || !message) {
    return res.status(400).json({
      success: false,
      reason: "line_user_missing",
      message: "lineUserId and message are required",
      details: "送信先のLINEユーザーが必要です。",
    });
  }

  try {
    const profileCheck = await axios.get(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    await axios.post("https://api.line.me/v2/bot/message/push", {
      to: lineUserId,
      messages: [{ type: "text", text: message }]
    }, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      }
    });

    res.json({
      success: true,
      reason: "delivered",
      details: "LINEから通知しました。",
      profileCheck: {
        status: profileCheck.status,
        userId: profileCheck.data?.userId,
      },
    });
  } catch (error: unknown) {
    const err = error as { response?: { data?: Record<string, unknown> }, message?: string };
    const status = err.response?.status;
    const payload = err.response?.data || {};
    let reason = "push_failed";
    let details = "LINEから通知できませんでした。";

    if (status === 401) {
      reason = "invalid_token";
      details = "LINE_CHANNEL_ACCESS_TOKENが無効です。";
    } else if (status === 403) {
      reason = "not_authorized";
      details = "LINEの送信権限が不足しています。";
    } else if (status === 400 && payload?.message === "Failed to send messages") {
      reason = "not_following_or_blocked";
      details = "友だち追加されていないか、ブロックされています。";
    } else if (status === 404) {
      reason = "profile_not_found";
      details = "送信先が見つかりません。";
    }

    console.error("LINE Messaging Error:", { status, payload: err.response?.data || err.message });
    res.json({
      success: false,
      lineDelivered: false,
      error: "Failed to send LINE message",
      reason,
      details,
      raw: err.response?.data || err.message || "unknown",
    });
  }
});

app.post("/api/auth/line/firebase-token", async (req, res) => {
  try {
    const profile = req.body?.profile;
    if (!profile?.userId || !profile?.displayName) {
      return res.status(400).json({ error: "profile is required" });
    }

    const customToken = await mintCustomToken(`line_${profile.userId}`);
    res.json({
      uid: `line_${profile.userId}`,
      customToken,
      debug: {
        projectId: adminProjectId,
        tokenPrefix: customToken.slice(0, 12),
        tokenLength: customToken.length,
      },
    });
  } catch (error: unknown) {
    const err = error as { message?: string };
    res.status(500).json({ error: err.message || "Failed to create custom token" });
  }
});

app.post("/api/auth/google/firebase-token", async (req, res) => {
  try {
    const { uid } = req.body || {};
    if (!uid || typeof uid !== "string") {
      return res.status(400).json({ error: "uid is required" });
    }
    const customToken = await mintCustomToken(uid);
    res.json({
      uid,
      customToken,
      debug: {
        projectId: adminProjectId,
        tokenPrefix: customToken.slice(0, 12),
        tokenLength: customToken.length,
      },
    });
  } catch (error: unknown) {
    const err = error as { message?: string };
    res.status(500).json({ error: err.message || "Failed to create custom token" });
  }
});

/* ================================================================
   エラーメッセージ日本語化関数
   ================================================================ */
function localizeErrorMessage(err: unknown): string {
  const errStr = String(err);
  
  // Firebase Auth エラーコードを抽出
  if (errStr.includes('auth/invalid-email')) {
    return 'このメールアドレスの形式が正しくありません。';
  }
  if (errStr.includes('auth/weak-password')) {
    return 'パスワードが弱すぎます。6文字以上で構成してください。';
  }
  if (errStr.includes('auth/email-already-exists')) {
    return 'このメールアドレスは既に登録されています。';
  }
  if (errStr.includes('auth/user-not-found')) {
    return 'このメールアドレスでアカウントが見つかりません。';
  }
  if (errStr.includes('auth/invalid-password') || errStr.includes('auth/wrong-password')) {
    return 'パスワードが正しくありません。';
  }
  if (errStr.includes('auth/user-disabled')) {
    return 'このアカウントは無効化されています。';
  }
  if (errStr.includes('PERMISSION_DENIED')) {
    return '権限がありません。';
  }
  if (errStr.includes('NOT_FOUND')) {
    return 'データが見つかりません。';
  }
  
  // その他のエラーはそのまま返す
  return errStr;
}

/* ================================================================
   メール通知 for Mini share pages
   ================================================================ */
async function sendResendEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY || process.env.SMTP_PASS;
  const fromAddress = process.env.SMTP_FROM || "noreply@choicrew.com";
  const from = `ChoiCrew <${fromAddress}>`;
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

app.post("/api/mini/notify-email", async (req, res) => {
  const { shareId, requesterName, slotDate, slotStart, slotEnd, message: reqMessage } = req.body as {
    shareId?: string; requesterName?: string; slotDate?: string;
    slotStart?: string; slotEnd?: string; message?: string;
  };
  if (!shareId) return res.status(400).json({ error: "shareId required" });
  if (!getApps().length) return res.status(503).json({ error: "admin not configured" });

  try {
    const adminDb = getFirestore();
    const snap = await adminDb.doc(`mini_shares/${shareId}`).get();
    if (!snap.exists) return res.status(404).json({ error: "share not found" });

    const data = snap.data()!;
    const notifyEmail = data.notify_email as string | undefined;
    if (!notifyEmail) return res.json({ ok: false, reason: "no_email" });

    const actualTo = process.env.SMTP_TO || notifyEmail;
    const appUrl = (process.env.APP_URL || "https://choicrew.com").replace(/\/$/, "");
    const shareUrl = `${appUrl}/mini/s/${shareId}`;
    const ownerName = (data.displayName || data.name || "管理者") as string;

    const bodyLines = [
      `${ownerName}さんに新しい依頼が届きました。`,
      "",
      `依頼者: ${requesterName || "不明"}`,
      `日時: ${slotDate} ${slotStart}〜${slotEnd}`,
      ...(reqMessage ? [`メッセージ: ${reqMessage}`] : []),
      "",
      "▼ 確認・承認はこちら",
      shareUrl,
    ];

    await sendResendEmail(
      actualTo,
      `${requesterName || "誰か"}さんからの依頼`,
      bodyLines.join("\n")
    );

    res.json({ ok: true });

    // 依頼受信のタイミングでバックグラウンドクリーンアップ
    if (getApps().length) {
      runCleanup().catch(e => console.error("[bg cleanup]", e));
    }
  } catch (err) {
    console.error("Email notify error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// メール通知先登録の確認メール
app.post("/api/mini/email-confirm", async (req, res) => {
  const { to, isNew } = req.body as { to?: string; isNew?: boolean };
  if (!to) return res.status(400).json({ error: "to required" });

  const appUrl = (process.env.APP_URL || "https://choicrew.com").replace(/\/$/, "");
  
  if (isNew) {
    // 新規ユーザー：確認トークン付きメール送信
    const token = Buffer.from(to).toString('base64');
    const verifyUrl = `${appUrl}/mini/verify-email?token=${token}`;

    try {
      await sendResendEmail(
        process.env.SMTP_TO || to,
        "【ChoiCrew Mini】メールアドレス確認のお願い",
        [
          "ChoiCrew Mini をご利用いただきありがとうございます。",
          "",
          "以下のリンクをクリックして、メールアドレスを確認してください。",
          verifyUrl,
          "",
          "このリンクは24時間有効です。",
          "",
          "※ このメールに心当たりがない場合は、このメールを削除してください。",
        ].join("\n")
      );

      res.json({ ok: true });
    } catch (err) {
      console.error("Email confirm error:", err);
      res.status(500).json({ error: localizeErrorMessage(err) });
    }
  } else {
    // 既存ユーザー：確認メール送信（トークンなし）
    try {
      await sendResendEmail(
        process.env.SMTP_TO || to,
        "【ChoiCrew Mini】メール設定が更新されました",
        [
          "メール設定が更新されました。",
          "",
          "今後、このメールアドレスに通知が届きます。",
          "管理者によって有効化されるまで、メール通知は送信されません。",
          "",
          "※ このメールは自動送信です。返信しても届きません。",
        ].join("\n")
      );

      res.json({ ok: true });
    } catch (err) {
      console.error("Email confirm error:", err);
      res.status(500).json({ error: localizeErrorMessage(err) });
    }
  }
});

// メール確認リンク & ログイン & 新規登録完了
app.get("/api/mini/verify-email", async (req, res) => {
  const { token, register } = req.query as { token?: string; register?: string };
  if (!token) return res.status(400).json({ error: "token required" });

  try {
    const adminDb = getFirestore();
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [email, timestamp] = decoded.split(':');
    
    // タイムスタンプをチェック（5分以内か）
    const tokenTime = parseInt(timestamp, 10);
    const now = Date.now();
    const expiryTime = 5 * 60 * 1000; // 5分
    
    if (isNaN(tokenTime) || now - tokenTime > expiryTime) {
      return res.status(401).json({ error: "確認リンクが期限切れです。新しい確認メールをリクエストしてください。" });
    }
    
    if (register) {
      // 新規登録のメール確認
      const userRef = adminDb.collection('mini_users').doc(email);
      const userSnap = await userRef.get();
      
      if (!userSnap.exists) {
        return res.status(404).json({ error: "ユーザーが見つかりません" });
      }

      // メール確認を完了
      await userRef.update({ email_verified: true });

      const user = userSnap.data();
      const sessionToken = Buffer.from(`${email}:${Date.now()}`).toString('base64');

      return res.json({
        ok: true,
        user: {
          email,
          name: user.name,
          email_verified: true,
        },
        sessionToken,
        isRegistration: true,
      });
    } else {
      // 既存ユーザーのメール通知確認（互換性維持）
      // メールアドレスでクエリ → 該当する全予定の email_verified も true に
      const sharesSnap = await adminDb.collection('mini_shares').where('notify_email', '==', email).get();

      if (sharesSnap.size > 0) {
        const updates = sharesSnap.docs.map(d => d.ref.update({ email_verified: true }));
        await Promise.all(updates);
      }

      res.json({ ok: true, message: `${sharesSnap.size} 件の予定でメールを有効化しました` });
    }
  } catch (err) {
    console.error("Email verify error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// ログインメール送信
app.post("/api/mini/send-login-email", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "email required" });

  const appUrl = (process.env.APP_URL || "https://choicrew.com").replace(/\/$/, "");
  const token = Buffer.from(email).toString('base64');
  const loginUrl = `${appUrl}/mini/verify-email?token=${token}`;

  try {
    await sendResendEmail(
      process.env.SMTP_TO || email,
      "【ChoiCrew Mini】ログインリンク",
      [
        "ChoiCrew Mini へのログインリンクです。",
        "",
        "下のリンクをクリックしてログインしてください（24時間有効）:",
        loginUrl,
        "",
        "※ このメールに心当たりがない場合は、このメールを削除してください。",
      ].join("\n")
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("Login email error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// メールアドレスの存在確認
app.post("/api/mini/check-email", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "email required" });

  try {
    const adminDb = getFirestore();
    const userRef = adminDb.collection('mini_users').doc(email);
    const userSnap = await userRef.get();

    res.json({ isNew: !userSnap.exists });
  } catch (err) {
    console.error("Check email error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// 新規登録
app.post("/api/mini/register", async (req, res) => {
  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
  if (!email || !password || !name) return res.status(400).json({ error: "email, password, name required" });
  if (password.length < 6) return res.status(400).json({ error: "password must be 6+ characters" });

  try {
    const adminDb = getFirestore();
    const userRef = adminDb.collection('mini_users').doc(email);
    const userSnap = await userRef.get();

    if (userSnap.exists) {
      return res.status(409).json({ error: "このメールアドレスは既に登録されています" });
    }

    // パスワードをハッシュ化
    const passwordHash = await bcryptjs.hash(password, 10);

    // ユーザー情報を保存
    await userRef.set({
      email,
      name,
      password_hash: passwordHash,
      email_verified: false,
      created_at: new Date(),
    });

    // 確認メール送信（タイムスタンプ付きトークン）
    const appUrl = (process.env.APP_URL || "https://choicrew.com").replace(/\/$/, "");
    const timestamp = Date.now();
    const token = Buffer.from(`${email}:${timestamp}`).toString('base64');
    const verifyUrl = `${appUrl}/mini/verify-email?token=${token}&register=1`;

    await sendResendEmail(
      process.env.SMTP_TO || email,
      "【ChoiCrew Mini】メールアドレス確認のお願い",
      [
        "ChoiCrew Mini の登録ありがとうございます。",
        "",
        "下のリンクをクリックしてメールアドレスを確認してください（5分以内）:",
        verifyUrl,
        "",
        "※ このメールに心当たりがない場合は、このメールを削除してください。",
      ].join("\n")
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// プロフィール更新（名前）
app.post("/api/mini/update-profile", async (req, res) => {
  const { sessionToken, name } = req.body as { sessionToken?: string; name?: string };
  if (!sessionToken || !name) return res.status(400).json({ error: "sessionToken and name required" });
  try {
    const decoded = Buffer.from(sessionToken, 'base64').toString('utf-8');
    const email = decoded.split(':')[0];
    if (!email) return res.status(400).json({ error: "invalid sessionToken" });
    const adminDb = getFirestore();
    const userRef = adminDb.collection('mini_users').doc(email);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: "ユーザーが見つかりません" });
    await userRef.update({ name: name.trim(), updated_at: new Date() });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// ログイン
app.post("/api/mini/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "email and password required" });

  try {
    const adminDb = getFirestore();
    const userRef = adminDb.collection('mini_users').doc(email);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(401).json({ error: "ユーザーが見つかりません" });
    }

    const userData = userSnap.data();

    // パスワード確認
    const isValid = await bcryptjs.compare(password, userData.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: "パスワードが間違っています" });
    }

    if (!userData.email_verified) {
      return res.status(403).json({ error: "メール確認が完了していません" });
    }

    // セッショントークン生成
    const sessionToken = Buffer.from(`${email}:${Date.now()}`).toString('base64');

    res.json({
      ok: true,
      user: {
        email,
        name: userData.name,
        email_verified: userData.email_verified,
      },
      sessionToken,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// パスワードリセットリクエスト
app.post("/api/mini/request-password-reset", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "email required" });

  try {
    const adminDb = getFirestore();
    const userRef = adminDb.collection('mini_users').doc(email);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      // セキュリティのため、ユーザーが存在しない場合も「送信しました」と返す
      return res.json({ ok: true });
    }

    // パスワードリセット用トークン生成（5分有効）
    const timestamp = Date.now();
    const token = Buffer.from(`${email}:${timestamp}`).toString('base64');
    const appUrl = (process.env.APP_URL || "https://choicrew.com").replace(/\/$/, "");
    const resetUrl = `${appUrl}/mini/reset-password?token=${token}`;

    await sendResendEmail(
      process.env.SMTP_TO || email,
      "【ChoiCrew Mini】パスワード再設定のお願い",
      [
        "パスワード再設定のご依頼をいただきました。",
        "",
        "下のリンクをクリックして新しいパスワードを設定してください（5分以内）:",
        resetUrl,
        "",
        "※ このメールに心当たりがない場合は、このメールを削除してください。",
      ].join("\n")
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("Password reset request error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// パスワード再設定
app.post("/api/mini/reset-password", async (req, res) => {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password) return res.status(400).json({ error: "token and password required" });
  if (password.length < 6) return res.status(400).json({ error: "password must be 6+ characters" });

  try {
    const adminDb = getFirestore();
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [email, timestamp] = decoded.split(':');

    // トークンの有効期限チェック（5分）
    const tokenTime = parseInt(timestamp, 10);
    const now = Date.now();
    const expiryTime = 5 * 60 * 1000; // 5分

    if (isNaN(tokenTime) || now - tokenTime > expiryTime) {
      return res.status(401).json({ error: "リセットリンクが期限切れです。新しいリンクをリクエストしてください。" });
    }

    // パスワードをハッシュ化
    const passwordHash = await bcryptjs.hash(password, 10);

    // パスワード更新
    const userRef = adminDb.collection('mini_users').doc(email);
    await userRef.update({ password_hash: passwordHash });

    res.json({ ok: true });
  } catch (err) {
    console.error("Password reset error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// 既存ユーザーの移行
app.post("/api/mini/migrate-existing-user", async (req, res) => {
  const { email, name } = req.body as { email?: string; name?: string };
  if (!email || !name) return res.status(400).json({ error: "email and name required" });

  try {
    const adminDb = getFirestore();
    const userRef = adminDb.collection('mini_users').doc(email);
    const userSnap = await userRef.get();

    if (userSnap.exists) {
      return res.status(409).json({ error: "このメールアドレスは既に登録されています" });
    }

    // 仮パスワード生成（UUID風）
    const tempPassword = Buffer.from(`temp-${email}-${Date.now()}`).toString('base64').slice(0, 12);
    const passwordHash = await bcryptjs.hash(tempPassword, 10);

    // mini_users に登録（email_verified=true で自動認証）
    await userRef.set({
      email,
      name,
      password_hash: passwordHash,
      email_verified: true, // 既存ユーザーなのでスキップ
      created_at: new Date(),
      migrated_at: new Date(), // 移行フラグ
    });

    // パスワードリセットメール送信
    const appUrl = (process.env.APP_URL || "https://choicrew.com").replace(/\/$/, "");
    const timestamp = Date.now();
    const token = Buffer.from(`${email}:${timestamp}`).toString('base64');
    const resetUrl = `${appUrl}/mini/reset-password?token=${token}`;

    await sendResendEmail(
      process.env.SMTP_TO || email,
      "【ChoiCrew Mini】ログインシステム移行のお知らせ",
      [
        `${name}さん、こんにちは。`,
        "",
        "ChoiCrew Mini がパスワード認証ログインに対応しました！",
        "",
        "下のリンクをクリックして新しいパスワードを設定してください（5分以内）:",
        resetUrl,
        "",
        "設定後は、このメールアドレスとパスワードでログインできます。",
        "",
        "質問や問題がありましたら、お気軽にお問い合わせください。",
        "",
        "ChoiCrew Mini チーム",
      ].join("\n")
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("User migration error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// ===== Admin: アカウント管理 =====
const ADMIN_SECRET = process.env.ADMIN_SECRET || "choicrew-admin-1234";

function checkAdminSecret(req: any, res: any): boolean {
  const secret = req.headers['x-admin-secret'] || req.body?.adminSecret;
  if (secret !== ADMIN_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// Admin: アカウント作成（メール確認不要・即有効化）
app.post("/api/mini/admin/create-user", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
  if (!email || !password || !name) return res.status(400).json({ error: "email, password, name required" });
  if (password.length < 6) return res.status(400).json({ error: "パスワードは6文字以上にしてください" });
  try {
    const adminDb = getFirestore();
    const userRef = adminDb.collection('mini_users').doc(email.trim().toLowerCase());
    const snap = await userRef.get();
    if (snap.exists) return res.status(409).json({ error: "このメールアドレスは既に登録されています" });
    const passwordHash = await bcryptjs.hash(password, 10);
    await userRef.set({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      password_hash: passwordHash,
      email_verified: true,
      created_at: new Date(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// アカウント一覧取得
app.get("/api/mini/admin/users", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const adminDb = getFirestore();
    const snap = await adminDb.collection('mini_users').get();
    const users = snap.docs.map(d => {
      const data = d.data();
      return { email: d.id, name: data.name, email_verified: data.email_verified, created_at: data.created_at };
    });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// アカウント更新（表示名・メール・email_verified）
app.post("/api/mini/admin/update-user", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  const { email, newEmail, name, email_verified } = req.body as {
    email?: string; newEmail?: string; name?: string; email_verified?: boolean;
  };
  if (!email) return res.status(400).json({ error: "email required" });
  try {
    const adminDb = getFirestore();
    const userRef = adminDb.collection('mini_users').doc(email);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: "ユーザーが見つかりません" });

    if (newEmail && newEmail !== email) {
      // メールアドレス変更：古いドキュメントを削除して新しいIDで作り直す
      const data = snap.data()!;
      await adminDb.collection('mini_users').doc(newEmail).set({
        ...data,
        email: newEmail,
        ...(name !== undefined ? { name } : {}),
        ...(email_verified !== undefined ? { email_verified } : {}),
        updated_at: new Date(),
      });
      await userRef.delete();
      // mini_shares の creator_email / notify_email も更新
      const sharesSnap = await adminDb.collection('mini_shares')
        .where('creator_email', '==', email).get();
      const sharesSnap2 = await adminDb.collection('mini_shares')
        .where('notify_email', '==', email).get();
      const batch = adminDb.batch();
      sharesSnap.docs.forEach(d => batch.update(d.ref, { creator_email: newEmail }));
      sharesSnap2.docs.forEach(d => {
        if (!sharesSnap.docs.find(x => x.id === d.id)) {
          batch.update(d.ref, { notify_email: newEmail });
        }
      });
      await batch.commit();
    } else {
      const updates: Record<string, any> = { updated_at: new Date() };
      if (name !== undefined) updates.name = name;
      if (email_verified !== undefined) updates.email_verified = email_verified;
      await userRef.update(updates);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// アカウント削除
app.post("/api/mini/admin/delete-user", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "email required" });
  try {
    const adminDb = getFirestore();

    // そのユーザーが作成した予定を取得（creator_email または notify_email で検索）
    const [byCreator, byNotify] = await Promise.all([
      adminDb.collection('mini_shares').where('creator_email', '==', email).get(),
      adminDb.collection('mini_shares').where('notify_email', '==', email).get(),
    ]);
    const shareIds = new Set<string>();
    byCreator.docs.forEach(d => shareIds.add(d.id));
    byNotify.docs.forEach(d => shareIds.add(d.id));

    // 予定に紐づく依頼を削除し、予定も削除
    for (const shareId of shareIds) {
      const reqsSnap = await adminDb.collection('mini_requests')
        .where('share_id', '==', shareId).get();
      const batch = adminDb.batch();
      reqsSnap.docs.forEach(d => batch.delete(d.ref));
      batch.delete(adminDb.collection('mini_shares').doc(shareId));
      await batch.commit();
    }

    // アカウント削除
    await adminDb.collection('mini_users').doc(email).delete();

    res.json({ ok: true, deletedShares: shareIds.size });
  } catch (err) {
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// メール有効化（管理者用）
app.post("/api/mini/admin/verify-email", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "email required" });
  try {
    const adminDb = getFirestore();
    const userRef = adminDb.collection('mini_users').doc(email);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: "ユーザーが見つかりません" });
    
    await userRef.update({
      email_verified: true,
      verified_at: new Date(),
    });
    
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// 予定削除（管理者用）
app.post("/api/mini/admin/delete-share", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  const { shareId } = req.body as { shareId?: string };
  if (!shareId) return res.status(400).json({ error: "shareId required" });
  try {
    const adminDb = getFirestore();

    // 予定に紐づく依頼を全て削除
    const reqsSnap = await adminDb.collection('mini_requests')
      .where('share_id', '==', shareId).get();
    
    const batch = adminDb.batch();
    reqsSnap.docs.forEach(d => batch.delete(d.ref));
    
    // 予定を削除フラグ処理（soft delete）
    batch.update(adminDb.collection('mini_shares').doc(shareId), {
      deleted: true,
      deleted_at: new Date(),
    });
    
    await batch.commit();
    res.json({ ok: true, deletedRequests: reqsSnap.size });
  } catch (err) {
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// 依頼ステータス変更通知メール
app.post("/api/mini/notify-requester", async (req, res) => {
  const { to, requesterName, ownerName, status, slotDate, slotStart, slotEnd } = req.body as {
    to?: string; requesterName?: string; ownerName?: string;
    status?: string; slotDate?: string; slotStart?: string; slotEnd?: string;
  };
  if (!to) return res.status(400).json({ error: "to required" });

  const appUrl = (process.env.APP_URL || "https://choicrew.com").replace(/\/$/, "");
  const noreplyNote = "※ このメールは自動送信です。返信しても届きません。";

  // slotDate は yyyy-MM-dd 形式 → M/d に変換
  const dateLabel = slotDate
    ? slotDate.replace(/^\d{4}-0?(\d+)-0?(\d+)$/, "$1/$2")
    : slotDate || "";

  const statusLabel =
    status === "approved" ? "承認されました" :
    status === "declined" ? "辞退されました" :
    "キャンセルされました";

  const subject = `${dateLabel}の依頼が${statusLabel}`;
  const mainLine = `${slotDate} ${slotStart}〜${slotEnd} の依頼が${statusLabel}。`;

  let bodyLines: string[];
  if (status === "approved") {
    bodyLines = [
      mainLine,
      "",
      appUrl,
      "",
      "※承認日時に誤りがある場合は、当サイトにてキャンセル依頼をお願いいたします。なお、行き違い防止のため、直接メッセージでもご連絡いただけますと幸いです。",
      "",
      noreplyNote,
    ];
  } else {
    bodyLines = [
      mainLine,
      "",
      appUrl,
      "",
      noreplyNote,
    ];
  }

  try {
    await sendResendEmail(process.env.SMTP_TO || to, subject, bodyLines.join("\n"));
    res.json({ ok: true });
  } catch (err) {
    console.error("notify-requester error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

/* ================================================================
   Cleanup — 期限切れ予定・過去スロット依頼の削除
   ================================================================ */
async function runCleanup(): Promise<{ deletedShares: number; deletedRequests: number }> {
  const adminDb = getFirestore();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  let deletedShares = 0;
  let deletedRequests = 0;

  // 1. expires_at が過去の予定と関連依頼を削除
  const expiredSnap = await adminDb.collection("mini_shares")
    .where("expires_at", "<", now)
    .get();
  for (const shareDoc of expiredSnap.docs) {
    const reqSnap = await adminDb.collection("mini_requests")
      .where("share_id", "==", shareDoc.id)
      .get();
    const batch = adminDb.batch();
    reqSnap.docs.forEach(d => { batch.delete(d.ref); deletedRequests++; });
    batch.delete(shareDoc.ref);
    await batch.commit();
    deletedShares++;
  }

  // 2. 過去日のスロット依頼を削除
  const oldReqSnap = await adminDb.collection("mini_requests")
    .where("slot_date", "<", todayStr)
    .get();
  if (!oldReqSnap.empty) {
    const batch = adminDb.batch();
    oldReqSnap.docs.forEach(d => { batch.delete(d.ref); deletedRequests++; });
    await batch.commit();
  }

  console.log(`[cleanup] shares: ${deletedShares}, requests: ${deletedRequests}`);
  return { deletedShares, deletedRequests };
}

// Vercel Cron または手動実行用エンドポイント
app.get("/api/mini/cleanup", async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers["authorization"] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!getApps().length) return res.status(503).json({ error: "admin not configured" });
  try {
    const result = await runCleanup();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("cleanup error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

/* ================================================================
   Owner Fingerprint + IP (Layer 2 authentication)
   ================================================================ */

function getClientIp(req: express.Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") return xff.split(",")[0].trim();
  if (Array.isArray(xff) && xff.length > 0) return xff[0].split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

// オーナーのFP+IPを登録（作成時 or オーナーがブラウザで訪問時）
app.post("/api/mini/register-fp", async (req, res) => {
  const { shareId, fingerprint } = req.body as { shareId?: string; fingerprint?: string };
  if (!shareId || !fingerprint) return res.status(400).json({ error: "missing params" });
  if (!getApps().length) return res.status(503).json({ error: "admin not configured" });
  try {
    const adminDb = getFirestore();
    const ip = getClientIp(req);
    await adminDb.doc(`mini_shares/${shareId}`).update({
      owner_fingerprint: fingerprint,
      owner_ip: ip,
      fp_registered_at: new Date(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("register-fp error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

// FP+IPの照合（別ブラウザからの訪問時）
app.post("/api/mini/check-fp", async (req, res) => {
  const { shareId, fingerprint } = req.body as { shareId?: string; fingerprint?: string };
  if (!shareId || !fingerprint) return res.status(400).json({ error: "missing params" });
  if (!getApps().length) return res.status(503).json({ error: "admin not configured" });
  try {
    const adminDb = getFirestore();
    const snap = await adminDb.doc(`mini_shares/${shareId}`).get();
    if (!snap.exists) return res.json({ match: false });
    const data = snap.data()!;
    const storedFp = data.owner_fingerprint;
    const storedIp = data.owner_ip;
    const registeredAt = data.fp_registered_at?.toDate?.() || data.fp_registered_at;
    if (!storedFp || !storedIp) return res.json({ match: false });
    // 常にFP+IP両方一致を要求（誤認防止）
    const clientIp = getClientIp(req);
    const match = storedFp === fingerprint && storedIp === clientIp;
    res.json({ match });
  } catch (err) {
    console.error("check-fp error:", err);
    res.status(500).json({ error: localizeErrorMessage(err) });
  }
});

/* ================================================================
   OGP for Mini share pages
   ================================================================ */

const OGP_BOT_UA = /bot|crawler|spider|preview|slack|discord|twitter|facebook|linebot|telegram|whatsapp|signal|embedly|quora|pinterest|facebookexternalhit|Twitterbot|LinkedInBot/i;

app.get("/mini/s/:shareId", async (req, res, next) => {
  const ua = req.get("user-agent") || "";
  if (!OGP_BOT_UA.test(ua)) return next();  // let SPA handle it

  const { shareId } = req.params;
  const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

  try {
    const adminDb = getFirestore();
    const snap = await adminDb.doc(`mini_shares/${shareId}`).get();

    if (!snap.exists) {
      return next();
    }

    const data = snap.data()!;
    const name = data.name || "";
    const slots = Array.isArray(data.slots) ? data.slots : [];
    const sortedDates = slots
      .map((slot: { date?: string }) => slot?.date)
      .filter((date): date is string => typeof date === "string" && date.length > 0)
      .sort();
    const endDate = sortedDates.length > 0 ? formatMiniShareEndDate(sortedDates[sortedDates.length - 1]) : "";
    const title = endDate ? `${name}さん予定（～${endDate}）` : `${name}さん予定`;
    const desc = title;
    const pageUrl = `${appUrl}/mini/s/${shareId}`;

    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:site_name" content="ChoiCrew Mini">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
</head><body>
<p>${esc(title)}</p>
<script>window.location.replace("${esc(pageUrl)}");</script>
</body></html>`);
  } catch (e) {
    console.error("OGP generation error:", e);
    next();
  }
});

if (process.env.NODE_ENV !== "production") {
  try {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite middleware attached");
  } catch (e) {
    console.error("Failed to start Vite:", e);
  }
} else {
  const distPath = path.join(process.cwd(), "dist");
  // assetsはハッシュ付きなので長期キャッシュOK、それ以外はno-cache
  app.use("/assets", express.static(path.join(distPath, "assets"), {
    maxAge: "1y",
    immutable: true,
  }));
  app.use(express.static(distPath, {
    maxAge: 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }));
  app.get("*all", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(distPath, "index.html"));
  });
}
