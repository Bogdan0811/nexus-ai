// Netlify Function: POST /api/chat
// GET /api/chat — дешёвая проверка конфигурации (без вызова модели); GET /api/chat?deep=1 — пробный вызов модели
import { handlePost, health, toErrorResponse, checkContentLength } from "../../server/nexus-chat.mjs";

const json = (status, data, extra) =>
  new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, extra || {}),
  });

// context.ip — адрес клиента, который выставляет сама платформа Netlify
const clientIp = (req, context) => (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "unknown";

function wantsDeep(req) {
  try {
    const v = new URL(req.url).searchParams.get("deep");
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

export default async (req, context) => {
  try {
    if (req.method === "GET") {
      const deep = wantsDeep(req);
      return json(200, await health(deep ? { deep: true, ip: clientIp(req, context), origin: req.headers.get("origin") } : undefined));
    }
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "GET, POST" });
    const contentLength = req.headers.get("content-length");
    checkContentLength(contentLength); // до чтения тела
    const text = await req.text();
    return json(200, await handlePost({ body: text, contentLength, ip: clientIp(req, context), origin: req.headers.get("origin") }));
  } catch (e) {
    const { status, body } = toErrorResponse(e);
    return json(status, body);
  }
};

export const config = { path: "/api/chat" };
