const API_URL = "https://script.google.com/macros/s/AKfycbzCQlmmlew67oXyr_INjKX-0qbfFm8tQPGIP7eSvpUPlAOs3NzEVAzILBplzfruODSp/exec";

// MUSS mit TOKEN in Code.gs übereinstimmen:
const API_TOKEN = "CITYBULLS-SECRET-12345";

const THEME_KEY = "forderungsapp_theme";
const COOLDOWN_MATCHDAYS = 2;
const POLL_INTERVAL_MS = 5000;

const DEFAULT_PLAYERS = [
  "Timo","Günther","Oliver Gielen","Ali Dursun","Daniel Düse","Ingo Dziuk",
  "Manuel","Vasili","Jimmy","Manfred","Mario"
];

let state = {
  version: 0,
  matchday: 1,
  players: [...DEFAULT_PLAYERS],
  locks: [],
  preseasonActive: true,
  preseasonGames: [],
  history: [],
  activePlayer: DEFAULT_PLAYERS[0]
};

let pollTimer = null;
let isPolling = false;

// ---------- UI ----------
function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
}

function cleanupLocks() {
  state.locks = state.locks.filter(l => state.matchday < l.until);
}

function isLocked(challenger, target) {
  return state.locks.some(l => l.challenger === challenger && l.target === target && state.matchday < l.until);
}

function addLock(challenger, target) {
  state.locks = state.locks.filter(l => !(l.challenger === challenger && l.target === target));
  state.locks.push({ challenger, target, until: state.matchday + COOLDOWN_MATCHDAYS + 1 });
}

function bumpVersion() {
  state.version = Date.now();
}

// ---------- Theme ----------
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = theme === "light" ? "☀️ Light" : "🌙 Dark";
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === "light" ? "light" : "dark");
  const toggle = document.getElementById("themeToggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
      applyTheme(current === "light" ? "dark" : "light");
    });
  }
}

// ---------- JSONP helper ----------
function jsonpRequest(url) {
  return new Promise((resolve, reject) => {
    const cbName = "cb_" + Math.random().toString(36).slice(2);
    const fullUrl = url + (url.includes("?") ? "&" : "?") + "callback=" + cbName;

    const script = document.createElement("script");
    script.src = fullUrl;
    script.async = true;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("JSONP timeout"));
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP load error"));
    };

    document.body.appendChild(script);
  });
}

// ---------- API via JSONP ----------
async function apiLoad() {
  const data = await jsonpRequest(`${API_URL}?action=load`);
  if (!data || data.ok !== true) throw new Error(data?.error || "LOAD failed");
  return JSON.parse(data.state || "{}");
}

async function apiSave(stateObj) {
  const payload = encodeURIComponent(JSON.stringify(stateObj));
  const data = await jsonpRequest(`${API_URL}?action=save&token=${encodeURIComponent(API_TOKEN)}&state=${payload}`);
  if (!data || data.ok !== true) throw new Error(data?.error || "SAVE failed");
  return true;
}

function normalize(remote) {
  if (!remote || typeof remote !== "object") remote = {};
  remote.players = Array.isArray(remote.players) && remote.players.length ? remote.players : [...DEFAULT_PLAYERS];
  remote.locks = Array.isArray(remote.locks) ? remote.locks : [];
  remote.preseasonGames = Array.isArray(remote.preseasonGames) ? remote.preseasonGames : [];
  remote.history = Array.isArray(remote.history) ? remote.history : [];
  remote.matchday = typeof remote.matchday === "number" ? remote.matchday : 1;
  remote.preseasonActive = typeof remote.preseasonActive === "boolean" ? remote.preseasonActive : true;
  remote.activePlayer = (typeof remote.activePlayer === "string" && remote.players.includes(remote.activePlayer))
    ? remote.activePlayer : remote.players[0];
  remote.version = typeof remote.version === "number" ? remote.version : 0;
  return remote;
}

// ---------- Preseason ranking ----------
function computePreseasonRanking() {
  const stats = new Map();
  DEFAULT_PLAYERS.forEach(p => stats.set(p, { name: p, wins: 0, legDiff: 0 }));

  for (const g of state.preseasonGames) {
    const A = stats.get(g.a);
    const B = stats.get(g.b);
    if (!A || !B) continue;
    A.legDiff += (g.legsA - g.legsB);
    B.legDiff += (g.legsB - g.legsA);
    if (g.legsA > g.legsB) A.wins++;
    else B.wins++;
  }

  return [...stats.values()].sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    if (y.legDiff !== x.legDiff) return y.legDiff - x.legDiff;
    return x.name.localeCompare(y.name);
  }).map(s => s.name);
}

// ---------- Render ----------
function render() {
  cleanupLocks();
  const md = document.getElementById("matchdayInfo");
  if (md) md.textContent = `Aktueller Spieltag: ${state.matchday}`;
  renderRanking();
  renderLocks();
  renderPreseason();
  renderHistory();
}

function renderRanking() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  const table = document.createElement("table");
  const header = document.createElement("tr");
  header.innerHTML = `<th>Platz</th><th>Spieler</th><th>Aktion</th>`;
  table.appendChild(header);

  state.players.forEach((name, i) => {
    const tr = document.createElement("tr");
    if (name === state.activePlayer) tr.classList.add("activeRow");

    tr.style.cursor = "pointer";
    tr.addEventListener("click", (e) => {
      if (e.target && e.target.tagName === "BUTTON") return;
      state.activePlayer = name;
      bumpVersion();
      saveShared();
      render();
    });

    const rankCell = document.createElement("td");
    rankCell.textContent = String(i + 1);

    const nameCell = document.createElement("td");
    nameCell.innerHTML = (i === 0)
      ? `<span class="bullIcon"><span class="emoji">🐂</span> ${name}</span>`
      : name;

    const actionCell = document.createElement("td");
    if (i === 0) {
      actionCell.textContent = "–";
    } else {
      const btn = document.createElement("button");
      btn.textContent = `Fordere Platz ${i}`;
      btn.addEventListener("click", () => challenge(i));
      actionCell.appendChild(btn);

      const target = state.players[i - 1];
      if (isLocked(name, target)) {
        const lock = state.locks.find(l => l.challenger === name && l.target === target);
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = `gesperrt bis Spieltag ${lock.until - 1}`;
        actionCell.appendChild(badge);
      }
    }

    tr.appendChild(rankCell);
    tr.appendChild(nameCell);
    tr.appendChild(actionCell);
    table.appendChild(tr);
  });

  app.appendChild(table);
}

function renderLocks() {
  const el = document.getElementById("locks");
  el.innerHTML = "";
  if (state.locks.length === 0) {
    el.innerHTML = `<div class="small">Keine aktiven Sperren.</div>`;
    return;
  }
  const ul = document.createElement("ul");
  state.locks.forEach(l => {
    const li = document.createElement("li");
    li.textContent = `${l.challenger} darf ${l.target} nicht fordern bis Spieltag ${l.until - 1}`;
    ul.appendChild(li);
  });
  el.appendChild(ul);
}

function renderPreseason() {
  const root = document.getElementById("preseason");
  root.innerHTML = "";

  const info = document.createElement("div");
  info.className = "small";
  info.textContent = state.preseasonActive
    ? "Preseason aktiv: Spiele eintragen → Preseason beenden → Start-Rangliste wird berechnet."
    : "Preseason beendet: Saison läuft.";
  root.appendChild(info);

  if (!state.preseasonActive) return;

  const form = document.createElement("div");
  form.style.display = "flex";
  form.style.gap = "10px";
  form.style.flexWrap = "wrap";
  form.style.alignItems = "center";
  form.style.marginTop = "10px";

  const selA = document.createElement("select");
  const selB = document.createElement("select");
  DEFAULT_PLAYERS.forEach(p => {
    const o1 = document.createElement("option"); o1.value = p; o1.textContent = p; selA.appendChild(o1);
    const o2 = document.createElement("option"); o2.value = p; o2.textContent = p; selB.appendChild(o2);
  });
  selB.selectedIndex = 1;

  const inpA = document.createElement("input"); inpA.type = "number"; inpA.min = "0"; inpA.placeholder = "Legs A"; inpA.style.width = "90px";
  const inpB = document.createElement("input"); inpB.type = "number"; inpB.min = "0"; inpB.placeholder = "Legs B"; inpB.style.width = "90px";

  const btnAdd = document.createElement("button");
  btnAdd.textContent = "Preseason-Spiel hinzufügen";
  btnAdd.addEventListener("click", () => {
    const a = selA.value, b = selB.value;
    const legsA = parseInt(inpA.value, 10), legsB = parseInt(inpB.value, 10);

    if (a === b) { setStatus("❌ Preseason: Spieler müssen verschieden sein."); return; }
    if (Number.isNaN(legsA) || Number.isNaN(legsB) || legsA === legsB) { setStatus("❌ Preseason: Zahlen, kein Unentschieden."); return; }

    state.preseasonGames.push({ a, b, legsA, legsB, ts: Date.now() });
    inpA.value = ""; inpB.value = "";
    bumpVersion();
    saveShared();
    render();
    setStatus(`✅ Preseason: ${a} ${legsA}:${legsB} ${b}`);
  });

  const btnFinish = document.createElement("button");
  btnFinish.textContent = "Preseason beenden";
  btnFinish.addEventListener("click", () => {
    if (state.preseasonGames.length < 10) {
      if (!confirm("Wenig Spiele. Trotzdem beenden?")) return;
    }
    state.players = computePreseasonRanking();
    state.preseasonActive = false;
    state.matchday = 1;
    state.locks = [];
    state.history = [];
    state.activePlayer = state.players[0];
    bumpVersion();
    saveShared();
    render();
    setStatus("🏁 Preseason beendet. Saison gestartet.");
  });

  form.appendChild(selA); form.appendChild(inpA);
  form.appendChild(selB); form.appendChild(inpB);
  form.appendChild(btnAdd); form.appendChild(btnFinish);
  root.appendChild(form);
}

function renderHistory() {
  const el = document.getElementById("history");
  el.innerHTML = "";
  if (!state.history || state.history.length === 0) {
    el.innerHTML = `<div class="small">Noch keine Spiele.</div>`;
    return;
  }
  const ul = document.createElement("ul");
  state.history.slice().reverse().forEach(h => {
    const li = document.createElement("li");
    li.textContent = `Spieltag ${h.d}: ${h.t}`;
    ul.appendChild(li);
  });
  el.appendChild(ul);
}

// ---------- Actions ----------
function challenge(i) {
  if (state.preseasonActive) {
    setStatus("ℹ️ Forderungen erst nach Preseason.");
    return;
  }

  const challenger = state.players[i];
  const target = state.players[i - 1];

  if (isLocked(challenger, target)) {
    setStatus(`❌ ${challenger} ist gegen ${target} gesperrt.`);
    return;
  }

  const a = parseInt(prompt(`Legs ${challenger}`), 10);
  const b = parseInt(prompt(`Legs ${target}`), 10);

  if (Number.isNaN(a) || Number.isNaN(b) || a === b) {
    setStatus("❌ Ungültiges Ergebnis.");
    return;
  }

  if (a > b) {
    [state.players[i - 1], state.players[i]] = [state.players[i], state.players[i - 1]];
    state.history.push({ d: state.matchday, t: `${challenger} ${a}:${b} ${target}` });
    setStatus(`✅ ${challenger} gewinnt ${a}:${b} → Platztausch!`);
  } else {
    addLock(challenger, target);
    state.history.push({ d: state.matchday, t: `${target} gewinnt ${b}:${a} gegen ${challenger}` });
    setStatus(`❌ ${challenger} verliert ${a}:${b} → Sperre.`);
  }

  state.activePlayer = challenger;
  bumpVersion();
  saveShared();
  render();
}

// ---------- Shared Save / Poll ----------
async function saveShared() {
  try {
    await apiSave(state);
    setStatus("✅ Gespeichert (Team-Stand).");
  } catch (err) {
    setStatus(`⚠️ Speichern fehlgeschlagen: ${err.message}`);
  }
}

async function pollShared() {
  if (isPolling) return;
  isPolling = true;
  try {
    const remote = normalize(await apiLoad());
    if ((remote.version || 0) > (state.version || 0)) {
      state = remote;
      render();
      setStatus("🔄 Aktualisiert (Team-Stand).");
    }
  } catch (err) {
    setStatus(`⚠️ Laden fehlgeschlagen: ${err.message}`);
  } finally {
    isPolling = false;
  }
}

// ---------- Controls ----------
function bindControls() {
  document.getElementById("btnMatchday").onclick = () => {
    if (state.preseasonActive) {
      setStatus("ℹ️ Spieltage starten erst nach Preseason.");
      return;
    }
    state.matchday++;
    bumpVersion();
    saveShared();
    render();
  };

  document.getElementById("btnReset").onclick = () => {
    if (!confirm("Alles zurücksetzen? (betrifft ALLE)")) return;
    state = normalize({
      version: Date.now(),
      matchday: 1,
      players: [...DEFAULT_PLAYERS],
      locks: [],
      preseasonActive: true,
      preseasonGames: [],
      history: [],
      activePlayer: DEFAULT_PLAYERS[0]
    });
    saveShared();
    render();
  };
}

// ---------- Start ----------
async function init() {
  initTheme();
  bindControls();
  setStatus("Lade Team-Stand…");

  try {
    const remote = normalize(await apiLoad());
    if ((remote.version || 0) === 0) {
      bumpVersion();
      await apiSave(state);
      setStatus("✅ Team-Stand initialisiert.");
    } else {
      state = remote;
      setStatus("✅ Team-Stand geladen.");
    }
    render();
  } catch (err) {
    setStatus(`⚠️ Backend nicht erreichbar: ${err.message}`);
    render();
  }

  pollTimer = setInterval(pollShared, POLL_INTERVAL_MS);
}

init();
