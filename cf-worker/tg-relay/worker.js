// Релей Bot API для Telegram Studio — резервный путь №2 (между прямым
// подключением и Supabase-релеем). Транзитит запросы в api.telegram.org
// дословно. Работает на бесплатном тарифе Workers: лимит тела запроса
// 100 МБ (против ~25–30 КБ порога помех у российских ISP на Supabase),
// поэтому файлы идут одним запросом без чанкования.
//
// Защита от «открытого прокси»: клиент шлёт заголовок X-TG-Relay-Key,
// воркер сравнивает его с секретом из переменной окружения RELAY_KEY
// (ставится через `wrangler secret put RELAY_KEY`). Заголовок из запроса
// в Telegram не пересылается — Telegram его не ждёт, а утечь он может
// только в логи, которых у воркера нет.
//
// Развернуть: см. DEPLOY.md рядом.

const TELEGRAM_BASE = "https://api.telegram.org";

export default {
  async fetch(request, env) {
    // Проверяем секрет ДО любой работы с телом запроса.
    const key = request.headers.get("X-TG-Relay-Key") ?? "";
    if (!env.RELAY_KEY || key !== env.RELAY_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error_code: 403, description: "relay: bad or missing X-TG-Relay-Key" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    // Путь после /tg-relay должен начинаться с /bot<токен>/<метод> —
    // это единственная форма, которую понимает Bot API. Отсекаем всё
    // прочее (секретный ключ уже отсёк посторонних, это вторая линия).
    const url = new URL(request.url);
    const marker = "/tg-relay";
    const idx = url.pathname.indexOf(marker);
    const rest = idx === -1 ? "" : url.pathname.slice(idx + marker.length);
    if (!rest.startsWith("/bot")) {
      return new Response(
        JSON.stringify({ ok: false, error_code: 400, description: "relay: expected /bot<token>/<method> path" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const targetUrl = `${TELEGRAM_BASE}${rest}${url.search}`;
    const contentType = request.headers.get("content-type");
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

    try {
      const resp = await fetch(targetUrl, {
        method: request.method,
        headers: contentType ? { "Content-Type": contentType } : {},
        body,
      });
      // Ответ Telegram возвращаем дословно — клиент парсит его сам,
      // точно как ответ прямого подключения.
      return new Response(resp.body, {
        status: resp.status,
        headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error_code: 502, description: `relay: fetch to Telegram failed: ${e}` }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};
