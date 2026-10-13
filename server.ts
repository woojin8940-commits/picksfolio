import express from "express";
import { createServer as createViteServer } from "vite";
import sendSms from "./netlify/functions/send-sms.ts";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.post("/.netlify/functions/send-sms", async (req, res) => {
    try {
      const response = await sendSms(new Request(`http://localhost:${PORT}/.netlify/functions/send-sms`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-nf-client-connection-ip": req.socket.remoteAddress || "unknown" },
        body: JSON.stringify(req.body),
      }));
      for (const header of ["content-type", "retry-after", "cache-control"]) {
        const value = response.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.status(response.status).send(await response.text());
    } catch (error) {
      console.error("SMS Sending Error:", error);
      res.status(500).json({ error: "인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  });

  // Vite middleware for development
  const isDev = process.env.NODE_ENV !== "production"; 
  
  if (isDev) {
    console.log("Starting server in DEVELOPMENT mode");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode");
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
