(() => {
  const $ = (id) => document.getElementById(id);
  const el = { ball: $("ball"), era: $("labelEra"), scene: $("labelScene"), console: $("console"), crate: $("crate"), poster: $("poster"), status: $("status"), sheet: $("sheet") };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const MODES = {
    classic: { name: "Classic", blurb: "Ratings on show while you draft.", respins: 2, showRatings: true },
    scout: { name: "Scout", blurb: "Names only. You have to know your tennis.", respins: 2, showRatings: false },
    daily: { name: "Daily", blurb: "Same draws for everyone. One shot, no redraws.", respins: 0, showRatings: false },
  };

  // ---------- players and pools ----------
  const toPlayer = ([era, name, cc, years, style, slams, college, serve, rtn, rally, net, clutch, dbl, hard, clay, grass]) =>
    ({ id: name, era, name, cc, years, style, slams, college, serve, rtn, rally, net, clutch, dbl, hard, clay, grass });

  function poolsFor(tour) {
    const players = TOURS[tour].players().map(toPlayer);
    const eras = ERAS.map(([key, era, scenes]) => ({ id: `${tour}-${key}`, era, scene: scenes[tour], items: players.filter((p) => p.era === key) }));
    const wild = WILD_POOLS.map((w) => ({ id: `${tour}-${w.id}`, era: "Any era", scene: w.scene, wild: true, items: players.filter(w.test) }));
    return { eras, wild };
  }

  function buildFormat({ kind, tour, surface }) {
    const copy = BUILDS[kind];
    const { eras, wild } = poolsFor(tour);
    const base = { kind, copy, tour, pools: eras, wild, tourName: TOURS[tour].name };
    if (kind === "cup") {
      return { ...base, key: `cup-${tour}-${surface}`, label: `cup run, ${TOURS[tour].short}, ${SURFACES[surface].toLowerCase()} at home`,
        slots: CUP_SLOTS, pairCount: CUP_PAIR_COUNT, surface,
        stages: CUP_RUN.map(([title, sub, surf, diff]) => ({ title, sub, surface: surf || surface, diff, home: !surf })) };
    }
    return { ...base, key: `dual-${tour}`, label: `college season, ${TOURS[tour].short}`,
      slots: DUAL_SLOTS, pairCount: DUAL_PAIR_COUNT, surface: "hard", stages: SEASON.map(([title, sub, diff]) => ({ title, sub, surface: "hard", diff })) };
  }

  let choice = { kind: "dual", tour: "atp", surface: "hard" };
  try { Object.assign(choice, JSON.parse(localStorage.getItem("sixlove-choice")) || {}); } catch { /* private window */ }
  if (!BUILDS[choice.kind]) choice.kind = "dual";
  if (!TOURS[choice.tour]) choice.tour = "atp";
  if (!SURFACES[choice.surface]) choice.surface = "hard";

  let state = { phase: "home" };
  let format = buildFormat(choice);

  // ---------- rooms: play with friends ----------
  // A room fixes the settings and the seed, so everyone gets the same draws. Results land on a shared scoreboard.
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
    const lineup = [...singlesSlots().map((s) => `${s.short}: ${state.lineup[s.id].name}`), ...state.pairs.map((pr) => `Dbl: ${pairName(...pairPlayers(pr))}`)].join("; ");
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

  const ratingsVisible = () => Boolean(MODES[state.mode]?.showRatings) || state.phase === "season" || state.phase === "done";
  const singles = (p, surface = format.surface) => singlesRating(p, surface);
  const singlesSlots = () => format.slots.filter((s) => s.singles);
  const roster = () => format.slots.map((s) => state.lineup[s.id]).filter(Boolean);
  const slotOf = (id) => format.slots.find((s) => s.id === id);

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
      pool: null, crate: [], lastPoolId: null, selected: null, lineup: {}, used: new Set(), pairs: [], pairDraft: null, results: [], shown: 0 };
    setLabel("Six", "Love");
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  const availableItems = (pool) => pool.items.filter((p) => !state.used.has(p.id));

  function spin(isRespin) {
    if (state.phase === "spinning") return;
    if (isRespin) state.respins--;
    const open = (pools, min) => pools.filter((p) => p.id !== state.lastPoolId && availableItems(p).length >= min);
    const wild = open(format.wild, 4);
    const goWild = state.rng() < 0.3 && wild.length > 0;
    const options = goWild ? wild : open(format.pools, 3);
    const pool = options[Math.floor(state.rng() * options.length)];
    let crate = availableItems(pool);
    if (pool.wild) crate = crate.map((p) => [state.rng(), p]).sort((a, b) => a[0] - b[0]).slice(0, 9).map(([, p]) => p);
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
    const reel = [...format.pools, ...format.wild];
    const flicker = setInterval(() => { const p = reel[Math.floor(Math.random() * reel.length)]; setLabel(p.era, p.scene); }, 90);
    setTimeout(land, 1400);
  }

  function setLabel(era, scene) { el.era.textContent = era; el.scene.textContent = scene; }

  function selectItem(id) {
    state.selected = state.selected?.id === id ? null : state.crate.find((p) => p.id === id);
    render();
  }

  function placeItem(slotId) {
    if (!state.selected || state.lineup[slotId]) return;
    state.lineup[slotId] = state.selected;
    state.used.add(state.selected.id);
    state.selected = null;
    state.round++;
    state.phase = state.round === format.slots.length ? "doubles" : "spin";
    render();
    if (state.phase === "spin") el.console.querySelector("button")?.focus({ preventScroll: true });
    else window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }

  // Doubles: tap two roster players to make a pair. Pairs are ordered first to last.
  const inPair = (id) => state.pairs.some((pr) => pr.includes(id));
  function tapDoubles(id) {
    if (inPair(id)) return;
    if (state.pairDraft === id) state.pairDraft = null;
    else if (state.pairDraft) { state.pairs.push([state.pairDraft, id]); state.pairDraft = null; }
    else state.pairDraft = id;
    render();
  }
  function removePair(i) { state.pairs.splice(i, 1); state.pairDraft = null; render(); }
  const pairPlayers = (pr) => pr.map((id) => roster().find((p) => p.id === id));
  const pairsDone = () => state.pairs.length === format.pairCount;

  // ---------- simulation ----------
  function playDual(stage) {
    const L = state.lineup, stacked = stackedLines(L), lines = [];
    let doublesWon = 0;
    state.pairs.forEach((pr, i) => {
      const [a, b] = pairPlayers(pr);
      const mine = pairRating(a, b), theirs = stage.diff + DUAL_DOUBLES[i];
      const won = state.rng() < winChance(mine, theirs);
      if (won) doublesWon++;
      lines.push({ label: `Doubles ${i + 1}`, who: pairName(a, b), won });
    });
    const doublesPoint = doublesWon >= 2;
    lines.push({ label: "Doubles point", who: `${doublesWon} of 3 pairs won`, won: doublesPoint, point: true, doubles: true });
    let points = doublesPoint ? 1 : 0;
    singlesSlots().forEach((slot, k) => {
      const p = L[slot.id], mine = singles(p, "hard"), theirs = stage.diff + DUAL_LADDER[k];
      const isStacked = stacked.has(slot.id);
      const won = !isStacked && state.rng() < winChance(mine, theirs);
      if (won) points++;
      lines.push({ label: `No. ${k + 1}`, who: lineName(p), won, stacked: isStacked, point: true });
    });
    return { ...stage, lines, score: `${points}-${7 - points}`, won: points >= 4 };
  }

  function playTie(stage) {
    const L = state.lineup, [a, b] = pairPlayers(state.pairs[0]), lines = [];
    let mine = 0, theirs = 0;
    for (const [slot, line] of CUP_RUBBERS) {
      const decided = mine === 3 || theirs === 3;
      const isDoubles = slot === "d";
      const rating = isDoubles ? pairRating(a, b) : singles(L[slot], stage.surface);
      const won = decided ? null : state.rng() < winChance(rating, stage.diff + CUP_LADDER[line]);
      if (won === true) mine++; else if (won === false) theirs++;
      lines.push({ label: isDoubles ? "Doubles" : `${lineName(L[slot])} v their No. ${line}`, who: isDoubles ? pairName(a, b) : "", won, point: true, doubles: isDoubles });
    }
    return { ...stage, lines, score: `${mine}-${theirs}`, won: mine === 3 };
  }

  function playSeason() {
    if (!pairsDone()) return;
    state.results = format.stages.map((stage) => (format.kind === "dual" ? playDual(stage) : playTie(stage)));
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
    const dbl = state.pairs.map((pr, i) => `Doubles ${i + 1}: ${pairName(...pairPlayers(pr))}`).join("\n");
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
      : state.phase === "doubles" ? `${MODES[state.mode].name} · doubles`
      : `${MODES[state.mode].name} · pick ${Math.min(state.round + 1, total)} of ${total}`;
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
              <span class="mode-blurb">${done ? "New draws arrive at midnight." : m.blurb}</span>
            </button>`;
          }).join("")}
        </div>
        <section class="friends">
          <h2 class="friends-title">Play with friends</h2>
          <p class="friends-blurb">Everyone in a room gets the same draws with the build and tour picked above. Share the link, play whenever, and the scoreboard ranks the room.</p>
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
        ${!me ? `<p class="lede">Enter a name and you'll get the same draws as everyone else. ${room.players.length} in so far.</p>
          <form class="friends-form" data-form="join"><input class="input" name="name" placeholder="Your name" maxlength="24" required autocomplete="nickname"><button class="primary" type="submit" ${roomBusy ? "disabled" : ""}>Join and play</button></form>`
        : mine?.result ? `<p class="lede">${finished} of ${room.players.length} finished. This page updates on its own.</p>`
        : `<p class="lede">Play when you're ready. Your result posts to the room when the season ends.</p>
           <button class="primary" data-action="playroom">Play your season</button>`}
        <div class="share"><span class="share-link">${esc(roomLink())}</span><button class="secondary" data-action="copylink">Copy link</button></div>
        ${roomError ? `<p class="warn">${esc(roomError)}</p>` : ""}`;
      return;
    }
    if (p === "spin" || p === "spinning") {
      el.console.innerHTML = `
        <p class="eyebrow">${state.round === 0 ? "First pick" : `Pick ${state.round + 1} of ${format.slots.length}`}</p>
        <h2>${p === "spinning" ? "Making the draw…" : "Where's the next pick coming from?"}</h2>
        <p class="lede">${p === "spinning" ? "The ball's in the air." : "The draw lands on an era, or a wild pool that cuts across all of them."}</p>
        <button class="primary" data-action="spin" ${p === "spinning" ? "disabled" : ""}>Make the draw</button>`;
      return;
    }
    if (p === "pick") {
      const canRespin = state.respins > 0;
      el.console.innerHTML = `
        <p class="eyebrow">${esc(state.pool.era)} · pick ${state.round + 1} of ${format.slots.length}</p>
        <h2>${esc(state.pool.scene)}</h2>
        <p class="lede">${state.selected ? `Choose ${copy.place} for ${esc(state.selected.name)}.` : copy.crateLede}</p>
        ${MODES[state.mode].respins ? `<button class="secondary" data-action="respin" ${canRespin ? "" : "disabled"}>
          ${canRespin ? `Redraw · ${state.respins} left` : "No redraws left"}</button>` : ""}`;
      return;
    }
    if (p === "doubles") {
      const stacked = stackedLines(state.lineup);
      const need = format.pairCount - state.pairs.length;
      el.console.innerHTML = `
        <p class="eyebrow">Roster complete</p>
        <h2>${copy.doublesTitle}</h2>
        <p class="lede">${copy.doublesLede}</p>
        ${stacked.size && ratingsVisible() ? `<p class="warn">Stacked ladder: ${[...stacked].map((id) => slotOf(id).name).join(", ")} will be defaulted.</p>` : ""}
        <p class="hint">${need ? (state.pairDraft ? "Now tap a partner." : `Tap two players to form ${need === format.pairCount ? "a pair" : "the next pair"}. ${need} to go.`) : "All pairs set."}</p>
        <button class="primary" data-action="season" ${pairsDone() ? "" : "disabled"}>${copy.start}</button>`;
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
  const ratingsBlock = (a) => `<span class="act-ratings">${RATING_KEYS.map(([k, label]) =>
    `<span class="stat"><span class="stat-label">${label}</span><span class="stat-value">${a[k]}</span><span class="stat-bar" style="--v:${a[k]}"></span></span>`).join("")}</span>
    <span class="act-singles">${Object.entries(SURFACES).map(([k, label]) =>
      `<span class="${k === format.surface ? "is-surface" : ""}">${label} <b>${r1(singles(a, k))}</b></span>`).join("")}</span>`;

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
    if (p === "doubles") {
      const show = ratingsVisible();
      const players = roster();
      el.crate.innerHTML = `
        <ol class="pairs-set">${Array.from({ length: format.pairCount }, (_, i) => {
          const pr = state.pairs[i];
          if (!pr) return `<li class="pairslot is-empty"><span class="pairslot-no">${format.kind === "dual" ? `Doubles ${i + 1}` : "Doubles"}</span><span class="pairslot-names">${i === state.pairs.length ? (state.pairDraft ? `${esc(lineName(players.find((x) => x.id === state.pairDraft)))} + …` : "Tap two players") : "Open"}</span></li>`;
          const [a, b] = pairPlayers(pr);
          return `<li class="pairslot"><span class="pairslot-no">${format.kind === "dual" ? `Doubles ${i + 1}` : "Doubles"}</span>
            <span class="pairslot-names">${flag(a.cc)} ${esc(lineName(a))} / ${flag(b.cc)} ${esc(lineName(b))}</span>
            ${show ? `<span class="pairslot-score">${r1(pairRating(a, b))}</span>` : ""}
            <button class="pairslot-x" data-unpair="${i}" aria-label="Remove pair">×</button></li>`;
        }).join("")}</ol>
        <ul class="acts is-roster">${players.map((a) => {
          const taken = inPair(a.id), draft = state.pairDraft === a.id;
          const role = format.slots.find((s) => state.lineup[s.id] === a);
          return `<li><button class="act act-mini ${draft ? "is-selected" : ""} ${taken ? "is-taken" : ""}" data-double="${esc(a.id)}" ${taken ? "disabled" : ""} aria-pressed="${draft}">
            <span class="act-head"><span class="act-flag">${flag(a.cc)}</span><span class="act-name">${esc(a.name)}</span><span class="act-role">${esc(role.short)}</span></span>
            ${show ? `<span class="act-dbl"><span>Doubles <b>${a.dbl}</b></span><span>Net <b>${a.net}</b></span><span>Serve <b>${a.serve}</b></span></span>` : `<span class="act-sub">${esc(playerMeta(a))}</span>`}
          </button></li>`;
        }).join("")}</ul>`;
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
    if (p) {
      const isStacked = visible && stackedLines(state.lineup).has(s.id);
      return `<li class="spot is-filled ${isStacked ? "is-stacked" : ""}"><span class="spot-name">${s.short}</span>
        <span class="spot-player">${flag(p.cc)} ${esc(p.name)}</span>
        ${visible ? `<span class="spot-score">${isStacked ? "Stacked" : s.squad ? `<i>dbl</i> ${p.dbl}` : r1(singles(p))}</span>` : ""}</li>`;
    }
    if (interactive && state.phase === "pick" && state.selected) {
      const bad = visible ? stackingIfPlaced(s.id) : [];
      return `<li class="spot is-open"><button class="place ${bad.length ? "is-bad" : ""}" data-slot="${s.id}">
        <span class="spot-name">${s.short}</span><span class="spot-player">${esc(s.squad ? "Doubles only" : "Place here")}</span>
        ${bad.length ? `<span class="spot-score">Stacks ${bad.map((id) => slotOf(id).short).join(", ")}</span>` : ""}</button></li>`;
    }
    return `<li class="spot is-empty"><span class="spot-name">${s.short}</span><span class="spot-player">Open</span></li>`;
  }

  function renderPoster() {
    if (state.phase === "room") { el.poster.innerHTML = ""; return; }
    const home = state.phase === "home";
    const visible = !home && ratingsVisible();
    const squad = format.slots.filter((s) => s.squad);
    const pairsList = !home && state.pairs.length ? `<ol class="card-pairs">${state.pairs.map((pr, i) => {
      const [a, b] = pairPlayers(pr);
      return `<li><span class="spot-name">${format.kind === "dual" ? `Dbl ${i + 1}` : "Dbl"}</span><span class="spot-player">${esc(pairName(a, b))}</span>${visible ? `<span class="spot-score">${r1(pairRating(a, b))}</span>` : ""}</li>`;
    }).join("")}</ol>` : "";
    const filled = home ? 0 : roster().length;
    el.poster.innerHTML = `<div class="card">
      <div class="card-head"><div><p class="card-top">${esc(format.tourName)}${format.kind === "cup" ? ` · ${SURFACES[format.surface].toLowerCase()} at home` : ""}</p>
      <h2 class="card-title">${format.copy.posterTitle}</h2></div><span class="card-count">${filled}/${format.slots.length}</span></div>
      <p class="card-sub">Singles</p>
      <ol class="spots">${singlesSlots().map((s) => spotRow(s, { interactive: true })).join("")}</ol>
      <p class="card-sub">Doubles squad</p>
      <ol class="spots">${squad.map((s) => spotRow(s, { interactive: true })).join("")}</ol>
      ${pairsList ? `<p class="card-sub">Doubles pairs</p>${pairsList}` : ""}
      <p class="card-foot">${home ? format.copy.footEmpty : state.phase === "pick" && !state.selected ? "Pick a player first." : format.copy.surfaceNote}</p></div>`;
  }

  // Phones: a bottom sheet for placing the selected player, so the lineup card needn't be on screen.
  function renderSheet() {
    const open = state.phase === "pick" && state.selected;
    el.sheet.hidden = !open;
    if (!open) { el.sheet.innerHTML = ""; return; }
    const p = state.selected, visible = ratingsVisible();
    el.sheet.innerHTML = `<div class="sheet-inner">
      <div class="sheet-head"><span class="sheet-name">${flag(p.cc)} ${esc(p.name)}${visible ? ` <b>${r1(singles(p))}</b>` : ""}</span><button class="sheet-close" data-item="${esc(p.id)}" aria-label="Cancel">×</button></div>
      <div class="sheet-slots">${format.slots.map((s) => {
        if (state.lineup[s.id]) return `<span class="sheet-slot is-filled"><span>${s.short}</span><small>${esc(lineName(state.lineup[s.id]))}</small></span>`;
        const bad = visible ? stackingIfPlaced(s.id) : [];
        return `<button class="sheet-slot ${bad.length ? "is-bad" : ""}" data-slot="${s.id}"><span>${s.short}</span><small>${bad.length ? "Stacks" : s.squad ? "Doubles" : "Open"}</small></button>`;
      }).join("")}</div></div>`;
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
    if (btn.dataset.double) { tapDoubles(btn.dataset.double); return; }
    if (btn.dataset.unpair) { removePair(Number(btn.dataset.unpair)); return; }
    switch (btn.dataset.action) {
      case "spin": spin(false); break;
      case "respin": spin(true); break;
      case "season": playSeason(); break;
      case "skip": finishSeason(); break;
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
