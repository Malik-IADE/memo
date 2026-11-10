import * as store from './store.js';
import { schedule, previewIntervals, endOfToday, dueLabel } from './srs.js';
import { parseText, deckToText } from './format.js';
import { syncLibrary } from './library.js';

const $app = document.getElementById('app');
const modal = document.getElementById('modal');
const fileInput = document.getElementById('file-input');

/* ---------- Utilitaires ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rich = (s) => esc(s).replace(/\n/g, '<br>');
/**
 * Une ligne de réponse :
 * - « Titre : » seul → étiquette en gras (ses lignes « - » deviennent ses sous-puces) ;
 * - « Étiquette : texte » → étiquette en gras puis texte ;
 * - sinon texte simple.
 */
const formatLine = (l) => {
  const head = l.match(/^(.{1,60}) :$/);
  if (head) return `<strong>${esc(head[1])}</strong>`;
  const m = l.match(/^([^:]{1,50}?) : (.+)$/);
  return m ? `<strong>${esc(m[1])}</strong> : ${esc(m[2])}` : esc(l);
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
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
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

/* ---------- Routage ---------- */

let session = null;

function route() {
  const [view, id, sub] = (location.hash.slice(1) || '/').split('/').filter(Boolean).map(decodeURIComponent);
  return { view: view || 'home', id, sub };
}

function render() {
  const r = route();
  if (r.view === 'deck' && store.deck(r.id)) return renderDeck(r.id);
  if (r.view === 'review' && store.deck(r.id)) return renderReview(r.id);
  if (r.view === 'f' && r.id) return r.sub ? renderUE(r.id, r.sub) : renderFolder(r.id);
  renderHome();
}

/**
 * Statistiques anonymes (GoatCounter) : une « page vue » par écran.
 * Chemins lisibles : /accueil, /S1, /S1/3.3, /cours/<nom>, /revision/<nom>. Jamais de donnée personnelle.
 */
function trackView() {
  const r = route();
  const name = (id) => { const d = store.deck(id); return d ? shortName(d.name) : 'inconnu'; };
  const path = r.view === 'f' ? `/${[r.id, r.sub].filter(Boolean).join('/')}`
    : r.view === 'deck' ? `/cours/${name(r.id)}`
    : r.view === 'review' ? `/revision/${name(r.id)}`
    : '/accueil';
  const send = () => window.goatcounter?.count?.({ path, title: path });
  if (window.goatcounter?.count) send();
  else setTimeout(send, 1500); // le script se charge en différé
}

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); trackView(); });

/* ---------- Dossiers : Semestre → UE → cours ---------- */

// Emplacement d'un paquet d'après son fichier dans la Bibliothèque :
// « S1/3.3/cours.txt » → semestre « S1 », UE « 3.3 ». Paquets perso → dossier « perso ».
function locate(d) {
  const parts = (d.source || '').split('#')[0].split('/');
  if (parts.length >= 3) return { sem: parts[0], ue: parts[1] };
  return { sem: d.source ? 'partages' : 'perso', ue: null };
}

const semLabel = (sem) => sem === 'perso' ? 'Mes paquets'
  : sem === 'partages' ? 'Cours partagés'
  : /^S\d+$/i.test(sem) ? `Semestre ${sem.slice(1)}` : sem;
const ueLabel = (ue) => `UE ${ue}`;
const enc = encodeURIComponent;
const folderHref = (d) => {
  const { sem, ue } = locate(d);
  return ue ? `#/f/${enc(sem)}/${enc(ue)}` : `#/f/${enc(sem)}`;
};
const byKey = (a, b) => a.localeCompare(b, 'fr', { numeric: true });

// Dans un dossier d'UE, le préfixe « IADE – » est superflu.
const shortName = (name) => name.replace(/^IADE\s*[–-]\s*/, '');

const allRows = () => store.decks().map((d) => ({ d, s: stats(d.id), loc: locate(d) }));
const sumTodo = (rows) => rows.reduce((n, r) => n + r.s.todo, 0);

function topbarHome() {
  return `
    <header class="topbar">
      <div class="brand"><img src="icons/icon.svg" alt="" class="logo"><h1>Mémo</h1></div>
      <div class="topbar-actions">
        <button class="btn ghost" data-action="import">${ico.upload}<span class="hide-xs">Importer</span></button>
        <button class="icon-btn" data-action="settings" aria-label="Réglages">${ico.gear}</button>
      </div>
    </header>`;
}

function topbarFolder(backHref, title, eyebrow = '') {
  return `
    <header class="topbar">
      <a class="icon-btn" href="${backHref}" aria-label="Retour">${ico.back}</a>
      <div class="topbar-title">
        ${eyebrow ? `<span class="topbar-eyebrow">${esc(eyebrow)}</span>` : ''}
        <h1 class="title-sm">${esc(title)}</h1>
      </div>
      <span class="icon-btn" aria-hidden="true"></span>
    </header>`;
}

function hero(todo) {
  return `
    <section class="hero">
      <p class="eyebrow">Aujourd'hui</p>
      <p class="hero-value">${todo ? `${plural(todo, 'carte')} à réviser` : 'Tout est à jour ✓'}</p>
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

/** Accueil : un dossier par semestre (+ « Mes paquets »). */
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
  const sems = new Map();
  for (const r of rows) {
    if (!sems.has(r.loc.sem)) sems.set(r.loc.sem, []);
    sems.get(r.loc.sem).push(r);
  }
  const rank = (k) => (k === 'perso' ? 2 : k === 'partages' ? 1 : 0);
  const keys = [...sems.keys()].sort((a, b) => rank(a) - rank(b) || byKey(a, b));

  $app.innerHTML = `${topbarHome()}
    <main class="page">
      ${hero(sumTodo(rows))}
      <ul class="folder-list">
        ${keys.map((k) => {
          const rs = sems.get(k);
          const ues = new Set(rs.map((r) => r.loc.ue).filter(Boolean));
          const meta = ues.size ? `${`${ues.size} UE`} · ${`${rs.length} cours`}` : plural(rs.length, 'paquet');
          return folderRow(`#/f/${enc(k)}`, semLabel(k), meta, sumTodo(rs), k === 'perso' ? ico.cards : ico.folder);
        }).join('')}
      </ul>
      <button class="btn soft wide" data-action="new-deck">${ico.plus} Nouveau paquet</button>
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

  $app.innerHTML = `${topbarFolder('#/', semLabel(sem))}
    <main class="page">
      ${hero(sumTodo(rows))}
      ${ues.size ? `
        <ul class="folder-list">
          ${[...ues.keys()].sort(byKey).map((ue) => {
            const rs = ues.get(ue);
            return folderRow(`#/f/${enc(sem)}/${enc(ue)}`, ueLabel(ue), `${rs.length} cours`, sumTodo(rs));
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
      ${hero(sumTodo(rows))}
      ${deckRows(rows)}
    </main>`;
}

/* ---------- Page d'un paquet ---------- */

function cardRows(cs) {
  if (!cs.length) return `<li class="muted center pad">Aucune carte pour l'instant.</li>`;
  return cs.map((c) => `
    <li class="card-row" data-action="edit-card" data-id="${c.id}" data-q="${esc((c.front + ' ' + c.back).toLowerCase())}">
      <div class="card-text">
        <span class="card-front">${esc(c.front)}</span>
        <span class="card-back">${esc(c.back)}</span>
      </div>
      <span class="tag ${c.seen ? '' : 'tag-new'}">${dueLabel(c)}</span>
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
  const cs = store.cards(deckId);
  const end = endOfToday();
  const s = stats(deckId);
  // Les révisions les plus en retard d'abord, dans la limite du jour, puis mélangées.
  const due = shuffle(cs.filter((c) => c.seen && c.due <= end)
    .sort((a, b) => a.due - b.due)
    .slice(0, s.dueAvail)
    .map((c) => c.id));
  // Nouvelles cartes tirées au hasard parmi celles jamais vues (pas dans l'ordre du fichier).
  const fresh = shuffle(cs.filter((c) => !c.seen).map((c) => c.id)).slice(0, s.newAvail);
  // Révisions et nouvelles cartes mélangées : ordre différent à chaque session.
  const queue = shuffle([...due, ...fresh]);
  return { deckId, queue, revealed: false, reviewed: 0, again: 0, total: queue.length };
}

function renderReview(id) {
  if (!session || session.deckId !== id) session = buildSession(id);
  const d = store.deck(id);
  const c = session.queue.length ? store.card(session.queue[0]) : null;

  if (!c) {
    const nothing = session.reviewed === 0;
    $app.innerHTML = `
      <header class="topbar">
        <a class="icon-btn" href="#/deck/${id}" aria-label="Retour">${ico.back}</a>
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
          <a class="btn soft wide" href="#/deck/${id}">Voir le paquet</a>
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

  $app.innerHTML = `
    <div class="review">
      <header class="topbar">
        <a class="icon-btn" href="#/deck/${id}" aria-label="Quitter la révision">${ico.close}</a>
        <span class="title-sm">${esc(d.name)}</span>
        <span class="counts"><span class="count new">${nNew}</span><span class="count due">${nRev}</span></span>
      </header>
      <div class="progress"><span style="width:${pct}%"></span></div>
      <main class="flash ${session.revealed ? 'revealed' : ''}" ${session.revealed ? '' : 'data-action="reveal"'}>
        <article class="flash-card">
          ${c.seen ? '' : '<span class="tag tag-new flash-tag">Nouvelle</span>'}
          <div class="flash-inner">
            <div class="face front ${session.revealed && c.back.includes('\n') ? 'small' : ''}">${rich(c.front)}</div>
            ${session.revealed ? `<hr><div class="face back ${c.back.includes('\n') ? 'multi' : ''}">${richAnswer(c.back)}</div>` : '<p class="tap-hint">Touchez pour voir la réponse</p>'}
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

function editCardModal(cardId) {
  const c = store.card(cardId);
  openModal(`
    <h2>Modifier la carte</h2>
    <label>Question<textarea name="front" rows="3" required>${esc(c.front)}</textarea></label>
    <label>Réponse<textarea name="back" rows="3" required>${esc(c.back)}</textarea></label>
    <p class="hint">Prochaine révision : ${dueLabel(c)}${c.seen ? ` · intervalle ${c.interval} j · ${c.lapses} oubli(s)` : ''}</p>
    <div class="modal-actions">
      <button class="btn ghost danger-text" value="delete" formnovalidate>Supprimer</button>
      ${c.seen ? `<button class="btn ghost" value="reset" formnovalidate>Réinitialiser</button>` : ''}
      <span class="spacer"></span>
      ${cancelBtn}<button class="btn primary" value="save">Enregistrer</button>
    </div>`,
  (f, v) => {
    if (v === 'delete') { store.deleteCard(cardId); toast('Carte supprimée'); }
    else if (v === 'reset') { store.resetCard(cardId); toast('Progression remise à zéro'); }
    else {
      const front = f.get('front').trim(), back = f.get('back').trim();
      if (!front || !back) return false;
      store.updateCard(cardId, { front, back });
    }
    render();
  });
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
    <label>Révisions maximum par jour (par paquet)
      <input name="reviewsPerDay" type="number" min="1" max="9999" value="${s.reviewsPerDay}" inputmode="numeric">
    </label>
    <p class="hint">Au-delà, les cartes à revoir sont reportées aux sessions suivantes, les plus en retard d'abord.</p>
    ${store.hiddenDecks().length ? `
      <h3>Cours masqués</h3>
      <div class="menu">${store.hiddenDecks().map((d) => `
        <button class="menu-item" type="button" data-unhide="${d.id}">Réafficher « ${esc(d.name)} »</button>`).join('')}
      </div>` : ''}
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
    case 'edit-card': return editCardModal(id);
    case 'reveal': return reveal();
    case 'grade': return grade(Number(el.dataset.grade));
  }
});

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
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('#card-list .card-row').forEach((li) => {
    li.hidden = q && !li.dataset.q.includes(q);
  });
});

document.addEventListener('keydown', (e) => {
  if (route().view !== 'review' || modal.open) return;
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
