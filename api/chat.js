// Vercel Serverless Function: POST /api/chat
// GET /api/chat — дешёвая проверка конфигурации (без вызова модели); GET /api/chat?deep=1 — пробный вызов модели
import { handlePost, health, toErrorResponse, ChatError } from "../server/nexus-chat.mjs";

const firstHeader = (v) => (Array.isArray(v) ? v[0] : v);

function clientIp(req) {
  // Vercel сам выставляет x-real-ip / x-forwarded-for с адресом клиента
  return String(firstHeader(req.headers["x-real-ip"]) || String(firstHeader(req.headers["x-forwarded-for"]) || "").split(",")[0] || (req.socket && req.socket.remoteAddress) || "unknown").trim();
}

function wantsDeep(req) {
  let v = req.query && firstHeader(req.query.deep);
  if (v == null) {
    try {
      v = new URL(req.url || "/", "http://localhost").searchParams.get("deep");
    } catch {
      v = null;
    }
  }
  return v === "1" || v === "true";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (req.method === "GET") {
      const deep = wantsDeep(req);
      const data = await health(deep ? { deep: true, ip: clientIp(req), origin: firstHeader(req.headers.origin) } : undefined);
      return res.status(200).json(data);
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }
    let body;
    try {
      body = req.body; // Vercel разбирает JSON лениво и бросает исключение на битом теле
    } catch {
      throw new ChatError(400, "bad_request", "Некорректный JSON");
    }
    const data = await handlePost({ body, contentLength: firstHeader(req.headers["content-length"]), ip: clientIp(req), origin: firstHeader(req.headers.origin) });
    return res.status(200).json(data);
  } catch (e) {
    const { status, body } = toErrorResponse(e);
    return res.status(status).json(body);
  }
}
