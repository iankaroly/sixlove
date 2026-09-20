// Rooms for playing with friends. One JSON blob per room holds everything; every write is a
// compare-and-swap on that blob's ETag, so concurrent joins and results never lose each other.
//
// Blob usage matters here: Hobby allows 2,000 "advanced" operations (put, copy, list) a month, and
// an earlier version spent one on every poll by listing the room folder. Now a poll is a single
// origin read of index.json and only create/join/result write anything.
import { put, get, list, BlobPreconditionFailedError } from "@vercel/blob";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const id = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const clean = (s, n) => String(s ?? "").replace(/[<>]/g, "").trim().slice(0, n);
const KINDS = ["dual", "cup"], TOURS = ["atp", "wta", "open"], SURFACES = ["hard", "clay", "grass"], MODES = ["classic", "scout"];
const ROLLS = ["shared", "own"], HANDS = [6, 8, 10], ERAS = ["all", "classic", "modern"];
const indexPath = (roomCode) => `rooms/${roomCode}/index.json`;
const PUT_OPTS = { access: "public", addRandomSuffix: false, contentType: "application/json" };

async function readJson(url) {
  const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  return r.ok ? r.json() : null;
}
// Read the room snapshot straight from origin (no CDN cache) together with its ETag.
async function readIndex(roomCode) {
  const res = await get(indexPath(roomCode), { access: "public", useCache: false });
  if (!res || res.statusCode !== 200) return null;
  const data = await new Response(res.stream).json();
  return { data, etag: res.blob.etag };
}
// Rooms made before index.json existed are spread over room.json, p/*.json and r/*.json.
// Fold them into one snapshot once, then read that from now on.
async function rebuildIndex(roomCode) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: `rooms/${roomCode}/`, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const files = (await Promise.all(blobs.map(async (b) => ({ path: b.pathname, data: await readJson(b.url) })))).filter((f) => f.data);
  const room = files.find((f) => f.path.endsWith("/room.json"))?.data;
  if (!room) return null;
  const players = files.filter((f) => f.path.includes("/p/")).map((f) => ({ ...f.data, results: [] }));
  for (const f of files.filter((x) => x.path.includes("/r/"))) {
    const p = players.find((x) => x.id === f.data.playerId);
    if (p) p.results.push({ ...f.data, round: Number(f.data.round) || 1 });
  }
  const data = { ...room, players };
  const res = await put(indexPath(roomCode), JSON.stringify(data), { ...PUT_OPTS, allowOverwrite: true });
  return { data, etag: res.etag };
}
const loadIndex = async (roomCode) => (await readIndex(roomCode)) || rebuildIndex(roomCode);

// What the client sees: results sorted by round, plus `result` (round 1) for older clients.
function view(data) {
  const players = data.players.map((p) => {
    const results = [...(p.results || [])].sort((a, b) => a.round - b.round);
    return { ...p, results, result: results[0] || null };
  });
  return { ...data, players };
}
async function loadRoom(roomCode) {
  const idx = await loadIndex(roomCode);
  return idx ? view(idx.data) : null;
}
// Apply `mutate` to the snapshot and write it back only if nobody else wrote in between.
// `mutate` returns false to say "nothing to change" (the read copy is returned as is).
async function updateRoom(roomCode, mutate) {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * attempt));
    const idx = await loadIndex(roomCode);
    if (!idx) return null;
    const data = structuredClone(idx.data);
    if (mutate(data) === false) return view(idx.data);
    try {
      await put(indexPath(roomCode), JSON.stringify(data), { ...PUT_OPTS, ifMatch: idx.etag });
      return view(data);
    } catch (err) {
      if (!(err instanceof BlobPreconditionFailedError)) throw err;
    }
  }
  throw new Error("The room is busy, try again");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const roomCode = clean(req.query.code, 6).toUpperCase();
      const room = await loadRoom(roomCode);
      if (!room) return res.status(404).json({ error: "No such room" });
      return res.json(room);
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const action = req.query.action;

    if (action === "create") {
      const s = body.settings || {};
      const settings = {
        kind: KINDS.includes(s.kind) ? s.kind : "dual", tour: TOURS.includes(s.tour) ? s.tour : "atp",
        surface: SURFACES.includes(s.surface) ? s.surface : "hard", mode: MODES.includes(s.mode) ? s.mode : "classic",
        rolls: ROLLS.includes(s.rolls) ? s.rolls : "shared", respins: Math.max(0, Math.min(3, Number(s.respins) || 0)),
        hand: HANDS.includes(Number(s.hand)) ? Number(s.hand) : 8, stacking: s.stacking !== false && s.stacking !== "off",
        eras: ERAS.includes(s.eras) ? s.eras : "all", timer: [0, 2, 5, 10].includes(Number(s.timer)) ? Number(s.timer) : 0,
      };
      const name = clean(body.name, 24) || "Host";
      const player = { id: id(), name, joinedAt: Date.now(), results: [] };
      // A fresh code almost never collides; if it does, put refuses to overwrite and we roll again.
      let lastErr;
      for (let attempt = 0; attempt < 5; attempt++) {
        const roomCode = code();
        const room = { code: roomCode, settings, seed: (Math.random() * 2 ** 32) >>> 0, host: name, createdAt: Date.now(), players: [player] };
        try {
          await put(indexPath(roomCode), JSON.stringify(room), { ...PUT_OPTS, allowOverwrite: false });
          return res.json({ room: view(room), playerId: player.id });
        } catch (err) { lastErr = err; if (!/exist/i.test(err.message || "")) throw err; }
      }
      throw lastErr;
    }
    if (action === "join") {
      const roomCode = clean(body.code, 6).toUpperCase();
      const player = { id: id(), name: clean(body.name, 24), joinedAt: Date.now(), results: [] };
      const room = await updateRoom(roomCode, (data) => {
        player.name ||= `Player ${data.players.length + 1}`;
        data.players.push(player);
      });
      if (!room) return res.status(404).json({ error: "No such room" });
      return res.json({ room, playerId: player.id });
    }
    if (action === "result") {
      const roomCode = clean(body.code, 6).toUpperCase();
      const playerId = clean(body.playerId, 12);
      const round = Math.max(1, Math.min(50, Math.floor(Number(body.round)) || 1));
      const t = body.team || {};
      const team = {
        singles: Array.isArray(t.singles) ? t.singles.slice(0, 8).map((x) => clean(x, 40)) : [],
        doubles: Array.isArray(t.doubles) ? t.doubles.slice(0, 4).map((pr) => (Array.isArray(pr) ? pr.slice(0, 2).map((x) => clean(x, 40)) : [])) : [],
        grade: t.grade ? { letter: clean(t.grade.letter, 3), score: Math.max(0, Math.min(99, Number(t.grade.score) || 0)) } : null,
      };
      const result = {
        playerId, round, wins: Math.max(0, Math.min(20, Number(body.wins) || 0)), total: Math.max(1, Math.min(20, Number(body.total) || 1)),
        points: Math.max(0, Math.min(200, Number(body.points) || 0)), grid: clean(body.grid, 40), lineup: clean(body.lineup, 600), team, finishedAt: Date.now(),
      };
      let notInRoom = false;
      const room = await updateRoom(roomCode, (data) => {
        const mine = data.players.find((p) => p.id === playerId);
        if (!mine) { notInRoom = true; return false; }
        if ((mine.results || []).some((r) => r.round === round)) return false;
        (mine.results ||= []).push(result);
      });
      if (!room) return res.status(404).json({ error: "No such room" });
      if (notInRoom) return res.status(403).json({ error: "Not in this room" });
      return res.json(room);
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
