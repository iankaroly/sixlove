(() => {
  const $ = (id) => document.getElementById(id);
  const el = { ball: $("ball"), era: $("labelEra"), scene: $("labelScene"), console: $("console"), crate: $("crate"), poster: $("poster"), status: $("status") };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const MODES = {
    classic: { name: "Classic", blurb: "Ratings on show while you draft.", respins: 2, showRatings: true },
    scout: { name: "Scout", blurb: "Names only. You have to know your tennis.", respins: 2, showRatings: false },
    daily: { name: "Daily", blurb: "Same draws for everyone. One shot, no re-draws.", respins: 0, showRatings: false },
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
        slots: CUP_SLOTS, surface, stages: CUP_RUN.map(([title, sub, surf, diff]) => ({ title, sub, surface: surf || surface, diff, home: !surf })) };
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

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const flag = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  const today = () => new Date().toLocaleDateString("en-CA");
  const dailyKey = () => `sixlove-daily-${today()}-${format.key}`;
  const r1 = (n) => Math.round(n);

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

  const ratingsVisible = () => MODES[state.mode].showRatings || state.phase === "season" || state.phase === "done";
  const singles = (p, surface = format.surface) => singlesRating(p, surface);

  // The ladder rule. Compares each filled spot with the nearest filled spot above it.
  function stackedLines(lineup) {
    if (format.kind !== "dual") return new Set();
    const stacked = new Set();
    let above = null;
    for (const slot of format.slots) {
      const p = lineup[slot.id];
      if (!p) continue;
      if (above && singles(p, "hard") > singles(above, "hard") + STACK_TOLERANCE) stacked.add(slot.id);
      above = p;
    }
    return stacked;
  }
  // What placing the selected player in a spot would do to the ladder.
  function stackingIfPlaced(slotId) {
    const before = stackedLines(state.lineup);
    const after = stackedLines({ ...state.lineup, [slotId]: state.selected });
    return [...after].filter((id) => !before.has(id));
  }
  const pairs = () => (format.kind === "dual" ? DUAL_PAIRS : [["d1", "d2"]]);

  // ---------- game flow ----------
  function setChoice(patch) {
    Object.assign(choice, patch);
    try { localStorage.setItem("sixlove-choice", JSON.stringify(choice)); } catch { /* private window */ }
    format = buildFormat(choice);
    render();
  }

  function startGame(mode) {
    const seed = mode === "daily" ? hash(`sixlove-${today()}-${format.key}`) : (Math.random() * 2 ** 32) >>> 0;
    state = { phase: "spin", mode, rng: mulberry32(seed), round: 0, respins: MODES[mode].respins,
      pool: null, crate: [], lastPoolId: null, selected: null, lineup: {}, used: new Set(), results: [], shown: 0 };
    setLabel("Six", "Love");
    render();
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
      el.crate.querySelector("button")?.focus({ preventScroll: true });
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
    state.phase = state.round === format.slots.length ? "full" : "spin";
    render();
    el.console.querySelector("button")?.focus({ preventScroll: true });
  }

  // ---------- simulation ----------
  const lineName = (p) => p.name.split(" ").slice(-1)[0];
  const pairName = (a, b) => `${lineName(a)}/${lineName(b)}`;

  function playDual(stage) {
    const L = state.lineup, stacked = stackedLines(L), lines = [];
    let doublesWon = 0;
    DUAL_PAIRS.forEach(([a, b], i) => {
      const mine = pairRating(L[a], L[b]), theirs = stage.diff + DUAL_DOUBLES[i];
      const won = state.rng() < winChance(mine, theirs);
      if (won) doublesWon++;
      lines.push({ label: `Doubles ${i + 1}`, who: pairName(L[a], L[b]), mine, theirs, won });
    });
    const doublesPoint = doublesWon >= 2;
    lines.push({ label: "Doubles point", who: `${doublesWon} of 3`, won: doublesPoint, point: true });
    let points = doublesPoint ? 1 : 0;
    format.slots.forEach((slot, k) => {
      const p = L[slot.id], mine = singles(p, "hard"), theirs = stage.diff + DUAL_LADDER[k];
      const isStacked = stacked.has(slot.id);
      const won = !isStacked && state.rng() < winChance(mine, theirs);
      if (won) points++;
      lines.push({ label: `No. ${k + 1}`, who: lineName(p), mine, theirs, won, stacked: isStacked, point: true });
    });
    return { ...stage, lines, score: `${points}-${7 - points}`, won: points >= 4 };
  }

  function playTie(stage) {
    const L = state.lineup, lines = [];
    let mine = 0, theirs = 0;
    for (const [slot, line] of CUP_RUBBERS) {
      const decided = mine === 3 || theirs === 3;
      const isDoubles = slot === "d";
      const rating = isDoubles ? pairRating(L.d1, L.d2) : singles(L[slot], stage.surface);
      const opp = stage.diff + CUP_LADDER[line];
      const won = decided ? null : state.rng() < winChance(rating, opp);
      if (won === true) mine++; else if (won === false) theirs++;
      lines.push({ label: isDoubles ? "Doubles" : `${lineName(L[slot])} v their No. ${line}`, who: isDoubles ? pairName(L.d1, L.d2) : "",
        mine: rating, theirs: opp, won, dead: decided, point: true });
    }
    return { ...stage, lines, score: `${mine}-${theirs}`, won: mine === 3 };
  }

  function playSeason() {
    state.results = format.stages.map((stage) => (format.kind === "dual" ? playDual(stage) : playTie(stage)));
    state.shown = 0;
    state.phase = "season";
    render();
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
    const card = format.slots.map((s) => `${s.name}: ${state.lineup[s.id].name}`).join("\n");
    return `${label}: ${w}-${n - w}\n${grid()}\n\n${card}`;
  }

  // ---------- rendering ----------
  function render() {
    document.body.dataset.phase = state.phase;
    document.body.dataset.surface = format.surface;
    renderStatus();
    renderConsole();
    renderCrate();
    renderPoster();
  }

  function renderStatus() {
    if (state.phase === "home") { el.status.innerHTML = ""; return; }
    const total = format.slots.length;
    const text = state.phase === "season" || state.phase === "done"
      ? `${MODES[state.mode].name}, ${format.copy.running}`
      : `${MODES[state.mode].name}, pick ${Math.min(state.round + 1, total)} of ${total}`;
    el.status.innerHTML = `<span>${text}</span><button class="quit" data-action="home">Quit</button>`;
  }

  function chips(name, options, current) {
    return `<div class="chips" role="group" aria-label="${name}">${options.map(([value, label]) =>
      `<button class="chip" data-choose="${name}" data-value="${esc(value)}" aria-pressed="${value === current}">${esc(label)}</button>`).join("")}</div>`;
  }

  function renderConsole() {
    const p = state.phase, copy = format.copy;
    if (p === "home") {
      const played = readDaily();
      el.console.innerHTML = `
        <h1>${copy.headline}</h1>
        <p class="lede">${copy.lede}</p>
        <p class="rule">${copy.rule}</p>
        <h2 class="chooser-title">What are you building?</h2>
        ${chips("kind", Object.entries(BUILDS).map(([id, b]) => [id, b.name]), choice.kind)}
        <h2 class="chooser-title">Which tour?</h2>
        ${chips("tour", Object.entries(TOURS).map(([id, t]) => [id, t.name]), choice.tour)}
        ${choice.kind === "cup" ? `<h2 class="chooser-title">Home surface</h2>${chips("surface", Object.entries(SURFACES), choice.surface)}` : ""}
        <div class="modes">
          ${Object.entries(MODES).map(([id, m]) => {
            const done = id === "daily" && played;
            return `<button class="mode" data-mode="${id}" ${done ? "disabled" : ""}>
              <span class="mode-name">${done ? `Daily played: ${played.wins}-${played.total - played.wins}` : `Play ${m.name.toLowerCase()}`}</span>
              <span class="mode-blurb">${done ? "A new set of draws arrives at midnight." : m.blurb}</span>
            </button>`;
          }).join("")}
        </div>`;
      return;
    }
    if (p === "spin" || p === "spinning") {
      el.console.innerHTML = `
        <h2>${state.round === 0 ? "First pick" : `Pick ${state.round + 1} of ${format.slots.length}`}</h2>
        <p class="lede">${p === "spinning" ? "Making the draw…" : "See which era you're drafting from next."}</p>
        <button class="primary" data-action="spin" ${p === "spinning" ? "disabled" : ""}>Make the draw</button>`;
      return;
    }
    if (p === "pick") {
      const canRespin = state.respins > 0;
      el.console.innerHTML = `
        <h2>${esc(state.pool.scene)}<span class="console-era">${esc(state.pool.era)}</span></h2>
        <p class="lede">${state.selected ? `Now choose ${copy.place} for ${esc(state.selected.name)}.` : copy.crateLede}</p>
        ${MODES[state.mode].respins ? `<button class="secondary" data-action="respin" ${canRespin ? "" : "disabled"}>
          ${canRespin ? `Redraw (${state.respins} left)` : "No redraws left"}</button>` : ""}`;
      return;
    }
    if (p === "full") {
      const stacked = stackedLines(state.lineup);
      el.console.innerHTML = `
        <h2>${copy.fullTitle}</h2>
        <p class="lede">${copy.fullLede}</p>
        ${stacked.size && ratingsVisible() ? `<p class="warn">Stacked ladder: ${[...stacked].map((id) => format.slots.find((s) => s.id === id).name).join(", ")} will be defaulted.</p>` : ""}
        <button class="primary" data-action="season">${copy.start}</button>`;
      return;
    }
    const shown = state.results.slice(0, state.shown);
    const w = shown.filter((r) => r.won).length, l = shown.length - w, n = state.results.length;
    el.console.innerHTML = `
      <p class="record-line" aria-live="polite"><span class="tally">${w}-${l}</span></p>
      <p class="lede">${p === "done" ? verdict(w) : `${copy.stage} ${Math.min(state.shown + 1, n)} of ${n}`}</p>
      ${p === "done"
        ? `<div class="row"><button class="primary" data-action="share">Copy result</button><button class="secondary" data-action="home">Draft again</button></div>`
        : `<button class="secondary" data-action="skip">Skip to the end</button>`}`;
  }

  function playerMeta(a) {
    const bits = [a.style, a.slams === 0 ? "no slams" : a.slams === 1 ? "1 slam" : `${a.slams} slams`, a.college];
    return bits.filter(Boolean).join(" · ");
  }

  function renderCrate() {
    const p = state.phase;
    if (p === "pick") {
      const show = MODES[state.mode].showRatings;
      const items = state.crate.filter((a) => !state.used.has(a.id)).sort((a, b) => a.name.localeCompare(b.name));
      el.crate.innerHTML = `<ul class="acts">${items.map((a) => `
        <li><button class="act ${state.selected === a ? "is-selected" : ""}" data-item="${esc(a.id)}" aria-pressed="${state.selected === a}">
          <span class="act-head"><span class="act-flag">${flag(a.cc)}</span><span class="act-name">${esc(a.name)}</span><span class="act-years">${esc(a.years)}</span></span>
          <span class="act-sub">${esc(playerMeta(a))}</span>
          ${show ? `<span class="act-ratings">${RATING_KEYS.map(([k, label]) =>
            `<span class="stat"><span class="stat-label">${label}</span><span class="stat-value">${a[k]}</span><span class="stat-bar" style="--v:${a[k]}"></span></span>`).join("")}</span>
          <span class="act-singles">Singles: ${Object.entries(SURFACES).map(([k, label]) =>
            `<span class="${k === format.surface ? "is-surface" : ""}">${label.toLowerCase()} <b>${r1(singles(a, k))}</b></span>`).join("")}</span>` : ""}
        </button></li>`).join("")}</ul>`;
      return;
    }
    if (p === "season" || p === "done") {
      const copy = format.copy;
      el.crate.innerHTML = `<ol class="results">${state.results.slice(0, state.shown).map((r, i) => `
        <li class="result ${r.won ? "is-win" : "is-loss"} ${i >= state.results.length - 3 ? "is-finale" : ""}">
          <span class="result-no">${i + 1}</span>
          <span class="result-opp">${esc(r.title)}<span class="result-sub">${esc(r.sub)}${format.kind === "cup" ? `, ${SURFACES[r.surface].toLowerCase()}` : ""}</span></span>
          <span class="result-score"><b>${r.won ? copy.win : copy.loss}</b> ${r.score}</span>
          <span class="result-lines">${r.lines.filter((x) => x.point).map((x) => `<span class="line ${x.won === null ? "is-dead" : x.won ? "is-win" : "is-loss"} ${x.stacked ? "is-stacked" : ""}"
            title="${esc(x.label)}${x.who ? `: ${esc(x.who)}` : ""}${x.stacked ? " (stacked, defaulted)" : x.won === null ? " (not needed)" : x.won ? " won" : " lost"}">${x.stacked ? "S" : x.won === null ? "·" : x.label === "Doubles point" || x.label === "Doubles" ? "D" : x.won ? "W" : "L"}</span>`).join("")}</span>
        </li>`).join("")}</ol>`;
      el.crate.lastElementChild?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
      return;
    }
    el.crate.innerHTML = "";
  }

  function renderPoster() {
    if (state.phase === "home") {
      el.poster.innerHTML = `<div class="card">
        <p class="card-top">${esc(format.tourName)}</p>
        <h2 class="card-title">${format.copy.posterTitle}</h2>
        <ol class="spots">${format.slots.map((s) => `<li class="spot is-empty"><span class="spot-name">${s.name}</span><span class="spot-player">Open</span></li>`).join("")}</ol>
        <p class="card-foot">${format.copy.footEmpty}</p></div>`;
      return;
    }
    const visible = ratingsVisible();
    const stacked = visible ? stackedLines(state.lineup) : new Set();
    const canPlace = state.phase === "pick" && state.selected;
    const spot = (s) => {
      const p = state.lineup[s.id];
      if (p) {
        const isStacked = stacked.has(s.id);
        return `<li class="spot is-filled ${isStacked ? "is-stacked" : ""}"><span class="spot-name">${s.name}</span>
          <span class="spot-player">${flag(p.cc)} ${esc(p.name)}</span>
          ${visible ? `<span class="spot-score">${isStacked ? "Stacked" : r1(singles(p))}</span>` : ""}</li>`;
      }
      if (canPlace) {
        const bad = visible ? stackingIfPlaced(s.id) : [];
        return `<li class="spot is-open"><button class="place ${bad.length ? "is-bad" : ""}" data-slot="${s.id}">
          <span class="spot-name">${s.name}</span><span class="spot-player">Put ${esc(lineName(state.selected))} here</span>
          ${bad.length ? `<span class="spot-score">Stacks ${bad.map((id) => format.slots.find((x) => x.id === id).name.replace(" singles", "")).join(", ")}</span>` : ""}</button></li>`;
      }
      return `<li class="spot is-empty"><span class="spot-name">${s.name}</span><span class="spot-player">Open</span></li>`;
    };
    const groups = pairs().map(([a, b], i) => {
      const pa = state.lineup[a], pb = state.lineup[b];
      const tag = format.kind === "dual" ? `Doubles ${i + 1}` : "Pair";
      return `<li class="pair"><ol class="spots">${spot(format.slots.find((s) => s.id === a))}${spot(format.slots.find((s) => s.id === b))}</ol>
        <span class="pair-tag">${tag}${visible && pa && pb ? `<b>${r1(pairRating(pa, pb))}</b>` : ""}</span></li>`;
    });
    const singlesOnly = format.slots.filter((s) => !pairs().flat().includes(s.id));
    el.poster.innerHTML = `<div class="card">
      <p class="card-top">${esc(format.tourName)}${format.kind === "cup" ? `, ${SURFACES[format.surface].toLowerCase()} at home` : ""}</p>
      <h2 class="card-title">${format.copy.posterTitle}</h2>
      ${singlesOnly.length ? `<ol class="spots">${singlesOnly.map(spot).join("")}</ol>` : ""}
      <ol class="pairs">${groups.join("")}</ol>
      <p class="card-foot">${state.phase === "pick" && !state.selected ? "Pick a player first." : format.kind === "dual" ? format.copy.surfaceNote : ""}</p></div>`;
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    if (btn.dataset.choose) { setChoice({ [btn.dataset.choose]: btn.dataset.value }); return; }
    if (btn.dataset.mode) { startGame(btn.dataset.mode); return; }
    if (btn.dataset.item) { selectItem(btn.dataset.item); return; }
    if (btn.dataset.slot) { placeItem(btn.dataset.slot); return; }
    switch (btn.dataset.action) {
      case "spin": spin(false); break;
      case "respin": spin(true); break;
      case "season": playSeason(); break;
      case "skip": finishSeason(); break;
      case "share":
        navigator.clipboard?.writeText(shareText()).then(() => { btn.textContent = "Copied"; setTimeout(() => (btn.textContent = "Copy result"), 1500); }).catch(() => {});
        break;
      case "home": clearInterval(state.timer); state = { phase: "home" }; setLabel("Six", "Love"); render(); break;
    }
  });

  render();
})();
