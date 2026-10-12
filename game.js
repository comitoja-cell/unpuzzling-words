/* Unpuzzling Words — game logic
   Model: an N×N board holding 60 letter tiles and 4 empty spaces ("gaps").
   The four gaps are persistent objects (numbered 1–4) so the player can jump to them by key.
   Every legal move is "a tile adjacent to a gap slides into it", so steering a gap with the
   arrow keys covers every possible move with one keystroke. */

(() => {
  "use strict";

  const THEMES = window.UW_THEMES;
  const $ = (id) => document.getElementById(id);
  const boardEl = $("board");
  const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  const KEY_DIRS = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right", W: "up", S: "down", A: "left", D: "right"
  };

  /* ---------- persistence (per-browser conveniences only) ---------- */
  const SETTINGS_KEY = "uw.settings";
  const settings = Object.assign({ direction: "gap", hints: true, sound: true }, readJSON(SETTINGS_KEY) || {});
  function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function writeJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage unavailable */ } }
  const saveSettings = () => writeJSON(SETTINGS_KEY, settings);
  const bestFor = (id) => readJSON("uw.best." + id) || {};
  const saveBest = (id, b) => writeJSON("uw.best." + id, b);

  /* ---------- state ---------- */
  let theme, N, tiles, gaps, tileAt, gapAt, activeGap;
  let moves, history, startedAt, elapsed, timerId, won, found, foundCells;
  let pendingNew = 0, toastTimer = 0;

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

    let gapNo = 0;
    letters.forEach((ch, idx) => {
      if (ch === null) {
        const gap = { id: ++gapNo, idx, el: document.createElement("div") };
        gap.el.className = "cell gap";
        gap.el.innerHTML = `<div class="well">${gap.id}</div>`;
        gap.el.addEventListener("click", () => { setActive(gap); focusBoard(); });
        gaps.push(gap); gapAt[idx] = gap; boardEl.appendChild(gap.el);
      } else {
        const tile = { id: tiles.length, letter: ch, idx, el: document.createElement("div") };
        tile.el.className = "cell tile";
        tile.el.innerHTML = `<div class="face">${ch}</div>`;
        tile.el.addEventListener("click", () => onTileClick(tile));
        tiles.push(tile); tileAt[idx] = tile; boardEl.appendChild(tile.el);
      }
    });
    if (restore && restore.gapIdx) {
      // keep gap numbering stable across a hot reload
      gaps.forEach((g, i) => { g.idx = restore.gapIdx[i]; gapAt[g.idx] = g; });
    }

    moves = restore ? restore.moves : 0;
    history = restore ? restore.history : [];
    elapsed = restore ? restore.elapsed : 0;
    startedAt = restore && restore.running ? Date.now() - elapsed : 0;
    won = restore ? restore.won : false;
    clearInterval(timerId); timerId = 0;
    if (startedAt) timerId = setInterval(tick, 250);

    tiles.forEach(place); gaps.forEach(place);
    setActive(gaps[restore ? restore.active : 0]);
    buildWordList();
    renderBest();
    update();
    renderTime();
    $("wm-theme").textContent = `(${theme.name})`;
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
    const L = lines(letters);
    for (const w of theme.words) {
      for (const ln of L) {
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

  /* ---------- moves ---------- */
  function setActive(gap) {
    if (activeGap) activeGap.el.classList.remove("active");
    activeGap = gap;
    gap.el.classList.add("active");
  }

  function tryMove(dir) {
    const [dr, dc] = DIRS[dir];
    const sign = settings.direction === "gap" ? 1 : -1;
    const [r, c] = rc(activeGap.idx);
    const tr = r + dr * sign, tc = c + dc * sign;
    const target = inBounds(tr, tc) ? tileAt[idxOf(tr, tc)] : null;
    if (!target) { bump(activeGap.el, dr * sign, dc * sign); return false; }
    slide(target, activeGap);
    return true;
  }

  function slide(tile, gap) {
    const from = gap.idx, to = tile.idx;
    tileAt[from] = tile; tileAt[to] = null;
    gapAt[to] = gap; gapAt[from] = null;
    tile.idx = from; gap.idx = to;
    place(tile); place(gap);
    history.push({ g: gap.id, from, to });
    moves++;
    if (!startedAt && !won) { startedAt = Date.now(); timerId = setInterval(tick, 250); }
    sound.slide();
    update();
  }

  function undo() {
    const m = history.pop();
    if (!m) { toast("Nothing to undo"); return; }
    const gap = gaps[m.g - 1];
    const tile = tileAt[m.from];
    tileAt[m.to] = tile; tileAt[m.from] = null;
    gapAt[m.from] = gap; gapAt[m.to] = null;
    tile.idx = m.to; gap.idx = m.from;
    place(tile); place(gap);
    moves = Math.max(0, moves - 1);
    setActive(gap);
    sound.slide();
    update();
  }

  function onTileClick(tile) {
    const [r, c] = rc(tile.idx);
    const adjacent = [];
    for (const [dr, dc] of Object.values(DIRS)) {
      if (inBounds(r + dr, c + dc)) { const g = gapAt[idxOf(r + dr, c + dc)]; if (g) adjacent.push(g); }
    }
    if (!adjacent.length) { bump(tile.el, 0, 0); focusBoard(); return; }
    const gap = adjacent.includes(activeGap) ? activeGap : adjacent[0];
    setActive(gap);
    slide(tile, gap);
    focusBoard();
  }

  function cycleGap(step) {
    const i = gaps.indexOf(activeGap);
    setActive(gaps[(i + step + gaps.length) % gaps.length]);
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
      const [r, c] = rc(t.idx);
      let movable = false;
      for (const [dr, dc] of Object.values(DIRS)) {
        if (inBounds(r + dr, c + dc) && gapAt[idxOf(r + dr, c + dc)]) { movable = true; break; }
      }
      t.el.classList.toggle("movable", movable);
    });
    $("wordlist").querySelectorAll("li").forEach((li) => li.classList.toggle("done", found.has(li.dataset.word)));
    $("stat-words").textContent = `${found.size} / ${theme.words.length}`;
    $("stat-moves").textContent = moves;
    $("btn-undo").disabled = history.length === 0;

    let newlySpelled = 0;
    found.forEach((w) => { if (!prev.has(w)) newlySpelled++; });
    if (newlySpelled && moves > 0) sound.word();

    if (!won && found.size === theme.words.length) win();
  }

  function tick() { elapsed = Date.now() - startedAt; renderTime(); }
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
    if (startedAt) elapsed = Date.now() - startedAt;
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
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
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

  /* ---------- sound (tiny synthesized cues, no files) ---------- */
  const sound = (() => {
    let ac = null;
    const ctx = () => {
      if (!settings.sound) return null;
      try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === "suspended") ac.resume(); return ac; }
      catch (e) { return null; }
    };
    const tone = (f, t0, dur, type = "sine", gain = 0.08) => {
      const a = ctx(); if (!a) return;
      const o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    };
    return {
      slide() {
        const a = ctx(); if (!a) return;
        const n = a.sampleRate * 0.06, buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
        const src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
        src.buffer = buf; bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.8; g.gain.value = 0.35;
        src.connect(bp).connect(g).connect(a.destination); src.start();
      },
      thud() { const a = ctx(); if (!a) return; tone(110, a.currentTime, 0.08, "triangle", 0.05); },
      word() { const a = ctx(); if (!a) return; const t = a.currentTime; tone(659, t, 0.18); tone(988, t + 0.09, 0.26); },
      win() {
        const a = ctx(); if (!a) return; const t = a.currentTime;
        [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.11, 0.45, "sine", 0.07));
      }
    };
  })();

  /* ---------- ui wiring ---------- */
  function focusBoard() { boardEl.focus({ preventScroll: true }); }
  function requestNew(viaKey) {
    const now = Date.now();
    if (now - pendingNew < 2500) { pendingNew = 0; $("win").hidden = true; newGame(); toast("New puzzle. Good luck."); focusBoard(); return; }
    pendingNew = now;
    toast(viaKey ? "Press N again to start a new puzzle" : "Click again to start a new puzzle");
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
  function applyDirection() {
    const gapMode = settings.direction === "gap";
    const txt = gapMode
      ? "Move the glowing empty space; the tile in its way slides over"
      : "Slide the tile next to the glowing empty space in that direction";
    $("keymap-arrows").textContent = txt;
    $("help-arrows").textContent = txt;
    $("set-direction").value = settings.direction;
  }
  function openHelp() { $("help").hidden = false; $("help-close").focus(); }
  function closeOverlays() { $("help").hidden = true; $("win").hidden = true; focusBoard(); }

  $("btn-undo").addEventListener("click", () => { undo(); focusBoard(); });
  $("btn-hints").addEventListener("click", () => { settings.hints = !settings.hints; saveSettings(); applyHints(); focusBoard(); });
  $("btn-sound").addEventListener("click", () => { settings.sound = !settings.sound; saveSettings(); applySound(); focusBoard(); });
  $("btn-new").addEventListener("click", () => requestNew(false));
  $("btn-help").addEventListener("click", openHelp);
  $("help-close").addEventListener("click", closeOverlays);
  $("btn-again").addEventListener("click", () => { pendingNew = Date.now(); requestNew(false); });
  $("btn-admire").addEventListener("click", closeOverlays);
  $("btn-share").addEventListener("click", share);
  $("set-direction").addEventListener("change", (e) => { settings.direction = e.target.value; saveSettings(); applyDirection(); });
  $("set-hints").addEventListener("change", (e) => { settings.hints = e.target.checked; saveSettings(); applyHints(); });
  $("set-sound").addEventListener("change", (e) => { settings.sound = e.target.checked; saveSettings(); applySound(); });
  [$("help"), $("win")].forEach((ov) => ov.addEventListener("click", (e) => { if (e.target === ov) closeOverlays(); }));
  boardEl.addEventListener("focus", () => boardEl.classList.add("focused"));
  boardEl.addEventListener("blur", () => boardEl.classList.remove("focused"));

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "select" || tag === "textarea";
    const helpOpen = !$("help").hidden, winOpen = !$("win").hidden;

    if (e.key === "Escape") { if (helpOpen || winOpen) closeOverlays(); else if (pendingNew) { pendingNew = 0; toast(""); } return; }
    if (e.key === "?" || (e.key === "/" && e.shiftKey)) { e.preventDefault(); helpOpen ? closeOverlays() : openHelp(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing && !helpOpen) { e.preventDefault(); undo(); }
      return;
    }
    if (helpOpen) return;
    if (winOpen) {
      if (e.key.toLowerCase() === "n" || e.key === "Enter") { e.preventDefault(); pendingNew = Date.now(); requestNew(true); }
      return;
    }

    const onBoard = e.target === document.body || e.target === boardEl || e.target === document.documentElement;
    const dir = KEY_DIRS[e.key];
    if (dir) { e.preventDefault(); tryMove(dir); return; }
    if (e.key === "Tab" && onBoard) { e.preventDefault(); cycleGap(e.shiftKey ? -1 : 1); sound.thud(); return; }
    if (e.key === " " && onBoard) { e.preventDefault(); cycleGap(1); sound.thud(); return; }
    if (/^[1-9]$/.test(e.key)) { const g = gaps[Number(e.key) - 1]; if (g) { setActive(g); sound.thud(); } return; }
    switch (e.key.toLowerCase()) {
      case "z": case "backspace": e.preventDefault(); undo(); break;
      case "l": settings.hints = !settings.hints; saveSettings(); applyHints(); toast(settings.hints ? "Hints on" : "Hints off: spelled words no longer glow"); break;
      case "m": settings.sound = !settings.sound; saveSettings(); applySound(); toast(settings.sound ? "Sound on" : "Sound off"); break;
      case "n": requestNew(true); break;
      case "h": openHelp(); break;
    }
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

  // Hot reload (artifact viewer only): keep the board when the page is republished.
  const snapshot = () => ({
    theme: theme.id, letters: currentLetters(), gapIdx: gaps.map((g) => g.idx), active: gaps.indexOf(activeGap),
    moves, history, elapsed: startedAt ? Date.now() - startedAt : elapsed, running: !!startedAt && !won, won
  });
  const start = (data) => {
    applyHints(); applySound(); applyDirection();
    if (data && data.letters && data.letters.length === 64) newGame(data); else newGame();
    focusBoard();
  };
  // Debug/test hook: load a specific layout (64 chars, "." = empty). Used by automated tests.
  window.UW_DEBUG = {
    load(str) {
      const letters = str.split("").map((ch) => (ch === "." ? null : ch));
      newGame({ theme: theme.id, letters, moves: 0, history: [], elapsed: 0, running: false, won: false, active: 0 });
    },
    state: () => ({ moves, found: [...found], won })
  };

  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(snapshot);
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || null);
})();
