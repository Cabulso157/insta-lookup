#!/usr/bin/env node
// InstaLookup - Servidor standalone
// Requer: Node.js 18+ (sem dependências externas)
// Uso: node server.js
// Porta padrão: 3000 (mude via variável PORT=8080 node server.js)

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { exec } = require("child_process");
const { promisify } = require("util");
const { URL } = require("url");

const execAsync = promisify(exec);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
};

// ── Instagram scraper ─────────────────────────────────────────────────────────
async function fetchInstagramProfile(username) {
  const clean = username.replace(/^@/, "").trim().toLowerCase();
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(clean)}`;

  const { stdout } = await execAsync(
    `curl --silent --max-time 15 --compressed -H "User-Agent: Instagram 123.0.0.21.114" -H "Accept: */*" -H "Accept-Language: pt-BR,pt;q=0.9" -H "X-IG-App-ID: 936619743392459" "${url}"`,
    { timeout: 20000 }
  );

  if (!stdout || !stdout.trim()) throw new Error("Resposta vazia do Instagram.");

  const data = JSON.parse(stdout);

  if (data?.message === "checkpoint_required" || data?.message === "login_required")
    throw new Error("Instagram requer autenticação para este perfil.");

  if (data?.status !== "ok") throw new Error(`Erro do Instagram: ${data?.status ?? "desconhecido"}`);

  const user = data?.data?.user;
  if (!user) return null;

  return {
    username:      user.username ?? clean,
    fullName:      user.full_name ?? "",
    bio:           user.biography ?? "",
    followers:     user.edge_followed_by?.count ?? 0,
    following:     user.edge_follow?.count ?? 0,
    posts:         user.edge_owner_to_timeline_media?.count ?? 0,
    profilePicUrl: user.profile_pic_url_hd ?? user.profile_pic_url ?? "",
    isPrivate:     user.is_private ?? false,
    isVerified:    user.is_verified ?? false,
  };
}

// ── Image proxy ───────────────────────────────────────────────────────────────
const ALLOWED_IMG_HOSTS = ["cdninstagram.com", "fbcdn.net"];

async function proxyImage(imageUrl, res) {
  let parsed;
  try { parsed = new URL(imageUrl); } catch { return sendJson(res, 400, { error: "URL inválida." }); }

  const allowed = ALLOWED_IMG_HOSTS.some(h => parsed.hostname.endsWith(h));
  if (!allowed) return sendJson(res, 403, { error: "Host não permitido." });

  try {
    const { stdout } = await execAsync(
      `curl --silent --max-time 10 --output - "${imageUrl.replace(/"/g, "")}"`,
      { encoding: "buffer", timeout: 12000 }
    );
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(stdout);
  } catch {
    sendJson(res, 502, { error: "Não foi possível carregar a imagem." });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, html) => {
        if (e2) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  // API: Instagram profile
  const igMatch = pathname.match(/^\/api\/instagram\/([a-zA-Z0-9._]{1,30})$/);
  if (igMatch) {
    const username = igMatch[1];
    try {
      const profile = await fetchInstagramProfile(username);
      if (!profile) return sendJson(res, 404, { error: `Perfil "@${username}" não encontrado.` });
      return sendJson(res, 200, profile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      return sendJson(res, 500, { error: msg });
    }
  }

  // API: Image proxy
  if (pathname === "/api/proxy/image") {
    const imgUrl = urlObj.searchParams.get("url");
    if (!imgUrl) return sendJson(res, 400, { error: "URL obrigatória." });
    return proxyImage(imgUrl, res);
  }

  // Static files
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`\n🚀 InstaLookup rodando em http://localhost:${PORT}`);
  console.log(`   Pressione Ctrl+C para parar.\n`);
});
