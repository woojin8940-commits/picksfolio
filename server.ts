import express from "express";
import { createServer as createViteServer } from "vite";
import { SolapiMessageService } from "solapi";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.post("/.netlify/functions/send-sms", async (req, res) => {
    const { receiver } = req.body;

    if (!receiver) {
      return res.status(400).json({ error: "수신자 번호가 필요합니다." });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const apiKey = process.env.SOLAPI_API_KEY;
    const apiSecret = process.env.SOLAPI_API_SECRET;
    const fromNumber = process.env.SOLAPI_FROM_NUMBER || "01035638940";

    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: "서버 설정 오류", message: "API 키가 설정되지 않았습니다." });
    }

    try {
      const messageService = new SolapiMessageService(apiKey, apiSecret);
      const result = await messageService.sendOne({
        to: receiver,
        from: fromNumber,
        text: `[픽스폴리오] 인증번호는 [${code}] 입니다.`,
      });

      res.json({ 
        success: true, 
        message: "인증번호가 발송되었습니다.", 
        code: code,
        result: result 
      });
    } catch (error: any) {
      console.error("SMS Sending Error:", error.message);
      res.status(500).json({ error: "서버 에러", message: error.message });
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
