(() => {
  const $ = (id) => document.getElementById(id);
  const el = { ball: $("ball"), era: $("labelEra"), scene: $("labelScene"), console: $("console"), crate: $("crate"), poster: $("poster"), status: $("status"), sheet: $("sheet") };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const MODES = {
    classic: { name: "Classic", blurb: "Ratings on show while you draft.", respins: 2, showRatings: true },
    scout: { name: "Scout", blurb: "Names only. You have to know your tennis.", respins: 2, showRatings: false },
    daily: { name: "Daily", blurb: "Same rolls for everyone. One shot, no re-rolls.", respins: 0, showRatings: false },
  };

  // ---------- players and pools ----------
  const toPlayer = ([era, name, cc, years, style, slams, college, serve, rtn, rally, net, clutch, dbl, hard, clay, grass]) =>
    ({ id: name, era, name, cc, years, style, slams, college, serve, rtn, rally, net, clutch, dbl, hard, clay, grass });

  function poolsFor(tour) {
    const players = TOURS[tour].players().map(toPlayer);
    const eras = ERAS.map(([key, era, scenes]) => ({ id: `${tour}-${key}`, era, scene: scenes[tour], items: players.filter((p) => p.era === key) }));
    return { eras, wild: [] };
  }

  function buildFormat({ kind, tour, surface }) {
    const copy = BUILDS[kind];
    const { eras, wild } = poolsFor(tour);
    const base = { kind, copy, tour, pools: eras, wild, tourName: TOURS[tour].name };
    if (kind === "cup") {
      return { ...base, key: `cup-${tour}-${surface}`, label: `cup run, ${TOURS[tour].short}, ${SURFACES[surface].toLowerCase()} at home`,
        slots: CUP_SLOTS, surface,
        stages: CUP_RUN.map(([title, sub, surf, diff]) => ({ title, sub, surface: surf || surface, diff, home: !surf })) };
    }
    return { ...base, key: `dual-${tour}`, label: `college season, ${TOURS[tour].short}`,
      slots: DUAL_SLOTS, surface: "hard", stages: SEASON.map(([title, sub, diff]) => ({ title, sub, surface: "hard", diff })) };
  }

  let choice = { kind: "dual", tour: "atp", surface: "hard" };
  try { Object.assign(choice, JSON.parse(localStorage.getItem("sixlove-choice")) || {}); } catch { /* private window */ }
  if (!BUILDS[choice.kind]) choice.kind = "dual";
  if (!TOURS[choice.tour]) choice.tour = "atp";
  if (!SURFACES[choice.surface]) choice.surface = "hard";

  let state = { phase: "home" };
  let format = buildFormat(choice);

  // ---------- rooms: play with friends ----------
  // A room fixes the settings and the seed, so everyone gets the same rolls. Results land on a shared scoreboard.
  let room = null;          // { code, settings, seed, host, players: [{ id, name, result }] }
  let me = null;            // { id, name } for this browser in the current room
  let roomError = "";
  let roomBusy = false;
  let pollTimer = null;
  const roomLink = () => `${location.origin}${location.pathname}?room=${room.code}`;
  const readMe = (code) => { try { return JSON.parse(localStorage.getItem(`sixlove-room-${code}`)); } catch { return null; } };
  const saveMe = (code, who) => { try { localStorage.setItem(`sixlove-room-${code}`, JSON.stringify(who)); } catch { /* private window */ } };
  const myEntry = () => room?.players.find((p) => p.id === me?.id);

  async function api(action, body) {
    const res = await fetch(action === "get" ? `/api/room?code=${encodeURIComponent(body.code)}` : `/api/room?action=${action}`,
      action === "get" ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  function applyRoomSettings() {
    Object.assign(choice, room.settings);
    format = buildFormat(choice);
  }
  async function createRoom(name) {
    roomBusy = true; roomError = ""; render();
    try {
      const data = await api("create", { name, settings: { kind: choice.kind, tour: choice.tour, surface: choice.surface, mode: choice.roomMode || "classic" } });
      room = data.room; me = { id: data.playerId, name };
      saveMe(room.code, me);
      history.replaceState(null, "", `?room=${room.code}`);
      state = { phase: "room" };
      startPolling();
    } catch (err) { roomError = err.message; }
    roomBusy = false; render();
  }
  async function joinRoom(name) {
    roomBusy = true; roomError = ""; render();
    try {
      const data = await api("join", { code: room.code, name });
      room = data.room; me = { id: data.playerId, name };
      saveMe(room.code, me);
      startPolling();
    } catch (err) { roomError = err.message; }
    roomBusy = false; render();
  }
  async function openRoom(code) {
    try {
      room = await api("get", { code });
      me = readMe(room.code);
      if (me && !myEntry()) me = null;
      state = { phase: "room" };
      startPolling();
    } catch (err) { roomError = err.message; room = null; state = { phase: "home" }; history.replaceState(null, "", location.pathname); }
    render();
  }
  async function refreshRoom() {
    if (!room) return;
    try { room = await api("get", { code: room.code }); } catch { /* keep the last copy */ }
    if (state.phase === "room" || state.phase === "done") render();
  }
  function startPolling() { stopPolling(); pollTimer = setInterval(refreshRoom, 5000); }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
  async function submitResult() {
    if (!room || !me) return;
    const points = state.results.reduce((sum, r) => sum + Number(r.score.split("-")[0]), 0);
    const lineup = [...singlesSlots().map((s) => `${s.short}: ${state.lineup[s.id].name}`), ...pairs().map(([a, b]) => `Dbl: ${pairName(a, b)}`)].join("; ");
    try { room = await api("result", { code: room.code, playerId: me.id, wins: wins(), total: state.results.length, points, grid: grid(), lineup }); }
    catch (err) { roomError = err.message; }
    render();
  }
  function leaveRoom() {
    stopPolling(); room = null; me = null; roomError = "";
    history.replaceState(null, "", location.pathname);
  }
  // Rank: most wins, then most match points, then whoever finished first.
  function standings() {
    const done = room.players.filter((p) => p.result).sort((a, b) =>
      b.result.wins - a.result.wins || b.result.points - a.result.points || a.result.finishedAt - b.result.finishedAt);
    let place = 0;
    return done.map((p, i) => {
      if (i === 0 || p.result.wins !== done[i - 1].result.wins || p.result.points !== done[i - 1].result.points) place = i + 1;
      return { ...p, place };
    });
  }
  const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || "th"}`;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const flag = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  const today = () => new Date().toLocaleDateString("en-CA");
  const dailyKey = () => `sixlove-daily-${today()}-${format.key}`;
  const r1 = (n) => Math.round(n);
  const lineName = (p) => p.name.split(" ").slice(-1)[0];
  const pairName = (a, b) => `${lineName(a)} / ${lineName(b)}`;
  const article = (word) => (/^[aeiou]/i.test(word) ? "an" : "a");

  function hash(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function readDaily() { try { return JSON.parse(localStorage.getItem(dailyKey())); } catch { return null; } }
  function saveDaily(result) { try { localStorage.setItem(dailyKey(), JSON.stringify(result)); } catch { /* private window */ } }

  // Bars show in Classic while drafting; the true line ratings only come out once the season is played.
  const ratingsVisible = () => state.phase === "season" || state.phase === "done";
  const stackingVisible = () => Boolean(MODES[state.mode]?.showRatings) || ratingsVisible();
  const singles = (p, surface = format.surface) => singlesRating(p, surface);
  const singlesSlots = () => format.slots.filter((s) => s.singles);
  const seatSlots = () => format.slots.filter((s) => s.seat);
  const teams = () => [...new Set(seatSlots().map((s) => s.team))].map((t) => seatSlots().filter((s) => s.team === t));
  const roster = () => [...new Set(format.slots.map((s) => state.lineup[s.id]).filter(Boolean))];
  const slotOf = (id) => format.slots.find((s) => s.id === id);
  const inDoubles = (p) => seatSlots().some((s) => state.lineup[s.id] === p);
  const inSingles = (p) => singlesSlots().some((s) => state.lineup[s.id] === p);
  const cardFull = () => format.slots.every((s) => state.lineup[s.id]);
  // Singles players who could still take a doubles seat.
  const benchForSeat = () => roster().filter((p) => !inDoubles(p));
  const pairs = () => teams().map((tm) => tm.map((s) => state.lineup[s.id])).filter((pr) => pr.every(Boolean));

  // The ladder rule. Compares each filled singles spot with the nearest filled spot above it.
  function stackedLines(lineup) {
    if (format.kind !== "dual") return new Set();
    const stacked = new Set();
    let above = null;
    for (const slot of singlesSlots()) {
      const p = lineup[slot.id];
      if (!p) continue;
      if (above && singles(p, "hard") > singles(above, "hard") + STACK_TOLERANCE) stacked.add(slot.id);
      above = p;
    }
    return stacked;
  }
  function stackingIfPlaced(slotId) {
    const before = stackedLines(state.lineup);
    const after = stackedLines({ ...state.lineup, [slotId]: state.selected });
    return [...after].filter((id) => !before.has(id));
  }

  // ---------- game flow ----------
  function setChoice(patch) {
    Object.assign(choice, patch);
    try { localStorage.setItem("sixlove-choice", JSON.stringify(choice)); } catch { /* private window */ }
    format = buildFormat(choice);
    render();
  }

  function startGame(mode, seedOverride) {
    const seed = seedOverride ?? (mode === "daily" ? hash(`sixlove-${today()}-${format.key}`) : (Math.random() * 2 ** 32) >>> 0);
    state = { phase: "spin", mode, rng: mulberry32(seed), round: 0, respins: MODES[mode].respins,
      pool: null, crate: [], lastPoolId: null, selected: null, lineup: {}, used: new Set(), seatPick: null, results: [], shown: 0 };
    setLabel("Six", "Love");
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  const availableItems = (pool) => pool.items.filter((p) => !state.used.has(p.id));

  function spin(isRespin) {
    if (state.phase === "spinning") return;
    if (isRespin) state.respins--;
    // One era per roll, never the same era twice running. Everyone from that era is in the pool, legends included.
    const options = format.pools.filter((p) => p.id !== state.lastPoolId && availableItems(p).length >= 3);
    const pool = options[Math.floor(state.rng() * options.length)];
    const crate = availableItems(pool);
    state.phase = "spinning";
    state.selected = null;
    render();

    const land = () => {
      clearInterval(flicker);
      state.pool = pool;
      state.crate = crate;
      state.lastPoolId = pool.id;
      state.phase = "pick";
      setLabel(pool.era, pool.scene);
      el.ball.classList.remove("is-spinning");
      render();
    };
    if (reducedMotion) { land(); return; }
    el.ball.classList.add("is-spinning");
    const reel = format.pools;
    const flicker = setInterval(() => { const p = reel[Math.floor(Math.random() * reel.length)]; setLabel(p.era, p.scene); }, 90);
    setTimeout(land, 1400);
  }

  function setLabel(era, scene) { el.era.textContent = era; el.scene.textContent = scene; }

  function selectItem(id) {
    state.seatPick = null;
    state.selected = state.selected?.id === id ? null : state.crate.find((p) => p.id === id);
    render();
  }

  function placeItem(slotId) {
    if (!state.selected || state.lineup[slotId]) return;
    state.lineup[slotId] = state.selected;
    state.used.add(state.selected.id);
    state.selected = null;
    state.round++;
    afterPlacement();
  }
  // Seat a singles player in doubles, or clear a seat again while the card is still being built.
  function seatFromRoster(seatId, playerId) {
    const p = roster().find((x) => x.id === playerId);
    if (!p || state.lineup[seatId] || inDoubles(p)) return;
    state.lineup[seatId] = p;
    state.seatPick = null;
    afterPlacement();
  }
  function clearSeat(seatId) {
    const p = state.lineup[seatId];
    if (!p || !inSingles(p) || state.phase === "season" || state.phase === "done") return;
    delete state.lineup[seatId];
    if (state.phase === "full") state.phase = "spin";
    render();
  }
  // Reorder the ladder any time before the season starts. Swapping into an empty spot just moves the player.
  function moveSingles(slotId, dir) {
    if (!["spin", "pick", "full"].includes(state.phase)) return;
    const slots = singlesSlots(), i = slots.findIndex((s) => s.id === slotId), j = i + dir;
    if (i < 0 || j < 0 || j >= slots.length) return;
    const a = slots[i].id, b = slots[j].id;
    [state.lineup[a], state.lineup[b]] = [state.lineup[b], state.lineup[a]];
    for (const id of [a, b]) if (!state.lineup[id]) delete state.lineup[id];
    render();
    el.poster.querySelector(`[data-move][data-slotid="${b}"][data-move="${dir > 0 ? "1" : "-1"}"]`)?.focus({ preventScroll: true });
  }
  function afterPlacement() {
    state.phase = cardFull() ? "full" : "spin";
    render();
    if (state.phase === "spin") el.console.querySelector("button")?.focus({ preventScroll: true });
    else window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }

  // ---------- simulation ----------
  function playDual(stage) {
    const L = state.lineup, stacked = stackedLines(L), lines = [];
    let doublesWon = 0;
    pairs().forEach(([a, b], i) => {
      const mine = pairRating(a, b), theirs = stage.diff + DUAL_DOUBLES[i];
      const won = state.rng() < winChance(mine, theirs);
      if (won) doublesWon++;
      lines.push({ label: `Doubles ${i + 1}`, who: pairName(a, b), won });
    });
    const doublesPoint = doublesWon >= 2;
    lines.push({ label: "Doubles point", who: `${doublesWon} of 3 pairs won`, won: doublesPoint, point: true, doubles: true });
    let points = doublesPoint ? 1 : 0;
    const finale = stage.index >= format.stages.length - 3;
    singlesSlots().forEach((slot, k) => {
      const p = L[slot.id], opp = opponentStyle(stage.title, k + 1);
      const mine = singles(p, "hard") + matchup(p, opp) + (finale ? finaleBonus(p) : 0), theirs = stage.diff + DUAL_LADDER[k];
      const isStacked = stacked.has(slot.id);
      const won = !isStacked && state.rng() < winChance(mine, theirs);
      if (won) points++;
      lines.push({ label: `No. ${k + 1}`, who: `${lineName(p)} v ${article(FAMILY_NAMES[opp])} ${FAMILY_NAMES[opp]}`, won, stacked: isStacked, point: true });
    });
    return { ...stage, lines, score: `${points}-${7 - points}`, won: points >= 4 };
  }

  function playTie(stage) {
    const L = state.lineup, [a, b] = pairs()[0], lines = [];
    let mine = 0, theirs = 0;
    const finale = stage.index >= format.stages.length - 3;
    for (const [slot, line] of CUP_RUBBERS) {
      const decided = mine === 3 || theirs === 3;
      const isDoubles = slot === "d";
      const opp = isDoubles ? null : opponentStyle(stage.title, line);
      const rating = isDoubles ? pairRating(a, b) : singles(L[slot], stage.surface) + matchup(L[slot], opp) + (finale ? finaleBonus(L[slot]) : 0);
      const won = decided ? null : state.rng() < winChance(rating, stage.diff + CUP_LADDER[line]);
      if (won === true) mine++; else if (won === false) theirs++;
      lines.push({ label: isDoubles ? "Doubles" : `${lineName(L[slot])} v their No. ${line}, ${article(FAMILY_NAMES[opp])} ${FAMILY_NAMES[opp]}`, who: isDoubles ? pairName(a, b) : "", won, point: true, doubles: isDoubles });
    }
    return { ...stage, lines, score: `${mine}-${theirs}`, won: mine === 3 };
  }

  function playSeason() {
    if (!cardFull()) return;
    state.results = format.stages.map((stage, index) => (format.kind === "dual" ? playDual({ ...stage, index }) : playTie({ ...stage, index })));
    state.shown = 0;
    state.phase = "season";
    render();
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    if (reducedMotion) { finishSeason(); return; }
    state.timer = setInterval(() => {
      state.shown++;
      if (state.shown >= state.results.length) finishSeason(); else render();
    }, 520);
  }

  function finishSeason() {
    clearInterval(state.timer);
    state.shown = state.results.length;
    state.phase = "done";
    if (state.mode === "daily") saveDaily({ wins: wins(), total: state.results.length });
    render();
    if (room && me) submitResult();
  }

  const wins = () => state.results.filter((r) => r.won).length;
  const grid = () => state.results.map((r) => (r.won ? "🟩" : "🟥")).join("");

  function verdict(w) {
    const v = format.copy.verdicts, n = state.results.length, f = w / n;
    if (w === n) return v[0];
    if (f >= 0.83) return v[1];
    if (f >= 0.65) return v[2];
    if (f >= 0.45) return v[3];
    return v[4];
  }

  function shareText() {
    const w = wins(), n = state.results.length;
    const label = `Six-Love ${state.mode === "daily" ? `daily ${today()}` : MODES[state.mode].name.toLowerCase()}, ${format.label}`;
    const card = singlesSlots().map((s) => `${s.name}: ${state.lineup[s.id].name}`).join("\n");
    const dbl = pairs().map(([a, b], i) => `Doubles ${i + 1}: ${pairName(a, b)}`).join("\n");
    return `${label}: ${w}-${n - w}\n${grid()}\n\n${card}\n${dbl}`;
  }

  // ---------- rendering ----------
  function render() {
    document.body.dataset.phase = state.phase;
    document.body.dataset.surface = format.surface;
    renderStatus();
    renderConsole();
    renderCrate();
    renderPoster();
    renderSheet();
  }

  function renderStatus() {
    if (state.phase === "home") { el.status.innerHTML = ""; return; }
    if (state.phase === "room") { el.status.innerHTML = `<span>Room ${esc(room.code)}</span><button class="quit" data-action="leave">Leave</button>`; return; }
    const total = format.slots.length;
    const text = state.phase === "season" || state.phase === "done" ? `${MODES[state.mode].name} · ${format.copy.running}`
      : state.phase === "full" ? `${MODES[state.mode].name} · card set`
      : `${MODES[state.mode].name} · pick ${state.round + 1}`;
    el.status.innerHTML = `<span>${text}</span><button class="quit" data-action="home">Quit</button>`;
  }

  function chips(name, options, current) {
    return `<div class="seg" role="group" aria-label="${name}">${options.map(([value, label]) =>
      `<button class="seg-btn" data-choose="${name}" data-value="${esc(value)}" aria-pressed="${value === current}">${esc(label)}</button>`).join("")}</div>`;
  }

  function renderConsole() {
    const p = state.phase, copy = format.copy;
    if (p === "home") {
      const played = readDaily();
      el.console.innerHTML = `
        <p class="eyebrow">A tennis roster game</p>
        <h1>${copy.headline}</h1>
        <p class="lede">${copy.lede}</p>
        <p class="rule">${copy.rule}</p>
        <p class="rule">${copy.knowledge}</p>
        <div class="choosers">
          <div><h2 class="chooser-title">Build</h2>${chips("kind", Object.entries(BUILDS).map(([id, b]) => [id, b.name]), choice.kind)}</div>
          <div><h2 class="chooser-title">Tour</h2>${chips("tour", Object.entries(TOURS).map(([id, t]) => [id, t.name]), choice.tour)}</div>
          ${choice.kind === "cup" ? `<div><h2 class="chooser-title">Home surface</h2>${chips("surface", Object.entries(SURFACES), choice.surface)}</div>` : ""}
        </div>
        <div class="modes">
          ${Object.entries(MODES).map(([id, m]) => {
            const done = id === "daily" && played;
            return `<button class="mode" data-mode="${id}" ${done ? "disabled" : ""}>
              <span class="mode-name">${done ? `Daily played · ${played.wins}-${played.total - played.wins}` : m.name}</span>
              <span class="mode-blurb">${done ? "New rolls arrive at midnight." : m.blurb}</span>
            </button>`;
          }).join("")}
        </div>
        <section class="friends">
          <h2 class="friends-title">Play with friends</h2>
          <p class="friends-blurb">Everyone in a room gets the same rolls with the build and tour picked above. Share the link, play whenever, and the scoreboard ranks the room.</p>
          <div class="friends-row">
            <div class="seg friends-mode">${["classic", "scout"].map((m) => `<button class="seg-btn" data-choose="roomMode" data-value="${m}" aria-pressed="${(choice.roomMode || "classic") === m}">${MODES[m].name}</button>`).join("")}</div>
            <form class="friends-form" data-form="create"><input class="input" name="name" placeholder="Your name" maxlength="24" required autocomplete="nickname"><button class="primary" type="submit" ${roomBusy ? "disabled" : ""}>Create a room</button></form>
          </div>
          <form class="friends-form is-join" data-form="open"><input class="input" name="code" placeholder="Have a code?" maxlength="6" autocapitalize="characters" required><button class="secondary" type="submit">Open room</button></form>
          ${roomError ? `<p class="warn">${esc(roomError)}</p>` : ""}
        </section>`;
      return;
    }
    if (p === "room") {
      const mine = myEntry();
      const s = room.settings;
      const summary = `${BUILDS[s.kind].name.replace(/^A /, "")} · ${TOURS[s.tour].name}${s.kind === "cup" ? ` · ${SURFACES[s.surface].toLowerCase()} at home` : ""} · ${MODES[s.mode].name}`;
      const finished = room.players.filter((x) => x.result).length;
      el.console.innerHTML = `
        <p class="eyebrow">${esc(room.host)}'s room · ${esc(summary)}</p>
        <h2>${!me ? `Join ${esc(room.host)}'s room` : mine?.result ? "Scoreboard" : "You're in"}</h2>
        ${!me ? `<p class="lede">Enter a name and you'll get the same rolls as everyone else. ${room.players.length} in so far.</p>
          <form class="friends-form" data-form="join"><input class="input" name="name" placeholder="Your name" maxlength="24" required autocomplete="nickname"><button class="primary" type="submit" ${roomBusy ? "disabled" : ""}>Join and play</button></form>`
        : mine?.result ? `<p class="lede">${finished} of ${room.players.length} finished. This page updates on its own.</p>`
        : `<p class="lede">Play when you're ready. Your result posts to the room when the season ends.</p>
           <button class="primary" data-action="playroom">Play your season</button>`}
        <div class="share"><span class="share-link">${esc(roomLink())}</span><button class="secondary" data-action="copylink">Copy link</button></div>
        ${roomError ? `<p class="warn">${esc(roomError)}</p>` : ""}`;
      return;
    }
    if (p === "spin" || p === "spinning") {
      const openSingles = singlesSlots().filter((s) => !state.lineup[s.id]).length;
      const openSeats = seatSlots().filter((s) => !state.lineup[s.id]).length;
      const seatsOnly = !openSingles && openSeats;
      el.console.innerHTML = `
        <p class="eyebrow">${state.round === 0 ? "First pick" : `Pick ${state.round + 1}`} · ${openSingles} singles ${openSingles === 1 ? "spot" : "spots"}, ${openSeats} doubles ${openSeats === 1 ? "seat" : "seats"} open</p>
        <h2>${p === "spinning" ? "Rolling…" : seatsOnly ? "Fill the doubles" : "Roll for an era"}</h2>
        <p class="lede">${p === "spinning" ? "The ball's in the air." : seatsOnly ? copy.seatHint : "Every roll lands on one era. Everyone in that pool played in it, legends included."}</p>
        <div class="row"><button class="primary" data-action="spin" ${p === "spinning" ? "disabled" : ""}>Roll</button>
        ${openSeats && benchForSeat().length && p !== "spinning" ? `<button class="secondary" data-action="seatpick">Seat a singles player</button>` : ""}</div>`;
      return;
    }
    if (p === "pick") {
      const canRespin = state.respins > 0;
      el.console.innerHTML = `
        <p class="eyebrow">${esc(state.pool.era)} · pick ${state.round + 1}</p>
        <h2>${esc(state.pool.scene)}</h2>
        <p class="lede">${state.selected ? `Choose ${copy.place} for ${esc(state.selected.name)}: a singles spot or a doubles seat.` : copy.crateLede}</p>
        ${MODES[state.mode].respins ? `<button class="secondary" data-action="respin" ${canRespin ? "" : "disabled"}>
          ${canRespin ? `Re-roll · ${state.respins} left` : "No re-rolls left"}</button>` : ""}`;
      return;
    }
    if (p === "full") {
      const stacked = stackedLines(state.lineup);
      el.console.innerHTML = `
        <p class="eyebrow">Card complete</p>
        <h2>${copy.fullTitle}</h2>
        <p class="lede">${copy.fullLede}</p>
        ${stacked.size && stackingVisible() ? `<p class="warn">Stacked ladder: ${[...stacked].map((id) => slotOf(id).name).join(", ")} will be defaulted.</p>` : ""}
        <button class="primary" data-action="season">${copy.start}</button>`;
      return;
    }
    const shown = state.results.slice(0, state.shown);
    const w = shown.filter((r) => r.won).length, l = shown.length - w, n = state.results.length;
    el.console.innerHTML = `
      <p class="eyebrow">${p === "done" ? "Final record" : `${copy.stage} ${Math.min(state.shown + 1, n)} of ${n}`}</p>
      <p class="record-line" aria-live="polite"><span class="tally">${w}<span class="tally-dash">–</span>${l}</span></p>
      <p class="lede">${p === "done" ? verdict(w) : "…"}</p>
      ${p === "done"
        ? `<div class="row"><button class="primary" data-action="share">Copy result</button>${room ? `<button class="secondary" data-action="scoreboard">Scoreboard</button>` : ""}<button class="secondary" data-action="home">Draft again</button></div>`
        : `<button class="secondary" data-action="skip">Skip to the end</button>`}`;
  }

  function scoreboardHtml() {
    const ranked = standings();
    const waiting = room.players.filter((x) => !x.result);
    const n = room.players.length;
    return `<div class="board-card">
      <div class="board-head"><span>Scoreboard</span><span class="board-count">${ranked.length}/${n} done</span></div>
      <ol class="standings">${ranked.map((x) => `<li class="standing ${x.id === me?.id ? "is-me" : ""} place-${x.place}">
        <span class="standing-place">${ordinal(x.place)}</span>
        <span class="standing-name">${esc(x.name)}${x.id === me?.id ? " <small>you</small>" : ""}<span class="standing-lineup">${esc(x.result.lineup)}</span></span>
        <span class="standing-record">${x.result.wins}–${x.result.total - x.result.wins}<small>${x.result.points} pts</small></span>
      </li>`).join("")}
      ${waiting.map((x) => `<li class="standing is-waiting"><span class="standing-place">…</span><span class="standing-name">${esc(x.name)}${x.id === me?.id ? " <small>you</small>" : ""}</span><span class="standing-record"><small>still playing</small></span></li>`).join("")}</ol>
      ${!n ? "" : `<p class="board-foot">Ranked by wins, then match points won.</p>`}</div>`;
  }

  function playerMeta(a) {
    const bits = [a.style, a.slams === 0 ? "no slams" : a.slams === 1 ? "1 slam" : `${a.slams} slams`, a.college];
    return bits.filter(Boolean).join(" · ");
  }
  // Classic shows the five skill bars. Nerve, pedigree, surfaces and matchups stay in your head.
  const SHOWN_KEYS = RATING_KEYS.filter(([k]) => k !== "clutch");
  const ratingsBlock = (a) => `<span class="act-ratings">${SHOWN_KEYS.map(([k, label]) =>
    `<span class="stat"><span class="stat-label">${label}</span><span class="stat-value">${a[k]}</span><span class="stat-bar" style="--v:${a[k]}"></span></span>`).join("")}</span>`;

  function renderCrate() {
    const p = state.phase;
    if (p === "pick") {
      const show = MODES[state.mode].showRatings;
      const items = state.crate.filter((a) => !state.used.has(a.id)).sort((a, b) => a.name.localeCompare(b.name));
      el.crate.innerHTML = `<ul class="acts">${items.map((a, i) => `
        <li style="--i:${i}"><button class="act ${state.selected === a ? "is-selected" : ""}" data-item="${esc(a.id)}" aria-pressed="${state.selected === a}">
          <span class="act-head"><span class="act-flag">${flag(a.cc)}</span><span class="act-name">${esc(a.name)}</span><span class="act-years">${esc(a.years)}</span></span>
          <span class="act-sub">${esc(playerMeta(a))}</span>
          ${show ? ratingsBlock(a) : ""}
        </button></li>`).join("")}</ul>`;
      return;
    }
    if (p === "room") { el.crate.innerHTML = me ? scoreboardHtml() : ""; return; }
    if (p === "season" || p === "done") {
      const copy = format.copy;
      el.crate.innerHTML = `${p === "done" && room && me ? scoreboardHtml() : ""}<ol class="results">${state.results.slice(0, state.shown).map((r, i) => `
        <li class="result ${r.won ? "is-win" : "is-loss"} ${i >= state.results.length - 3 ? "is-finale" : ""}">
          <span class="result-no">${i + 1}</span>
          <span class="result-opp">${esc(r.title)}<span class="result-sub">${esc(r.sub)}${format.kind === "cup" ? ` · ${SURFACES[r.surface].toLowerCase()}` : ""}</span></span>
          <span class="result-score"><b>${r.won ? copy.win : copy.loss}</b>${r.score}</span>
          <span class="result-lines">${r.lines.filter((x) => x.point).map((x) => `<span class="line ${x.won === null ? "is-dead" : x.won ? "is-win" : "is-loss"} ${x.stacked ? "is-stacked" : ""}"
            title="${esc(x.label)}${x.who ? `: ${esc(x.who)}` : ""}${x.stacked ? " (stacked, defaulted)" : x.won === null ? " (not needed)" : x.won ? " won" : " lost"}">${x.stacked ? "S" : x.won === null ? "·" : x.doubles ? "D" : x.won ? "W" : "L"}</span>`).join("")}</span>
        </li>`).join("")}</ol>`;
      el.crate.lastElementChild?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
      return;
    }
    el.crate.innerHTML = "";
  }

  function spotRow(s, { interactive }) {
    const p = state.lineup?.[s.id];
    const visible = ratingsVisible();
    const building = state.phase === "pick" || state.phase === "spin" || state.phase === "full";
    if (p) {
      const isStacked = s.singles && stackingVisible() && stackedLines(state.lineup).has(s.id);
      const removable = s.seat && building && inSingles(p);
      const movable = s.singles && building && interactive;
      const idx = movable ? singlesSlots().findIndex((x) => x.id === s.id) : -1;
      return `<li class="spot is-filled ${isStacked ? "is-stacked" : ""}"><span class="spot-name">${s.short}</span>
        <span class="spot-player">${flag(p.cc)} ${esc(p.name)}${s.seat && inSingles(p) ? ` <small>${esc(singlesSlots().find((x) => state.lineup[x.id] === p).short)}</small>` : ""}</span>
        ${movable ? `<span class="reorder">${isStacked ? `<i>Stacked</i>` : ""}<button data-move="-1" data-slotid="${s.id}" ${idx === 0 ? "disabled" : ""} aria-label="Move up">↑</button><button data-move="1" data-slotid="${s.id}" ${idx === singlesSlots().length - 1 ? "disabled" : ""} aria-label="Move down">↓</button></span>`
        : removable ? `<button class="unseat" data-unseat="${s.id}" aria-label="Clear seat">×</button>` : visible ? `<span class="spot-score">${isStacked ? "Stacked" : s.seat ? "" : r1(singles(p))}</span>` : ""}</li>`;
    }
    if (interactive && state.phase === "pick" && state.selected) {
      const bad = s.singles && stackingVisible() ? stackingIfPlaced(s.id) : [];
      return `<li class="spot is-open"><button class="place ${bad.length ? "is-bad" : ""}" data-slot="${s.id}">
        <span class="spot-name">${s.short}</span><span class="spot-player">Place here</span>
        ${bad.length ? `<span class="spot-score">Stacks ${bad.map((id) => slotOf(id).short).join(", ")}</span>` : ""}</button></li>`;
    }
    if (interactive && s.seat && building && !state.selected && benchForSeat().length) {
      return `<li class="spot is-open"><button class="place is-seat" data-seat="${s.id}"><span class="spot-name">${s.short}</span><span class="spot-player">Seat a singles player</span></button></li>`;
    }
    return `<li class="spot is-empty"><span class="spot-name">${s.short}</span><span class="spot-player">Open</span></li>`;
  }

  function renderPoster() {
    if (state.phase === "room") { el.poster.innerHTML = ""; return; }
    const home = state.phase === "home";
    const visible = !home && ratingsVisible();
    const filledSingles = home ? 0 : singlesSlots().filter((s) => state.lineup[s.id]).length;
    const filledTeams = home ? 0 : pairs().length;
    el.poster.innerHTML = `<div class="card">
      <div class="card-head"><div><p class="card-top">${esc(format.tourName)}${format.kind === "cup" ? ` · ${SURFACES[format.surface].toLowerCase()} at home` : ""}</p>
      <h2 class="card-title">${format.copy.posterTitle}</h2></div><span class="card-count">${filledSingles}/${singlesSlots().length} · ${filledTeams}/${teams().length}</span></div>
      <p class="card-sub">Singles</p>
      <ol class="spots">${singlesSlots().map((s) => spotRow(s, { interactive: true })).join("")}</ol>
      <p class="card-sub">Doubles</p>
      <ol class="teams">${teams().map((tm) => {
        const [a, b] = tm.map((s) => state.lineup?.[s.id]);
        return `<li class="team"><ol class="spots">${tm.map((s) => spotRow(s, { interactive: true })).join("")}</ol>
          <span class="team-tag">${visible && a && b ? `<b>${r1(pairRating(a, b))}</b>` : ""}${a && b && isRealPair(a, b) ? `<i>real pair</i>` : ""}</span></li>`;
      }).join("")}</ol>
      <p class="card-foot">${home ? format.copy.footEmpty : state.phase === "pick" && !state.selected ? "Pick a player first." : state.phase === "season" || state.phase === "done" ? format.copy.surfaceNote : format.copy.seatHint}</p></div>`;
  }

  // Phones: a bottom sheet for placing the selected player, so the lineup card needn't be on screen.
  function renderSheet() {
    const placing = state.phase === "pick" && state.selected;
    const seating = state.seatPick && (state.phase === "spin" || state.phase === "pick" || state.phase === "full");
    el.sheet.hidden = !(placing || seating);
    el.sheet.classList.toggle("is-seating", Boolean(seating));
    if (!placing && !seating) { el.sheet.innerHTML = ""; return; }
    if (seating) {
      const seatId = state.seatPick === "any" ? seatSlots().find((s) => !state.lineup[s.id])?.id : state.seatPick;
      const show = Boolean(MODES[state.mode].showRatings);
      el.sheet.innerHTML = `<div class="sheet-inner">
        <div class="sheet-head"><span class="sheet-name">Seat in ${esc(slotOf(seatId)?.name || "doubles")}</span><button class="sheet-close" data-action="seatcancel" aria-label="Cancel">×</button></div>
        <ul class="bench">${benchForSeat().map((p) => `<li><button class="bench-btn" data-fill="${esc(p.id)}" data-seatid="${seatId}">
          <span class="bench-name">${flag(p.cc)} ${esc(p.name)} <small>${esc(singlesSlots().find((x) => state.lineup[x.id] === p)?.short || "")}</small></span>
          ${show ? `<span class="bench-stat">Dbl <b>${p.dbl}</b> · Net <b>${p.net}</b></span>` : `<span class="bench-stat">${esc(p.style)}</span>`}</button></li>`).join("")}</ul></div>`;
      return;
    }
    const p = state.selected;
    const seatLabel = (s) => `${s.short}<em>${s.id.endsWith("a") ? "A" : "B"}</em>`;
    el.sheet.innerHTML = `<div class="sheet-inner">
      <div class="sheet-head"><span class="sheet-name">${flag(p.cc)} ${esc(p.name)}</span><button class="sheet-close" data-item="${esc(p.id)}" aria-label="Cancel">×</button></div>
      <p class="sheet-sub">Singles</p>
      <div class="sheet-slots">${singlesSlots().map((s) => {
        if (state.lineup[s.id]) return `<span class="sheet-slot is-filled"><span>${s.short}</span><small>${esc(lineName(state.lineup[s.id]))}</small></span>`;
        const bad = stackingVisible() ? stackingIfPlaced(s.id) : [];
        return `<button class="sheet-slot ${bad.length ? "is-bad" : ""}" data-slot="${s.id}"><span>${s.short}</span><small>${bad.length ? "Stacks" : "Open"}</small></button>`;
      }).join("")}</div>
      <p class="sheet-sub">Doubles</p>
      <div class="sheet-slots is-seats">${seatSlots().map((s) => state.lineup[s.id]
        ? `<span class="sheet-slot is-filled"><span>${seatLabel(s)}</span><small>${esc(lineName(state.lineup[s.id]))}</small></span>`
        : `<button class="sheet-slot" data-slot="${s.id}"><span>${seatLabel(s)}</span><small>Open</small></button>`).join("")}</div></div>`;
  }

  // ---------- events ----------
  document.addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    const data = new FormData(form);
    if (form.dataset.form === "create") createRoom(String(data.get("name")).trim());
    if (form.dataset.form === "join") joinRoom(String(data.get("name")).trim());
    if (form.dataset.form === "open") { const code = String(data.get("code")).trim().toUpperCase(); history.replaceState(null, "", `?room=${code}`); openRoom(code); }
  });
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    if (btn.dataset.choose) { setChoice({ [btn.dataset.choose]: btn.dataset.value }); return; }
    if (btn.dataset.mode) { startGame(btn.dataset.mode); return; }
    if (btn.dataset.item) { selectItem(btn.dataset.item); return; }
    if (btn.dataset.slot) { placeItem(btn.dataset.slot); return; }
    if (btn.dataset.seat) { state.seatPick = btn.dataset.seat; render(); return; }
    if (btn.dataset.fill) { seatFromRoster(btn.dataset.seatid, btn.dataset.fill); return; }
    if (btn.dataset.unseat) { clearSeat(btn.dataset.unseat); return; }
    if (btn.dataset.move) { moveSingles(btn.dataset.slotid, Number(btn.dataset.move)); return; }
    switch (btn.dataset.action) {
      case "spin": spin(false); break;
      case "respin": spin(true); break;
      case "season": playSeason(); break;
      case "skip": finishSeason(); break;
      case "seatpick": state.seatPick = "any"; render(); break;
      case "seatcancel": state.seatPick = null; render(); break;
      case "share":
        navigator.clipboard?.writeText(shareText()).then(() => { btn.textContent = "Copied"; setTimeout(() => (btn.textContent = "Copy result"), 1500); }).catch(() => {});
        break;
      case "home": clearInterval(state.timer); state = room ? { phase: "room" } : { phase: "home" }; setLabel("Six", "Love"); render(); break;
      case "leave": leaveRoom(); state = { phase: "home" }; render(); break;
      case "playroom": applyRoomSettings(); startGame(room.settings.mode, room.seed); break;
      case "scoreboard": clearInterval(state.timer); state = { phase: "room" }; setLabel("Six", "Love"); render(); window.scrollTo({ top: 0 }); break;
      case "copylink":
        navigator.clipboard?.writeText(roomLink()).then(() => { btn.textContent = "Copied"; setTimeout(() => (btn.textContent = "Copy link"), 1500); }).catch(() => {});
        break;
    }
  });

  const roomParam = new URLSearchParams(location.search).get("room");
  if (roomParam) openRoom(roomParam.toUpperCase()); else render();
})();
