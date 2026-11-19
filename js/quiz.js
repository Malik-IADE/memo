/**
 * Quizz : QCM et QCU rangés par semestre puis par UE, comme les flashcards.
 *
 * « quiz/liste.txt » : une ligne par fichier, ex. « S1/3.3/estomac-plein.txt ».
 * Un fichier de quiz :
 *   # Titre du cours
 *   QCM · Thème            (ou « QCU · Thème » : une seule bonne réponse)
 *   La question, sur une ou plusieurs lignes
 *   + Proposition exacte :: pourquoi elle est exacte
 *   - Proposition fausse :: pourquoi elle est fausse
 *   > Correction (une ligne « > » par paragraphe)
 *   @ Source dans le cours (diapositives, pages)
 * Les questions sont séparées par une ligne vide ; « // » marque un commentaire.
 */

const LIST = 'quiz/liste.txt';
const MEM_KEY = 'memo-quiz-v1';

/** Petite empreinte stable d'un texte : identifie une question sans dépendre de sa position. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function parseQuiz(text, file) {
  const quiz = { file, title: '', questions: [] };
  let q = null;
  const flush = () => {
    if (q && q.stem.length && q.opts.length && q.opts.some((o) => o.ok)) {
      q.stem = q.stem.join('\n');
      q.key = `${file}#${hash(q.stem)}`;
      q.multi = q.type !== 'QCU';
      quiz.questions.push(q);
    }
    q = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('//')) continue;
    if (!line) { flush(); continue; }
    if (line.startsWith('# ') && !quiz.title) { quiz.title = line.slice(2).trim(); continue; }
    const head = line.match(/^(QCM|QCU)\b\s*(?:·\s*(.*))?$/);
    if (head) { flush(); q = { type: head[1], theme: (head[2] || '').trim(), stem: [], opts: [], exp: [], ref: '' }; continue; }
    if (!q) continue;
    const opt = line.match(/^([+-])\s+(.*)$/);
    if (opt) {
      const [text, note = ''] = opt[2].split(' :: ');
      q.opts.push({ text: text.trim(), note: note.trim(), ok: opt[1] === '+' });
    } else if (line.startsWith('>')) q.exp.push(line.slice(1).trim());
    else if (line.startsWith('@')) q.ref = line.slice(1).trim();
    else if (!q.opts.length) q.stem.push(line);
  }
  flush();
  for (const x of quiz.questions) x.quizTitle = quiz.title;
  return quiz;
}

/** Les fichiers de la liste, chargés une seule fois (le service worker les garde pour l'hors-ligne). */
let cache = null;
let listCache = null;
const pathInfo = (file) => {
  const [sem, ue] = file.split('/');
  return { sem, ue: /^\d+\.\d+$/.test(ue) ? ue : null };
};

export async function loadList() {
  if (listCache) return listCache;
  try {
    const res = await fetch(LIST, { cache: 'no-cache' });
    if (!res.ok) throw new Error();
    listCache = (await res.text()).split(/\r?\n/).map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//')).map((file) => ({ file, ...pathInfo(file) }));
    try { localStorage.setItem('memo-quiz-list', JSON.stringify(listCache)); } catch {}
  } catch {
    try { listCache = JSON.parse(localStorage.getItem('memo-quiz-list')) || []; } catch { listCache = []; }
  }
  return listCache;
}
export const knownList = () => {
  if (listCache) return listCache;
  try { return JSON.parse(localStorage.getItem('memo-quiz-list')) || []; } catch { return []; }
};

export async function loadQuizzes() {
  if (cache) return cache;
  const list = await loadList();
  const all = await Promise.all(list.map(async ({ file, sem, ue }) => {
    try {
      const res = await fetch(`quiz/${file}`, { cache: 'no-cache' });
      if (!res.ok) return null;
      const quiz = parseQuiz(await res.text(), file);
      quiz.sem = sem; quiz.ue = ue;
      quiz.slug = file.replace(/^.*\//, '').replace(/\.txt$/, '');
      for (const x of quiz.questions) { x.sem = sem; x.ue = ue; }
      return quiz.questions.length ? quiz : null;
    } catch { return null; }
  }));
  cache = all.filter(Boolean);
  return cache;
}
export const loadedQuizzes = () => cache;

/* ---------- Mémoire locale : dernière auto-évaluation de chaque question ---------- */
const readMem = () => { try { return JSON.parse(localStorage.getItem(MEM_KEY)) || {}; } catch { return {}; } };
export function remember(key, grade) {
  const mem = readMem();
  const prev = mem[key] || { n: 0 };
  mem[key] = { g: grade, n: prev.n + 1, t: Date.now() };
  try { localStorage.setItem(MEM_KEY, JSON.stringify(mem)); } catch {}
}
export const memoryOf = (key) => readMem()[key];
/** Dernière auto-évaluation de chaque question déjà notée : nombre par niveau (0 à 3). */
export function bilan() {
  const n = [0, 0, 0, 0];
  for (const m of Object.values(readMem())) if (Number.isInteger(m?.g) && m.g >= 0 && m.g <= 3) n[m.g] += 1;
  return n;
}

/* ---------- Série en cours : reprise après avoir quitté ou fermé l'app ---------- */
const RUN_KEY = 'memo-quiz-encours-v1';
const RUN_MAX_AGE = 60 * 24 * 3600 * 1000; // une série abandonnée depuis 60 jours est oubliée
const readRuns = () => { try { return JSON.parse(localStorage.getItem(RUN_KEY)) || {}; } catch { return {}; } };
const writeRuns = (runs) => { try { localStorage.setItem(RUN_KEY, JSON.stringify(runs)); } catch {} };

/** Enregistre la série (questions par leur clé, ordre des propositions, position, choix en cours). */
export function saveRun(s) {
  const runs = readRuns();
  if (s.i >= s.items.length) delete runs[s.id];
  else runs[s.id] = {
    keys: s.items.map((it) => it.q.key), orders: s.items.map((it) => it.order),
    i: s.i, chosen: [...s.chosen], validated: s.validated,
    results: s.results, grades: s.grades, t: Date.now(),
  };
  writeRuns(runs);
}
export function clearRun(id) { const runs = readRuns(); if (id in runs) { delete runs[id]; writeRuns(runs); } }

/** Série en cours d'un quiz : position et nombre de questions, ou null. */
export function runInfo(id) {
  const r = readRuns()[id];
  return r && Date.now() - r.t < RUN_MAX_AGE && r.i > 0 ? { i: r.i, n: r.keys.length } : null;
}

/** Reconstruit une série enregistrée avec les questions actuelles (une question retirée du fichier est sautée). */
export function restoreRun(id, questions) {
  const r = readRuns()[id];
  if (!r || Date.now() - r.t >= RUN_MAX_AGE) return null;
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const items = [];
  let i = 0;
  r.keys.forEach((k, pos) => {
    const q = byKey.get(k);
    if (!q) return;
    const order = Array.isArray(r.orders[pos]) && r.orders[pos].length === q.opts.length ? r.orders[pos] : optionOrder(q);
    items.push({ q, order });
    if (pos < r.i) i++;
  });
  if (!items.length || i >= items.length) { clearRun(id); return null; }
  const same = r.keys[r.i] === items[i].q.key; // la question en cours existe toujours
  return {
    id, items, i,
    chosen: new Set(same ? (r.chosen || []).filter((k) => k < items[i].q.opts.length) : []),
    validated: same && !!r.validated && (r.chosen || []).length > 0,
    results: { juste: 0, incomplet: 0, faux: 0, ...r.results }, grades: r.grades || [0, 0, 0, 0],
  };
}

/** Ordre aléatoire (Fisher-Yates). */
export function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

/**
 * Ordre d'affichage des propositions : mélangé à chaque fois, sauf pour les QCU
 * « deux affirmations et leur lien », dont l'ordre logique compte.
 * « Aucune / toutes les propositions » restent en dernier.
 */
export function optionOrder(q) {
  const idx = q.opts.map((_, i) => i);
  if (q.opts.some((o) => /affirmation/i.test(o.text))) return idx;
  const last = idx.filter((i) => /^(aucune|toutes) (des|les) propositions/i.test(q.opts[i].text));
  return [...shuffle(idx.filter((i) => !last.includes(i))), ...last];
}

/**
 * Quiz aléatoire : un tirage pondéré dans toutes les questions.
 * Jamais vues et « À revoir » d'abord, « Facile » rarement.
 */
const WEIGHT = { none: 3, 0: 4, 1: 3, 2: 1, 3: 0.4 };
export function randomPick(questions, n = 20) {
  const mem = readMem();
  const pool = questions.map((q) => {
    const m = mem[q.key];
    const w = WEIGHT[m ? m.g : 'none'] ?? 1;
    return { q, k: Math.random() ** (1 / w) }; // tirage pondéré sans remise
  });
  return pool.sort((a, b) => b.k - a.k).slice(0, n).map((x) => x.q);
}

/** Résultat d'une réponse : exacte, incomplète (rien de faux mais un oubli) ou fausse. */
export function verdict(q, chosen) {
  const wrong = [...chosen].some((i) => !q.opts[i].ok);
  const missed = q.opts.some((o, i) => o.ok && !chosen.has(i));
  return wrong ? 'faux' : missed ? 'incomplet' : 'juste';
}
