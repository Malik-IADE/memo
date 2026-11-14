import * as store from './store.js';
import { schedule, previewIntervals, endOfToday, dueLabel } from './srs.js';
import { parseText, deckToText } from './format.js';
import { syncLibrary } from './library.js';

const $app = document.getElementById('app');
const modal = document.getElementById('modal');
const fileInput = document.getElementById('file-input');

/* ---------- Utilitaires ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Images : « [img:chemin] » n'importe où dans la question ou la réponse. */
const IMG = /\[img:([^\]]+)\]\s*/g;
const takeImgs = (s) => ({ imgs: [...s.matchAll(IMG)].map((m) => m[1].trim()), text: s.replace(IMG, '').trim() });
const imgsHtml = (imgs) => imgs.map((src) => `<button type="button" class="card-img" data-action="zoom" data-src="${esc(src)}" aria-label="Agrandir l'image">
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
  if (lines.length === 1 && !lines[0].startsWith('- ')) return formatLine(lines[0]);
  const items = [];
  for (const l of lines) {
    if (l.startsWith('- ') && items.length) items[items.length - 1].subs.push(l.slice(2));
    else items.push({ text: l.replace(/^- /, ''), subs: [] });
  }
  return `<ul class="answer-list">${items.map((it) => `<li>${formatLine(it.text)}${it.subs.length
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
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  cards: svg('<rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v11"/>'),
  exam: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 14.5l2 2 4-4.5"/>'),
  shuffle: svg('<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  medal: svg('<circle cx="12" cy="15" r="6"/><path d="M8.5 9.5 6 2h12l-2.5 7.5"/>'),
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>'),
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

/* « Cours mélangés » : toutes les cartes des cours partagés, tirées au hasard. */
const MIX = 'mix';
const MIX_NAME = 'Cours mélangés';
const mixDecks = () => store.decks().filter((d) => d.source);
function mixStats() {
  const ds = mixDecks().map((d) => stats(d.id));
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
  const [view, id, sub] = (location.hash.slice(1) || '/').split('/').filter(Boolean).map(decodeURIComponent);
  return { view: view || 'home', id, sub };
}

function render() {
  const r = route();
  if (r.view === 'deck' && store.deck(r.id)) return renderDeck(r.id);
  if (r.view === 'review' && (r.id === MIX || store.deck(r.id))) return renderReview(r.id);
  if (r.view === 'f' && r.id) return r.sub ? renderUE(r.id, r.sub) : renderFolder(r.id);
  if (r.view === 'fc') return renderFlashcards();
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
window.addEventListener('hashchange', (e) => {
  const avant = new URL(e.oldURL).hash || '#/';
  if (!avant.startsWith('#/carte/')) hashPrecedent = avant;
  window.scrollTo(0, 0); render(); trackView();
});

/* ---------- Dossiers : Semestre → UE → cours ---------- */

// Emplacement d'un paquet d'après son fichier dans la Bibliothèque :
// « S1/3.3/cours.txt » → semestre « S1 », UE « 3.3 ». « Scores/scores.txt » → catégorie « Scores ».
// Paquets perso → dossier « perso ».
function locate(d) {
  const parts = (d.source || '').split('#')[0].split('/');
  if (parts.length >= 3) return { sem: parts[0], ue: parts[1] };
  if (parts.length === 2) return { sem: parts[0], ue: null };
  return { sem: d.source ? 'partages' : 'perso', ue: null };
}
// Catégorie à un seul paquet (ex. « Scores ») : l'accueil ouvre directement le paquet.
const isSingleCategory = (sem) => !/^S\d+$/i.test(sem) && sem !== 'perso' && sem !== 'partages';

const semLabel = (sem) => sem === 'perso' ? 'Mes paquets'
  : sem === 'partages' ? 'Cours partagés'
  : /^S\d+$/i.test(sem) ? `Semestre ${sem.slice(1)}` : sem;
const ueLabel = (ue) => `UE ${ue}`;
const enc = encodeURIComponent;
const folderHref = (d) => {
  const { sem, ue } = locate(d);
  if (!ue && isSingleCategory(sem)) return '#/';
  return ue ? `#/f/${enc(sem)}/${enc(ue)}` : `#/f/${enc(sem)}`;
};
const byKey = (a, b) => a.localeCompare(b, 'fr', { numeric: true });

// Dans un dossier d'UE, le préfixe « IADE – » est superflu.
const shortName = (name) => name.replace(/^IADE\s*[–-]\s*/, '');

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

function topbarHome() {
  return `
    <header class="topbar">
      <div class="brand"><img src="icons/icon.svg" alt="" class="logo"><h1>Mémo</h1></div>
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
        <a class="icon-btn" href="${backHref}" aria-label="Retour">${ico.back}</a>
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

/** Toutes les cartes qui contiennent tous les mots cherchés, les cours partagés d'abord. */
function searchCards(q) {
  const mots = fold(q).split(' ').filter(Boolean);
  if (!mots.length) return [];
  const out = [];
  for (const d of store.decks()) {
    const nom = shortName(d.name);
    for (const c of store.cards(d.id)) {
      const hay = fold(`${c.front} ${c.back} ${nom}`);
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
            <a class="card-row hit-link" href="#/carte/${c.id}">
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
  try { return (JSON.parse(localStorage.getItem(RESULTATS_KEY)) || []).filter((r) => r && r.href && isFinite(r.note)); }
  catch { return []; }
};
const dateCourte = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};
const note2 = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Vert au-dessus de 14, orange entre 10 et 14, rouge en dessous.
const tonNote = (n) => (n >= 14 ? 'bon' : n >= 10 ? 'moyen' : 'faible');

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

  $app.innerHTML = `${topbarFolder('#/', 'Mes résultats')}
    <main class="page">
      ${lignes.length ? `
        <section class="hero">
          <p class="eyebrow">Annales faites</p>
          <p class="hero-value">${plural(lignes.length, 'annale')} · moyenne ${note2(moyenne)}/20</p>
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
        <button class="btn ghost wide danger-text" data-action="clear-results">Effacer mes résultats</button>`
      : `<section class="empty">
          <div class="empty-art">🏅</div>
          <h2>Pas encore de résultat</h2>
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
      <a class="folder-row" href="${href}">
        <span class="folder-icon">${icon}</span>
        <span class="folder-text">
          <span class="folder-name">${esc(name)}</span>
          <span class="folder-meta">${meta}</span>
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
          <a class="deck-link" href="#/deck/${d.id}">
            <span class="deck-name">${esc(shortName(d.name))}</span>
            <span class="deck-meta">${plural(s.total, 'carte')}</span>
          </a>
          <span class="counts">
            <span class="count new" title="Nouvelles">${s.newAvail}</span>
            <span class="count due" title="À revoir">${s.dueAvail}</span>
          </span>
          <a class="btn small ${s.todo ? 'primary' : 'soft'}" href="#/review/${d.id}">Réviser</a>
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

/** Accueil : Cours mélangés, Flashcards, Annales, puis les catégories (ex. « Scores »). */
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
  const cats = sortSems([...sems.keys()].filter(isSingleCategory));
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

  $app.innerHTML = `${topbarHome()}
    <main class="page">
      ${hero(sumTodo(rows))}
      <a class="search-box" href="#/recherche">
        ${ico.search}<span>Chercher une notion…</span>
      </a>
      <ul class="folder-list">
        ${mixDecks().length > 1 ? (() => { const m = mixStats(); return folderRow(
          `#/review/${MIX}`, MIX_NAME, 'Questions de tous les cours, tirées au hasard', m.todo, ico.shuffle); })() : ''}
        ${fcRows.length ? folderRow('#/fc', 'Flashcards',
          [`${fcUes.size} UE`, plural(fcRows.length, 'cours')].join(' · '), sumTodo(fcRows), ico.cards) : ''}
        ${annaleRow('annales')}
        ${annaleRow('annales-nf')}
        ${cats.map((k) => {
          const rs = sems.get(k);
          if (rs.length === 1) {
            // Une catégorie à un seul paquet (ex. « Scores ») lance la révision tout de suite.
            const { d, s } = rs[0];
            return folderRow(`#/review/${d.id}`, k, `${plural(store.cards(d.id).length, 'carte')} · tirées au hasard`, s.todo, ico.shuffle);
          }
          return folderRow(`#/f/${enc(k)}`, k, plural(rs.length, 'paquet'), sumTodo(rs), ico.folder);
        }).join('')}
      </ul>
    </main>`;
}

/** Flashcards : un dossier par semestre (+ « Mes paquets »). */
function renderFlashcards() {
  session = null;
  const rows = allRows().filter((r) => !isSingleCategory(r.loc.sem));
  if (!rows.length) { location.hash = '#/'; return; }
  const sems = bySemester(rows);

  $app.innerHTML = `${topbarFolder('#/', 'Flashcards')}
    <main class="page">
      ${hero(sumTodo(rows))}
      <ul class="folder-list">
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
  const meta = (a) => {
    const y = annaleYears(a);
    if (!y) return 'Quiz interactif';
    return kind === 'annales-nf' ? `Promotion ${y} · quiz interactif` : `Sujets ${y} · quiz interactif`;
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
  const back = isSingleCategory(sem) ? '#/' : '#/fc';

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
function renderUE(sem, ue) {
  session = null;
  const rows = allRows().filter((r) => r.loc.sem === sem && r.loc.ue === ue);
  if (!rows.length) { location.hash = `#/f/${enc(sem)}`; return; }
  $app.innerHTML = `${topbarFolder(`#/f/${enc(sem)}`, ueLabel(ue), semLabel(sem))}
    <main class="page">
      ${hero(sumTodo(rows))}${deckRows(rows)}
      ${(() => {
        const rows = Object.keys(COLLECTIONS)
          .filter((k) => annalesOf(sem, ue, k).length)
          .map((k) => folderRow(`#/${k}/${enc(sem)}/${enc(ue)}`, COLLECTIONS[k].label,
            plural(annalesOf(sem, ue, k).length, 'annale'), 0, ico.exam));
        return rows.length ? `<p class="section-label">Annales</p><ul class="folder-list">${rows.join('')}</ul>` : '';
      })()}
    </main>`;
}

/* ---------- Page d'un paquet ---------- */

// Une carte de la liste s'ouvre en flashcard (lecture seule) : les cours sont partagés,
// une modification locale serait écrasée à la prochaine mise à jour.
function cardRows(cs) {
  if (!cs.length) return `<li class="muted center pad">Aucune carte pour l'instant.</li>`;
  return cs.map((c) => `
    <li class="card-row-item" data-q="${esc(fold(`${c.front} ${c.back}`))}">
      <a class="card-row" href="#/carte/${c.id}">
        <span class="card-text">
          <span class="card-front">${esc(plainText(c.front))}</span>
          <span class="card-back">${esc(c.back)}</span>
        </span>
        <span class="tag ${c.seen ? '' : 'tag-new'}">${dueLabel(c)}</span>
      </a>
    </li>`).join('');
}

function renderDeck(id) {
  session = null;
  const d = store.deck(id);
  const s = stats(id);
  $app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="${folderHref(d)}" aria-label="Retour">${ico.back}</a>
      <h1 class="title-sm">${esc(shortName(d.name))}</h1>
      <button class="icon-btn" data-action="deck-menu" data-id="${id}" aria-label="Options du paquet">${ico.more}</button>
    </header>
    <main class="page">
      <section class="stats">
        <div class="stat"><span class="stat-v c-new">${s.newAvail}</span><span class="stat-l">Nouvelles</span></div>
        <div class="stat"><span class="stat-v c-due">${s.dueAvail}</span><span class="stat-l">À revoir</span></div>
        <div class="stat"><span class="stat-v">${s.total}</span><span class="stat-l">Total</span></div>
      </section>
      ${s.backlog ? `<p class="hint center">+ ${plural(s.backlog, 'révision')} reportée${s.backlog > 1 ? 's' : ''} aux prochaines sessions (limite quotidienne)</p>` : ''}
      <a class="btn ${s.todo ? 'primary' : 'soft'} wide big" href="#/review/${id}">
        ${s.todo ? `Réviser · ${s.todo}` : 'Rien à réviser pour le moment'}
      </a>

      <form class="panel" id="add-form" data-id="${id}">
        <h2>Ajouter une carte</h2>
        ${d.source ? '<p class="hint">Cours partagé : il se met à jour tout seul. Les cartes que vous ajoutez ici restent personnelles.</p>' : ''}
        <label>Question<textarea name="front" rows="2" required placeholder="Ex. Capitale du Japon ?"></textarea></label>
        <label>Réponse<textarea name="back" rows="2" required placeholder="Ex. Tokyo"></textarea></label>
        <div class="row">
          <button class="btn primary" type="submit">${ico.plus} Ajouter</button>
          <button class="btn ghost" type="button" data-action="import" data-id="${id}">${ico.upload} Coller une liste</button>
        </div>
        <p class="hint hide-touch">⌘ + Entrée pour ajouter rapidement</p>
      </form>

      <section class="panel">
        <div class="list-head">
          <h2>Cartes <span class="muted">${s.total}</span></h2>
          ${s.total > 5 ? `<input type="search" id="search" placeholder="Rechercher…" aria-label="Rechercher">` : ''}
        </div>
        <ul class="card-list" id="card-list">${cardRows(store.cards(id))}</ul>
      </section>
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
  // En fermant, on revient au menu d'où part la révision : l'accueil pour « Cours
  // mélangés » et « Scores », le dossier de l'UE pour un cours.
  const backHref = mix ? '#/' : folderHref(d);
  const c = session.queue.length ? store.card(session.queue[0]) : null;

  if (!c) {
    const nothing = session.reviewed === 0;
    $app.innerHTML = `
      <header class="topbar">
        <a class="icon-btn" href="${backHref}" aria-label="Retour">${ico.back}</a>
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
          ${mix ? '' : `<a class="btn soft wide" href="#/deck/${id}">Voir le paquet</a>`}
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
        <a class="icon-btn" href="${backHref}" aria-label="Quitter la révision">${ico.close}</a>
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
            <div class="face front ${session.revealed && c.back.includes('\n') ? 'small' : ''}">${rich(qf.text)}</div>
            ${session.revealed ? `<hr>${imgsHtml(qb.imgs)}<div class="face back ${qb.text.includes('\n') ? 'multi' : ''}">${richAnswer(qb.text)}</div>` : '<p class="tap-hint">Touchez pour voir la réponse</p>'}
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
  const retour = venuDeRecherche ? '#/recherche' : `#/deck/${d.id}`;
  const retourLabel = venuDeRecherche ? 'Retour à la recherche' : 'Retour au cours';

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
            <div class="face front ${carteVue.revealed && c.back.includes('\n') ? 'small' : ''}">${rich(qf.text)}</div>
            ${carteVue.revealed
              ? `<hr>${imgsHtml(qb.imgs)}<div class="face back ${qb.text.includes('\n') ? 'multi' : ''}">${richAnswer(qb.text)}</div>`
              : '<p class="tap-hint">Touchez pour voir la réponse</p>'}
          </div>
        </article>
      </main>
      <footer class="answer-bar">
        ${carteVue.revealed
          ? `<div class="stack">
              <a class="btn primary wide big" href="#/review/${d.id}">Réviser ce cours</a>
              <a class="btn ghost wide" href="${retour}">${retourLabel}</a>
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
  store.updateCard(c.id, schedule(c, g));
  store.bumpToday(c.deckId, wasNew ? 'new' : 'rev');
  if (session.deckId === MIX) store.bumpToday(MIX, wasNew ? 'new' : 'rev');
  session.queue.shift();
  session.reviewed++;
  if (g === 0) session.again++; // ne revient pas dans cette session : 1 à 3 jours plus tard
  session.revealed = false;
  render();
}

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
    location.hash = `#/deck/${d.id}`;
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
  const s = r.added > 1 ? 's' : '';
  const parts = [`${r.added} nouvelle${s} carte${s}`];
  if (r.updated) parts.push(`${r.updated} mise(s) à jour`);
  if (r.removed) parts.push(`${r.removed} supprimée(s)`);
  if (errors.length) parts.push(`${errors.length} ligne(s) ignorée(s)`);
  toast(`${r.names.join(', ')} : ${parts.join(' · ')}`);
  if (r.names.length === 1) {
    const d = store.deckByName(r.names[0]);
    if (location.hash === `#/deck/${d.id}`) render(); else location.hash = `#/deck/${d.id}`;
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
        <button class="menu-item" type="button" data-unhide="${d.id}">Réafficher « ${esc(d.name)} »</button>`).join('')}
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
      try { store.importBackup(text); modal.close(); render(); toast('Sauvegarde restaurée'); }
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
    case 'grade': return grade(Number(el.dataset.grade));
    case 'zoom': return openViewer(el.dataset.src);
    case 'clear-results': {
      if (!confirm('Effacer toutes vos notes d\'annales ? Les annales elles-mêmes sont conservées.')) return;
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
    <p class="img-viewer-hint">Toucher l'image : zoom · faire glisser pour parcourir</p>`;
  const close = () => { v.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  v.querySelector('.img-viewer-close').addEventListener('click', close);
  // Taille de départ lisible : bande de rythme (très allongée) → ~240 px de haut ; ECG 12 dérivations → ≥ 900 px de large.
  const img = v.querySelector('img');
  let zoom = 1;
  const size = () => {
    const ratio = img.naturalWidth / img.naturalHeight || 2;
    const base = ratio > 3 ? 240 * ratio : Math.max(window.innerWidth, Math.min(900, img.naturalWidth));
    img.style.width = `${Math.round(base * zoom)}px`;
  };
  img.addEventListener('load', size);
  img.addEventListener('click', () => { zoom = zoom === 1 ? 1.8 : 1; size(); });
  v.addEventListener('click', (e) => { if (e.target === v) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(v);
}

$app.addEventListener('submit', (e) => {
  if (e.target.id !== 'add-form') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const front = f.get('front').trim(), back = f.get('back').trim();
  if (!front || !back) return;
  store.addCard(e.target.dataset.id, front, back);
  render();
  document.querySelector('#add-form [name=front]')?.focus();
  toast('Carte ajoutée');
});

$app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.closest('#add-form')) {
    e.preventDefault();
    e.target.closest('form').requestSubmit();
  }
});

$app.addEventListener('input', (e) => {
  if (e.target.id !== 'search') return;
  const q = fold(e.target.value);   // sans accents, comme la recherche globale
  document.querySelectorAll('#card-list .card-row-item').forEach((li) => {
    li.hidden = q && !li.dataset.q.includes(q);
  });
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
  if (!r) return;
  if ((force || r.added || r.updated || r.removed) && route().view !== 'review' && !modal.open) render();
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
updateLibrary(true);
loadAnnales();
