import express from "express";
import path from "path";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
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

const mintLineCustomToken = async (profile: { userId: string; displayName: string; pictureUrl?: string }) => {
  if (!getApps().length) {
    throw new Error("Firebase Admin SDK is not configured");
  }
  return getAdminAuth().createCustomToken(`line_${profile.userId}`);
};

app.use(cors());
app.use(express.json());

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

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

    const customToken = await mintLineCustomToken(profile);
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
  app.use(express.static(distPath));
  app.get("*all", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}
