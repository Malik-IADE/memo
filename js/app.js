import * as store from './store.js';
import { schedule, previewIntervals, endOfToday, dueLabel } from './srs.js';
import { parseText, deckToText } from './format.js';
import { syncLibrary } from './library.js';
import * as quiz from './quiz.js';

const $app = document.getElementById('app');
const modal = document.getElementById('modal');
const fileInput = document.getElementById('file-input');

/* ---------- Utilitaires ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Images : « [img:chemin] » n'importe où dans la question ou la réponse. */
const IMG = /\[img:([^\]]+)\]\s*/g;
const takeImgs = (s) => ({ imgs: [...s.matchAll(IMG)].map((m) => m[1].trim()), text: s.replace(IMG, '').trim() });
// Seulement des images sûres : chemins du site, https ou images bitmap en data URI (jamais javascript:, //… ni SVG).
const safeSrc = (src) => /^(https:\/\/|paquets\/|icons\/|data:image\/(png|jpeg|webp|gif);base64,)/i.test(src);
const imgsHtml = (imgs) => imgs.filter(safeSrc).map((src) => `<button type="button" class="card-img" data-action="zoom" data-src="${esc(src)}" aria-label="Agrandir l'image">
    <img src="${esc(src)}" alt="" loading="lazy"><span class="card-img-hint">Touchez pour agrandir</span></button>`).join('');
const plainText = (s) => (takeImgs(s).imgs.length ? '🖼 ' : '') + takeImgs(s).text;
// Typographie française à l'affichage : espace insécable avant ? ! : ; » et après «
// (évite un « ? » seul en début de ligne). Le texte enregistré n'est pas modifié.
const nb = (html) => html.replace(/ ([?!:;»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');
const rich = (s) => nb(esc(s)).replace(/\n/g, '<br>');
/**
 * Une ligne de réponse :
 * - « Titre : » seul → étiquette en gras (ses lignes « - » deviennent ses sous-puces) ;
 * - « Étiquette : texte » → étiquette en gras puis texte ;
 * - sinon texte simple.
 */
const formatLine = (l) => {
  const head = l.match(/^(.{1,60}) :$/);
  if (head) return `<strong>${nb(esc(head[1]))}</strong>`;
  const m = l.match(/^([^:]{1,50}?) : (.+)$/);
  return m ? `<strong>${nb(esc(m[1]))}</strong>\u00a0: ${nb(esc(m[2]))}` : nb(esc(l));
};
/**
 * Mise en forme unique de toutes les réponses, sur deux niveaux :
 * - chaque ligne → puce principale ;
 * - chaque ligne « - » → sous-puce en retrait de la puce qui la précède.
 */
const richAnswer = (s) => {
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  // Même mise en forme pour toutes les réponses, y compris celles d'une seule ligne.
  const items = [];
  for (const l of lines) {
    if (l.startsWith('- ') && items.length) items[items.length - 1].subs.push(l.slice(2));
    else items.push({ text: l.replace(/^- /, ''), subs: [] });
  }
  // Légende de schéma (« 1 : …, 2 : … ») assez longue : deux colonnes, lues de haut en bas.
  const legend = items.length >= 6 && items.every((it) => !it.subs.length && /^\d+\s*:/.test(it.text));
  const cls = legend ? ` legend-cols" style="grid-template-rows:repeat(${Math.ceil(items.length / 2)},auto)` : '';
  return `<ul class="answer-list${cls}">${items.map((it) => `<li>${formatLine(it.text)}${it.subs.length
    ? `<ul class="answer-sub">${it.subs.map((t) => `<li>${formatLine(t)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>`;
};
// « cours » est déjà au pluriel : pas de « s » en plus.
const plural = (n, word) => `${n} ${word}${n > 1 && !word.endsWith('s') ? 's' : ''}`;
const baseName = (f) => f.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ico = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  upload: svg('<path d="M12 15V3M7 8l5-5 5 5M5 21h14"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  more: svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
  chevron: svg('<path d="M9 18l6-6-6-6"/>'),
  chevDown: svg('<path d="M6 9l6 6 6-6"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  cards: svg('<rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v11"/>'),
  exam: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 14.5l2 2 4-4.5"/>'),
  restart: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  shuffle: svg('<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  medal: svg('<circle cx="12" cy="15" r="6"/><path d="M8.5 9.5 6 2h12l-2.5 7.5"/>'),
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>'),
  quiz: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 9 1.5 1.5L11 8M7 15.5l1.5 1.5 2.5-2.5M14 9h3M14 15.5h3"/>'),
};

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function pickFile(accept, onText) {
  fileInput.accept = accept;
  fileInput.value = '';
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (f) onText(await f.text(), f.name);
  };
  fileInput.click();
}

/* ---------- Statistiques ---------- */

function stats(deckId) {
  const cs = store.cards(deckId);
  const end = endOfToday();
  let due = 0, fresh = 0;
  for (const c of cs) {
    if (!c.seen) fresh++;
    else if (c.due <= end) due++;
  }
  const st = store.settings();
  const newLeft = Math.max(0, st.newPerDay - store.countToday(deckId, 'new'));
  const revLeft = Math.max(0, st.reviewsPerDay - store.countToday(deckId, 'rev'));
  const newAvail = Math.min(fresh, newLeft);
  const dueAvail = Math.min(due, revLeft); // au-delà de la limite : reporté aux prochaines sessions
  return { total: cs.length, due, dueAvail, backlog: due - dueAvail, fresh, newAvail, todo: dueAvail + newAvail };
}

/* « Flashcards aléatoires » : les cartes des cours partagés, tirées au hasard (sans les Schémas). */
const MIX = 'mix';
const MIX_NAME = 'Flashcards aléatoires';
const mixDecks = () => store.decks().filter((d) => d.source && !isFcCat(locate(d).sem));
function mixStats(precomputed = null) {
  const ds = precomputed
    ? precomputed.filter((r) => r.d.source && !isFcCat(r.loc.sem)).map((r) => r.s)
    : mixDecks().map((d) => stats(d.id));
  const st = store.settings();
  const dueAvail = ds.reduce((n, s) => n + s.dueAvail, 0);
  const fresh = ds.reduce((n, s) => n + s.fresh, 0);
  const newLeft = Math.max(0, st.newPerDay - store.countToday(MIX, 'new'));
  const newAvail = Math.min(fresh, newLeft);
  return { dueAvail, newAvail, todo: dueAvail + newAvail, decks: ds.length };
}

/* ---------- Routage ---------- */

let session = null;
let searchQuery = '';   // ce qui est tapé dans la recherche, gardé d'un écran à l'autre

function route() {
  const [view, id, sub, item] = (location.hash.slice(1) || '/').split('/').filter(Boolean).map(decodeURIComponent);
  return { view: view || 'home', id, sub, item };
}

function render() {
  const r = route();
  // L'écran d'un cours n'existe plus : ouvrir un cours lance directement sa révision.
  if (r.view === 'deck' && store.deck(r.id)) { location.replace(`#/review/${enc(r.id)}`); return; }
  if (r.view === 'review' && (r.id === MIX || store.deck(r.id))) return renderReview(r.id);
  if (r.view === 'f' && r.id) return r.sub ? renderUE(r.id, r.sub, rubrique(r.item)) : renderFolder(r.id);
  if (r.view === 'fc') return renderFlashcards();
  if (r.view === 'quiz') return r.item && !rubrique(r.item) ? renderQuizSession(`${r.id}/${r.sub}/${r.item}`) : renderQuizMenu(r.id, r.sub, rubrique(r.item));
  if (r.view === 'quiz-aleatoire') return r.id ? renderQuizSession(randomId(r.id, r.sub)) : renderRandomMenu();
  if (r.view === 'recherche') return renderSearch(searchQuery);
  if (r.view === 'carte' && r.id) return renderCard(r.id);
  if (r.view === 'resultats') return renderResults();
  if (COLLECTIONS[r.view]) {
    if (r.id && r.sub) return renderAnnalesUE(r.id, r.sub, r.view);
    if (r.id) return renderAnnalesSem(r.id, r.view);
    return renderAnnales(r.view);
  }
  renderHome();
}

/**
 * Statistiques anonymes (GoatCounter) : une « page vue » par écran.
 * Chemins lisibles : /accueil, /S1, /S1/3.3, /cours/<nom>, /revision/<nom>. Jamais de donnée personnelle.
 */
function trackView() {
  const r = route();
  const name = (id) => { if (id === MIX) return MIX_NAME; const d = store.deck(id); return d ? shortName(d.name) : 'inconnu'; };
  const path = r.view === 'f' ? `/${[r.id, r.sub].filter(Boolean).join('/')}`
    : r.view === 'fc' ? '/flashcards'
    : r.view === 'quiz' ? (r.item ? `/quiz-cours/${quizTitle(`${r.id}/${r.sub}/${r.item}`)}`
      : `/quiz${[r.id, r.sub].filter(Boolean).map((x) => `/${x}`).join('')}`)
    : r.view === 'quiz-aleatoire' ? `/quiz-aleatoire${[r.id, r.sub].filter(Boolean).map((x) => `/${x}`).join('')}`
    : COLLECTIONS[r.view] ? `/${r.view}${[r.id, r.sub].filter(Boolean).map((s) => `/${s}`).join('')}`
    : r.view === 'deck' ? `/cours/${name(r.id)}`
    : r.view === 'review' ? `/revision/${name(r.id)}`
    : '/accueil';
  const send = () => window.goatcounter?.count?.({ path, title: path });
  if (window.goatcounter?.count) send();
  else setTimeout(send, 1500); // le script se charge en différé
}

// L'écran précédent, pour que la carte seule sache où revenir (recherche ou cours).
let hashPrecedent = '#/';
// Le dernier menu visité (ni révision, ni carte seule) : la croix d'une révision y ramène.
let menuPrecedent = null;
window.addEventListener('hashchange', (e) => {
  const avant = new URL(e.oldURL).hash || '#/';
  if (!avant.startsWith('#/carte/')) hashPrecedent = avant;
  if (!/^#\/(review|carte|deck)\//.test(avant) && !/^#\/quiz(-aleatoire\/|\/[^/]+\/[^/]+\/[^~/])/.test(avant)) menuPrecedent = avant;
  window.scrollTo(0, 0); render(); trackView();
});

/* ---------- Dossiers : Semestre → UE → cours ---------- */

// Emplacement d'un paquet d'après son fichier dans la Bibliothèque :
// « S1/3.3/cours.txt » → semestre « S1 », UE « 3.3 ». « Scores/scores.txt » → catégorie « Scores ».
// Paquets perso → dossier « perso ».
function locate(d) {
  const parts = (d.source || '').split('#')[0].split('/');
  if (parts.length >= 3) return { sem: parts[0], ue: parts[1], group: parts.length >= 4 ? parts[2] : null };
  if (parts.length === 2) return { sem: parts[0], ue: null };
  return { sem: d.source ? 'partages' : 'perso', ue: null };
}
// Catégorie à un seul paquet (ex. « Scores ») : l'accueil ouvre directement le paquet.
const isSingleCategory = (sem) => !/^S\d+$/i.test(sem) && sem !== 'perso' && sem !== 'partages';
// Catégories rangées tout en haut de « Flashcards » plutôt que sur l'accueil.
const FC_CATS = ['Schemas'];
const isFcCat = (sem) => FC_CATS.includes(sem);

// Dossiers en ASCII sur le serveur, nom accentué dans l'app.
const CAT_LABELS = { Schemas: 'Schémas' };
const semLabel = (sem) => sem === 'perso' ? 'Mes paquets'
  : sem === 'partages' ? 'Cours partagés'
  : /^S\d+$/i.test(sem) ? `Semestre ${sem.slice(1)}` : CAT_LABELS[sem] || sem;
const ueLabel = (ue) => `UE ${ue}`;
const enc = encodeURIComponent;
const folderHref = (d) => {
  const { sem, ue, group } = locate(d);
  if (!ue && isSingleCategory(sem)) return isFcCat(sem) ? '#/fc' : '#/';
  return ue ? `#/f/${enc(sem)}/${enc(ue)}${group ? `/~${enc(group)}` : ''}` : `#/f/${enc(sem)}`;
};
const byKey = (a, b) => a.localeCompare(b, 'fr', { numeric: true });

// Dans un dossier d'UE, le préfixe « IADE – » est superflu.
const shortName = (name) => name.replace(/^IADE\s*[–-]\s*/, '');
/** Ordre alphabétique français des cours (accents et majuscules ignorés, nombres dans l'ordre). */
// Rubriques d'une UE (sous-dossiers, ex. « Terrains », « Chirurgie ») : un dossier cliquable par rubrique,
// adresse « …/<UE>/~<rubrique> » (le « ~ » distingue une rubrique d'un quiz).
const rubrique = (seg) => (seg && seg.startsWith('~') ? seg.slice(1) : null);
const rubriquesOf = (items, groupOf) => [...new Set(items.map(groupOf).filter(Boolean))].sort((a, b) => byName(a, b));
const byName = new Intl.Collator('fr', { sensitivity: 'base', numeric: true }).compare;

/* ---------- Annales : des quiz HTML rangés par semestre puis par UE ---------- */
// Deux collections : les sujets officiels de l'école (dossier « annales/ ») et les
// sujets de promotions précédentes (dossier « annales-nf/ »).
// Chaque « liste.txt » : une ligne « S1/3.3-2013-2015.html | titre ». Le semestre et
// l'UE sont lus au début du chemin ; le reste du nom distingue les annales d'une même
// UE. Les listes sont gardées en mémoire locale pour l'hors-ligne.
const COLLECTIONS = {
  annales: { dir: 'annales', key: 'memo-annales', label: 'Annales officielles', short: 'Annales', sub: 'Sujets d\'examen en quiz interactif.' },
  'annales-nf': { dir: 'annales-nf', key: 'memo-annales-nf', label: 'Annales non officielles', short: 'Annales non officielles', sub: 'Sujets des promotions précédentes, en quiz interactif.' },
};
const readList = (key) => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
const lists = Object.fromEntries(Object.entries(COLLECTIONS).map(([k, c]) => [k, readList(c.key)]));
const annalesIn = (kind) => lists[kind] || [];
const annalesOf = (sem, ue, kind = 'annales') => annalesIn(kind).filter((a) => a.sem === sem && a.ue === ue);
async function loadAnnales() {
  for (const [kind, c] of Object.entries(COLLECTIONS)) {
    try {
      const res = await fetch(`${c.dir}/liste.txt`, { cache: 'no-cache' });
      if (!res.ok) continue;
      const list = (await res.text()).split(/\r?\n/).map((l) => l.trim())
        .filter((l) => l && !l.startsWith('//'))
        .map((l) => {
          const [file, label = ''] = l.split('|').map((s) => s.trim());
          const m = file.match(/^([^/]+)\/(\d+\.\d+)(.*)\.html?$/);
          return m ? { sem: m[1], ue: m[2], href: `${c.dir}/${file}`, label: label || `Annales de l'UE ${m[2]}` } : null;
        })
        .filter(Boolean);
      const changed = JSON.stringify(list) !== JSON.stringify(lists[kind]);
      lists[kind] = list;
      try { localStorage.setItem(c.key, JSON.stringify(list)); } catch {}
      const v = route().view;
      if (changed && (v === 'home' || COLLECTIONS[v]) && !modal.open) render();
    } catch { /* hors ligne : on garde la dernière liste connue */ }
  }
}
// Années couvertes, lues dans le titre : « Annales 2013-2015 UE 3.3 » → « 2013-2015 ».
const annaleYears = (a) => (a.label.match(/\d{4}\s*[–-]\s*\d{4}/) || [''])[0];

const allRows = () => store.decks().map((d) => ({ d, s: stats(d.id), loc: locate(d) }));
const sumTodo = (rows) => rows.reduce((n, r) => n + r.s.todo, 0);

function topbarHome(todo = null) {
  // Le compte du jour se loge entre le titre et les boutons, pour libérer de la place sous la barre.
  const today = todo === null ? '' : `
      <div class="topbar-today">
        <span class="eyebrow">Aujourd'hui</span>
        <span class="today-value">${todo ? `${plural(todo, 'carte')} à réviser` : 'Tout est à jour ✓'}</span>
      </div>`;
  return `
    <header class="topbar">
      <div class="brand"><img src="icons/icon.svg" alt="" class="logo"><h1>Mémo</h1></div>${today}
      <div class="topbar-actions">
        <a class="btn ghost" href="#/resultats" title="Mes notes aux annales">${ico.medal}<span class="hide-xs">Mes notes</span></a>
        <button class="icon-btn" data-action="settings" aria-label="Réglages">${ico.gear}</button>
      </div>
    </header>`;
}

function topbarFolder(backHref, title, eyebrow = '') {
  // Flèche « Retour » (un cran en arrière) et, à côté, un raccourci vers l'accueil.
  return `
    <header class="topbar">
      <div class="topbar-nav">
        <a class="icon-btn" href="${esc(backHref)}" aria-label="Retour">${ico.back}</a>
        ${backHref === '#/' ? '' : `<a class="icon-btn" href="#/" aria-label="Accueil" title="Accueil">${ico.home}</a>`}
      </div>
      <div class="topbar-title">
        ${eyebrow ? `<span class="topbar-eyebrow">${esc(eyebrow)}</span>` : ''}
        <h1 class="title-sm">${esc(title)}</h1>
      </div>
      <span class="topbar-nav" aria-hidden="true">
        <span class="icon-btn"></span>${backHref === '#/' ? '' : '<span class="icon-btn"></span>'}
      </span>
    </header>`;
}

/* ---------- Recherche dans toutes les cartes ---------- */

// Sans accents ni ponctuation : « œdème » se trouve en tapant « oedeme ».
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^a-z0-9]+/g, ' ').trim();

// Cache du texte normalisé par carte : évite de recalculer normalize/regex sur toutes les cartes à chaque frappe.
const foldCache = new Map();
function foldedCard(c, nom) {
  const hit = foldCache.get(c.id);
  if (hit && hit.u === c.updated && hit.nom === nom) return hit.hay;
  const hay = fold(`${c.front} ${c.back} ${nom}`);
  foldCache.set(c.id, { u: c.updated, nom, hay });
  return hay;
}
function invalidateSearch() { notions = null; foldCache.clear(); }

/** Toutes les cartes qui contiennent tous les mots cherchés, les cours partagés d'abord. */
function searchCards(q) {
  const mots = fold(q).split(' ').filter(Boolean);
  if (!mots.length) return [];
  const out = [];
  for (const d of store.decks()) {
    const nom = shortName(d.name);
    for (const c of store.cards(d.id)) {
      const hay = foldedCard(c, nom);
      if (mots.every((m) => hay.includes(m))) out.push({ c, d, nom });
      if (out.length > 300) return out;
    }
  }
  return out;
}

// Met en évidence les mots cherchés dans un extrait de texte.
function surligne(texte, mots) {
  const brut = plainText(texte).replace(/\n/g, ' · ');
  if (!mots.length) return esc(brut);
  const motifs = mots.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // On compare sans accents : on repère les positions sur une copie « pliée » de même longueur.
  const plie = brut.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, (x, i) => '');
  const src = plie.length === brut.length ? plie : brut.toLowerCase();
  let out = '', i = 0;
  for (const m of src.matchAll(new RegExp(motifs, 'g'))) {
    out += esc(brut.slice(i, m.index)) + `<mark>${esc(brut.slice(m.index, m.index + m[0].length))}</mark>`;
    i = m.index + m[0].length;
  }
  return out + esc(brut.slice(i));
}

/**
 * Index des notions : chaque mot d'au moins 3 lettres rencontré dans les cartes,
 * avec le nombre de cartes où il apparaît. Sert aux propositions pendant la frappe.
 * Construit une seule fois, à la première recherche.
 */
let notions = null;
const VIDES = new Set(('alors apres aussi autre avant avec avoir bien cela cette chez comme dans deux dont donc elle elles '
  + 'entre est etre faire fait ils leur leurs mais meme moins null nest ont ou par pas peut plus pour quand que quel quelle '
  + 'quelles quels qui quoi sans selon sert ses soit son sont sous sur tous tout toute toutes tres une uns vers voir vous '
  + 'est-ce quest quels quelles comment pourquoi faut-il doit-elle peut-on lors ceux celui celle').split(' '));
function buildNotions() {
  if (notions) return notions;
  const n = new Map();
  for (const d of store.decks()) {
    for (const c of store.cards(d.id)) {
      const vus = new Set(fold(`${c.front} ${c.back}`).split(' '));
      for (const m of vus) {
        if (m.length < 3 || VIDES.has(m) || /^\d+$/.test(m)) continue;
        n.set(m, (n.get(m) || 0) + 1);
      }
    }
    for (const m of fold(shortName(d.name)).split(' ')) {
      if (m.length >= 3 && !VIDES.has(m)) n.set(m, (n.get(m) || 0) + 40);
    }
  }
  notions = [...n].sort((a, b) => b[1] - a[1]);
  return notions;
}

/** Propositions pour ce qui est tapé : le dernier mot complété, comme une barre de recherche web. */
function suggestions(q) {
  const brut = fold(q);
  if (!brut) return [];
  const mots = brut.split(' ');
  const debut = mots.slice(0, -1), dernier = mots[mots.length - 1];
  if (dernier.length < 2) return [];
  const prefixe = [], dedans = [];
  for (const [mot, poids] of buildNotions()) {
    if (mot === dernier) continue;
    if (mot.startsWith(dernier)) prefixe.push([mot, poids]);
    else if (prefixe.length + dedans.length < 40 && mot.includes(dernier)) dedans.push([mot, poids]);
    if (prefixe.length >= 8) break;
  }
  return [...prefixe, ...dedans].slice(0, 7).map(([mot]) => [...debut, mot].join(' '));
}

function renderSearch(q = '') {
  session = null;
  $app.innerHTML = `${topbarFolder('#/', 'Recherche')}
    <main class="page">
      <div class="search-field">
        <div class="search-box big">
          ${ico.search}
          <input type="text" id="q" placeholder="Chercher une notion…" aria-label="Chercher une notion"
            value="${esc(q)}" autocomplete="off" autocapitalize="off" spellcheck="false"
            enterkeyhint="search" role="combobox" aria-expanded="false" aria-controls="sugg" aria-autocomplete="list">
          <button type="button" class="search-clear" id="vider" aria-label="Effacer" hidden>${ico.close}</button>
        </div>
        <ul class="suggestions" id="sugg" role="listbox" hidden></ul>
      </div>
      <div id="results-zone"></div>
    </main>`;

  const input = document.getElementById('q');
  const $sugg = document.getElementById('sugg');
  const $zone = document.getElementById('results-zone');
  let choix = -1, liste = [];

  /* --- résultats --- */
  function montrerResultats(texte) {
    const mots = fold(texte).split(' ').filter(Boolean);
    if (!texte.trim()) {
      $zone.innerHTML = '<p class="hint center pad">Tapez un mot : les cartes de tous les cours s\'affichent ici.</p>';
      return;
    }
    const res = searchCards(texte);
    if (!res.length) {
      $zone.innerHTML = `<p class="hint center pad">Aucune carte ne contient « ${esc(texte.trim())} ».</p>`;
      return;
    }
    $zone.innerHTML = `
      <p class="results-count">${plural(res.length, 'carte')}${res.length > 60 ? ' · 60 affichées' : ''}</p>
      <section class="panel flush">
        <ul class="card-list">${res.slice(0, 60).map(({ c, d, nom }) => `
          <li class="search-hit">
            <a class="card-row hit-link" href="#/carte/${esc(c.id)}">
              <span class="card-text">
                <span class="card-front">${surligne(c.front, mots)}</span>
                <span class="card-back">${surligne(c.back, mots)}</span>
              </span>
              <span class="hit-deck">${esc(nom)}</span>
            </a>
          </li>`).join('')}</ul>
      </section>`;
  }

  /* --- propositions --- */
  function fermer() {
    $sugg.hidden = true; $sugg.innerHTML = ''; choix = -1; liste = [];
    input.setAttribute('aria-expanded', 'false');
  }
  function montrerSuggestions() {
    liste = suggestions(input.value);
    if (!liste.length) return fermer();
    const dernier = fold(input.value).split(' ').pop();
    $sugg.innerHTML = liste.map((s, i) => {
      const mot = s.split(' ').pop();
      const reste = mot.startsWith(dernier) ? mot.slice(dernier.length) : '';
      const vu = reste ? `<b>${esc(mot.slice(0, dernier.length))}</b>${esc(reste)}` : esc(mot);
      const avant = s.slice(0, s.length - mot.length);
      return `<li role="option" id="sg${i}" data-i="${i}" aria-selected="false">${ico.search}<span>${esc(avant)}${vu}</span></li>`;
    }).join('');
    $sugg.hidden = false; choix = -1;
    input.setAttribute('aria-expanded', 'true');
  }
  function surligneChoix() {
    [...$sugg.children].forEach((li, i) => {
      li.classList.toggle('on', i === choix);
      li.setAttribute('aria-selected', String(i === choix));
    });
    input.setAttribute('aria-activedescendant', choix >= 0 ? `sg${choix}` : '');
  }
  const $vider = document.getElementById('vider');
  function valider(texte) {
    input.value = texte; searchQuery = texte; fermer(); montrerResultats(texte);
    $vider.hidden = !texte;
  }

  let t;
  input.addEventListener('input', () => {
    searchQuery = input.value;
    $vider.hidden = !input.value;
    montrerSuggestions();
    clearTimeout(t);
    t = setTimeout(() => montrerResultats(input.value), 160);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!liste.length) return;
      e.preventDefault();
      choix = e.key === 'ArrowDown'
        ? (choix + 1) % liste.length
        : (choix <= 0 ? liste.length : choix) - 1;
      surligneChoix();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      valider(choix >= 0 ? liste[choix] : input.value);
      input.blur();
    } else if (e.key === 'Escape') {
      // Échap ferme les propositions sans effacer ce qui est tapé.
      e.preventDefault();
      if (!$sugg.hidden) fermer(); else input.blur();
    }
  });
  $vider.addEventListener('click', () => { valider(''); input.focus(); });
  $vider.hidden = !q;
  $sugg.addEventListener('mousedown', (e) => {   // avant le blur du champ
    const li = e.target.closest('[data-i]');
    if (!li) return;
    e.preventDefault();
    valider(liste[Number(li.dataset.i)]);
    input.focus();
  });
  input.addEventListener('blur', () => setTimeout(fermer, 120));
  input.addEventListener('focus', () => { if (input.value.trim()) montrerSuggestions(); });

  montrerResultats(q);
  input.focus();
  input.setSelectionRange(q.length, q.length);
}

/* ---------- Mes résultats aux annales ---------- */
// Chaque quiz enregistre sa note ici (même origine, donc même stockage que l'app).
const RESULTATS_KEY = 'memo-resultats';
const lireResultats = () => {
  try {
    return (JSON.parse(localStorage.getItem(RESULTATS_KEY)) || [])
      .filter((r) => r && typeof r.href === 'string' && /^annales(?:-nf)?\//.test(r.href) && isFinite(r.note));
  } catch { return []; }
};
const dateCourte = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};
const note2 = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Vert au-dessus de 14, orange entre 10 et 14, rouge en dessous.
const tonNote = (n) => (n >= 14 ? 'bon' : n >= 10 ? 'moyen' : 'faible');

/**
 * Bilan des auto-évaluations : une carte compte une seule fois, pour sa dernière note.
 * Mêmes couleurs que les boutons de révision.
 */
const NOTES_CARTES = [
  { cle: 'again', nom: 'À revoir' },
  { cle: 'hard', nom: 'Difficile' },
  { cle: 'good', nom: 'Bien' },
  { cle: 'easy', nom: 'Facile' },
];
function bilanEvaluations() {
  const n = [0, 0, 0, 0];
  for (const d of store.decks()) {
    for (const c of store.cards(d.id)) {
      if (Number.isInteger(c.lastGrade) && c.lastGrade >= 0 && c.lastGrade <= 3) n[c.lastGrade] += 1;
    }
  }
  return n;
}

function grapheEvaluations(n = bilanEvaluations(), titre = 'Mes flashcards', unite = 'carte') {
  const total = n.reduce((a, b) => a + b, 0);
  if (!total) return '';
  const haut = Math.max(...n);
  return `
    <p class="section-label">${titre} · ${plural(total, unite)}</p>
    <section class="panel">
      <ul class="eval-graph">
        ${NOTES_CARTES.map((g, i) => `
          <li class="eval-col g${i}">
            <span class="eval-n">${n[i]}</span>
            <span class="eval-bar-zone">
              <span class="eval-bar" style="height:${n[i] ? Math.max(6, (n[i] / haut) * 100) : 2}%"></span>
            </span>
            <span class="eval-l">${g.nom}</span>
          </li>`).join('')}
      </ul>
    </section>`;
}

let confirmClearResults = false;

function renderResults() {
  session = null;
  const toutes = lireResultats();
  // Une ligne par quiz : la dernière note, et le nombre de tentatives.
  const parQuiz = new Map();
  for (const r of toutes.sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const p = parQuiz.get(r.id) || { ...r, essais: 0, meilleure: r.note };
    p.essais += 1;
    p.meilleure = Math.max(p.meilleure, r.note);
    parQuiz.set(r.id, { ...p, note: r.note, date: r.date });
  }
  const lignes = [...parQuiz.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const moyenne = lignes.length ? lignes.reduce((s, r) => s + r.note, 0) / lignes.length : 0;

  // Les quiz sont comptés question par question, dès l'auto-évaluation (pas besoin de finir la série).
  const graphe = grapheEvaluations() + grapheEvaluations(quiz.bilan(), 'Mes quizz', 'question');

  $app.innerHTML = `${topbarFolder('#/', 'Mes résultats')}
    <main class="page">
      ${graphe}
      ${lignes.length ? `
        <section class="hero">
          <span class="eyebrow">Annales faites</span>
          <span class="hero-value">${plural(lignes.length, 'annale')} · moyenne ${note2(moyenne)}/20</span>
        </section>
        <p class="section-label">Touchez une annale pour la refaire</p>
        <ul class="folder-list">
          ${lignes.map((r) => `
            <li>
              <a class="folder-row result-row" href="${esc(r.href)}">
                <span class="folder-icon">${ico.exam}</span>
                <span class="folder-text">
                  <span class="folder-name">${esc(r.titre || `UE ${r.ue}`)}</span>
                  <span class="folder-meta">${esc([
                    `UE ${r.ue}`,
                    r.sem ? `S${String(r.sem).slice(1)}` : '',
                    r.collection === 'annales-nf' ? 'non officielle' : 'officielle',
                    dateCourte(r.date),
                    r.essais > 1 ? `${r.essais} essais · record ${note2(r.meilleure)}` : '',
                  ].filter(Boolean).join(' · '))}</span>
                </span>
                <span class="note ${tonNote(r.note)}">${note2(r.note)}<small>/20</small></span>
                <span class="folder-chev">${ico.chevron}</span>
              </a>
            </li>`).join('')}
        </ul>
        ${confirmClearResults
          ? `<div class="quiz-confirm" role="alert">
              <p><strong>Effacer toutes vos notes d'annales ?</strong> Les annales elles-mêmes sont conservées.</p>
              <div class="quiz-confirm-actions">
                <button type="button" class="btn danger small" data-action="clear-results-yes">Oui, effacer</button>
                <button type="button" class="btn ghost small" data-action="clear-results-no">Annuler</button>
              </div>
            </div>`
          : `<button class="btn ghost wide danger-text" data-action="clear-results">Effacer mes résultats</button>`}`
      : `<section class="empty">
          <div class="empty-art">🏅</div>
          <h2>${graphe ? 'Pas encore d\'annale faite' : 'Pas encore de résultat'}</h2>
          <p>Faites une annale et validez-la : votre note s'affichera ici, avec un lien pour la refaire.</p>
          <div class="stack">
            <a class="btn primary wide" href="#/annales">Voir les annales officielles</a>
            <a class="btn soft wide" href="#/annales-nf">Annales non officielles</a>
          </div>
        </section>`}
    </main>`;
}

function hero(todo) {
  // L'étiquette et le compte tiennent sur une seule ligne, pour laisser la place au reste.
  return `
    <section class="hero">
      <span class="eyebrow">Aujourd'hui</span>
      <span class="hero-value">${todo ? `${plural(todo, 'carte')} à réviser` : 'Tout est à jour ✓'}</span>
    </section>`;
}

function folderRow(href, name, meta, todo, icon = ico.folder) {
  return `
    <li>
      <a class="folder-row" href="${esc(href)}">
        <span class="folder-icon">${icon}</span>
        <span class="folder-text">
          <span class="folder-name">${esc(name)}</span>
          <span class="folder-meta">${esc(meta)}</span>
        </span>
        ${todo ? `<span class="count due" title="À réviser aujourd'hui">${todo}</span>` : ''}
        <span class="folder-chev">${ico.chevron}</span>
      </a>
    </li>`;
}

function deckRows(rows) {
  return `
    <ul class="deck-list">
      ${rows.map(({ d, s }) => `
        <li class="deck-row">
          <a class="deck-link" href="#/review/${esc(d.id)}">
            <span class="deck-name">${esc(shortName(d.name))}</span>
            <span class="deck-meta">${plural(s.total, 'carte')}</span>
          </a>
          <a class="btn small ${s.todo ? 'primary' : 'soft'}" href="#/review/${esc(d.id)}">Réviser</a>
        </li>`).join('')}
    </ul>`;
}

/** Les paquets rangés par semestre (clé → lignes), pour l'accueil et les flashcards. */
function bySemester(rows) {
  const sems = new Map();
  for (const r of rows) {
    if (!sems.has(r.loc.sem)) sems.set(r.loc.sem, []);
    sems.get(r.loc.sem).push(r);
  }
  return sems;
}
// Semestres d'abord, puis les catégories (ex. « Scores »), les cours partagés, « Mes paquets ».
const semRank = (k) => (/^S\d+$/i.test(k) ? 0 : k === 'perso' ? 3 : k === 'partages' ? 2 : 1);
const sortSems = (keys) => [...keys].sort((a, b) => semRank(a) - semRank(b) || byKey(a, b));

/** Accueil : Flashcards, Quizz, Annales, puis les catégories (ex. « Scores »). */
function renderHome() {
  session = null;
  const rows = allRows();
  if (!rows.length) {
    $app.innerHTML = `${topbarHome()}
      <main class="page">
        <section class="empty">
          <div class="empty-art">🗂️</div>
          <h2>Bienvenue dans Mémo</h2>
          <p>Créez un paquet de cartes, ou importez un simple fichier texte :</p>
          <pre class="sample"># Capitales\nFrance :: Paris\nJapon :: Tokyo</pre>
          <div class="stack">
            <button class="btn primary wide" data-action="new-deck">${ico.plus} Créer un paquet</button>
            <button class="btn soft wide" data-action="import">${ico.upload} Importer un fichier</button>
            <button class="btn ghost wide" data-action="load-example">Essayer avec un exemple</button>
          </div>
        </section>
      </main>`;
    return;
  }
  const sems = bySemester(rows);
  // Les semestres et « Mes paquets » vivent sous « Flashcards » ; les catégories (ex. « Scores ») restent ici.
  const cats = sortSems([...sems.keys()].filter((k) => isSingleCategory(k) && !isFcCat(k)));
  const fcKeys = sortSems([...sems.keys()].filter((k) => !isSingleCategory(k)));
  const fcRows = fcKeys.flatMap((k) => sems.get(k));
  const fcUes = new Set(fcRows.map((r) => `${r.loc.sem}/${r.loc.ue}`).filter((k) => !k.endsWith('/null')));
  const annaleRow = (kind) => {
    const as = annalesIn(kind);
    if (!as.length) return '';
    const ues = new Set(as.map((a) => `${a.sem}/${a.ue}`));
    return folderRow(`#/${kind}`, COLLECTIONS[kind].label,
      [`${ues.size} UE`, plural(as.length, 'annale')].join(' · '), 0, ico.exam);
  };

  $app.innerHTML = `${topbarHome(sumTodo(rows))}
    <main class="page">
      <a class="search-box" href="#/recherche">
        ${ico.search}<span>Chercher une notion…</span>
      </a>
      <ul class="folder-list">
        ${fcRows.length ? folderRow('#/fc', 'Flashcards',
          [`${fcUes.size} UE`, plural(fcRows.length, 'cours')].join(' · '),
          sumTodo(fcRows) + sumTodo(FC_CATS.flatMap((k) => sems.get(k) || [])), ico.cards) : ''}
        ${quizHomeRow()}
        ${annaleRow('annales')}
        ${annaleRow('annales-nf')}
        ${cats.map((k) => catRow(k, sems.get(k))).join('')}
      </ul>
    </main>`;
}

/** Une catégorie (ex. « Scores ») : un seul paquet lance la révision tout de suite. */
function catRow(k, rs) {
  if (rs.length === 1) {
    const { d, s } = rs[0];
    return folderRow(`#/review/${d.id}`, semLabel(k), `${plural(store.cards(d.id).length, 'carte')} · tirées au hasard`, s.todo, ico.shuffle);
  }
  return folderRow(`#/f/${enc(k)}`, semLabel(k), plural(rs.length, 'paquet'), sumTodo(rs), ico.folder);
}

/** Flashcards : les catégories rangées ici (ex. « Schémas »), puis un dossier par semestre (+ « Mes paquets »). */
function renderFlashcards() {
  session = null;
  const all = allRows();
  const rows = all.filter((r) => !isSingleCategory(r.loc.sem));
  const catRows = all.filter((r) => isFcCat(r.loc.sem));
  if (!rows.length && !catRows.length) { location.hash = '#/'; return; }
  const sems = bySemester(rows);
  const catSems = bySemester(catRows);

  $app.innerHTML = `${topbarFolder('#/', 'Flashcards')}
    <main class="page">
      ${hero(sumTodo(rows) + sumTodo(catRows))}
      <ul class="folder-list">
        ${FC_CATS.filter((k) => catSems.has(k)).map((k) => catRow(k, catSems.get(k))).join('')}
        ${(() => { const ms = mixStats(all); return ms.decks > 1 ? folderRow(`#/review/${MIX}`, MIX_NAME,
          'Cartes de tous les cours, tirées au hasard', ms.todo, ico.shuffle) : ''; })()}
        ${sortSems(sems.keys()).map((k) => {
          const rs = sems.get(k);
          const ues = new Set(rs.map((r) => r.loc.ue).filter(Boolean));
          const meta = ues.size ? [`${ues.size} UE`, plural(rs.length, 'cours')].join(' · ') : plural(rs.length, 'paquet');
          return folderRow(`#/f/${enc(k)}`, semLabel(k), meta, sumTodo(rs), k === 'perso' ? ico.cards : ico.folder);
        }).join('')}
      </ul>
      <button class="btn soft wide" data-action="new-deck">${ico.plus} Nouveau paquet</button>
    </main>`;
}

/** Annales : un dossier par semestre. */
function renderAnnales(kind) {
  session = null;
  const all = annalesIn(kind);
  if (!all.length) { location.hash = '#/'; return; }
  const c = COLLECTIONS[kind];
  const sems = [...new Set(all.map((a) => a.sem))].sort(byKey);

  $app.innerHTML = `${topbarFolder('#/', c.label)}
    <main class="page">
      <p class="hint center">${c.sub}</p>
      <ul class="folder-list">
        ${sems.map((sem) => {
          const as = all.filter((a) => a.sem === sem);
          const ues = new Set(as.map((a) => a.ue));
          return folderRow(`#/${kind}/${enc(sem)}`, semLabel(sem),
            [`${ues.size} UE`, plural(as.length, 'annale')].join(' · '), 0, ico.folder);
        }).join('')}
      </ul>
    </main>`;
}

/** Annales d'un semestre : les UE qui en ont une. */
function renderAnnalesSem(sem, kind) {
  session = null;
  const as = annalesIn(kind).filter((a) => a.sem === sem);
  if (!as.length) { location.hash = `#/${kind}`; return; }
  const c = COLLECTIONS[kind];
  const ues = [...new Set(as.map((a) => a.ue))].sort(byKey);

  $app.innerHTML = `${topbarFolder(`#/${kind}`, semLabel(sem), c.short)}
    <main class="page">
      <ul class="folder-list">
        ${ues.map((ue) => folderRow(`#/${kind}/${enc(sem)}/${enc(ue)}`, ueLabel(ue),
          plural(annalesOf(sem, ue, kind).length, 'annale'), 0, ico.exam)).join('')}
      </ul>
    </main>`;
}

/** Annales d'une UE : un quiz par période ou par promotion. */
function renderAnnalesUE(sem, ue, kind) {
  session = null;
  const as = annalesOf(sem, ue, kind);
  if (!as.length) { location.hash = `#/${kind}/${enc(sem)}`; return; }
  const c = COLLECTIONS[kind];
  // Tentative interrompue (gardée par js/reprise-annale.js dans chaque annale).
  let enCours = {};
  try { enCours = JSON.parse(localStorage.getItem('memo-annales-encours-v1')) || {}; } catch {}
  const meta = (a) => {
    const y = annaleYears(a), run = enCours[a.href];
    const reprise = run ? `En cours : ${plural(run.n, 'réponse')}` : 'quiz interactif';
    if (!y) return run ? reprise : 'Quiz interactif';
    return kind === 'annales-nf' ? `Promotion ${y} · ${reprise}` : `Sujets ${y} · ${reprise}`;
  };

  $app.innerHTML = `${topbarFolder(`#/${kind}/${enc(sem)}`, ueLabel(ue), `${c.short} · ${semLabel(sem)}`)}
    <main class="page">
      <ul class="folder-list">
        ${as.map((a) => folderRow(a.href, a.label, meta(a), 0, ico.exam)).join('')}
      </ul>
    </main>`;
}

/** Dossier d'un semestre : liste des UE (ou directement les paquets pour « Mes paquets »). */
function renderFolder(sem) {
  session = null;
  const rows = allRows().filter((r) => r.loc.sem === sem);
  if (!rows.length) { location.hash = '#/'; return; }
  const ues = new Map();
  for (const r of rows) if (r.loc.ue) {
    if (!ues.has(r.loc.ue)) ues.set(r.loc.ue, []);
    ues.get(r.loc.ue).push(r);
  }
  const loose = rows.filter((r) => !r.loc.ue);
  const back = isSingleCategory(sem) && !isFcCat(sem) ? '#/' : '#/fc';

  $app.innerHTML = `${topbarFolder(back, semLabel(sem), isSingleCategory(sem) ? '' : 'Flashcards')}
    <main class="page">
      ${rows.length ? hero(sumTodo(rows)) : ''}
      ${ues.size ? `
        <ul class="folder-list">
          ${[...ues.keys()].sort(byKey).map((ue) => {
            const rs = ues.get(ue);
            return folderRow(`#/f/${enc(sem)}/${enc(ue)}`, ueLabel(ue), plural(rs.length, 'cours'), sumTodo(rs));
          }).join('')}
        </ul>` : ''}
      ${loose.length ? deckRows(loose) : ''}
      ${sem === 'perso' ? `<button class="btn soft wide" data-action="new-deck">${ico.plus} Nouveau paquet</button>` : ''}
    </main>`;
}

/** Dossier d'une UE : les cours (quiz). */
function renderUE(sem, ue, group = null) {
  session = null;
  const ueHref = `#/f/${enc(sem)}/${enc(ue)}`;
  const all = allRows().filter((r) => r.loc.sem === sem && r.loc.ue === ue);
  const rows = all.filter((r) => !group || r.loc.group === group)
    .sort((a, b) => byName(shortName(a.d.name), shortName(b.d.name)));
  if (!rows.length) { location.hash = group ? ueHref : `#/f/${enc(sem)}`; return; }
  if (group) {
    $app.innerHTML = `${topbarFolder(ueHref, group, ueLabel(ue))}
      <main class="page">${hero(sumTodo(rows))}${deckRows(rows)}</main>`;
    return;
  }
  const groups = rubriquesOf(rows, (r) => r.loc.group);
  const loose = rows.filter((r) => !r.loc.group);
  $app.innerHTML = `${topbarFolder(`#/f/${enc(sem)}`, ueLabel(ue), semLabel(sem))}
    <main class="page">
      ${hero(sumTodo(rows))}
      ${groups.length ? `<ul class="folder-list">${groups.map((g) => {
        const rs = rows.filter((r) => r.loc.group === g);
        return folderRow(`${ueHref}/~${enc(g)}`, g, plural(rs.length, 'cours'), sumTodo(rs));
      }).join('')}</ul>` : ''}
      ${loose.length ? deckRows(loose) : ''}
      ${(() => {
        const rows = Object.keys(COLLECTIONS)
          .filter((k) => annalesOf(sem, ue, k).length)
          .map((k) => folderRow(`#/${k}/${enc(sem)}/${enc(ue)}`, COLLECTIONS[k].label,
            plural(annalesOf(sem, ue, k).length, 'annale'), 0, ico.exam));
        return rows.length ? `<p class="section-label">Annales</p><ul class="folder-list">${rows.join('')}</ul>` : '';
      })()}
    </main>`;
}

/* ---------- Révision ---------- */

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildSession(deckId) {
  const end = endOfToday();
  let due, fresh;
  if (deckId === MIX) {
    // Tous les cours partagés : les révisions dues de chaque cours (dans sa limite du jour)
    // et des nouvelles cartes tirées au hasard dans l'ensemble des cours.
    due = []; const pool = [];
    for (const d of mixDecks()) {
      const cs = store.cards(d.id);
      const s = stats(d.id);
      due.push(...cs.filter((c) => c.seen && c.due <= end).sort((a, b) => a.due - b.due)
        .slice(0, s.dueAvail).map((c) => c.id));
      pool.push(...cs.filter((c) => !c.seen).map((c) => c.id));
    }
    fresh = shuffle(pool).slice(0, mixStats().newAvail);
  } else {
    const cs = store.cards(deckId);
    const s = stats(deckId);
    // Les révisions les plus en retard d'abord, dans la limite du jour, puis mélangées.
    due = shuffle(cs.filter((c) => c.seen && c.due <= end)
      .sort((a, b) => a.due - b.due)
      .slice(0, s.dueAvail)
      .map((c) => c.id));
    // Nouvelles cartes tirées au hasard parmi celles jamais vues (pas dans l'ordre du fichier).
    fresh = shuffle(cs.filter((c) => !c.seen).map((c) => c.id)).slice(0, s.newAvail);
  }
  // Révisions et nouvelles cartes mélangées : ordre différent à chaque session.
  // Puis on répartit régulièrement les cartes à image (ex. ECG) parmi les questions de cours,
  // pour éviter des séries de tracés au début ou à la fin.
  const all = shuffle([...due, ...fresh]);
  const hasImg = (cid) => /\[img:/.test(store.card(cid).front);
  const imgs = all.filter(hasImg);
  const texts = all.filter((cid) => !hasImg(cid));
  const queue = [];
  let ti = 0;
  imgs.forEach((cid, k) => {
    const upto = Math.round(((k + 1) * texts.length) / (imgs.length + 1));
    while (ti < upto) queue.push(texts[ti++]);
    queue.push(cid);
  });
  while (ti < texts.length) queue.push(texts[ti++]);
  return { deckId, queue, revealed: false, reviewed: 0, again: 0, total: queue.length };
}

function renderReview(id) {
  if (!session || session.deckId !== id) session = buildSession(id);
  const mix = id === MIX;
  const d = mix ? { name: MIX_NAME } : store.deck(id);
  // En fermant, on revient au menu d'où part la révision (UE, accueil, recherche…).
  // À défaut (lien direct, rechargement) : « Flashcards » pour les flashcards aléatoires,
  // l'accueil pour « Scores », le dossier de l'UE pour un cours.
  const backHref = menuPrecedent || (mix ? '#/fc' : folderHref(d));
  const c = session.queue.length ? store.card(session.queue[0]) : null;

  if (!c) {
    const nothing = session.reviewed === 0;
    $app.innerHTML = `
      <header class="topbar">
        <a class="icon-btn" href="${esc(backHref)}" aria-label="Retour">${ico.back}</a>
        <h1 class="title-sm">${esc(d.name)}</h1><span></span>
      </header>
      <main class="page done">
        <div class="empty-art">${nothing ? '☕️' : '🎉'}</div>
        <h2>${nothing ? 'Rien à réviser pour le moment' : 'Session terminée !'}</h2>
        <p class="muted">${nothing
          ? 'Revenez demain pour la prochaine session, ou ajoutez de nouvelles cartes.'
          : `${plural(session.reviewed, 'carte')} révisée${session.reviewed > 1 ? 's' : ''}${session.again
            ? ` · ${session.again} à revoir, réparties sur les 3 prochains jours` : ''}`}</p>
        ${nothing ? '' : '<p class="muted">Prochaine session : demain.</p>'}
        <div class="stack">
          <a class="btn primary wide" href="#/">Retour à l'accueil</a>
        </div>
      </main>`;
    return;
  }

  const left = session.queue.map(store.card).filter(Boolean);
  const nNew = left.filter((x) => !x.seen).length;
  const nRev = left.length - nNew;
  const pct = Math.round((1 - left.length / Math.max(session.total, left.length)) * 100);
  const labels = previewIntervals(c);
  const names = ['À revoir', 'Difficile', 'Bien', 'Facile'];
  const qf = takeImgs(c.front);
  const qb = takeImgs(c.back);

  $app.innerHTML = `
    <div class="review">
      <header class="topbar">
        <a class="icon-btn" href="${esc(backHref)}" aria-label="Quitter la révision">${ico.close}</a>
        <span class="title-sm">${esc(d.name)}</span>
        <span class="counts"><span class="count new">${nNew}</span><span class="count due">${nRev}</span></span>
      </header>
      <div class="progress"><span style="width:${pct}%"></span></div>
      <main class="flash ${session.revealed ? 'revealed' : ''}" ${session.revealed ? '' : 'data-action="reveal"'}>
        <article class="flash-card">
          ${c.seen ? '' : '<span class="tag tag-new flash-tag">Nouvelle</span>'}
          ${mix ? (() => { const cd = store.deck(c.deckId); const { ue } = cd ? locate(cd) : {}; return cd
            ? `<span class="flash-src">${ue ? `UE ${esc(ue)} · ` : ''}${esc(shortName(cd.name))}</span>` : ''; })() : ''}
          <div class="flash-inner">
            ${imgsHtml(qf.imgs)}
            <div class="face front ${session.revealed ? 'small' : ''}">${rich(qf.text)}</div>
            ${session.revealed ? `<hr>${imgsHtml(qb.imgs)}<div class="face back multi">${richAnswer(qb.text)}</div>` : '<p class="tap-hint">Touchez pour voir la réponse</p>'}
          </div>
        </article>
      </main>
      <footer class="answer-bar">
        ${session.revealed
          ? `<div class="grades">${names.map((n, i) => `
              <button class="grade g${i}" data-action="grade" data-grade="${i}">
                <span class="grade-l">${n}</span><span class="grade-t">${labels[i]}</span>
              </button>`).join('')}</div>`
          : `<button class="btn primary wide big" data-action="reveal">Afficher la réponse</button>`}
        <p class="hint hide-touch">Espace : retourner · 1 2 3 4 : noter</p>
      </footer>
    </div>`;
}

/**
 * Une carte seule, ouverte depuis la recherche : la flashcard, sans noter
 * (la planification du cours n'est pas touchée).
 */
let carteVue = { id: null, revealed: false };

function renderCard(cardId) {
  session = null;
  const c = store.card(cardId);
  const d = c && store.deck(c.deckId);
  if (!c || !d) { location.hash = hashPrecedent; return; }
  if (carteVue.id !== cardId) carteVue = { id: cardId, revealed: false };
  const { ue } = locate(d);
  const qf = takeImgs(c.front), qb = takeImgs(c.back);
  // On revient là d'où la carte a été ouverte : la recherche, ou la liste du cours.
  const venuDeRecherche = hashPrecedent.startsWith('#/recherche');
  const retour = venuDeRecherche ? '#/recherche' : folderHref(d);
  const retourLabel = venuDeRecherche ? 'Retour à la recherche' : 'Retour aux cours';

  $app.innerHTML = `
    <div class="review">
      <header class="topbar">
        <a class="icon-btn" href="${retour}" aria-label="${retourLabel}">${ico.back}</a>
        <span class="title-sm">${esc(shortName(d.name))}</span>
        <span class="icon-btn" aria-hidden="true"></span>
      </header>
      <main class="flash ${carteVue.revealed ? 'revealed' : ''}" ${carteVue.revealed ? '' : 'data-action="reveal-one"'}>
        <article class="flash-card">
          <span class="flash-src">${ue ? `UE ${esc(ue)} · ` : ''}${esc(shortName(d.name))}</span>
          <div class="flash-inner">
            ${imgsHtml(qf.imgs)}
            <div class="face front ${carteVue.revealed ? 'small' : ''}">${rich(qf.text)}</div>
            ${carteVue.revealed
              ? `<hr>${imgsHtml(qb.imgs)}<div class="face back multi">${richAnswer(qb.text)}</div>`
              : '<p class="tap-hint">Touchez pour voir la réponse</p>'}
          </div>
        </article>
      </main>
      <footer class="answer-bar">
        ${carteVue.revealed
          ? `<div class="stack">
              <a class="btn primary wide big" href="#/review/${esc(d.id)}">Réviser ce cours</a>
              <a class="btn ghost wide" href="${esc(retour)}">${retourLabel}</a>
            </div>`
          : '<button class="btn primary wide big" data-action="reveal-one">Afficher la réponse</button>'}
      </footer>
    </div>`;
}

function reveal() {
  if (!session || session.revealed) return;
  session.revealed = true;
  render();
}

function grade(g) {
  if (!session?.revealed) return;
  const c = store.card(session.queue[0]);
  if (!c) return;
  const wasNew = !c.seen;
  store.updateCard(c.id, schedule(c, g), { autosave: false });
  store.bumpToday(c.deckId, wasNew ? 'new' : 'rev', { autosave: false });
  if (session.deckId === MIX) store.bumpToday(MIX, wasNew ? 'new' : 'rev', { autosave: false });
  store.save();
  window.memoCollectives?.shareFlashcards();
  session.queue.shift();
  session.reviewed++;
  if (g === 0) session.again++; // ne revient pas dans cette session : 1 à 3 jours plus tard
  session.revealed = false;
  render();
}

/* ---------- Quizz : QCM et QCU, correction immédiate ---------- */

// Quiz aléatoire : « aleatoire » tire dans toutes les UE (adresse #/quiz-aleatoire/tout),
// « aleatoire/S1/3.3 » dans les quiz d'une UE (adresse #/quiz-aleatoire/S1/3.3).
const QUIZ_RANDOM = 'aleatoire';
const QUIZ_RANDOM_SIZE = 20;
const isRandom = (id) => id === QUIZ_RANDOM || id.startsWith(`${QUIZ_RANDOM}/`);
const randomId = (sem, ue) => (sem === 'tout' || !ue ? QUIZ_RANDOM : `${QUIZ_RANDOM}/${sem}/${ue}`);
const randomHref = (id) => (id === QUIZ_RANDOM ? '#/quiz-aleatoire/tout' : `#/quiz-aleatoire/${id.split('/').slice(1).map(enc).join('/')}`);
/** Questions où tirer : toutes, ou celles d'une UE. */
const randomPool = (id, all) => {
  if (id === QUIZ_RANDOM) return all.flatMap((z) => z.questions);
  const [, sem, ue] = id.split('/');
  return all.filter((z) => z.sem === sem && z.ue === ue).flatMap((z) => z.questions);
};
const randomTitle = (id) => (id === QUIZ_RANDOM ? 'Quiz aléatoire' : `Quiz aléatoire – ${ueLabel(id.split('/')[2])}`);
const randomMeta = (id, zs) => {
  const run = quiz.runInfo(id);
  if (run) return `En cours : question ${run.i + 1}/${run.n}`;
  const n = Math.min(QUIZ_RANDOM_SIZE, qCount(zs));
  return id === QUIZ_RANDOM ? `${n} questions tirées dans tous les cours` : `${n} questions tirées dans ${zs.length} quiz`;
};
const GRADE_NAMES = ['À revoir', 'Difficile', 'Bien', 'Facile'];
const LETTERS = 'ABCDEFGH';
let qsession = null;

const quizBySlug = (path) => (quiz.loadedQuizzes() || []).find((z) => `${z.sem}/${z.ue}/${z.slug}` === path);
const quizTitle = (path) => quizBySlug(path)?.title || path.split('/').pop();
const quizHref = (z) => `#/quiz/${enc(z.sem)}/${enc(z.ue)}/${enc(z.slug)}`;

/** Ligne « Quizz » de l'accueil, d'après la liste (sans charger les questions). */
function quizHomeRow() {
  const list = quiz.knownList();
  if (!list.length) return '';
  const ues = new Set(list.map((x) => `${x.sem}/${x.ue}`));
  return folderRow('#/quiz', 'Quizz', [`${ues.size} UE`, `${list.length} quiz`].join(' · '), 0, ico.quiz);
}

/** Écran d'attente pendant le premier chargement des questions. */
function quizLoading(back, title) {
  $app.innerHTML = `${topbarFolder(back, title)}
    <main class="page"><p class="hint center">Chargement des questions…</p></main>`;
  quiz.loadQuizzes().then((all) => { if (all.length) render(); else { toast('Quizz indisponibles hors ligne'); location.hash = '#/'; } });
}

const qCount = (zs) => zs.reduce((n, z) => n + z.questions.length, 0);
const doneCount = (zs) => zs.reduce((n, z) => n + z.questions.filter((q) => quiz.memoryOf(q.key)).length, 0);
const quizMeta = (zs) => {
  const n = qCount(zs), done = doneCount(zs);
  const run = zs.length === 1 ? quiz.runInfo(`${zs[0].sem}/${zs[0].ue}/${zs[0].slug}`) : null;
  return [run ? `En cours : question ${run.i + 1}/${run.n}` : plural(n, 'question'),
    done ? `${done} déjà faite${done > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
};

/** Quizz → semestres → UE → quiz d'un cours. « Quiz aléatoire » en tête. */
function renderQuizMenu(sem, ue, group = null) {
  qsession = null;
  const all = quiz.loadedQuizzes();
  if (!all) return quizLoading(sem ? '#/quiz' : '#/', sem ? semLabel(sem) : 'Quizz');
  if (!all.length) { location.hash = '#/'; return; }

  if (!sem) {
    const sems = [...new Set(all.map((z) => z.sem))].sort(byKey);
    $app.innerHTML = `${topbarFolder('#/', 'Quizz')}
      <main class="page">
        <p class="hint center">QCM et QCU corrigés tout de suite, avec la source du cours.</p>
        <ul class="folder-list">
          ${folderRow('#/quiz-aleatoire', 'Quiz aléatoire', 'Toutes les UE ou une seule UE', 0, ico.shuffle)}
          ${sems.map((s) => {
            const zs = all.filter((z) => z.sem === s);
            const ues = new Set(zs.map((z) => z.ue));
            return folderRow(`#/quiz/${enc(s)}`, semLabel(s),
              [`${ues.size} UE`, `${zs.length} quiz`, plural(qCount(zs), 'question')].join(' · '), 0, ico.folder);
          }).join('')}
        </ul>
      </main>`;
    return;
  }
  if (!ue) {
    const zs = all.filter((z) => z.sem === sem);
    if (!zs.length) { location.hash = '#/quiz'; return; }
    const ues = [...new Set(zs.map((z) => z.ue))].sort(byKey);
    $app.innerHTML = `${topbarFolder('#/quiz', semLabel(sem), 'Quizz')}
      <main class="page">
        <ul class="folder-list">
          ${ues.map((u) => {
            const zu = zs.filter((z) => z.ue === u);
            return folderRow(`#/quiz/${enc(sem)}/${enc(u)}`, ueLabel(u),
              `${zu.length} quiz · ${quizMeta(zu)}`, 0, ico.folder);
          }).join('')}
        </ul>
      </main>`;
    return;
  }
  const ueHref = `#/quiz/${enc(sem)}/${enc(ue)}`;
  const zs = all.filter((z) => z.sem === sem && z.ue === ue && (!group || z.group === group))
    .sort((a, b) => byName(a.title, b.title));
  if (!zs.length) { location.hash = group ? ueHref : `#/quiz/${enc(sem)}`; return; }
  const groups = group ? [] : rubriquesOf(zs, (z) => z.group);
  const loose = group ? zs : zs.filter((z) => !z.group);
  $app.innerHTML = `${group ? topbarFolder(ueHref, group, `Quizz · ${ueLabel(ue)}`)
    : topbarFolder(`#/quiz/${enc(sem)}`, ueLabel(ue), `Quizz · ${semLabel(sem)}`)}
    <main class="page">
      <ul class="folder-list">
        ${groups.map((g) => {
          const zg = zs.filter((z) => z.group === g);
          return folderRow(`${ueHref}/~${enc(g)}`, g, `${zg.length} quiz · ${quizMeta(zg)}`, 0, ico.folder);
        }).join('')}
        ${loose.map((z) => folderRow(quizHref(z), z.title, quizMeta([z]), 0, ico.quiz)).join('')}
      </ul>
    </main>`;
}

/** Quiz aléatoire : toutes les UE en tête, puis un tirage par UE. */
function renderRandomMenu() {
  qsession = null;
  const all = quiz.loadedQuizzes();
  if (!all) return quizLoading('#/quiz', 'Quiz aléatoire');
  if (!all.length) { location.hash = '#/quiz'; return; }
  const ues = [...new Set(all.map((z) => `${z.sem}/${z.ue}`))]
    .sort((a, b) => byKey(a.split('/')[0], b.split('/')[0]) || byKey(a.split('/')[1], b.split('/')[1]));
  const sems = new Set(ues.map((k) => k.split('/')[0]));
  $app.innerHTML = `${topbarFolder('#/quiz', 'Quiz aléatoire', 'Quizz')}
    <main class="page">
      <ul class="folder-list">
        ${folderRow(randomHref(QUIZ_RANDOM), 'Quiz aléatoire toutes les UE', randomMeta(QUIZ_RANDOM, all), 0, ico.shuffle)}
      </ul>
      <p class="section-label">Par UE</p>
      <ul class="folder-list">
        ${ues.map((k) => {
          const [sem, ue] = k.split('/');
          const id = randomId(sem, ue);
          const zs = all.filter((z) => z.sem === sem && z.ue === ue);
          const label = sems.size > 1 ? `${ueLabel(ue)} · ${semLabel(sem)}` : ueLabel(ue);
          return folderRow(randomHref(id), label, randomMeta(id, zs), 0, ico.shuffle);
        }).join('')}
      </ul>
    </main>`;
}

/** Une série : toutes les questions d'un cours, ou un tirage dans tous les cours ou dans une UE. */
function buildQuizSession(id, fresh = false) {
  const all = quiz.loadedQuizzes();
  if (!fresh) {
    const pool = isRandom(id) ? randomPool(id, all) : quizBySlug(id)?.questions || [];
    const back = quiz.restoreRun(id, pool);
    if (back) { if (back.i > 0) toast(`Reprise à la question ${back.i + 1} sur ${back.items.length}`); return back; }
  }
  const qs = isRandom(id)
    ? quiz.randomPick(randomPool(id, all), QUIZ_RANDOM_SIZE)
    : quiz.shuffle(quizBySlug(id)?.questions || []);
  return {
    id, items: qs.map((q) => ({ q, order: quiz.optionOrder(q) })), i: 0,
    chosen: new Set(), validated: false,
    results: { juste: 0, incomplet: 0, faux: 0 }, grades: [0, 0, 0, 0],
  };
}

function renderQuizSession(id) {
  const all = quiz.loadedQuizzes();
  const random = isRandom(id);
  const back = menuPrecedent && menuPrecedent.startsWith('#/quiz') ? menuPrecedent
    : random ? '#/quiz-aleatoire' : `#/quiz/${id.split('/').slice(0, 2).map(enc).join('/')}${quizBySlug(id)?.group ? `/~${enc(quizBySlug(id).group)}` : ''}`;
  if (!all) return quizLoading(back, 'Quizz');
  if (random ? !randomPool(id, all).length : !quizBySlug(id)) { location.hash = random ? '#/quiz-aleatoire' : '#/quiz'; return; }
  if (!qsession || qsession.id !== id) qsession = buildQuizSession(id);
  const s = qsession;
  const title = random ? randomTitle(id) : quizTitle(id);
  const item = s.items[s.i];

  if (!item) {
    $app.innerHTML = `
      <header class="topbar">
        <a class="icon-btn" href="${esc(back)}" aria-label="Retour">${ico.back}</a>
        <h1 class="title-sm">${esc(title)}</h1><span class="icon-btn" aria-hidden="true"></span>
      </header>
      <main class="page done">
        ${quizNoteHtml(s, random)}
        <div class="stack">
          <button class="btn primary wide" data-action="quiz-again">${random ? 'Nouveau quiz aléatoire' : 'Recommencer ce quiz'}</button>
          <a class="btn ghost wide" href="${esc(back)}">Retour aux quizz</a>
        </div>
      </main>`;
    return;
  }

  const { q, order } = item;
  const pct = Math.round((s.i / s.items.length) * 100);
  const v = s.validated ? quiz.verdict(q, s.chosen) : null;
  const VERDICT = { juste: 'Bonne réponse', incomplet: 'Réponse incomplète', faux: 'Réponse fausse' };
  const stateOf = (k) => {
    if (!s.validated) return s.chosen.has(k) ? 'is-chosen' : '';
    const o = q.opts[k], c = s.chosen.has(k);
    return o.ok && c ? 'is-right' : o.ok ? 'is-missed' : c ? 'is-wrong' : 'is-off';
  };
  const MARK = { 'is-right': '✓', 'is-missed': '✓', 'is-wrong': '✗' };
  const refLabel = (ref) => (/^[\d\s,–\-àet]+$/i.test(ref) ? `p. ${ref}` : ref);

  $app.innerHTML = `
    <div class="review quiz">
      <header class="topbar">
        <a class="icon-btn" href="${esc(back)}" aria-label="Quitter le quiz">${ico.close}</a>
        <span class="title-sm">${esc(title)}</span>
        <span class="quiz-count">${s.i + 1}<span class="muted"> / ${s.items.length}</span></span>
      </header>
      <div class="progress"><span style="width:${pct}%"></span></div>
      <main class="quiz-main">
        ${s.i > 0 ? (s.confirmRestart
          ? `<div class="quiz-confirm" role="alert">
              <p><strong>Repartir de zéro ?</strong> Ta progression dans ce quiz (question ${s.i + 1}/${s.items.length}) sera effacée. Tes auto-évaluations déjà données sont gardées.</p>
              <div class="quiz-confirm-actions">
                <button type="button" class="btn danger small" data-action="quiz-restart-yes">Oui, repartir de zéro</button>
                <button type="button" class="btn ghost small" data-action="quiz-restart-no">Annuler</button>
              </div>
            </div>`
          : `<div class="quiz-restart-bar"><button type="button" class="quiz-restart" data-action="quiz-restart">${ico.restart}<span>Repartir de zéro</span></button></div>`) : ''}
        <article class="quiz-card">
          <div class="quiz-meta">
            <span class="tag ${q.multi ? 'tag-qcm' : 'tag-qcu'}">${q.multi ? 'QCM · une ou plusieurs réponses' : 'QCU · une seule réponse'}</span>
            ${random ? `<span class="quiz-src">UE ${esc(q.ue)} · ${esc(q.quizTitle)}</span>`
              : q.theme ? `<span class="quiz-src">${esc(q.theme)}</span>` : ''}
          </div>
          <h2 class="quiz-stem">${rich(q.stem)}</h2>
          <ol class="quiz-opts" role="${q.multi ? 'group' : 'radiogroup'}">
            ${order.map((k, pos) => {
              const o = q.opts[k], st = stateOf(k);
              return `<li><button type="button" class="quiz-opt ${st}" data-action="quiz-pick" data-k="${k}"
                  role="${q.multi ? 'checkbox' : 'radio'}" aria-checked="${s.chosen.has(k)}" ${s.validated ? 'disabled' : ''}>
                <span class="opt-letter">${MARK[st] || LETTERS[pos]}</span>
                <span class="opt-body"><span class="opt-text">${nb(esc(o.text))}</span>
                  ${s.validated && o.note ? `<span class="opt-note">${nb(esc(o.note))}</span>` : ''}
                  ${st === 'is-missed' ? '<span class="opt-flag">Oubliée</span>' : ''}</span>
              </button></li>`;
            }).join('')}
          </ol>
          ${s.validated ? `
            <div class="quiz-verdict v-${v}">${VERDICT[v]}</div>
            ${q.exp.length || q.ref ? `<section class="quiz-correction">
              <h3>Correction</h3>
              ${q.exp.map((p) => `<p>${nb(esc(p))}</p>`).join('')}
              ${q.ref ? `<p class="quiz-ref">Source : cours « ${esc(q.quizTitle)} », ${esc(refLabel(q.ref))}</p>` : ''}
            </section>` : ''}` : ''}
        </article>
      </main>
      <footer class="answer-bar">
        ${s.validated
          ? `<p class="hint">Comment avez-vous trouvé cette question ?</p>
             <div class="grades">${GRADE_NAMES.map((n, i) => `
              <button class="grade g${i}" data-action="quiz-grade" data-grade="${i}"><span class="grade-l">${n}</span></button>`).join('')}</div>`
          : `<button class="btn primary wide big" data-action="quiz-validate" ${s.chosen.size ? '' : 'disabled'}>Valider</button>`}
        <p class="hint hide-touch">${s.validated ? '1 2 3 4 : noter et passer à la suite' : `${LETTERS.slice(0, order.length).split('').join(' ')} : choisir · Entrée : valider`}</p>
      </footer>
    </div>`;
}

/** Fin de série : note sur 20 (sans erreur 1 point, une erreur 0,5, deux ou plus 0) et détail par question. */
function quizNoteHtml(s, random) {
  const fmt = (x) => String(x).replace('.', ',');
  const rows = s.items.map((it, idx) => ({ it, idx,
    pts: it.answer ? quiz.points(it.q, it.answer) : null, err: it.answer ? quiz.errors(it.q, it.answer) : null }));
  const done = rows.filter((r) => r.pts != null);
  const note = done.length ? Math.round((done.reduce((a, r) => a + r.pts, 0) / done.length) * 40) / 2 : null;
  const count = (p) => done.filter((r) => r.pts === p).length;
  const cls = (p) => (p === 1 ? 'p1' : p === 0.5 ? 'p05' : 'p0');
  const detail = ({ it, pts, err }) => {
    const q = it.q;
    if (!it.answer) return '<p class="qn-reason">Réponse non enregistrée (question faite avant cette mise à jour).</p>';
    const ch = new Set(it.answer);
    const wrongN = q.opts.filter((o, i) => !o.ok && ch.has(i)).length, missedN = q.opts.filter((o, i) => o.ok && !ch.has(i)).length;
    const parts = [];
    if (wrongN) parts.push(`${wrongN} proposition${wrongN > 1 ? 's' : ''} cochée${wrongN > 1 ? 's' : ''} à tort`);
    if (missedN) parts.push(`${missedN} bonne${missedN > 1 ? 's' : ''} réponse${missedN > 1 ? 's' : ''} oubliée${missedN > 1 ? 's' : ''}`);
    return `<p class="qn-stem">${rich(q.stem)}</p>
      <ul class="qn-opts">${it.order.map((k, pos) => {
        const o = q.opts[k], c = ch.has(k);
        const st = o.ok && c ? 'right' : o.ok ? 'missed' : c ? 'wrong' : 'off';
        return `<li class="qn-opt ${st}"><span class="qn-l">${st === 'wrong' ? '✗' : st === 'off' ? LETTERS[pos] : '✓'}</span><span>${nb(esc(o.text))}</span></li>`;
      }).join('')}</ul>
      <div class="qn-legend"><span class="right">cochée et juste</span><span class="missed">juste, non cochée</span><span class="wrong">cochée à tort</span></div>
      <p class="qn-reason ${cls(pts)}"><b>${err ? `${err} erreur${err > 1 ? 's' : ''}` : 'Aucune erreur'}</b>${parts.length ? ` : ${parts.join(', ')}` : ''} → ${fmt(pts)} point</p>
      <button type="button" class="qn-hide" data-action="quiz-hide">Masquer la question</button>`;
  };
  return `
    <div class="qn-hero">
      <div class="qn-note">${note == null ? '—' : fmt(note)}<small> / 20</small></div>
      <div class="muted">${plural(s.items.length, 'question')}</div>
      <h2>Quiz terminé</h2>
      <p class="qn-bareme">Barème : sans erreur 1 point · une erreur 0,5 · deux erreurs ou plus 0</p>
    </div>
    <div class="qn-split">
      <div class="qn-sp p1"><b>${count(1)}</b><span>sans erreur<br>1 point</span></div>
      <div class="qn-sp p05"><b>${count(0.5)}</b><span>une erreur<br>0,5 point</span></div>
      <div class="qn-sp p0"><b>${count(0)}</b><span>2&nbsp;erreurs ou&nbsp;+<br>0 point</span></div>
    </div>
    <section class="qn-list">
      <h3>Détail des questions</h3>
      <div class="qn-rows">${rows.map((r) => `
        <details class="qn-row">
          <summary>
            <span class="qn-num">${r.idx + 1}</span>
            <span class="qn-txt"><span class="qn-theme">${esc(random ? r.it.q.quizTitle : r.it.q.theme || r.it.q.quizTitle)}</span><span class="qn-short">${nb(esc(r.it.q.stem))}</span></span>
            <span class="qn-pts ${r.pts == null ? '' : cls(r.pts)}">${r.pts == null ? '—' : fmt(r.pts)}</span>
            <span class="qn-chev" aria-hidden="true">${ico.chevDown}</span>
          </summary>
          <div class="qn-body">${detail(r)}</div>
        </details>`).join('')}</div>
    </section>`;
}

function quizPick(k) {
  const s = qsession;
  if (!s || s.validated) return;
  const q = s.items[s.i].q;
  if (q.multi) { if (s.chosen.has(k)) s.chosen.delete(k); else s.chosen.add(k); }
  else s.chosen = new Set([k]);
  quiz.saveRun(s);
  // Mise à jour ciblée du DOM sans reconstruire toute la page (préserve le focus clavier et évite le clignotement).
  const opts = $app.querySelectorAll('.quiz-opt[data-k]');
  if (!opts.length) return render();
  opts.forEach((btn) => {
    const on = s.chosen.has(Number(btn.dataset.k));
    btn.classList.toggle('is-chosen', on);
    btn.setAttribute('aria-checked', String(on));
  });
  const valBtn = $app.querySelector('[data-action="quiz-validate"]');
  if (valBtn) valBtn.disabled = !s.chosen.size;
}

function quizValidate() {
  const s = qsession;
  if (!s || s.validated || !s.chosen.size) return;
  s.validated = true;
  s.items[s.i].answer = [...s.chosen]; // pour le détail de la note en fin de série
  s.results[quiz.verdict(s.items[s.i].q, s.chosen)]++;
  quiz.saveRun(s);
  render();
  document.querySelector('.quiz-verdict')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function quizGrade(g) {
  const s = qsession;
  if (!s?.validated) return;
  const q = s.items[s.i].q;
  quiz.remember(q.key, g);
  s.grades[g]++;
  s.i++; s.chosen = new Set(); s.validated = false;
  quiz.saveRun(s);
  // Statistiques anonymes, seulement pour un quiz terminé : le quiz, puis le nombre
  // d'auto-évaluations de chaque niveau (sans les réponses).
  if (s.i >= s.items.length) {
    const titre = isRandom(s.id) ? randomTitle(s.id) : quizTitle(s.id);
    statEvents([{ path: `quiz-fini/${titre}`, title: titre },
      ...s.grades.flatMap((n, k) => Array.from({ length: n }, () => ({ path: `quiz-fini-note-${k}`, title: GRADE_NAMES[k] })))]);
  }
  window.scrollTo(0, 0);
  render();
}

/* Événements GoatCounter envoyés un par un (le compteur limite le débit), via une file
   gardée en mémoire locale : si l'app est fermée pendant l'envoi, la suite part au prochain lancement. */
const STAT_QUEUE = 'memo-stats-file-v1';
const readQueue = () => { try { return JSON.parse(localStorage.getItem(STAT_QUEUE)) || []; } catch { return []; } };
const writeQueue = (q) => { try { if (q.length) localStorage.setItem(STAT_QUEUE, JSON.stringify(q)); else localStorage.removeItem(STAT_QUEUE); } catch {} };
function statEvents(events) { writeQueue([...readQueue(), ...events].slice(-500)); flushStats(); } // 500 au plus si le compteur est bloqué
function flushStats() {
  if (flushStats.busy) return;
  const q = readQueue();
  if (!q.length) return;
  if (!window.goatcounter?.count || !navigator.onLine) { setTimeout(flushStats, 5000); return; }
  flushStats.busy = true;
  const [ev, ...rest] = q;
  writeQueue(rest);
  window.goatcounter.count({ path: ev.path, title: ev.title || ev.path, event: true });
  setTimeout(() => { flushStats.busy = false; flushStats(); }, 400);
}
addEventListener('online', flushStats);

/* ---------- Fenêtres modales ---------- */

function openModal(html, onSubmit) {
  modal.innerHTML = `<form method="dialog" class="modal-body">${html}</form>`;
  const form = modal.querySelector('form');
  form.addEventListener('submit', (e) => {
    const v = e.submitter?.value;
    if (v === 'cancel') return;
    e.preventDefault();
    if (onSubmit?.(new FormData(form), v) !== false) modal.close();
  });
  modal.showModal();
  modal.querySelector('[autofocus]')?.focus();
}

modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

const cancelBtn = `<button class="btn ghost" value="cancel" formnovalidate>Annuler</button>`;

function confirmModal(title, text, okLabel, onOk) {
  openModal(`
    <h2>${title}</h2><p class="muted">${text}</p>
    <div class="modal-actions">${cancelBtn}<button class="btn danger" value="ok">${okLabel}</button></div>`,
  () => onOk());
}

function newDeckModal() {
  openModal(`
    <h2>Nouveau paquet</h2>
    <label>Nom<input name="name" required autofocus placeholder="Ex. Anglais – vocabulaire" autocomplete="off"></label>
    <div class="modal-actions">${cancelBtn}<button class="btn primary" value="ok">Créer</button></div>`,
  (f) => {
    const name = f.get('name').trim();
    if (!name) return false;
    const d = store.deckByName(name) || store.createDeck(name);
    location.hash = folderHref(d);
  });
}

function deckMenu(id) {
  const d = store.deck(id);
  openModal(`
    <h2>${esc(d.name)}</h2>
    <div class="menu">
      ${d.source ? '' : '<button class="menu-item" value="rename">Renommer</button>'}
      <button class="menu-item" value="export">Exporter en fichier texte (.txt)</button>
      ${d.source
        ? '<button class="menu-item danger-text" value="hide">Masquer ce cours</button>'
        : '<button class="menu-item danger-text" value="delete">Supprimer le paquet</button>'}
    </div>
    <div class="modal-actions">${cancelBtn}</div>`,
  (_, v) => {
    if (v === 'export') download(`${d.name}.txt`, deckToText(d, store.cards(id)));
    if (v === 'hide') {
      store.setHidden(id, true);
      location.hash = '#/';
      toast('Cours masqué (réaffichable dans les Réglages)');
    }
    if (v === 'rename') setTimeout(() => renameModal(id));
    if (v === 'delete') setTimeout(() => confirmModal('Supprimer ce paquet ?',
      `« ${esc(d.name)} » et ses ${plural(store.cards(id).length, 'carte')} seront supprimés.`,
      'Supprimer', () => { store.deleteDeck(id); location.hash = '#/'; toast('Paquet supprimé'); }));
  });
}

function renameModal(id) {
  openModal(`
    <h2>Renommer le paquet</h2>
    <label>Nom<input name="name" required autofocus value="${esc(store.deck(id).name)}" autocomplete="off"></label>
    <div class="modal-actions">${cancelBtn}<button class="btn primary" value="ok">Enregistrer</button></div>`,
  (f) => { store.renameDeck(id, f.get('name')); render(); });
}

function runImport(text, defaultName, prune = false) {
  const { decks, errors } = parseText(text, defaultName || 'Nouveau paquet');
  if (!decks.length) {
    toast('Aucune carte trouvée. Format attendu : question :: réponse');
    return false;
  }
  const r = store.importDecks(decks, { prune });
  if (r.changed) invalidateSearch();
  const s = r.added > 1 ? 's' : '';
  const parts = [`${r.added} nouvelle${s} carte${s}`];
  if (r.updated) parts.push(`${r.updated} mise(s) à jour`);
  if (r.removed) parts.push(`${r.removed} supprimée(s)`);
  if (errors.length) parts.push(`${errors.length} ligne(s) ignorée(s)`);
  toast(`${r.names.join(', ')} : ${parts.join(' · ')}`);
  if (r.names.length === 1) {
    const d = store.deckByName(r.names[0]);
    if (location.hash === folderHref(d)) render(); else location.hash = folderHref(d);
  } else render();
  return true;
}

function importModal(deckId) {
  const current = deckId ? store.deck(deckId).name : '';
  openModal(`
    <h2>Importer des cartes</h2>
    <p class="muted">Collez une liste ou choisissez un fichier <code>.txt</code>.</p>
    <label>Paquet (si le texte ne commence pas par « # Nom »)
      <input name="deck" value="${esc(current)}" placeholder="Nom du paquet" autocomplete="off">
    </label>
    <label>Cartes
      <textarea name="text" rows="8" class="mono" placeholder="# Capitales&#10;France :: Paris&#10;Japon :: Tokyo"></textarea>
    </label>
    <details class="help">
      <summary>Format du fichier</summary>
      <ul>
        <li><code># Nom</code> : commence un paquet (plusieurs paquets possibles)</li>
        <li><code>question :: réponse</code> : une carte par ligne</li>
        <li><code>\\n</code> : retour à la ligne dans une carte</li>
        <li><code>// texte</code> : commentaire ignoré</li>
        <li>Une tabulation fonctionne aussi (copier-coller depuis Excel/Numbers)</li>
        <li>Réimporter un fichier met à jour les cartes existantes sans perdre la progression</li>
      </ul>
    </details>
    <label class="check">
      <input type="checkbox" name="prune">
      <span>Supprimer du paquet les cartes qui ne sont plus dans le texte</span>
    </label>
    <div class="modal-actions">
      <button class="btn soft" type="button" data-pick>${ico.upload} Choisir un fichier…</button>
      <span class="spacer"></span>
      ${cancelBtn}<button class="btn primary" value="ok">Importer</button>
    </div>`,
  (f) => {
    const text = f.get('text');
    if (!text.trim()) { toast('Collez du texte ou choisissez un fichier'); return false; }
    return runImport(text, f.get('deck').trim(), f.get('prune') === 'on');
  });

  modal.querySelector('[data-pick]').addEventListener('click', () => {
    pickFile('.txt,.md,.csv,.tsv,text/plain', (text, name) => {
      modal.querySelector('[name=text]').value = text;
      const deckField = modal.querySelector('[name=deck]');
      if (!deckField.value.trim()) deckField.value = baseName(name);
    });
  });
}

function settingsModal() {
  const s = store.settings();
  openModal(`
    <h2>Réglages</h2>
    <label>Nouvelles cartes par jour (par paquet)
      <input name="newPerDay" type="number" min="0" max="999" value="${s.newPerDay}" inputmode="numeric">
    </label>
    <label>Révisions maximales par jour (par paquet)
      <input name="reviewsPerDay" type="number" min="1" max="9999" value="${s.reviewsPerDay}" inputmode="numeric">
    </label>
    <p class="hint">Au-delà, les cartes à revoir sont reportées aux sessions suivantes, les plus en retard d'abord.</p>
    ${store.hiddenDecks().length ? `
      <h3>Cours masqués</h3>
      <div class="menu">${store.hiddenDecks().map((d) => `
        <button class="menu-item" type="button" data-unhide="${esc(d.id)}">Réafficher « ${esc(d.name)} »</button>`).join('')}
      </div>` : ''}
    <h3>Cartes</h3>
    <p class="muted">Ajoutez vos propres cartes depuis un fichier texte ou un copier-coller.</p>
    <div class="row">
      <button class="btn soft" type="button" data-import>${ico.upload} Importer des cartes</button>
    </div>
    <h3>Sauvegarde</h3>
    <p class="muted">Vos données sont enregistrées sur cet appareil. Exportez une sauvegarde pour les transférer ou les mettre à l'abri.</p>
    <div class="row">
      <button class="btn soft" type="button" data-export>Exporter (.json)</button>
      <button class="btn soft" type="button" data-restore>Restaurer…</button>
    </div>
    <div class="modal-actions">${cancelBtn}<button class="btn primary" value="ok">Enregistrer</button></div>`,
  (f) => {
    const n = Math.max(0, Math.min(999, parseInt(f.get('newPerDay'), 10) || 0));
    const r = Math.max(1, Math.min(9999, parseInt(f.get('reviewsPerDay'), 10) || 50));
    store.setSetting('newPerDay', n);
    store.setSetting('reviewsPerDay', r);
    render();
  });
  modal.querySelectorAll('[data-unhide]').forEach((b) => b.addEventListener('click', () => {
    store.setHidden(b.dataset.unhide, false);
    b.remove();
    render();
    toast('Cours réaffiché');
  }));
  modal.querySelector('[data-import]').addEventListener('click', () => {
    modal.close();
    importModal();
  });
  modal.querySelector('[data-export]').addEventListener('click', () => {
    download(`memo-sauvegarde-${new Date().toLocaleDateString('sv')}.json`, store.exportBackup(), 'application/json');
  });
  modal.querySelector('[data-restore]').addEventListener('click', () => {
    pickFile('.json,application/json', (text) => {
      try { store.importBackup(text); invalidateSearch(); modal.close(); render(); toast('Sauvegarde restaurée'); }
      catch (err) { toast(err.message); }
    });
  });
}

async function loadExample() {
  try {
    const res = await fetch('exemples/capitales.txt');
    runImport(await res.text(), 'Capitales');
  } catch {
    toast("Impossible de charger l'exemple");
  }
}

/* ---------- Événements ---------- */

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  switch (action) {
    case 'new-deck': return newDeckModal();
    case 'import': return importModal(id);
    case 'settings': return settingsModal();
    case 'load-example': return loadExample();
    case 'deck-menu': return deckMenu(id);
    case 'reveal-one': {
      carteVue.revealed = true;
      return render();
    }
    case 'reveal': return reveal();
    case 'quiz-pick': return quizPick(Number(el.dataset.k));
    case 'quiz-validate': return quizValidate();
    case 'quiz-hide': { const d = el.closest('details'); if (d) { d.open = false; d.querySelector('summary')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } return; }
    case 'quiz-grade': return quizGrade(Number(el.dataset.grade));
    case 'quiz-again': { if (qsession) quiz.clearRun(qsession.id); qsession = null; return render(); }
    // Confirmation affichée dans la page (pas de fenêtre « confirm », peu fiable sur mobile).
    case 'quiz-restart': { if (qsession) { qsession.confirmRestart = true; render(); } return; }
    case 'quiz-restart-no': { if (qsession) { qsession.confirmRestart = false; render(); } return; }
    case 'quiz-restart-yes': {
      if (!qsession) return;
      quiz.clearRun(qsession.id);
      qsession = buildQuizSession(qsession.id, true);
      window.scrollTo(0, 0);
      toast('Quiz repris depuis le début');
      return render();
    }
    case 'grade': return grade(Number(el.dataset.grade));
    case 'zoom': return safeSrc(el.dataset.src) && openViewer(el.dataset.src);
    case 'clear-results': { confirmClearResults = true; return render(); }
    case 'clear-results-no': { confirmClearResults = false; return render(); }
    case 'clear-results-yes': {
      confirmClearResults = false;
      try { localStorage.removeItem(RESULTATS_KEY); } catch {}
      toast('Résultats effacés');
      return render();
    }
  }
});

/** Visionneuse plein écran : l'image (ex. ECG) en grand, défilable ; toucher bascule ajusté / taille réelle. */
function openViewer(src) {
  const v = document.createElement('div');
  v.className = 'img-viewer';
  v.innerHTML = `<button type="button" class="icon-btn img-viewer-close" aria-label="Fermer">${ico.close}</button>
    <div class="img-viewer-scroll"><img src="${esc(src)}" alt=""></div>
    <div class="img-viewer-bar"><span class="img-viewer-hint">Toucher l'image : zoom · glisser pour parcourir</span>
    <button type="button" class="btn img-viewer-done">Fermer</button></div>`;
  const close = () => { v.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  v.querySelector('.img-viewer-close').addEventListener('click', close);
  v.querySelector('.img-viewer-done').addEventListener('click', close);
  // Taille de départ lisible : bande de rythme (très allongée) → ~240 px de haut ; ECG 12 dérivations → ≥ 900 px de large.
  const img = v.querySelector('img');
  let zoom = 1;
  const size = () => {
    const ratio = img.naturalWidth / img.naturalHeight || 2;
    // Ordinateur : l'image tient entière dans la fenêtre (sans dépasser sa taille réelle).
    const fit = Math.min(img.naturalWidth, window.innerWidth - 48, (window.innerHeight - 140) * ratio);
    // Schémas : toujours entiers à l'écran (rien à faire glisser) ; toucher agrandit.
    const schema = /\/Schemas\//.test(src);
    const base = window.innerWidth >= 768 || schema ? (schema ? Math.min(window.innerWidth - 16, (window.innerHeight - 130) * ratio) : fit)
      : ratio > 3 ? 240 * ratio : Math.max(window.innerWidth, Math.min(900, img.naturalWidth));
    img.style.width = `${Math.round(base * zoom)}px`;
  };
  img.addEventListener('load', size);
  img.addEventListener('click', () => { zoom = zoom === 1 ? (window.innerWidth >= 768 ? 1.5 : 1.8) : 1; size(); });
  // Toucher le fond sombre autour de l'image ferme aussi.
  v.addEventListener('click', (e) => { if (e.target === v || e.target.classList.contains('img-viewer-scroll')) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(v);
}

document.addEventListener('keydown', (e) => {
  if (!qsession || modal.open || e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input, textarea')) return;
  const r = route();
  if (!((r.view === 'quiz-aleatoire' && r.id) || (r.view === 'quiz' && r.item))) return;
  const s = qsession, item = s.items[s.i];
  if (!item) return;
  if (!s.validated) {
    const pos = LETTERS.toLowerCase().indexOf(e.key.toLowerCase());
    if (e.key.length === 1 && pos >= 0 && pos < item.order.length) { e.preventDefault(); quizPick(item.order[pos]); }
    else if (e.key === 'Enter') { e.preventDefault(); quizValidate(); }
  } else if (['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); quizGrade(Number(e.key) - 1); }
});

document.addEventListener('keydown', (e) => {
  if (route().view !== 'review' || modal.open || document.querySelector('.img-viewer')) return;
  if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (!session?.revealed) reveal(); else grade(2);
  } else if (['1', '2', '3', '4'].includes(e.key)) {
    grade(Number(e.key) - 1);
  }
});

/** Met à jour les cours partagés, puis rafraîchit l'écran si quelque chose a changé. */
async function updateLibrary(force = false) {
  const r = await syncLibrary({ force });
  window.memoCollectives?.shareFlashcards();
  if (!r) return;
  if (r.added || r.updated || r.removed || r.changed) invalidateSearch();
  if ((r.changed || r.added || r.updated || r.removed) && route().view !== 'review' && !modal.open) render();
  if (r.added) toast(`Cours mis à jour : ${r.added} nouvelle${r.added > 1 ? 's' : ''} question${r.added > 1 ? 's' : ''}`);
}

// Au retour au premier plan : compteurs du jour à jour + vérification des cours partagés.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (route().view !== 'review' && !modal.open) render();
  updateLibrary();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker :', err));
}

render();
trackView();
flushStats();
updateLibrary(true);
loadAnnales();
const prevQuizList = JSON.stringify(quiz.knownList());
quiz.loadList().then((list) => {
  if (JSON.stringify(list) !== prevQuizList && route().view === 'home' && !modal.open) render();
});
