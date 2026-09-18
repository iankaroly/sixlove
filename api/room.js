// Rooms for playing with friends. One JSON blob per room, per player and per result, so nothing races.
import { put, list } from "@vercel/blob";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const id = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const clean = (s, n) => String(s ?? "").replace(/[<>]/g, "").trim().slice(0, n);
const KINDS = ["dual", "cup"], TOURS = ["atp", "wta", "open"], SURFACES = ["hard", "clay", "grass"], MODES = ["classic", "scout"];
const ROLLS = ["shared", "own"], HANDS = [6, 8, 10], ERAS = ["all", "classic", "modern"];

async function write(path, data) {
  await put(path, JSON.stringify(data), { access: "public", addRandomSuffix: false, contentType: "application/json" });
}
async function readAll(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const b of page.blobs) out.push(b);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const bodies = await Promise.all(out.map(async (b) => {
    const r = await fetch(`${b.url}?t=${Date.now()}`, { cache: "no-store" });
    return r.ok ? { path: b.pathname, data: await r.json() } : null;
  }));
  return bodies.filter(Boolean);
}
async function loadRoom(roomCode) {
  const files = await readAll(`rooms/${roomCode}/`);
  const room = files.find((f) => f.path.endsWith("/room.json"))?.data;
  if (!room) return null;
  const results = Object.fromEntries(files.filter((f) => f.path.includes("/r/")).map((f) => [f.data.playerId, f.data]));
  const players = files.filter((f) => f.path.includes("/p/")).map((f) => ({ ...f.data, result: results[f.data.id] || null }));
  return { ...room, players };
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
        eras: ERAS.includes(s.eras) ? s.eras : "all",
      };
      const name = clean(body.name, 24) || "Host";
      const player = { id: id(), name, joinedAt: Date.now() };
      let roomCode;
      for (let attempt = 0; attempt < 5; attempt++) {
        roomCode = code();
        const existing = await list({ prefix: `rooms/${roomCode}/`, limit: 1 });
        if (!existing.blobs.length) break;
      }
      const room = { code: roomCode, settings, seed: (Math.random() * 2 ** 32) >>> 0, host: name, createdAt: Date.now() };
      await write(`rooms/${roomCode}/room.json`, room);
      await write(`rooms/${roomCode}/p/${player.id}.json`, player);
      return res.json({ room: { ...room, players: [{ ...player, result: null }] }, playerId: player.id });
    }
    if (action === "join") {
      const roomCode = clean(body.code, 6).toUpperCase();
      const room = await loadRoom(roomCode);
      if (!room) return res.status(404).json({ error: "No such room" });
      const player = { id: id(), name: clean(body.name, 24) || `Player ${room.players.length + 1}`, joinedAt: Date.now() };
      await write(`rooms/${roomCode}/p/${player.id}.json`, player);
      room.players.push({ ...player, result: null });
      return res.json({ room, playerId: player.id });
    }
    if (action === "result") {
      const roomCode = clean(body.code, 6).toUpperCase();
      const playerId = clean(body.playerId, 12);
      const room = await loadRoom(roomCode);
      if (!room) return res.status(404).json({ error: "No such room" });
      if (!room.players.some((p) => p.id === playerId)) return res.status(403).json({ error: "Not in this room" });
      if (room.players.find((p) => p.id === playerId).result) return res.json(room);
      const result = {
        playerId, wins: Math.max(0, Math.min(20, Number(body.wins) || 0)), total: Math.max(1, Math.min(20, Number(body.total) || 1)),
        points: Math.max(0, Math.min(200, Number(body.points) || 0)), grid: clean(body.grid, 40), lineup: clean(body.lineup, 600), finishedAt: Date.now(),
      };
      await write(`rooms/${roomCode}/r/${playerId}.json`, result);
      return res.json(await loadRoom(roomCode));
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
