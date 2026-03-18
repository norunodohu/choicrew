// ファイル名: server.ts
import express from "express";
import path from "path";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
path.dirname(__filename);

const app = express();
export default app; // Export for Vercel
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Start listening immediately to avoid platform timeouts
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: { 
    hasClientId: !!process.env.LINE_CLIENT_ID,
    hasClientSecret: !!process.env.LINE_CLIENT_SECRET,
    appUrl: process.env.APP_URL || "not set"
  }});
});

// LINE Auth Routes
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
  
  const url = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${scope}`;
  res.json({ url });
});

app.get("/api/auth/line/callback", async (req, res) => {
  const { code } = req.query;
  const clientId = process.env.LINE_CLIENT_ID;
  const clientSecret = process.env.LINE_CLIENT_SECRET;
  const appUrl = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/auth/line/callback`;

  console.log("LINE Callback Debug:", { 
    hasCode: !!code, 
    clientId, 
    redirectUri,
    appUrlFromEnv: process.env.APP_URL 
  });

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

    console.log("Requesting token from LINE...");
    const tokenResponse = await axios.post("https://api.line.me/oauth2/v2.1/token", 
      params.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    console.log("Token received, fetching profile...");
    const profileResponse = await axios.get("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` }
    });

    const profile = profileResponse.data;

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'LINE_AUTH_SUCCESS', 
                profile: ${JSON.stringify(profile)} 
              }, '*');
              window.close();
            } else {
              window.location.href = '/?line_user=' + encodeURIComponent(JSON.stringify(${JSON.stringify(profile)}));
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

// LINE Messaging API
app.post("/api/notify", async (req, res) => {
  const { lineUserId, message } = req.body;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!accessToken) {
    return res.status(503).json({ error: "LINE_CHANNEL_ACCESS_TOKEN not configured" });
  }

  try {
    await axios.post("https://api.line.me/v2/bot/message/push", {
      to: lineUserId,
      messages: [{ type: "text", text: message }]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      }
    });
    res.json({ success: true });
  } catch (error: unknown) {
    const err = error as { response?: { data?: Record<string, unknown> }, message?: string };
    console.error("LINE Messaging Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to send LINE message" });
  }
});

// Vite middleware for development
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
