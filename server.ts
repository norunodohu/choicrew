import express from "express";
import path from "path";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
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
    res.status(500).json({ error: String(err) });
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
   メール通知 for Mini share pages
   ================================================================ */
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

    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser;
    if (!smtpHost || !smtpUser || !smtpPass) {
      return res.status(503).json({ error: "SMTP not configured" });
    }

    // SMTP_TO が設定されている場合はそちらを優先（Resend無料プランのドメイン制限対応）
    const actualTo = process.env.SMTP_TO || notifyEmail;

    const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const shareUrl = `${appUrl}/mini/s/${shareId}`;
    const ownerName = (data.displayName || data.name || "管理者") as string;

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_PORT === "465",
      auth: { user: smtpUser, pass: smtpPass },
    });

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

    await transporter.sendMail({
      from: smtpFrom,
      to: actualTo,
      subject: `【ChoiCrew Mini】${requesterName || "誰か"}さんから依頼が届きました`,
      text: bodyLines.join("\n"),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Email notify error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// メール通知先登録の確認メール
app.post("/api/mini/email-confirm", async (req, res) => {
  const { to, shareId, ownerName } = req.body as { to?: string; shareId?: string; ownerName?: string };
  if (!to || !shareId) return res.status(400).json({ error: "to and shareId required" });

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || smtpUser;
  if (!smtpHost || !smtpUser || !smtpPass) {
    return res.status(503).json({ error: "SMTP not configured" });
  }

  const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const shareUrl = `${appUrl}/mini/s/${shareId}`;

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_PORT === "465",
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
      from: smtpFrom,
      to: process.env.SMTP_TO || to,
      subject: "【ChoiCrew Mini】メール通知が有効になりました",
      text: [
        `${ownerName || ""}さん、メール通知の設定が完了しました。`,
        "",
        "これ以降、依頼が届いたときにこのアドレスへ通知が届きます。",
        "",
        "▼ 共有ページはこちら",
        shareUrl,
      ].join("\n"),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Email confirm error:", err);
    res.status(500).json({ error: String(err) });
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
    res.status(500).json({ error: String(err) });
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
    res.status(500).json({ error: String(err) });
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
    const slotCount = Array.isArray(data.slots) ? data.slots.length : 0;
    const title = `${name}さんの空き時間 | ChoiCrew Mini`;
    const desc = `${slotCount}件の空き時間が共有されています。タップして依頼を送りましょう。`;
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
