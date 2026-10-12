/* Unpuzzling Words — game logic
   Model: an N×N board holding 60 letter tiles and 4 empty spaces.
   Controls are letter-first: a cursor sits on a tile. Arrow keys move the cursor across tiles;
   pressing toward an empty space slides the cursor's tile into it. Typing a letter jumps the
   cursor to the next tile with that letter; Tab cycles through tiles that can move right now. */

(() => {
  "use strict";

  const THEMES = window.UW_THEMES;
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board");
  const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  const KEY_DIRS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

  /* ---------- persistence (per-browser conveniences only) ---------- */
  const SETTINGS_KEY = "uw.settings";
  const settings = Object.assign({ hints: true, sound: true }, readJSON(SETTINGS_KEY) || {});
  function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function writeJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage unavailable */ } }
  const saveSettings = () => writeJSON(SETTINGS_KEY, settings);
  const bestFor = (id) => readJSON("uw.best." + id) || {};
  const saveBest = (id, b) => writeJSON("uw.best." + id, b);

  /* ---------- state ---------- */
  let theme, N, tiles, gaps, tileAt, gapAt, cursor;
  let moves, history, startedAt, elapsed, timerId, won, found, foundCells;
  let pendingNew = 0, toastTimer = 0;
  let lastMoveAt = 0, paused = false;
  const IDLE_MS = 30000; // timer pauses after this long without a move

  const rc = (idx) => [Math.floor(idx / N), idx % N];
  const idxOf = (r, c) => r * N + c;
  const inBounds = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

  /* ---------- setup ---------- */
  function newGame(opts) {
    const restore = opts && opts.letters ? opts : null;
    const themeId = opts && opts.theme ? opts.theme : (theme ? theme.id : "coffee");
    theme = THEMES.find((t) => t.id === themeId && t.available) || THEMES[0];
    N = theme.size;
    const total = N * N;
    if (theme.tiles.length !== total - theme.gaps) {
      console.warn("Theme tile count mismatch", theme.id, theme.tiles.length, total - theme.gaps);
    }

    let letters;
    if (restore) {
      letters = restore.letters;
    } else {
      // Fully random shuffle. With four empty spaces every arrangement is reachable,
      // so any shuffle is solvable. Reject shuffles that already spell 2+ words.
      for (let attempt = 0; attempt < 100; attempt++) {
        letters = (theme.tiles + "\0".repeat(theme.gaps)).split("");
        for (let i = letters.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [letters[i], letters[j]] = [letters[j], letters[i]];
        }
        letters = letters.map((ch) => (ch === "\0" ? null : ch));
        if (countWords(letters) < 2) break;
      }
    }

    tiles = []; gaps = []; tileAt = new Array(total).fill(null); gapAt = new Array(total).fill(null);
    boardEl.innerHTML = "";
    boardEl.style.setProperty("--n", N);

    letters.forEach((ch, idx) => {
      if (ch === null) {
        const gap = { idx, el: document.createElement("div") };
        gap.el.className = "cell gap";
        gap.el.innerHTML = `<div class="well"></div>`;
        gap.el.addEventListener("click", () => onGapClick(gap));
        gaps.push(gap); gapAt[idx] = gap; boardEl.appendChild(gap.el);
      } else {
        const tile = { id: tiles.length, letter: ch, idx, el: document.createElement("div") };
        tile.el.className = "cell tile";
        tile.el.innerHTML = `<div class="face">${ch}</div>`;
        tile.el.addEventListener("click", () => onTileClick(tile));
        tiles.push(tile); tileAt[idx] = tile; boardEl.appendChild(tile.el);
      }
    });

    moves = restore ? restore.moves : 0;
    history = []; // undo history does not survive a reload (tile ids are reassigned)
    elapsed = restore ? restore.elapsed : 0;
    startedAt = restore && restore.running ? Date.now() - elapsed : 0;
    won = restore ? restore.won : false;
    clearInterval(timerId); timerId = 0;
    paused = false; lastMoveAt = Date.now(); setPausedUI(false);
    if (startedAt) timerId = setInterval(tick, 250);

    tiles.forEach(place); gaps.forEach(place);
    cursor = null;
    const startTile = (restore && restore.cursor != null && tileAt[restore.cursor]) || movableTiles()[0] || tiles[0];
    setCursor(startTile);
    buildWordList();
    renderBest();
    update();
    renderTime();
  }

  function place(obj) {
    const [r, c] = rc(obj.idx);
    obj.el.style.setProperty("--r", r);
    obj.el.style.setProperty("--c", c);
  }

  function buildWordList() {
    const ul = $("wordlist");
    ul.innerHTML = "";
    theme.words.forEach((w) => {
      const li = document.createElement("li");
      li.textContent = w; li.dataset.word = w; ul.appendChild(li);
    });
  }

  /* ---------- word detection ---------- */
  function lines(letters) {
    const out = [];
    for (let r = 0; r < N; r++) {
      let s = "", ix = [];
      for (let c = 0; c < N; c++) { const i = idxOf(r, c); s += letters[i] || "."; ix.push(i); }
      out.push({ s, ix });
    }
    for (let c = 0; c < N; c++) {
      let s = "", ix = [];
      for (let r = 0; r < N; r++) { const i = idxOf(r, c); s += letters[i] || "."; ix.push(i); }
      out.push({ s, ix });
    }
    return out;
  }
  function scan(letters) {
    const f = new Set(), cellsLit = new Set();
    // Words count in all four directions: each row and column is scanned forward and reversed.
    const L = lines(letters);
    const all = L.concat(L.map((ln) => ({ s: ln.s.split("").reverse().join(""), ix: ln.ix.slice().reverse() })));
    for (const w of theme.words) {
      for (const ln of all) {
        let p = ln.s.indexOf(w);
        while (p >= 0) {
          f.add(w);
          for (let i = 0; i < w.length; i++) cellsLit.add(ln.ix[p + i]);
          p = ln.s.indexOf(w, p + 1);
        }
      }
    }
    return { found: f, cells: cellsLit };
  }
  function countWords(letters) { return scan(letters).found.size; }
  const currentLetters = () => tileAt.map((t) => (t ? t.letter : null));

  /* ---------- neighbors ---------- */
  function neighborGaps(tile) {
    const [r, c] = rc(tile.idx), out = [];
    for (const [dr, dc] of Object.values(DIRS)) {
      if (inBounds(r + dr, c + dc)) { const g = gapAt[idxOf(r + dr, c + dc)]; if (g) out.push(g); }
    }
    return out;
  }
  const movableTiles = () => tiles.filter((t) => neighborGaps(t).length).sort((a, b) => a.idx - b.idx);

  /* ---------- cursor ---------- */
  function setCursor(tile) {
    if (!tile) return;
    if (cursor) cursor.el.classList.remove("cursor");
    cursor = tile;
    cursor.el.classList.add("cursor");
    markTargets();
  }
  function markTargets() {
    const targets = cursor ? neighborGaps(cursor) : [];
    gaps.forEach((g) => g.el.classList.toggle("target", targets.includes(g)));
  }

  /* Arrow: slide the cursor's tile if that way is empty, otherwise walk the cursor to the next tile. */
  function arrow(dir, walkOnly) {
    const [dr, dc] = DIRS[dir];
    let [r, c] = rc(cursor.idx);
    r += dr; c += dc;
    if (!inBounds(r, c)) { bump(cursor.el, dr, dc); return; }
    const gap = gapAt[idxOf(r, c)];
    if (gap && !walkOnly) { slide(cursor, gap); return; }
    // walk: skip over empty cells until a tile is found
    while (inBounds(r, c)) {
      const t = tileAt[idxOf(r, c)];
      if (t) { setCursor(t); sound.tick(); return; }
      r += dr; c += dc;
    }
    bump(cursor.el, dr, dc);
  }

  /* Tab: next tile that can move right now, in reading order. */
  function cycleMovable(step) {
    const list = movableTiles();
    if (!list.length) return;
    let i = list.indexOf(cursor);
    if (i < 0) { i = list.findIndex((t) => t.idx > cursor.idx); if (i < 0) i = 0; if (step < 0) i -= 1; }
    else i += step;
    setCursor(list[(i + list.length) % list.length]);
    sound.tick();
  }

  /* Letter key: next tile with that letter after the cursor, wrapping. */
  function jumpToLetter(ch) {
    const list = tiles.filter((t) => t.letter === ch).sort((a, b) => a.idx - b.idx);
    if (!list.length) { bump(cursor.el, 0, 0); return; }
    const next = list.find((t) => t.idx > cursor.idx) || list[0];
    setCursor(next);
    sound.tick();
  }

  /* ---------- moves ---------- */
  function slide(tile, gap) {
    const from = tile.idx, to = gap.idx;
    tileAt[to] = tile; tileAt[from] = null;
    gapAt[from] = gap; gapAt[to] = null;
    tile.idx = to; gap.idx = from;
    place(tile); place(gap);
    history.push({ t: tile.id, from, to });
    moves++;
    noteMove();
    sound.slide();
    setCursor(tile);
    update();
  }

  function undo() {
    const m = history.pop();
    if (!m) { toast("Nothing to undo"); return; }
    const tile = tiles[m.t];
    const gap = gapAt[m.from];
    tileAt[m.from] = tile; tileAt[m.to] = null;
    gapAt[m.to] = gap; gapAt[m.from] = null;
    tile.idx = m.from; gap.idx = m.to;
    place(tile); place(gap);
    moves = Math.max(0, moves - 1);
    noteMove();
    sound.slide();
    setCursor(tile);
    update();
  }

  function onTileClick(tile) {
    const adjacent = neighborGaps(tile);
    if (!adjacent.length) { setCursor(tile); focusBoard(); return; }
    slide(tile, adjacent[0]);
    focusBoard();
  }
  function onGapClick(gap) {
    // Clicking an empty space next to the cursor's tile slides the tile there.
    if (cursor && neighborGaps(cursor).includes(gap)) slide(cursor, gap);
    focusBoard();
  }

  function bump(el, dr, dc) {
    el.style.setProperty("--bx", `${dc * 10}%`);
    el.style.setProperty("--by", `${dr * 10}%`);
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    sound.thud();
  }

  /* ---------- render ---------- */
  function update() {
    const letters = currentLetters();
    const prev = found || new Set();
    const res = scan(letters);
    found = res.found; foundCells = res.cells;

    tiles.forEach((t) => {
      t.el.classList.toggle("lit", foundCells.has(t.idx));
      t.el.classList.toggle("movable", neighborGaps(t).length > 0);
    });
    markTargets();
    $("wordlist").querySelectorAll("li").forEach((li) => li.classList.toggle("done", found.has(li.dataset.word)));
    $("stat-words").textContent = `${found.size} / ${theme.words.length}`;
    $("stat-moves").textContent = moves;
    $("btn-undo").disabled = history.length === 0;

    let newlySpelled = 0;
    found.forEach((w) => { if (!prev.has(w)) newlySpelled++; });
    if (newlySpelled && moves > 0) sound.word();

    if (!won && found.size === theme.words.length) win();
  }

  /* Timer: starts on the first move, pauses after IDLE_MS without a move, resumes on the next move.
     Idle time beyond the 30-second grace period does not count. */
  function noteMove() {
    const now = Date.now();
    if (won) return;
    if (!startedAt) { startedAt = now; timerId = setInterval(tick, 250); }
    else if (paused) { paused = false; startedAt = now - elapsed; setPausedUI(false); }
    lastMoveAt = now;
  }
  function tick() {
    if (!startedAt || paused) return;
    const now = Date.now();
    if (now - lastMoveAt > IDLE_MS) {
      paused = true;
      elapsed = lastMoveAt + IDLE_MS - startedAt;
      renderTime();
      setPausedUI(true);
      toast("Timer paused. It picks back up on your next move.", 3500);
      return;
    }
    elapsed = now - startedAt;
    renderTime();
  }
  function setPausedUI(on) {
    $("stat-time-wrap").classList.toggle("paused", on);
    $("stat-time-label").textContent = on ? "Paused" : "Time";
    boardEl.classList.toggle("paused", on);
  }
  const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  function renderTime() { $("stat-time").textContent = fmt(elapsed); }
  function renderBest() {
    const b = bestFor(theme.id);
    const txt = b.moves ? `${b.moves} · ${fmt(b.ms)}` : "—";
    $("stat-best").textContent = txt; $("win-best").textContent = txt;
  }

  function toast(msg, ms = 2200) {
    const el = $("toast"); el.textContent = msg;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.textContent = ""; }, ms);
  }

  /* ---------- win ---------- */
  function win() {
    won = true;
    clearInterval(timerId); timerId = 0;
    if (startedAt && !paused) elapsed = Date.now() - startedAt;
    paused = false; setPausedUI(false);
    renderTime();
    const b = bestFor(theme.id);
    const notes = [];
    if (!b.moves || moves < b.moves) { b.moves = moves; notes.push("fewest moves"); }
    if (!b.ms || elapsed < b.ms) { b.ms = elapsed; notes.push("fastest time"); }
    saveBest(theme.id, b);
    renderBest();
    $("win-moves").textContent = moves;
    $("win-time").textContent = fmt(elapsed);
    $("win-note").textContent = notes.length ? `New personal best: ${notes.join(" and ")}.` : "";
    sound.win();
    $("win").hidden = false;
    confetti();
  }

  function shareText() {
    return `${theme.emoji || ""} Unpuzzling Words · ${theme.name}\nAll ${theme.words.length} words in ${moves} moves · ${fmt(elapsed)}\n${location.href.split("#")[0]}`;
  }
  async function share() {
    const text = shareText();
    const btn = $("btn-share");
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied!";
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); btn.textContent = "Copied!"; } catch (e2) { btn.textContent = "Select & copy below"; }
      document.body.removeChild(ta);
      $("win-note").textContent = text;
    }
    setTimeout(() => { btn.textContent = "Copy result"; }, 1800);
  }

  function confetti() {
    const cv = $("confetti");
    const ctx = cv.getContext("2d");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const W = cv.width = cv.offsetWidth, H = cv.height = cv.offsetHeight;
    const colors = ["#f1c75b", "#fff0c2", "#b8860b", "#efe2cc", "#8a5a0a"];
    const ps = Array.from({ length: 170 }, () => ({
      x: Math.random() * W, y: -20 - Math.random() * H * 0.6,
      w: 6 + Math.random() * 8, h: 4 + Math.random() * 6,
      vx: (Math.random() - 0.5) * 1.6, vy: 2 + Math.random() * 3.2,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.2,
      color: colors[Math.floor(Math.random() * colors.length)]
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vx += Math.sin(t / 300 + p.y / 50) * 0.02;
        if (p.y < H + 20) alive = true;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      if (alive && t - t0 < 6000 && !$("win").hidden) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    })(t0);
  }

  /* ---------- sound (tiny synthesized cues, no files) ----------
     Browsers keep audio suspended until the page gets a real user gesture, so the engine is
     unlocked on the first pointer/key event (capture phase, before any game handler runs).
     Every cue waits for the context to be running, so nothing is scheduled into a dead engine. */
  const sound = (() => {
    let ac = null, master = null;
    function ensure() {
      if (ac) return ac;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
      } catch (e) { ac = null; }
      return ac;
    }
    function unlock() {
      const a = ensure(); if (!a) return;
      if (a.state !== "running") {
        a.resume().catch(() => {});
        // iOS needs an actual (silent) buffer played inside the gesture
        try { const b = a.createBuffer(1, 1, a.sampleRate), s = a.createBufferSource(); s.buffer = b; s.connect(a.destination); s.start(0); } catch (e) { /* ignore */ }
      }
    }
    ["pointerdown", "keydown", "touchend"].forEach((ev) => document.addEventListener(ev, unlock, { capture: true, passive: true }));

    // run fn with a live context; if the engine is still waking up, run it once it is
    function withCtx(fn) {
      if (!settings.sound) return;
      const a = ensure(); if (!a) return;
      if (a.state === "running") { fn(a); return; }
      a.resume().then(() => { if (a.state === "running") fn(a); }).catch(() => {});
    }
    const tone = (a, f, t0, dur, type = "sine", gain = 0.12) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(master); o.start(t0); o.stop(t0 + dur + 0.03);
    };
    return {
      state: () => (ac ? ac.state : "not created"),
      slide() { withCtx((a) => {
        // a short filtered noise burst: a tile sliding on wood
        const n = Math.floor(a.sampleRate * 0.07), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
        const src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
        src.buffer = buf; bp.type = "bandpass"; bp.frequency.value = 800; bp.Q.value = 0.7; g.gain.value = 0.6;
        src.connect(bp).connect(g).connect(master); src.start();
        tone(a, 180, a.currentTime, 0.05, "triangle", 0.08); // soft knock underneath
      }); },
      tick() { withCtx((a) => tone(a, 1300, a.currentTime, 0.035, "square", 0.025)); },
      thud() { withCtx((a) => tone(a, 100, a.currentTime, 0.09, "triangle", 0.08)); },
      word() { withCtx((a) => { const t = a.currentTime; tone(a, 659, t, 0.2, "sine", 0.14); tone(a, 988, t + 0.1, 0.3, "sine", 0.14); }); },
      win() { withCtx((a) => { const t = a.currentTime; [523, 659, 784, 1047, 1319].forEach((f, i) => tone(a, f, t + i * 0.11, 0.5, "sine", 0.12)); }); },
      confirm() { withCtx((a) => { const t = a.currentTime; tone(a, 784, t, 0.12, "sine", 0.12); tone(a, 1175, t + 0.08, 0.18, "sine", 0.12); }); }
    };
  })();

  /* ---------- ui wiring ---------- */
  function focusBoard() { boardEl.focus({ preventScroll: true }); }
  function requestNew(viaKey) {
    const now = Date.now();
    if (now - pendingNew < 2500) { pendingNew = 0; $("win").hidden = true; newGame(); toast("New puzzle. Good luck."); focusBoard(); return; }
    pendingNew = now;
    toast(viaKey ? "Press Enter again to start a new puzzle" : "Click again to start a new puzzle");
  }
  function applyHints() {
    document.body.classList.toggle("hints", settings.hints);
    $("hints-label").textContent = settings.hints ? "Hints on" : "Hints off";
    $("btn-hints").classList.toggle("on", settings.hints);
    $("set-hints").checked = settings.hints;
  }
  function applySound() {
    $("sound-label").textContent = settings.sound ? "Sound on" : "Sound off";
    $("btn-sound").classList.toggle("on", settings.sound);
    $("set-sound").checked = settings.sound;
  }
  function openHelp() { $("help").hidden = false; $("help-close").focus(); }
  function closeOverlays() { $("help").hidden = true; $("win").hidden = true; focusBoard(); }

  $("btn-undo").addEventListener("click", () => { undo(); focusBoard(); });
  $("btn-hints").addEventListener("click", () => { settings.hints = !settings.hints; saveSettings(); applyHints(); focusBoard(); });
  $("btn-sound").addEventListener("click", () => { settings.sound = !settings.sound; saveSettings(); applySound(); if (settings.sound) sound.confirm(); focusBoard(); });
  $("btn-new").addEventListener("click", () => requestNew(false));
  $("btn-help").addEventListener("click", openHelp);
  $("help-close").addEventListener("click", closeOverlays);
  $("btn-again").addEventListener("click", () => { pendingNew = Date.now(); requestNew(false); });
  $("btn-admire").addEventListener("click", closeOverlays);
  $("btn-share").addEventListener("click", share);
  $("set-hints").addEventListener("change", (e) => { settings.hints = e.target.checked; saveSettings(); applyHints(); });
  $("set-sound").addEventListener("change", (e) => { settings.sound = e.target.checked; saveSettings(); applySound(); if (settings.sound) sound.confirm(); });
  [$("help"), $("win")].forEach((ov) => ov.addEventListener("click", (e) => { if (e.target === ov) closeOverlays(); }));
  boardEl.addEventListener("focus", () => boardEl.classList.add("focused"));
  boardEl.addEventListener("blur", () => boardEl.classList.remove("focused"));

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "select" || tag === "textarea";
    const helpOpen = !$("help").hidden, winOpen = !$("win").hidden;

    if (e.key === "Escape") { if (helpOpen || winOpen) closeOverlays(); else if (pendingNew) { pendingNew = 0; toast(""); } return; }
    if (e.key === "?" || e.key === "F1") { e.preventDefault(); helpOpen ? closeOverlays() : openHelp(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing && !helpOpen && !winOpen) { e.preventDefault(); undo(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (helpOpen) return;
    if (winOpen) {
      if (e.key === "Enter") { e.preventDefault(); pendingNew = Date.now(); requestNew(true); }
      return;
    }

    const onBoard = e.target === document.body || e.target === boardEl || e.target === document.documentElement;
    const dir = KEY_DIRS[e.key];
    if (dir) { e.preventDefault(); arrow(dir, e.shiftKey); return; }
    if (e.key === "Tab" && onBoard) { e.preventDefault(); cycleMovable(e.shiftKey ? -1 : 1); return; }
    if (e.key === "Backspace") { e.preventDefault(); undo(); return; }
    if (e.key === "Enter" && onBoard) { e.preventDefault(); requestNew(true); return; }
    if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); jumpToLetter(e.key.toUpperCase()); return; }
  });

  // Theme chips
  const nav = $("theme-nav");
  THEMES.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip" + (t.id === "coffee" ? " active" : "");
    b.textContent = t.name; b.disabled = !t.available;
    if (t.available) b.addEventListener("click", () => { newGame({ theme: t.id }); nav.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === b)); focusBoard(); });
    nav.appendChild(b);
  });
  $("year").textContent = new Date().getFullYear();

  // Debug/test hook: load a specific layout (64 chars, "." = empty). Used by automated tests.
  window.UW_DEBUG = {
    load(str) {
      const letters = str.split("").map((ch) => (ch === "." ? null : ch));
      newGame({ theme: theme.id, letters, moves: 0, history: [], elapsed: 0, running: false, won: false });
    },
    state: () => ({ moves, found: [...found], won, cursor: cursor ? { idx: cursor.idx, letter: cursor.letter } : null, audio: sound.state(), soundOn: settings.sound })
  };

  // Hot reload (artifact viewer only): keep the board when the page is republished.
  const snapshot = () => ({
    theme: theme.id, letters: currentLetters(), cursor: cursor ? cursor.idx : null,
    moves, history, elapsed: startedAt ? Date.now() - startedAt : elapsed, running: !!startedAt && !won, won
  });
  const start = (data) => {
    applyHints(); applySound();
    if (data && data.letters && data.letters.length === 64) newGame(data); else newGame();
    focusBoard();
  };
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(snapshot);
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || null);
})();
