const STORAGE_KEY = "liner-notes-v1";
const BACKUP_KEY = "liner-notes-v1.bak";
const THEME_KEY = "the-white-meat-theme";
const REV = 3;
const KIND_ORDER = ["album", "ep", "compilation", "single", "remixes", "unreleased"];
const KIND_META = {
  album: { select: "Album", badge: "Album", plural: "Albums", toast: "Album added", add: "Add album" },
  ep: { select: "EP", badge: "EP", plural: "EPs", toast: "EP added", add: "Add EP" },
  single: { select: "Non-album single", badge: "Single", plural: "Singles", toast: "Single added", add: "Add single" },
  compilation: { select: "Compilation", badge: "Compilation", plural: "Compilations", toast: "Compilation added", add: "Add compilation" },
  remixes: { select: "Remixes", badge: "Remixes", plural: "Remixes", toast: "Remixes added", add: "Add remixes" },
  unreleased: { select: "Unreleased", badge: "Unreleased", plural: "Unreleased", toast: "Unreleased added", add: "Add unreleased" },
};
const COVER_PALETTE = [
  { bg: "#1a1f24", fg: "#d5d0c6" },
  { bg: "#241e18", fg: "#e0d6c8" },
  { bg: "#1c1c1a", fg: "#cfcabe" },
  { bg: "#1a2220", fg: "#d2d5c8" },
  { bg: "#221a1c", fg: "#e2d4d4" },
  { bg: "#181c22", fg: "#c9d0d8" },
];
const SEED_ARTISTS = {
  "a-miles": { genre: "Jazz" },
  "a-radiohead": { genre: "Art rock" },
  "a-alice": { genre: "Spiritual jazz" },
  "a-bjork": { genre: "Electronic" },
  "a-nina": { genre: "Soul" },
};
const KIND_SUFFIX = /\s*\((ep|single|non-album single|compilation|compilations|remix|remixes|unreleased|album)\)\s*$/i;
const YEAR_TITLE = /^(\d{4})\s*[-–—]\s*(.+)$/;

const $ = (sel, el = document) => el.querySelector(sel);
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => crypto.randomUUID();
const now = () => Date.now();
const norm = (s) => (s || "").trim().toLowerCase();

function parseKindSuffix(title) {
  const t = (title || "").trim();
  const m = t.match(KIND_SUFFIX);
  if (!m) return { title: t, kind: "album" };
  const r = m[1].toLowerCase();
  let kind = "album";
  if (r === "ep") kind = "ep";
  else if (r === "single" || r === "non-album single") kind = "single";
  else if (r === "compilation" || r === "compilations") kind = "compilation";
  else if (r === "remix" || r === "remixes") kind = "remixes";
  else if (r === "unreleased") kind = "unreleased";
  return { title: t.slice(0, m.index).trim() || t, kind };
}
function canonKind(k) {
  return KIND_META[k] ? k : "album";
}
function countCrate(c) {
  return (c.artists?.length || 0) + (c.albums?.length || 0) + (c.songs?.length || 0);
}
function parseSnapshot(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const n = Array.isArray(parsed.artists) ? parsed : parsed.state;
    if (!n || !Array.isArray(n.artists) || !Array.isArray(n.albums) || !Array.isArray(n.songs)) return null;
    return { artists: n.artists, albums: n.albums, songs: n.songs };
  } catch {
    return null;
  }
}
function serializeCrate(store) {
  return JSON.stringify({ rev: REV, artists: store.artists, albums: store.albums, songs: store.songs, initialized: true }, null, 2);
}
function pickRicher(a, b) {
  const na = a ? countCrate(a) : -1;
  const nb = b ? countCrate(b) : -1;
  if (na < 0 && nb < 0) return null;
  return na >= nb ? a : b;
}
function normalizeUrl(input) {
  const t = (input || "").trim();
  if (!t) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}
function sourceLabel(url) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return "Source"; }
  if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return "Wikipedia";
  if (host === "bandcamp.com" || host.endsWith(".bandcamp.com")) return "Bandcamp";
  if (host === "discogs.com" || host.endsWith(".discogs.com")) return "Discogs";
  return host || "Source";
}
function coverColor(title, artist) {
  const key = `${title}:${artist ?? ""}`;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVER_PALETTE[h % COVER_PALETTE.length];
}
function yearOk(y) {
  const n = Number(y);
  return Number.isInteger(n) && n > 1800 && n < 2100 ? n : undefined;
}

const state = {
  artists: [],
  albums: [],
  songs: [],
  initialized: false,
  hydrated: false,
  undoStack: [],
  search: "",
  dialog: null,
  toast: null,
  artistSort: "name",
  meatSort: "name",
  releaseSort: "kind",
  genreDrill: "",
  meatDrill: "",
  sucksOpen: {},
};

function persist() {
  if (!state.hydrated) return;
  const next = countCrate(state);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const bak = localStorage.getItem(BACKUP_KEY);
    const existing = pickRicher(parseSnapshot(raw), parseSnapshot(bak));
    if (next === 0 && existing && countCrate(existing) > 0) return;
    if (existing && countCrate(existing) > next && raw) {
      try { localStorage.setItem(BACKUP_KEY, raw); } catch {}
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      rev: REV, artists: state.artists, albums: state.albums, songs: state.songs, initialized: true,
    }));
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        rev: REV,
        artists: state.artists,
        albums: state.albums.map((a) => a.coverSrc?.startsWith("data:") ? { ...a, coverSrc: undefined } : a),
        songs: state.songs.map((s) => s.coverSrc?.startsWith("data:") ? { ...s, coverSrc: undefined } : s),
        initialized: true,
      }));
    } catch {}
  }
}

function migrateArtists(list) {
  const anyGenre = list.some((e) => typeof e.genre === "string" && e.genre.trim());
  return list.map((e) => {
    const i = { ...e, sucks: !!e.sucks };
    if (!anyGenre && !i.genre && SEED_ARTISTS[i.id]?.genre) i.genre = SEED_ARTISTS[i.id].genre;
    return i;
  });
}
function migrateAlbums(list) {
  return list.map((e) => {
    const parsed = parseKindSuffix(e.title);
    const usedSuffix = parsed.title !== (e.title || "").trim();
    return {
      id: e.id,
      artistId: e.artistId,
      title: parsed.title,
      year: e.year,
      coverSrc: e.coverSrc || undefined,
      kind: usedSuffix ? parsed.kind : canonKind(e.kind),
      createdAt: e.createdAt,
    };
  });
}
function migrateSongs(list) {
  return list.map((e) => ({
    id: e.id,
    artistId: e.artistId,
    albumId: e.albumId || undefined,
    title: e.title,
    coverSrc: e.coverSrc || undefined,
    createdAt: e.createdAt,
  }));
}

function hydrate() {
  let snapshot = null, rawPresent = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const bak = localStorage.getItem(BACKUP_KEY);
    rawPresent = !!(raw || bak);
    snapshot = pickRicher(parseSnapshot(raw), parseSnapshot(bak));
  } catch {}
  if (snapshot && countCrate(snapshot) > 0) {
    state.artists = migrateArtists(snapshot.artists);
    state.albums = migrateAlbums(snapshot.albums);
    state.songs = migrateSongs(snapshot.songs);
  } else {
    state.artists = [];
    state.albums = [];
    state.songs = [];
  }
  state.initialized = true;
  state.hydrated = true;
  persist();
}

function pushUndo(label) {
  state.undoStack.push({
    label,
    artists: structuredClone(state.artists),
    albums: structuredClone(state.albums),
    songs: structuredClone(state.songs),
  });
  if (state.undoStack.length > 20) state.undoStack.shift();
}
function undo() {
  const snap = state.undoStack.pop();
  if (!snap) return false;
  state.artists = snap.artists;
  state.albums = snap.albums;
  state.songs = snap.songs;
  persist();
  toast("Restored");
  render();
  return true;
}

function catalogArtists() { return state.artists.filter((a) => !a.sucks); }
function sucksArtists() { return state.artists.filter((a) => a.sucks); }
function artistById(id) { return state.artists.find((a) => a.id === id); }
function albumById(id) { return state.albums.find((a) => a.id === id); }
function albumsOf(id) { return state.albums.filter((a) => a.artistId === id); }
function songsOf(id) { return state.songs.filter((s) => s.artistId === id); }
function matches(hay, q) {
  if (!q.trim()) return true;
  return norm(hay).includes(norm(q));
}

function kindCounts(albums) {
  const c = { albums: 0, eps: 0, singles: 0, remixes: 0, compilations: 0, unreleased: 0 };
  for (const a of albums) {
    const k = canonKind(a.kind);
    if (k === "ep") c.eps++;
    else if (k === "single") c.singles++;
    else if (k === "remixes") c.remixes++;
    else if (k === "compilation") c.compilations++;
    else if (k === "unreleased") c.unreleased++;
    else c.albums++;
  }
  return c;
}
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
function countLine({ artists, genres, albums, songs, sucks }) {
  const parts = [];
  if (artists != null) parts.push(plural(artists, "artist", "artists"));
  if (genres != null) parts.push(plural(genres, "genre", "genres"));
  if (albums != null) parts.push(plural(albums, "release", "releases"));
  if (songs != null) parts.push(`${songs} meat`);
  if (sucks != null) parts.push(sucks === 1 ? "1 artist that sucks" : `${sucks} artists that suck`);
  return parts.join(" · ");
}
function catalogLine(artist) {
  const albs = albumsOf(artist.id);
  const meat = songsOf(artist.id).length;
  const c = kindCounts(albs);
  const parts = [];
  if (c.albums) parts.push(plural(c.albums, "album", "albums"));
  if (c.eps) parts.push(plural(c.eps, "EP", "EPs"));
  if (c.singles) parts.push(plural(c.singles, "single", "singles"));
  if (c.compilations) parts.push(plural(c.compilations, "compilation", "compilations"));
  if (c.remixes) parts.push(`${c.remixes} remixes`);
  if (c.unreleased) parts.push(`${c.unreleased} unreleased`);
  if (!parts.length) return `No catalog · ${meat} meat`;
  if (meat) parts.push(`${meat} meat`);
  return parts.join(" · ");
}

function route() {
  const raw = (location.hash || "#/").replace(/^#/, "") || "/";
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "artists" || path === "/adjust") {
    location.replace(parts[0] === "adjust" ? "#/settings" : "#/");
    return { name: "artists" };
  }
  if (!parts.length) return { name: "artists" };
  if (parts[0] === "genres") return { name: "genres" };
  if (parts[0] === "songs") return { name: "songs" };
  if (parts[0] === "sucks") return { name: "sucks" };
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "artist" && parts[1]) return { name: "artist", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "album" && parts[1]) return { name: "album", id: decodeURIComponent(parts[1]) };
  return { name: "artists" };
}
function go(to) {
  location.hash = to.startsWith("#") ? to : `#${to}`;
}

let toastTimer;
function toast(message, action) {
  state.toast = { message, action };
  renderToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; renderToast(); }, action ? 8000 : 3200);
}

function icon(name) {
  const p = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    disc: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">${p[name] || ""}</svg>`;
}

function coverHtml(title, artist, src, cls = "") {
  if (!src) return "";
  return `<div class="cover ${cls}"><img alt="" src="${escapeHtml(src)}"></div>`;
}

function emptyBox(title, body, cta, action) {
  return `<div class="empty"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>${cta ? `<button class="btn" data-act="${escapeHtml(action)}">${escapeHtml(cta)}</button>` : ""}</div>`;
}

function toolbarSelect(id, value, options) {
  return `<select class="select" id="${id}" aria-label="Sort">${options.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select>`;
}


function parseNotes(text, scopedArtist) {
  const lines = text.replace(/\r/g, "").split("\n");
  const errors = [];
  const blocks = [];
  let current = scopedArtist ? { name: scopedArtist.name, artistId: scopedArtist.id, lines: [] } : null;
  const startBlock = (name) => {
    current = { name: name.replace(/^#\s*/, "").trim(), lines: [] };
    blocks.push(current);
  };
  if (scopedArtist) blocks.push(current);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (!line) {
      if (!scopedArtist) current = null;
      return;
    }
    const yt = line.match(YEAR_TITLE);
    if (yt) {
      if (!current) {
        errors.push({ line: n, text: "Put the artist name on the line above this." });
        return;
      }
      const year = yearOk(Number(yt[1]));
      if (!year) {
        errors.push({ line: n, text: "Need a year and a title, like 1997-OK Computer." });
        return;
      }
      const parsed = parseKindSuffix(yt[2]);
      current.lines.push({ year, title: parsed.title, kind: parsed.kind, line: n });
      return;
    }
    if (scopedArtist) {
      errors.push({ line: n, text: `Not year-title. This paste is for ${scopedArtist.name}.` });
      return;
    }
    startBlock(line);
  });
  const seenPaste = new Set();
  const preview = [];
  const actions = [];
  for (const b of blocks) {
    if (!b.name) continue;
    const existing = state.artists.find((a) => norm(a.name) === norm(b.name));
    if (existing?.sucks) {
      preview.push(`${b.name} · already in Sucks, skipped`);
      continue;
    }
    let artistId = existing?.id;
    let newArtist = false;
    if (!artistId && !scopedArtist) {
      newArtist = true;
      artistId = "pending:" + norm(b.name);
    }
    if (!artistId) continue;
    const have = new Set(state.albums.filter((a) => a.artistId === (existing?.id)).map((a) => norm(parseKindSuffix(a.title).title)));
    let added = 0, skipped = 0;
    const albums = [];
    for (const row of b.lines) {
      const key = `${artistId}:${norm(row.title)}`;
      if (seenPaste.has(key) || have.has(norm(row.title))) {
        skipped++;
        continue;
      }
      seenPaste.add(key);
      albums.push(row);
      added++;
    }
    preview.push(`${b.name} · ${added} new${skipped ? ` · ${skipped} skipped` : ""}`);
    actions.push({ name: b.name, existingId: existing?.id, newArtist, albums });
  }
  return { preview, actions, errors, empty: !actions.some((a) => a.newArtist || a.albums.length) };
}

function parseMeat(text, artistId) {
  const titles = [];
  const errors = [];
  const seen = new Set();
  const have = new Set(state.songs.filter((s) => s.artistId === artistId).map((s) => norm(s.title)));
  text.replace(/\r/g, "").split("\n").forEach((raw, i) => {
    const title = raw.trim();
    if (!title) return;
    const k = norm(title);
    if (seen.has(k) || have.has(k)) {
      errors.push({ line: i + 1, text: "Duplicate in this paste." });
      return;
    }
    seen.add(k);
    titles.push(title);
  });
  return { titles, errors };
}

function parseSucks(text) {
  const names = [];
  const skipped = [];
  const catalog = [];
  const seen = new Set();
  text.replace(/\r/g, "").split("\n").forEach((raw) => {
    let line = raw.trim();
    if (!line) return;
    if (/^\|?[\s-|]+$/.test(line)) return;
    if (line.startsWith("|") && line.endsWith("|")) line = line.slice(1, -1).trim();
    const k = norm(line);
    if (!k || seen.has(k)) return;
    seen.add(k);
    const existing = state.artists.find((a) => norm(a.name) === k);
    if (existing?.sucks) skipped.push(existing.name);
    else if (existing && !existing.sucks) catalog.push(existing);
    else names.push(line);
  });
  return { names, skipped, catalog };
}

function addArtist({ name, genre, sourceUrl, sucks }) {
  const id = uid();
  state.artists.push({
    id, name: name.trim(), genre: genre?.trim() || undefined,
    sourceUrl: sourceUrl || undefined, sucks: !!sucks, createdAt: now(),
  });
  persist();
  return id;
}

function parseArtistCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { if (row.some((c) => c.trim())) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQ) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") pushField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && next === "\n") i++;
      pushField(); pushRow();
    } else field += ch;
  }
  if (field.length || row.length) { pushField(); pushRow(); }
  if (!rows.length) return { added: [], skipped: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const nameI = header.findIndex((h) => h === "artist name" || h === "artist" || h === "name");
  const genreI = header.findIndex((h) => h === "genre");
  if (nameI < 0) return { added: [], skipped: [], error: "Need an Artist Name column" };
  const added = [], skipped = [];
  for (const r of rows.slice(1)) {
    const name = (r[nameI] || "").trim();
    if (!name) continue;
    const genre = genreI >= 0 ? (r[genreI] || "").trim() : "";
    if (dupArtist(name)) skipped.push(name);
    else added.push({ name, genre });
  }
  return { added, skipped };
}

function importArtistRows(rows) {
  pushUndo("import artists");
  for (const r of rows) addArtist({ name: r.name, genre: r.genre });
}

function updateArtist(id, patch) {
  const a = artistById(id);
  if (!a) return;
  Object.assign(a, patch);
  if (patch.genre !== undefined) a.genre = patch.genre?.trim() || undefined;
  persist();
}
function setSucks(id, val) {
  const a = artistById(id);
  if (!a) return;
  pushUndo(a.name);
  a.sucks = val;
  persist();
}
function removeArtist(id) {
  const a = artistById(id);
  if (!a) return;
  pushUndo(a.name);
  state.artists = state.artists.filter((x) => x.id !== id);
  state.albums = state.albums.filter((x) => x.artistId !== id);
  state.songs = state.songs.filter((x) => x.artistId !== id);
  persist();
}
function addAlbum(data) {
  const id = uid();
  state.albums.push({
    id, artistId: data.artistId, title: data.title.trim(),
    year: yearOk(data.year), kind: canonKind(data.kind),
    coverSrc: data.coverSrc, createdAt: now(),
  });
  persist();
  return id;
}
function updateAlbum(id, patch) {
  const a = albumById(id);
  if (!a) return;
  Object.assign(a, patch);
  if (patch.year !== undefined) a.year = yearOk(patch.year);
  persist();
}
function removeAlbum(id) {
  const a = albumById(id);
  if (!a) return;
  pushUndo(a.title);
  state.albums = state.albums.filter((x) => x.id !== id);
  state.songs = state.songs.map((s) => s.albumId === id ? { ...s, albumId: undefined } : s);
  persist();
}
function addSong(data) {
  const id = uid();
  state.songs.push({
    id, artistId: data.artistId, albumId: data.albumId || undefined,
    title: data.title.trim(), coverSrc: data.coverSrc, createdAt: now(),
  });
  persist();
  return id;
}
function updateSong(id, patch) {
  const s = state.songs.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, patch);
  persist();
}
function removeSong(id) {
  const s = state.songs.find((x) => x.id === id);
  if (!s) return;
  pushUndo(s.title);
  state.songs = state.songs.filter((x) => x.id !== id);
  persist();
}
function replaceCrate(snap) {
  state.undoStack = [];
  state.artists = migrateArtists(snap.artists);
  state.albums = migrateAlbums(snap.albums);
  state.songs = migrateSongs(snap.songs);
  persist();
}

function applyNotes(parsed) {
  pushUndo("import");
  let addedArtists = 0, addedAlbums = 0;
  for (const a of parsed.actions) {
    let id = a.existingId;
    if (!id && a.newArtist) {
      id = addArtist({ name: a.name });
      addedArtists++;
    }
    if (!id) continue;
    for (const alb of a.albums) {
      addAlbum({ artistId: id, title: alb.title, year: alb.year, kind: alb.kind });
      addedAlbums++;
    }
  }
  persist();
  return { addedArtists, addedAlbums };
}

function uniqueGenres() {
  const map = new Map();
  for (const a of catalogArtists()) {
    const g = a.genre?.trim();
    if (!g) continue;
    const k = g.toLowerCase();
    if (!map.has(k)) map.set(k, g);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function searchHay(q) {
  const artists = [];
  const releases = [];
  const meat = [];
  const sucks = [];
  for (const a of state.artists) {
    const blob = `${a.name} ${a.genre ?? ""}`;
    if (a.sucks) { if (matches(blob, q)) sucks.push(a); continue; }
    if (matches(blob, q)) artists.push(a);
  }
  for (const alb of state.albums) {
    const ar = artistById(alb.artistId);
    if (!ar || ar.sucks) continue;
    if (matches(`${alb.title} ${alb.year ?? ""} ${ar.name}`, q)) releases.push(alb);
  }
  for (const s of state.songs) {
    const ar = artistById(s.artistId);
    if (!ar || ar.sucks) continue;
    if (matches(`${s.title} ${ar.name}`, q)) meat.push(s);
  }
  return { artists, releases, meat, sucks };
}

function backupFilename(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `the-white-meat-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
}

function downloadBackup() {
  const blob = new Blob([serializeCrate(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFilename();
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readImage(file) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Could not read this image."));
    i.src = URL.createObjectURL(file);
  });
  const max = 720;
  let w = img.width, h = img.height;
  if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
  else if (h > max) { w = Math.round(w * max / h); h = max; }
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111110";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}


function renderToast() {
  let wrap = $(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  if (!state.toast) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = `<div class="toast">${escapeHtml(state.toast.message)}${state.toast.action ? `<button class="btn sm" data-act="undo">Undo</button>` : ""}</div>`;
}

function headerHtml(r) {
  const q = escapeHtml(state.search);
  const theme = document.documentElement.classList.contains("light") ? "Light" : "Dark";
  const next = theme === "Dark" ? "light" : "dark";
  const active = (name) => {
    if (name === "artists") return r.name === "artists" || r.name === "artist" ? "active" : "";
    return r.name === name ? "active" : "";
  };
  return `<header class="header"><div class="header-inner">
    <a class="wordmark" href="#/" aria-label="The White Meat">The White Meat</a>
    <nav aria-label="Library">
      <a class="nav-link ${active("artists")}" href="#/">Artists</a>
      <a class="nav-link ${active("genres")}" href="#/genres">Genre</a>
      <a class="nav-link ${active("songs")}" href="#/songs">White Meat</a>
      <a class="nav-link ${active("sucks")}" href="#/sucks">Sucks</a>
      <a class="nav-link ${active("settings")}" href="#/settings">Settings</a>
    </nav>
    <div class="search-wrap">
      <label class="search"><span aria-hidden="true">${icon("search")}</span>
        <input id="crate-search" placeholder="Search artists, releases, meat" value="${q}" />
      </label>
      <button class="btn sm" data-act="theme" aria-label="Switch to ${next}">${theme}</button>
    </div>
  </div></header>`;
}

function artistListHtml(artists, { sortBy = "name", emptyTitle, emptyBody, emptyCta, emptyAct, scoped } = {}) {
  const q = state.search;
  let rows = artists.filter((a) => matches(`${a.name} ${a.genre ?? ""}`, q));
  rows = rows.slice().sort((a, b) => {
    if (sortBy === "genre") {
      const g = (a.genre || "").localeCompare(b.genre || "", undefined, { sensitivity: "base" });
      return g || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  if (!rows.length) {
    if (q.trim()) return emptyBox("Nothing matches", scoped ? "Try another artist or genre." : "Try another artist, album, or genre.");
    return emptyBox(emptyTitle, emptyBody, emptyCta, emptyAct);
  }
  return `<ul class="list">${rows.map((a) => `<li>
    <a class="row" href="#/artist/${encodeURIComponent(a.id)}">
      <span><span class="block">${escapeHtml(a.name)}</span>
      <span class="sub">${escapeHtml([a.genre, catalogLine(a)].filter(Boolean).join(" · "))}</span></span>
    </a></li>`).join("")}</ul>`;
}

function renderSearch() {
  const { artists, releases, meat, sucks } = searchHay(state.search);
  const section = (title, inner) => inner ? `<section class="mb"><h2 style="margin:1.5rem 0 .6rem;font-size:1.125rem">${title}</h2>${inner}</section>` : "";
  const aHtml = artists.length ? `<ul class="list">${artists.map((a) => `<li><a class="row" href="#/artist/${encodeURIComponent(a.id)}"><span>${escapeHtml(a.name)}<span class="sub">${escapeHtml(a.genre || "")}</span></span></a></li>`).join("")}</ul>` : "";
  const rHtml = releases.length ? `<ul class="list">${releases.map((alb) => `<li><a class="row" href="#/album/${encodeURIComponent(alb.id)}"><span>${escapeHtml(alb.title)}<span class="sub">${escapeHtml(artistById(alb.artistId)?.name || "")}</span></span></a></li>`).join("")}</ul>` : "";
  const mHtml = meat.length ? `<ul class="list">${meat.map((s) => `<li><a class="row" href="#/artist/${encodeURIComponent(s.artistId)}"><span>${escapeHtml(s.title)}<span class="sub">${escapeHtml(artistById(s.artistId)?.name || "")}</span></span></a></li>`).join("")}</ul>` : "";
  const sHtml = sucks.length ? `<ul class="list">${sucks.map((a) => `<li><a class="row" href="#/artist/${encodeURIComponent(a.id)}"><span>${escapeHtml(a.name)}</span></a></li>`).join("")}</ul>` : "";
  const any = artists.length + releases.length + meat.length + sucks.length;
  return `<div class="page-head"><div><p class="muted">Search</p><h1>Results</h1>
    <p class="muted">Matching “${escapeHtml(state.search)}”. Open an artist to work the discography.</p></div></div>
    ${section("Artists", aHtml)}${section("Releases", rHtml)}${section("White Meat", mHtml)}${section("Sucks", sHtml)}
    ${any ? "" : emptyBox("Nothing matches", "Try an artist, a release title, or meat.")}`;
}

function renderArtists() {
  const list = catalogArtists();
  return `<div class="page-head"><div><h1>Artists</h1><p class="muted tabular">${countLine({ artists: list.length })}</p></div>
    <div class="row-actions">
      <button class="btn" data-act="open-artist">${icon("plus")} Artist</button>
      <button class="btn" data-act="open-notes">Import artists</button>
      ${toolbarSelect("artist-sort", state.artistSort, [["name", "Artist"], ["genre", "Genre"]])}
    </div></div>
    ${artistListHtml(list, { sortBy: state.artistSort, emptyTitle: "No artists yet", emptyBody: "Pick an artist. Listen through every album, EP, and non-album single. Keep the white meat.", emptyCta: "Add artist", emptyAct: "open-artist" })}`;
}

function renderGenres() {
  if (state.genreDrill) {
    const artists = catalogArtists().filter((a) => norm(a.genre) === norm(state.genreDrill));
    return `<div class="page-head"><div><h1>${escapeHtml(state.genreDrill)}</h1><p class="muted tabular">${countLine({ artists: artists.length })}</p></div>
      <button class="btn" data-act="clear-genre">All genres</button></div>
      ${artistListHtml(artists, { scoped: true, emptyTitle: "Nothing matches", emptyBody: "Try another artist or genre." })}`;
  }
  const genres = uniqueGenres().filter((g) => matches(g, state.search));
  if (!uniqueGenres().length) {
    return `<div class="page-head"><div><h1>Genre</h1><p class="muted tabular">0 genres</p></div></div>
      <p class="muted">No genres yet. Set one on an artist — it covers every release and meat.</p>`;
  }
  return `<div class="page-head"><div><h1>Genre</h1><p class="muted tabular">${countLine({ genres: genres.length })}</p></div></div>
    ${genres.length ? `<ul class="list">${genres.map((g) => {
      const artists = catalogArtists().filter((a) => norm(a.genre) === norm(g));
      const ids = new Set(artists.map((a) => a.id));
      const rel = state.albums.filter((a) => ids.has(a.artistId)).length;
      const meat = state.songs.filter((s) => ids.has(s.artistId)).length;
      return `<li><button class="row" data-act="drill-genre" data-id="${escapeHtml(g)}"><span class="font-medium">${escapeHtml(g)}</span>
        <span class="muted tabular">${artists.length} ${artists.length === 1 ? "artist" : "artists"} · ${rel} ${rel === 1 ? "release" : "releases"} · ${meat} meat</span></button></li>`;
    }).join("")}</ul>` : emptyBox("Nothing matches", "Try another artist or genre.")}`;
}

function renderSongs() {
  const q = state.search;
  if (state.meatDrill) {
    const ar = artistById(state.meatDrill);
    if (!ar || ar.sucks) { state.meatDrill = ""; return renderSongs(); }
    const songs = songsOf(ar.id);
    return `<div class="page-head"><div><h1>${escapeHtml(ar.name)}</h1>
      ${ar.genre ? `<p class="muted">${escapeHtml(ar.genre)}</p>` : ""}
      <p class="muted tabular">${songs.length} meat</p></div>
      <div class="row-actions">
        <button class="btn" data-act="clear-meat">All artists</button>
        <button class="btn" data-act="open-meat" data-id="${ar.id}">Import meat</button>
        <button class="btn" data-act="open-song" data-id="${ar.id}">${icon("plus")} Meat</button>
      </div></div>
      ${songs.length ? songList(songs) : ""}`;
  }
  const rows = catalogArtists()
    .map((a) => ({ artist: a, cuts: songsOf(a.id).length }))
    .filter((r) => r.cuts > 0 && matches(`${r.artist.name} ${r.artist.genre ?? ""}`, q))
    .sort((a, b) => state.meatSort === "genre"
      ? (a.artist.genre || "").localeCompare(b.artist.genre || "", undefined, { sensitivity: "base" }) || a.artist.name.localeCompare(b.artist.name)
      : a.artist.name.localeCompare(b.artist.name, undefined, { sensitivity: "base" }));
  const total = state.songs.filter((s) => !artistById(s.artistId)?.sucks).length;
  return `<div class="page-head"><div><h1>White Meat</h1><p class="muted tabular">${total} meat</p></div>
    <div class="row-actions">
      <button class="btn" data-act="open-song">${icon("plus")} Meat</button>
      <button class="btn" data-act="open-meat">Import meat</button>
      ${toolbarSelect("meat-sort", state.meatSort, [["name", "Artist"], ["genre", "Genre"]])}
    </div></div>
    ${!rows.length ? emptyBox(q.trim() ? "Nothing matches" : "No white meat yet", q.trim() ? "Try another artist or genre." : "Listen through the catalog, then save the meat.", q.trim() ? "" : "Save meat", "open-song")
      : `<ul class="list">${rows.map((r) => `<li><button class="row" data-act="drill-meat" data-id="${r.artist.id}">
        <span>${escapeHtml(r.artist.name)}${state.meatSort === "name" && r.artist.genre ? `<span class="sub">${escapeHtml(r.artist.genre)}</span>` : ""}</span>
        <span class="muted tabular">${r.cuts} meat</span></button></li>`).join("")}</ul>`}`;
}

function songList(songs) {
  return `<ul class="list">${songs.map((s) => {
    const ar = artistById(s.artistId);
    const alb = s.albumId ? albumById(s.albumId) : null;
    return `<li><div class="row">
      ${s.coverSrc ? coverHtml(s.title, ar?.name, s.coverSrc) : ""}
      <span style="flex:1;min-width:0"><span>${escapeHtml(s.title)}</span>
      <span class="sub">${escapeHtml([ar?.name, alb?.title].filter(Boolean).join(" · "))}</span></span>
      <button class="btn sm" data-act="edit-song" data-id="${s.id}">Edit</button>
      <button class="btn sm" data-act="del-song" data-id="${s.id}">Delete</button>
    </div></li>`;
  }).join("")}</ul>`;
}

function renderSucks() {
  const list = sucksArtists();
  const groups = new Map();
  for (const a of list) {
    const ch = a.name.trim().charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(ch) ? ch : "#";
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(a);
  }
  const letters = [...groups.keys()].sort((a, b) => a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b));
  const body = !list.length
    ? emptyBox("Nobody in Sucks", "Park an artist you won’t listen through, so you don’t start them twice.", "Add to Sucks", "open-sucks")
    : letters.map((L) => {
      const open = state.search.trim() || state.sucksOpen[L] !== false;
      return `<h2 class="letter"><button data-act="toggle-letter" data-id="${L}">${L}</button></h2>
        ${open ? `<ul class="list">${groups.get(L).map((a) => `<li><div class="row">
          <a href="#/artist/${encodeURIComponent(a.id)}" style="flex:1">${escapeHtml(a.name)}</a>
          <button class="btn sm" data-act="edit-artist" data-id="${a.id}">Edit</button>
          <button class="btn sm" data-act="restore-artist" data-id="${a.id}">Restore</button>
          <button class="btn sm" data-act="del-artist" data-id="${a.id}">Remove</button>
        </div></li>`).join("")}</ul>` : ""}`;
    }).join("");
  return `<div class="page-head"><div><h1>Sucks</h1><p class="muted tabular">${countLine({ sucks: list.length })}</p></div>
    <div class="row-actions">
      <button class="btn" data-act="open-sucks">${icon("plus")} Sucks</button>
      <button class="btn" data-act="open-sucks-import">Import</button>
    </div></div>${body}`;
}

function renderSettings() {
  return `<div class="page-head"><div><h1>Settings</h1></div></div>
    <h2 style="font-size:1.125rem;margin-bottom:.75rem">Backup</h2>
    <div class="editor" style="margin:0">
      <div class="row-actions">
        <button class="btn" data-act="download">Download backup</button>
        <button class="btn" data-act="restore">Restore backup</button>
        <input id="restore-file" class="hidden" type="file" accept="application/json,.json" />
      </div>
    </div>
    <h2 style="font-size:1.125rem;margin:2rem 0 .75rem">Spreadsheet</h2>
    <div class="editor" style="margin:0">
      <p class="help">Name and genre only. Skips artists already in the crate. Does not touch releases or meat.</p>
      <div class="row-actions">
        <button class="btn" data-act="import-artists-csv">Import artists CSV</button>
        <input id="artists-csv" class="hidden" type="file" accept=".csv,text/csv" />
      </div>
    </div>`;
}

function missingHtml(label) {
  return `<p class="muted" style="letter-spacing:.1em;text-transform:uppercase;font-size:.75rem">Not in the catalog</p>
    <h1 class="big-title" style="margin:.4rem 0 1rem">This ${escapeHtml(label)} is not here.</h1>
    <p class="muted" style="margin-bottom:1rem">It may have been deleted, or the link is out of date.</p>
    <a class="btn" href="#/">Back to catalog</a>`;
}

function renderArtist(id) {
  const a = artistById(id);
  if (!a) return missingHtml("artist");
  const albs = albumsOf(a.id).slice().sort((x, y) => {
    if (state.releaseSort === "year-old") return (x.year || 9999) - (y.year || 9999) || x.title.localeCompare(y.title);
    if (state.releaseSort === "year-new") return (y.year || 0) - (x.year || 0) || x.title.localeCompare(y.title);
    return KIND_ORDER.indexOf(canonKind(x.kind)) - KIND_ORDER.indexOf(canonKind(y.kind)) || (x.year || 0) - (y.year || 0);
  });
  const meat = songsOf(a.id);
  const actions = a.sucks
    ? `<button class="btn" data-act="restore-artist" data-id="${a.id}">Restore</button>
       <button class="btn" data-act="edit-artist" data-id="${a.id}">Edit</button>
       <button class="btn" data-act="del-artist" data-id="${a.id}">Delete</button>`
    : `<button class="btn" data-act="open-album" data-id="${a.id}">${icon("plus")} Release</button>
       <button class="btn" data-act="open-song" data-id="${a.id}">${icon("plus")} Meat</button>
       <button class="btn" data-act="open-notes" data-id="${a.id}">Import releases</button>
       <button class="btn" data-act="open-meat" data-id="${a.id}">Import meat</button>
       <button class="btn" data-act="edit-artist" data-id="${a.id}">Edit</button>
       <button class="btn" data-act="del-artist" data-id="${a.id}">Delete</button>
       <button class="btn" data-act="sucks-artist" data-id="${a.id}">Sucks</button>
       ${toolbarSelect("release-sort", state.releaseSort, [["kind", "Type"], ["year-old", "Year · oldest"], ["year-new", "Year · newest"]])}`;
  const relHtml = albs.length
    ? `<ul class="list">${albs.map((alb) => `<li><a class="row" href="#/album/${encodeURIComponent(alb.id)}">
        ${coverHtml(alb.title, a.name, alb.coverSrc)}
        <span style="flex:1"><span>${escapeHtml(alb.title)}</span>
        <span class="sub">${escapeHtml([KIND_META[canonKind(alb.kind)].badge, alb.year].filter(Boolean).join(" · "))}</span></span>
      </a></li>`).join("")}</ul>`
    : emptyBox("Nothing in the catalog yet", "Add every album, EP, non-album single, and remixes, then save the meat.", a.sucks ? "" : "Add release", "open-album");
  return `<a class="back" href="${a.sucks ? "#/sucks" : "#/"}">${icon("back")} ${escapeHtml(a.name)}</a>
    <p class="badge">${a.sucks ? "Sucks" : "Artist"}</p>
    <h1 class="big-title">${escapeHtml(a.name)}</h1>
    ${a.genre ? `<p class="muted">${escapeHtml(a.genre)}</p>` : ""}
    ${a.sourceUrl ? `<p><a class="source" href="${escapeHtml(a.sourceUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(sourceLabel(a.sourceUrl))}</a></p>` : ""}
    ${a.sucks ? "" : `<p class="muted tabular" style="margin:.4rem 0 1rem">${catalogLine(a)}</p>`}
    <div class="row-actions" style="margin:1rem 0 2rem">${actions}</div>
    <h2 style="font-size:1.125rem;margin-bottom:.75rem">Releases</h2>${relHtml}
    ${meat.length ? `<h2 style="font-size:1.125rem;margin:2rem 0 .75rem">White Meat</h2>${songList(meat)}` : ""}`;
}

function renderAlbum(id) {
  const alb = albumById(id);
  if (!alb) return missingHtml("release");
  const a = artistById(alb.artistId);
  const meat = state.songs.filter((s) => s.albumId === alb.id);
  return `<a class="back" href="#/artist/${encodeURIComponent(alb.artistId)}">${icon("back")} ${escapeHtml(a?.name || "Artist")}</a>
    <div style="display:flex;gap:1.25rem;flex-wrap:wrap;align-items:flex-end">
      ${coverHtml(alb.title, a?.name, alb.coverSrc, "lg")}
      <div>
        <p class="badge">${escapeHtml(KIND_META[canonKind(alb.kind)].badge)}</p>
        <h1 class="big-title">${escapeHtml(alb.title)}</h1>
        <p><a class="source" href="#/artist/${encodeURIComponent(alb.artistId)}">${escapeHtml(a?.name || "")}</a></p>
        ${a?.genre ? `<p class="muted">${escapeHtml(a.genre)}</p>` : ""}
        ${alb.year ? `<p class="muted">${alb.year}</p>` : ""}
        <p class="muted tabular">${meat.length} meat</p>
      </div>
    </div>
    <div class="row-actions" style="margin:1.25rem 0 2rem">
      <button class="btn" data-act="open-song" data-id="${alb.artistId}" data-album="${alb.id}">${icon("plus")} Meat</button>
      <button class="btn" data-act="edit-album" data-id="${alb.id}">Edit</button>
      <button class="btn" data-act="del-album" data-id="${alb.id}">Delete</button>
    </div>
    <h2 style="font-size:1.125rem;margin-bottom:.75rem">White Meat</h2>
    ${meat.length ? songList(meat) : emptyBox("No meat from this release", "The white meat — the good stuff after you listen through.", "Save meat", "open-song")}`;
}


function field(label, inner) {
  return `<label>${escapeHtml(label)}${inner}</label>`;
}
function artistOptions(selected, { allowEmpty } = {}) {
  const list = catalogArtists();
  if (!list.length) return `<option value="">Add an artist first</option>`;
  return `${allowEmpty ? `<option value="">Select artist</option>` : ""}${list.map((a) => `<option value="${a.id}" ${a.id === selected ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}`;
}
function albumOptions(artistId, selected) {
  const list = albumsOf(artistId);
  return `<option value="">None</option>${list.map((a) => `<option value="${a.id}" ${a.id === selected ? "selected" : ""}>${escapeHtml(a.title)}</option>`).join("")}`;
}

function renderDialog() {
  const d = state.dialog;
  if (!d) return "";
  if (d.kind === "artist") {
    const edit = d.artistId ? artistById(d.artistId) : null;
    const sucks = !!(d.sucks || edit?.sucks);
    const title = edit ? "Edit artist" : sucks ? "Add to Sucks" : "Add artist";
    const body = sucks
      ? "Won’t listen through the discography. Tracked so you don’t try again."
      : "Start here. Work through the catalog. Keep the white meat. Genre on this artist covers every release.";
    const genres = uniqueGenres();
    return `<div class="editor" id="crate-editor"><h2>${title}</h2><p class="help">${body}</p>
      <div class="fields">
        ${field("Name", `<input class="input" id="f-name" placeholder="Alice Coltrane" value="${escapeHtml(edit?.name || "")}" />`)}
        ${field("Genre", `<input class="input" id="f-genre" list="genre-list" placeholder="Search or type a genre" value="${escapeHtml(edit?.genre || "")}" />
          <datalist id="genre-list">${genres.map((g) => `<option value="${escapeHtml(g)}"></option>`).join("")}</datalist>
          <p class="help" style="margin:.35rem 0 0">Pick one you already use, or type a new label. It sticks to this artist and every release under them.</p>`)}
        ${field("Source", `<input class="input" id="f-source" inputmode="url" autocomplete="url" placeholder="https://en.wikipedia.org/wiki/Radiohead" value="${escapeHtml(edit?.sourceUrl || "")}" />`)}
      </div>
      <div class="form-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn primary" data-act="save-artist">${edit ? "Save" : sucks ? "Add to Sucks" : "Add artist"}</button>
      </div></div>`;
  }
  if (d.kind === "album") {
    const edit = d.albumId ? albumById(d.albumId) : null;
    return `<div class="editor" id="crate-editor"><h2>${edit ? "Edit release" : "Add to the catalog"}</h2>
      <p class="help">Album, EP, non-album single, compilation, remixes, or unreleased. Genre lives on the artist. Art lives on the release.</p>
      <div class="fields">
        ${field("Artist", `<select class="select" id="f-artist" style="width:100%">${artistOptions(edit?.artistId || d.artistId, { allowEmpty: true })}</select>`)}
        ${field("Kind", `<select class="select" id="f-kind" style="width:100%">${KIND_ORDER.map((k) => `<option value="${k}" ${k === (edit?.kind || "album") ? "selected" : ""}>${KIND_META[k].select}</option>`).join("")}</select>`)}
        ${field("Title", `<input class="input" id="f-title" placeholder="Kind of Blue" value="${escapeHtml(edit?.title || "")}" />`)}
        ${field("Year", `<input class="input" id="f-year" inputmode="numeric" placeholder="1959" value="${edit?.year ?? ""}" />`)}
        <div><p style="margin-bottom:.35rem">Art</p>
          <input type="file" accept="image/*" id="f-art" />
          <p class="muted" id="art-status" style="margin-top:.35rem">${edit?.coverSrc ? "Art on file" : ""}</p>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn primary" data-act="save-album">${edit ? "Save" : "Save"}</button>
      </div></div>`;
  }
  if (d.kind === "song") {
    const edit = d.songId ? state.songs.find((s) => s.id === d.songId) : null;
    const artistId = edit?.artistId || d.artistId || "";
    return `<div class="editor" id="crate-editor"><h2>${edit ? "Edit meat" : "Save meat"}</h2>
      <p class="help">The white meat — the good stuff after you listen through.</p>
      <div class="fields">
        ${field("Artist", `<select class="select" id="f-artist" style="width:100%">${artistOptions(artistId, { allowEmpty: true })}</select>`)}
        ${field("Release", `<select class="select" id="f-album" style="width:100%">${albumOptions(artistId, edit?.albumId || d.albumId)}</select>`)}
        ${field("Title", `<input class="input" id="f-title" placeholder="So What" value="${escapeHtml(edit?.title || "")}" />`)}
        <div><p style="margin-bottom:.35rem">Art</p><input type="file" accept="image/*" id="f-art" /><p class="muted" id="art-status" style="margin-top:.35rem">${edit?.coverSrc ? "Art on file" : ""}</p></div>
      </div>
      <div class="form-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn primary" data-act="save-song">${edit ? "Save" : "Save meat"}</button>
      </div></div>`;
  }
  if (d.kind === "notes") {
    const scoped = d.artistId ? artistById(d.artistId) : null;
    return `<div class="editor" id="crate-editor"><h2>${scoped ? `Import releases · ${escapeHtml(scoped.name)}` : "Import artists"}</h2>
      <p class="help">${scoped ? "Paste year and title, one per line. 1997-OK Computer." : "Artist name, then year-title lines. Blank line, next artist. That’s the whole catalog dump."}</p>
      ${field("Notes", `<textarea class="textarea" id="f-notes" placeholder="${scoped ? "1992-Drill\n1993-Pablo Honey\n1995-The Bends\n1997-OK Computer" : "Radiohead\n1992-Drill\n1993-Pablo Honey\n1995-The Bends\n1997-OK Computer\n\nTalk Talk\n1982-The Party's Over"}"></textarea>`)}
      <p class="preview" id="notes-preview">Nothing parsed yet.</p>
      <div class="form-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn primary" data-act="save-notes" disabled>Import</button>
      </div></div>`;
  }
  if (d.kind === "meat") {
    const scoped = d.artistId ? artistById(d.artistId) : null;
    return `<div class="editor" id="crate-editor"><h2>${scoped ? `Import meat · ${escapeHtml(scoped.name)}` : "Import meat"}</h2>
      <p class="help">Paste the meat, one song per line. They go in White Meat for this artist.</p>
      ${scoped ? "" : field("Artist", `<select class="select" id="f-artist" style="width:100%">${artistOptions("", { allowEmpty: true })}</select>`)}
      ${field("Meat", `<textarea class="textarea" id="f-meat" placeholder="(L)MIRL\n7 Words\nChange (In the House of Flies)\nDigital Bath"></textarea>`)}
      <p class="preview" id="meat-preview">Nothing parsed yet.</p>
      <div class="form-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn primary" data-act="save-meat-import">Import</button>
      </div></div>`;
  }
  if (d.kind === "sucks-import") {
    return `<div class="editor" id="crate-editor"><h2>Import sucks</h2>
      <p class="help">One artist per line.</p>
      ${field("Artists", `<textarea class="textarea" id="f-sucks" placeholder="1000mods\n24-7 Spyz\nAmon Amarth"></textarea>`)}
      <p class="preview" id="sucks-preview">Nothing parsed yet.</p>
      <div class="form-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn primary" data-act="save-sucks-import">Import</button>
      </div></div>`;
  }
  if (d.kind === "backup") {
    return `<div class="editor" id="crate-editor"><h2>Backup</h2>
      <p class="help">If a file doesn’t download, copy this text, paste it into a .json file, and keep that file. Restore backup reads it later.</p>
      <textarea class="textarea" id="f-backup" readonly>${escapeHtml(serializeCrate(state))}</textarea>
      <div class="form-actions">
        <button class="btn" data-act="copy-backup">Copy</button>
        <button class="btn" data-act="download-file">Download file</button>
        <button class="btn" data-act="close">Done</button>
      </div></div>`;
  }
  if (d.kind === "confirm") {
    return `<div class="editor" id="crate-editor"><h2>${escapeHtml(d.title)}</h2>
      <p class="help">${escapeHtml(d.body)}</p>
      <div class="form-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn danger" data-act="confirm-ok">Delete</button>
      </div></div>`;
  }
  return "";
}

function openDialog(dialog) {
  state.dialog = dialog;
  render();
  $("#crate-editor")?.scrollIntoView({ block: "start" });
}
function closeDialog() { state.dialog = null; render(); }

function bindDialogLive() {
  const notes = $("#f-notes");
  if (notes) {
    const paint = () => {
      const scoped = state.dialog?.artistId ? artistById(state.dialog.artistId) : null;
      const parsed = parseNotes(notes.value, scoped);
      const err = parsed.errors.slice(0, 4).map((e) => `Line ${e.line}: ${e.text}`).join("\n");
      const extra = parsed.errors.length > 4 ? `\n${parsed.errors.length - 4} more lines couldn’t be read.` : "";
      $("#notes-preview").textContent = parsed.preview.join("\n") + (err ? `\n${err}${extra}` : "") || "Nothing parsed yet.";
      $("[data-act=save-notes]").disabled = parsed.empty;
    };
    notes.addEventListener("input", paint);
    paint();
  }
  const meat = $("#f-meat");
  if (meat) {
    const paint = () => {
      const artistId = state.dialog?.artistId || $("#f-artist")?.value;
      if (!artistId) { $("#meat-preview").textContent = "Pick an artist first."; return; }
      const parsed = parseMeat(meat.value, artistId);
      $("#meat-preview").textContent = parsed.titles.length ? `${parsed.titles.length} new` : "Nothing parsed yet.";
    };
    meat.addEventListener("input", paint);
    $("#f-artist")?.addEventListener("change", paint);
    paint();
  }
  const sucks = $("#f-sucks");
  if (sucks) {
    const paint = () => {
      const p = parseSucks(sucks.value);
      const bits = [];
      if (p.names.length) bits.push(`${p.names.length} new`);
      if (p.skipped.length) bits.push(`${p.skipped.length} already in Sucks`);
      if (p.catalog.length) bits.push(`${p.catalog.length} already in Artists`);
      $("#sucks-preview").textContent = bits.join(" · ") || "Nothing parsed yet.";
    };
    sucks.addEventListener("input", paint);
    paint();
  }
  const art = $("#f-art");
  if (art) {
    art.addEventListener("change", async () => {
      const file = art.files?.[0];
      if (!file) return;
      $("#art-status").textContent = "Reading…";
      try {
        state.dialog.coverSrc = await readImage(file);
        $("#art-status").textContent = "Art ready";
      } catch {
        toast("Couldn’t read that image.");
        $("#art-status").textContent = "";
      }
    });
  }
  $("#f-artist")?.addEventListener("change", () => {
    const alb = $("#f-album");
    if (alb) alb.innerHTML = albumOptions($("#f-artist").value, "");
  });
}

function render() {
  const r = route();
  const q = state.search.trim();
  let page = "";
  if (q && !state.dialog) page = renderSearch();
  else if (r.name === "artists") page = renderArtists();
  else if (r.name === "genres") page = renderGenres();
  else if (r.name === "songs") page = renderSongs();
  else if (r.name === "sucks") page = renderSucks();
  else if (r.name === "settings") page = renderSettings();
  else if (r.name === "artist") page = renderArtist(r.id);
  else if (r.name === "album") page = renderAlbum(r.id);
  $("#app").innerHTML = `${headerHtml(r)}<main class="main">${renderDialog()}${page}</main>`;
  renderToast();
  bindDialogLive();
}

function dupArtist(name, ignoreId) {
  return state.artists.find((a) => a.id !== ignoreId && norm(a.name) === norm(name));
}

function onClick(e) {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;
  const id = t.dataset.id;
  if (act === "theme") {
    const light = !document.documentElement.classList.contains("light");
    document.documentElement.classList.toggle("light", light);
    document.documentElement.classList.toggle("dark", !light);
    localStorage.setItem(THEME_KEY, light ? "light" : "dark");
    $('meta[name="theme-color"]').setAttribute("content", light ? "#FFFFFF" : "#0b0b0a");
    render();
    return;
  }
  if (act === "undo") { undo(); return; }
  if (act === "close") { closeDialog(); return; }
  if (act === "open-artist") { openDialog({ kind: "artist" }); return; }
  if (act === "open-sucks") { openDialog({ kind: "artist", sucks: true }); return; }
  if (act === "open-notes") { openDialog({ kind: "notes", artistId: id }); return; }
  if (act === "open-meat") { openDialog({ kind: "meat", artistId: id }); return; }
  if (act === "open-sucks-import") { openDialog({ kind: "sucks-import" }); return; }
  if (act === "open-song") { openDialog({ kind: "song", artistId: id, albumId: t.dataset.album }); return; }
  if (act === "open-album") { openDialog({ kind: "album", artistId: id }); return; }
  if (act === "edit-artist") { openDialog({ kind: "artist", artistId: id }); return; }
  if (act === "edit-album") { openDialog({ kind: "album", albumId: id }); return; }
  if (act === "edit-song") { openDialog({ kind: "song", songId: id }); return; }
  if (act === "clear-genre") { state.genreDrill = ""; render(); return; }
  if (act === "clear-meat") { state.meatDrill = ""; render(); return; }
  if (act === "drill-genre") { state.genreDrill = id; render(); return; }
  if (act === "drill-meat") { state.meatDrill = id; render(); return; }
  if (act === "toggle-letter") {
    state.sucksOpen[id] = state.sucksOpen[id] === false;
    render();
    return;
  }
  if (act === "sucks-artist") {
    const a = artistById(id);
    setSucks(id, true);
    toast(`${a.name} moved to Sucks`, true);
    go("/sucks");
    return;
  }
  if (act === "restore-artist") {
    const a = artistById(id);
    setSucks(id, false);
    toast(`${a.name} back in Artists`, true);
    render();
    return;
  }
  if (act === "del-artist") {
    const a = artistById(id);
    openDialog({
      kind: "confirm", title: `Delete ${a.name}?`,
      body: a.sucks ? "They’ll be gone from Sucks. You can undo after." : "This artist’s catalog and meat will be removed. You can undo after.",
      run: () => { removeArtist(id); toast(`${a.name} removed`, true); go(a.sucks ? "/sucks" : "/"); },
    });
    return;
  }
  if (act === "del-album") {
    const alb = albumById(id);
    openDialog({
      kind: "confirm", title: `Delete ${alb.title}?`,
      body: "Meat from this release stays in White Meat. You can undo after.",
      run: () => { const aid = alb.artistId; removeAlbum(id); toast(`${alb.title} removed`, true); go(`/artist/${aid}`); },
    });
    return;
  }
  if (act === "del-song") {
    const s = state.songs.find((x) => x.id === id);
    openDialog({
      kind: "confirm", title: `Delete ${s.title}?`,
      body: "You can undo after.",
      run: () => { removeSong(id); toast(`${s.title} removed`, true); render(); },
    });
    return;
  }
  if (act === "confirm-ok") {
    const run = state.dialog?.run;
    closeDialog();
    run?.();
    return;
  }
  if (act === "save-artist") {
    const name = $("#f-name").value.trim();
    if (!name) return;
    const sucks = !!(state.dialog.sucks || artistById(state.dialog.artistId)?.sucks);
    const dup = dupArtist(name, state.dialog.artistId);
    if (dup) { toast(dup.sucks ? "Already in Sucks" : "Already in the catalog"); return; }
    const srcRaw = $("#f-source").value.trim();
    let sourceUrl;
    if (srcRaw) {
      sourceUrl = normalizeUrl(srcRaw);
      if (!sourceUrl) { toast("Need a web link, like a Wikipedia or Bandcamp page."); return; }
    }
    const patch = { name, genre: $("#f-genre").value, sourceUrl, sucks };
    if (state.dialog.artistId) {
      updateArtist(state.dialog.artistId, patch);
      toast("Artist updated");
    } else {
      addArtist(patch);
      toast(sucks ? "Added to Sucks" : "Artist added");
    }
    closeDialog();
    return;
  }
  if (act === "save-album") {
    const artistId = $("#f-artist").value;
    const title = $("#f-title").value.trim();
    if (!artistId || !title) return;
    const kind = $("#f-kind").value;
    const year = $("#f-year").value;
    const coverSrc = state.dialog.coverSrc;
    if (state.dialog.albumId) {
      updateAlbum(state.dialog.albumId, { artistId, title, kind, year, coverSrc: coverSrc ?? albumById(state.dialog.albumId).coverSrc });
      toast("Release updated");
    } else {
      addAlbum({ artistId, title, kind, year, coverSrc });
      toast(KIND_META[canonKind(kind)].toast);
    }
    closeDialog();
    return;
  }
  if (act === "save-song") {
    const artistId = $("#f-artist").value;
    const title = $("#f-title").value.trim();
    if (!artistId || !title) return;
    const albumId = $("#f-album").value || undefined;
    const coverSrc = state.dialog.coverSrc;
    if (state.dialog.songId) {
      updateSong(state.dialog.songId, { artistId, title, albumId, coverSrc: coverSrc ?? state.songs.find((s) => s.id === state.dialog.songId)?.coverSrc });
      toast("Meat updated");
    } else {
      addSong({ artistId, title, albumId, coverSrc });
      toast("Meat saved");
    }
    closeDialog();
    return;
  }
  if (act === "save-notes") {
    const scoped = state.dialog.artistId ? artistById(state.dialog.artistId) : null;
    const parsed = parseNotes($("#f-notes").value, scoped);
    if (parsed.empty) { toast("Nothing new to import"); return; }
    const r = applyNotes(parsed);
    toast(`Imported ${r.addedArtists} ${r.addedArtists === 1 ? "artist" : "artists"}, ${r.addedAlbums} ${r.addedAlbums === 1 ? "release" : "releases"}`);
    closeDialog();
    return;
  }
  if (act === "save-meat-import") {
    const artistId = state.dialog.artistId || $("#f-artist")?.value;
    if (!artistId) { toast("Pick an artist first."); return; }
    if (artistById(artistId)?.sucks) { toast("Already in Sucks."); return; }
    const parsed = parseMeat($("#f-meat").value, artistId);
    if (!parsed.titles.length) { toast("Nothing new to import"); return; }
    pushUndo("import meat");
    parsed.titles.forEach((title) => addSong({ artistId, title }));
    toast(`Imported ${parsed.titles.length} meat`);
    closeDialog();
    return;
  }
  if (act === "save-sucks-import") {
    const p = parseSucks($("#f-sucks").value);
    if (!p.names.length) { toast("Nothing new to import"); return; }
    pushUndo("import sucks");
    p.names.forEach((name) => addArtist({ name, sucks: true }));
    toast(`Imported ${p.names.length} to Sucks`);
    closeDialog();
    return;
  }
  if (act === "download") {
    if (!countCrate(state)) { toast("Nothing to download yet"); return; }
    downloadBackup();
    openDialog({ kind: "backup" });
    return;
  }
  if (act === "download-file") { downloadBackup(); return; }
  if (act === "copy-backup") {
    const text = $("#f-backup")?.value || serializeCrate(state);
    navigator.clipboard.writeText(text).then(() => toast("Backup copied")).catch(() => toast("Select the text and copy it yourself."));
    return;
  }
  if (act === "restore") {
    $("#restore-file")?.click();
    return;
  }
  if (act === "import-artists-csv") {
    $("#artists-csv")?.click();
    return;
  }
}

function onChange(e) {
  if (e.target.id === "artist-sort") { state.artistSort = e.target.value; render(); }
  if (e.target.id === "meat-sort") { state.meatSort = e.target.value; render(); }
  if (e.target.id === "release-sort") { state.releaseSort = e.target.value; render(); }
  if (e.target.id === "restore-file") {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((raw) => {
      const snap = parseSnapshot(raw);
      if (!snap) { toast("That file isn’t a White Meat backup"); return; }
      replaceCrate(snap);
      toast("Backup restored");
      render();
    });
  }
  if (e.target.id === "artists-csv") {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    file.text().then((raw) => {
      const parsed = parseArtistCsv(raw);
      if (parsed.error) { toast(parsed.error); return; }
      if (!parsed.added.length) {
        toast(parsed.skipped.length ? "Already in the catalog" : "Nothing new to import");
        return;
      }
      importArtistRows(parsed.added);
      const extra = parsed.skipped.length ? ` · ${parsed.skipped.length} already in the crate` : "";
      toast(`Imported ${parsed.added.length} ${parsed.added.length === 1 ? "artist" : "artists"}${extra}`, true);
      render();
    });
  }
}

function boot() {
  hydrate();
  render();
  window.addEventListener("hashchange", render);
  document.addEventListener("click", onClick);
  document.addEventListener("input", (e) => {
    if (e.target.id === "crate-search") {
      state.search = e.target.value;
      render();
      const el = $("#crate-search");
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }
  });
  document.addEventListener("change", onChange);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (state.dialog) { closeDialog(); return; }
      if (state.search) { state.search = ""; render(); }
    }
    const tag = document.activeElement?.tagName;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(tag) || document.activeElement?.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey && !typing) {
      e.preventDefault();
      undo();
    }
    if (e.key === "/" && !typing) {
      e.preventDefault();
      $("#crate-search")?.focus();
    }
  });
}

boot();
