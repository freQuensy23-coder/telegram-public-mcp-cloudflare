const PROTOCOL_VERSION = "2025-03-26";
const SERVER_INFO = { name: "telegram-public-mcp-cf", version: "1.0.0" };
const MAX_LIMIT = 100;

const TOOL_DEFS = [
  {
    name: "get_channel_info",
    description: "Get public Telegram channel title, description, avatar URL, subscriber counter and canonical t.me/s URL.",
    inputSchema: {
      type: "object",
      properties: { channel: { type: "string", description: "Channel username, @username, or t.me link." } },
      required: ["channel"],
      additionalProperties: false,
    },
  },
  {
    name: "get_latest_posts",
    description: "Get latest public Telegram channel posts from t.me/s, including text, image URLs, views and timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel username, @username, or t.me link." },
        limit: { type: "integer", description: "Maximum posts to return, default 10, max 100." },
        before_post_id: { type: "integer", description: "Return posts with a Telegram post id lower than this value." },
        before_time: { type: "string", description: "Return posts before this RFC3339 timestamp." },
      },
      required: ["channel"],
      additionalProperties: false,
    },
  },
  {
    name: "search_posts",
    description: "Search public Telegram channel posts using Telegram's t.me/s/{channel}?q= query endpoint.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel username, @username, or t.me link." },
        query: { type: "string", description: "Search query." },
        limit: { type: "integer", description: "Maximum posts to return, default 10, max 100." },
      },
      required: ["channel", "query"],
      additionalProperties: false,
    },
  },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz" || url.pathname === "/health")) {
      return json({ ok: true, service: SERVER_INFO.name, version: SERVER_INFO.version });
    }
    if (url.pathname !== "/mcp") return json({ error: "not found" }, 404);
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

    let req;
    try {
      req = await request.json();
    } catch {
      return rpcError(null, -32700, "Parse error");
    }
    const base = { jsonrpc: "2.0", id: req.id ?? null };
    try {
      if (req.method === "initialize") {
        return json({ ...base, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO } });
      }
      if (req.method === "tools/list") return json({ ...base, result: { tools: TOOL_DEFS } });
      if (req.method === "notifications/initialized") return new Response(null, { status: 204 });
      if (req.method === "tools/call") {
        const name = req.params?.name;
        const args = req.params?.arguments || {};
        return json({ ...base, result: { content: [{ type: "text", text: JSON.stringify(await callTool(env, name, args), null, 2) }] } });
      }
      return rpcError(req.id ?? null, -32601, "Method not found");
    } catch (err) {
      return rpcError(req.id ?? null, -32603, err?.message || String(err));
    }
  },
};

async function callTool(env, name, args) {
  if (name === "get_channel_info") return getChannelInfo(env, args);
  if (name === "get_latest_posts") return getLatestPosts(env, args);
  if (name === "search_posts") return searchPosts(env, args);
  throw new Error(`Unknown tool: ${name}`);
}

async function getChannelInfo(env, args) {
  const channel = normalizeChannel(requiredString(args.channel, "channel"));
  const html = await fetchTelegramHtml(env, channel);
  const title = firstText(html, /<div class="tgme_channel_info_header_title"[^>]*>([\s\S]*?)<\/div>/) || firstText(html, /<meta property="og:title" content="([^"]*)"/);
  const subscriberCount = firstText(html, /<div class="tgme_channel_info_counter"[^>]*>([\s\S]*?)<\/div>/);
  const hasChannelMarkers = html.includes("tgme_channel_info") || html.includes("tgme_widget_message");
  if (!hasChannelMarkers || title === "Telegram – a new era of messaging") throw new Error(`Public channel not found: ${channel}`);
  return {
    title,
    description: firstText(html, /<div class="tgme_channel_info_description"[^>]*>([\s\S]*?)<\/div>/) || firstText(html, /<meta property="og:description" content="([^"]*)"/),
    avatarUrl: absoluteUrl(firstAttr(html, /<img class="tgme_page_photo_image"[^>]*src="([^"]+)"/), baseUrl(env)),
    subscriberCount,
    url: `${baseUrl(env)}/s/${channel}`,
    channel,
  };
}

async function getLatestPosts(env, args) {
  const channel = normalizeChannel(requiredString(args.channel, "channel"));
  const limit = clampLimit(args.limit);
  const beforePostId = args.before_post_id == null ? null : Number(args.before_post_id);
  const beforeTime = args.before_time ? Date.parse(args.before_time) : null;
  let url = `${baseUrl(env)}/s/${channel}`;
  if (beforePostId && Number.isFinite(beforePostId)) url += `?before=${beforePostId}`;
  const posts = parsePosts(await fetchUrl(url), channel)
    .sort((a, b) => b.id - a.id)
    .filter((p) => beforeTime ? Date.parse(p.timestamp || "") < beforeTime : true)
    .slice(0, limit);
  return posts;
}

async function searchPosts(env, args) {
  const channel = normalizeChannel(requiredString(args.channel, "channel"));
  const query = requiredString(args.query, "query");
  const limit = clampLimit(args.limit);
  const url = `${baseUrl(env)}/s/${channel}?q=${encodeURIComponent(query)}`;
  return parsePosts(await fetchUrl(url), channel).slice(0, limit);
}

async function fetchTelegramHtml(env, channel) {
  return fetchUrl(`${baseUrl(env)}/s/${channel}`);
}

async function fetchUrl(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; telegram-public-mcp-cf/1.0; +https://github.com/freQuensy23-coder/telegram-public-mcp-cloudflare)",
      "accept": "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Telegram public page returned HTTP ${res.status}`);
  return res.text();
}

function parsePosts(html, channel) {
  const blocks = [...html.matchAll(/<div class="tgme_widget_message_wrap[\s\S]*?(?=<div class="tgme_widget_message_wrap|<\/main>|$)/g)].map((m) => m[0]);
  return blocks.map((block) => parsePost(block, channel)).filter(Boolean);
}

function parsePost(block, channel) {
  const href = firstAttr(block, /<a class="tgme_widget_message_date"[^>]*href="([^"]+)"/);
  const idMatch = href?.match(/\/(\d+)(?:\?|$)/);
  const id = idMatch ? Number(idMatch[1]) : null;
  if (!id) return null;
  const datetime = firstAttr(block, /<time[^>]*datetime="([^"]+)"/);
  const textHtml = firstMatch(block, /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) || "";
  const imageUrls = [...block.matchAll(/background-image:url\('([^']+)'\)/g)].map((m) => htmlDecode(m[1]));
  const views = firstText(block, /<span class="tgme_widget_message_views">([\s\S]*?)<\/span>/);
  const author = firstText(block, /<div class="tgme_widget_message_author[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/);
  return {
    id,
    channel,
    url: href ? absoluteUrl(href, "https://t.me") : `https://t.me/${channel}/${id}`,
    text: cleanText(textHtml),
    imageUrls,
    views,
    timestamp: datetime || null,
    author,
  };
}

function baseUrl(env) { return (env.TELEGRAM_BASE_URL || "https://t.me").replace(/\/$/, ""); }
function requiredString(v, name) { if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required`); return v.trim(); }
function clampLimit(v) { const n = v == null ? 10 : Number(v); return Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(n) ? Math.floor(n) : 10)); }
function normalizeChannel(input) {
  let s = input.trim();
  if (/^https?:\/\/(?:www\.)?t\.me\/s\//i.test(s)) {
    s = s.replace(/^https?:\/\/(?:www\.)?t\.me\/s\//i, "").split(/[/?#]/)[0];
  } else if (/^https?:\/\/(?:www\.)?t\.me\//i.test(s)) {
    s = s.replace(/^https?:\/\/(?:www\.)?t\.me\//i, "").split(/[/?#]/)[0];
  } else {
    s = s.replace(/^@/, "");
    if (/[\/?#]/.test(s)) throw new Error("Invalid public channel username");
  }
  if (!/^[A-Za-z0-9_]{3,64}$/.test(s)) throw new Error("Invalid public channel username");
  return s;
}
function firstMatch(s, re) { return s.match(re)?.[1]; }
function firstText(s, re) { const m = firstMatch(s, re); return m == null ? null : cleanText(m); }
function firstAttr(s, re) { const m = firstMatch(s, re); return m == null ? null : htmlDecode(m); }
function cleanText(html) {
  return htmlDecode(String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}
function htmlDecode(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function absoluteUrl(u, base) { if (!u) return null; if (/^https?:\/\//i.test(u)) return u; return `${base}${u.startsWith("/") ? "" : "/"}${u}`; }
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function rpcError(id, code, message) { return json({ jsonrpc: "2.0", id, error: { code, message } }); }
