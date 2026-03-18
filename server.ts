// ファイル名: server.ts
import express from "express";
import path from "path";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const appUrl = process.env.APP_URL;

  if (!clientId || !clientSecret || !appUrl) {
    console.error("Environment variables missing:", { clientId: !!clientId, clientSecret: !!clientSecret, appUrl: !!appUrl });
    return res.status(500).json({ 
      error: "Environment variables are missing", 
      debug: {
        LINE_CLIENT_ID: clientId || "MISSING",
        LINE_CLIENT_SECRET: clientSecret ? "SET (HIDDEN FOR SAFETY)" : "MISSING",
        APP_URL: appUrl || "MISSING"
      }
    });
  }

  const baseUrl = appUrl;
  const redirectUri = encodeURIComponent(`${baseUrl}/api/auth/line/callback`);
  const state = Math.random().toString(36).substring(7);
  const scope = "profile openid email";
  
  const url = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}`;
  res.json({ url, debug: { clientId, appUrl, redirectUri: decodeURIComponent(redirectUri) } });
});

app.get("/api/auth/line/callback", async (req, res) => {
  const { code } = req.query;
  const clientId = process.env.LINE_CLIENT_ID;
  const clientSecret = process.env.LINE_CLIENT_SECRET;
  
  const baseUrl = process.env.APP_URL;
  const redirectUri = `${baseUrl}/api/auth/line/callback`;

  try {
    const tokenResponse = await axios.post("https://api.line.me/oauth2/v2.1/token", 
      new URLSearchParams({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: redirectUri,
        client_id: clientId!,
        client_secret: clientSecret!,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

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
  } catch (error: any) {
    console.error("LINE Auth Error:", error.response?.data || error.message);
    res.status(500).send("Authentication failed");
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
