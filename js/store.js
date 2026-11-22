// Stockage local (localStorage). Chaque objet a un id unique, un champ
// `updated` et une suppression « douce » (`deleted`) : c'est ce qui
// permettra de brancher la synchronisation Firebase plus tard.

import { dueInDays } from './srs.js';

const KEY = 'memo-data-v1';
const now = () => Date.now();
const alive = (o) => o && !o.deleted;
const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const today = () => new Date().toLocaleDateString('sv'); // AAAA-MM-JJ

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

const VERSION = 2;

function empty() {
  return {
    decks: {}, cards: {},
    meta: { version: VERSION, settings: { newPerDay: 20, reviewsPerDay: 50 }, daily: {} },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      const e = empty();
      const data = {
        decks: d.decks || {},
        cards: d.cards || {},
        meta: { ...e.meta, ...d.meta, settings: { ...e.meta.settings, ...d.meta?.settings } },
      };
      migrate(data, d.meta?.version || 1);
      purge(data);
      return data;
    }
  } catch (err) {
    console.warn('Lecture des données impossible', err);
  }
  return empty();
}

// Ménage à l'ouverture, pour limiter la place prise sur l'appareil : les cartes retirées des
// cours partagés sont effacées pour de bon (la bibliothèque est rechargée depuis le site) ;
// les autres suppressions (cartes et paquets personnels) sont gardées 90 jours, puis effacées.
function purge(data) {
  const old = now() - 90 * 864e5;
  for (const [id, c] of Object.entries(data.cards)) {
    if (c?.deleted && (c.lib || (c.updated || 0) < old)) delete data.cards[id];
  }
  const used = new Set(Object.values(data.cards).map((c) => c.deckId));
  for (const [id, d] of Object.entries(data.decks)) {
    if (d?.deleted && (d.updated || 0) < old && !used.has(id)) delete data.decks[id];
  }
}

function migrate(data, from) {
  if (from < 2) {
    // v1 : les cartes ratées revenaient dans la minute. On les répartit sur 1 à 3 jours.
    const tomorrow = dueInDays(1);
    for (const c of Object.values(data.cards)) {
      if (c.seen && !c.interval && !c.deleted && c.due < tomorrow) {
        c.due = dueInDays(1 + Math.floor(Math.random() * 3));
      }
    }
    data.meta.daily = {};
    delete data.meta.introduced;
  }
  data.meta.version = VERSION;
}

let db = load();
save();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (err) {
    console.error('Enregistrement impossible', err);
  }
}

/* ---------- Paquets ---------- */

const byName = (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });

/** Paquets affichés (hors cours partagés masqués). */
export function decks() {
  return Object.values(db.decks).filter((d) => alive(d) && !d.hidden).sort(byName);
}

/** Cours partagés que l'utilisateur a masqués. */
export const hiddenDecks = () => Object.values(db.decks).filter((d) => alive(d) && d.hidden).sort(byName);

export function setHidden(id, hidden) {
  Object.assign(db.decks[id], { hidden, updated: now() });
  save();
}
export const deck = (id) => (alive(db.decks[id]) ? db.decks[id] : null);
export const deckByName = (name) => decks().find((d) => norm(d.name) === norm(name)) || null;

export function createDeck(name) {
  const d = { id: uid(), name: name.trim(), created: now(), updated: now(), deleted: false };
  db.decks[d.id] = d;
  save();
  return d;
}

export function renameDeck(id, name) {
  Object.assign(db.decks[id], { name: name.trim(), updated: now() });
  save();
}

export function deleteDeck(id) {
  const t = now();
  Object.assign(db.decks[id], { deleted: true, updated: t });
  for (const c of Object.values(db.cards)) {
    if (c.deckId === id && !c.deleted) Object.assign(c, { deleted: true, updated: t });
  }
  save();
}

/* ---------- Cartes ---------- */

function newCard(deckId, front, back) {
  const t = now();
  return {
    id: uid(), deckId, front: front.trim(), back: back.trim(),
    created: t, updated: t, deleted: false,
    seen: false, reps: 0, interval: 0, ease: 2.5, lapses: 0, due: 0,
  };
}

export const cards = (deckId) =>
  Object.values(db.cards).filter((c) => alive(c) && c.deckId === deckId);
export const card = (id) => (alive(db.cards[id]) ? db.cards[id] : null);

export function addCard(deckId, front, back) {
  const c = newCard(deckId, front, back);
  db.cards[c.id] = c;
  save();
  return c;
}

export function updateCard(id, patch) {
  Object.assign(db.cards[id], patch, { updated: now() });
  save();
}

export const deleteCard = (id) => updateCard(id, { deleted: true });

export function resetCard(id) {
  updateCard(id, { seen: false, reps: 0, interval: 0, ease: 2.5, lapses: 0, due: 0 });
}

/**
 * Importe des paquets issus de parseText(). Une carte dont la question existe
 * déjà dans le paquet est mise à jour (sa progression est conservée).
 *
 * - prune  : supprime les cartes du paquet absentes du texte.
 * - source : nom du fichier de la Bibliothèque (cours partagé). Le paquet est alors
 *            reconnu par sa source, et seules les cartes venant du cours (lib) sont
 *            supprimées : les cartes perso ajoutées à la main sont conservées.
 */
/** Supprime les paquets de la bibliothèque dont le fichier n'est plus dans la liste partagée. */
export function pruneLibraryDecks(files) {
  const keep = new Set(files);
  let n = 0;
  for (const d of Object.values(db.decks)) {
    if (!alive(d) || !d.source) continue;
    if (!keep.has(d.source.replace(/#\d+$/, ''))) { deleteDeck(d.id); n++; }
  }
  return n;
}

// - autosave : false → l'appelant enregistre lui-même (la Bibliothèque enregistre une seule
//              fois après tous les cours). Dans tous les cas, rien n'est écrit si rien n'a changé.
export function importDecks(parsed, { prune = false, source = null, autosave = true } = {}) {
  let added = 0, updated = 0, removed = 0;
  let changed = false; // modification sans effet sur les compteurs (source, nom, marque « lib »)
  const names = [];
  parsed.forEach((p, i) => {
    const src = source ? `${source}#${i}` : null;
    let d = (src && Object.values(db.decks).find((x) => alive(x) && x.source === src))
      || deckByName(p.name)
      || createDeck(p.name);
    if (src && (d.source !== src || d.name !== p.name)) {
      Object.assign(d, { source: src, name: p.name, updated: now() });
      changed = true;
    }
    names.push(d.name);
    const existing = new Map(cards(d.id).map((c) => [norm(c.front), c]));
    if (prune) {
      const keep = new Set(p.cards.flatMap((c) => [c.front, ...(c.was || [])].map(norm)));
      for (const [key, c] of existing) {
        if (!keep.has(key) && (!src || c.lib)) {
          Object.assign(c, { deleted: true, updated: now() });
          existing.delete(key);
          removed++;
        }
      }
    }
    for (const { front, back, was = [] } of p.cards) {
      let ex = existing.get(norm(front));
      // Carte reformulée : on retrouve l'ancienne par sa question d'avant.
      const oldKey = !ex && was.map(norm).find((k) => existing.has(k));
      if (oldKey) {
        ex = existing.get(oldKey);
        existing.delete(oldKey);
        Object.assign(ex, { front, updated: now() });
        existing.set(norm(front), ex);
        updated++;
      }
      if (ex) {
        if (ex.back !== back) { Object.assign(ex, { back, updated: now() }); updated++; }
        if (src && !ex.lib) { Object.assign(ex, { lib: true, updated: now() }); changed = true; }
      } else {
        const c = newCard(d.id, front, back);
        c.lib = !!src;
        db.cards[c.id] = c;
        existing.set(norm(front), c);
        added++;
      }
    }
  });
  changed ||= added + updated + removed > 0;
  if (changed && autosave) save();
  return { added, updated, removed, names, changed };
}

/* ---------- Compteurs du jour (limites de nouvelles cartes / révisions) ---------- */

/** kind = 'new' (nouvelles cartes vues) ou 'rev' (révisions faites) aujourd'hui. */
export const countToday = (deckId, kind) => db.meta.daily[today()]?.[deckId]?.[kind] || 0;

export function bumpToday(deckId, kind) {
  const k = today();
  db.meta.daily = { [k]: db.meta.daily[k] || {} }; // on ne garde que le jour en cours
  const d = (db.meta.daily[k][deckId] ??= { new: 0, rev: 0 });
  d[kind]++;
  save();
}

/* ---------- Réglages & sauvegarde ---------- */

export const settings = () => db.meta.settings;
export function setSetting(key, value) {
  db.meta.settings[key] = value;
  save();
}

export function exportBackup() {
  return JSON.stringify({ app: 'memo', version: 1, exported: new Date().toISOString(), ...db });
}

/** Fusionne une sauvegarde : pour chaque objet, la version la plus récente gagne. */
export function importBackup(json) {
  const d = JSON.parse(json);
  if (!d || typeof d.decks !== 'object' || typeof d.cards !== 'object') {
    throw new Error('Fichier de sauvegarde invalide');
  }
  // Un fichier de sauvegarde peut venir de quelqu'un d'autre : on n'accepte que des objets
  // bien formés (id simples, textes en texte), pour qu'aucun contenu ne s'injecte dans la page.
  const okId = (v) => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
  const okStr = (v) => typeof v === 'string' && v.length <= 20000;
  const valid = {
    decks: (o, id) => o.id === id && okStr(o.name) && (o.source == null || okStr(o.source)),
    cards: (o, id) => o.id === id && okId(o.deckId) && okStr(o.front) && okStr(o.back),
  };
  for (const kind of ['decks', 'cards']) {
    for (const [id, obj] of Object.entries(d[kind])) {
      if (!okId(id) || !obj || typeof obj !== 'object' || !valid[kind](obj, id)) continue;
      const cur = db[kind][id];
      if (!cur || (obj.updated || 0) > (cur.updated || 0)) db[kind][id] = obj;
    }
  }
  save();
}
