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
/** « Titre : texte » → titre en gras ; « Titre : » seul → intertitre. */
const formatLine = (l) => {
  const head = l.match(/^(.{1,50}) :$/);
  if (head) return `<strong>${esc(head[1])}</strong>`;
  const m = l.match(/^([^:]{1,50}?) : (.+)$/);
  return m ? `<strong>${esc(m[1])}</strong> : ${esc(m[2])}` : esc(l);
};
/**
 * Réponse sur plusieurs lignes → liste alignée à gauche.
 * Une ligne qui commence par « - » devient une sous-puce de la ligne précédente.
 */
const richAnswer = (s) => {
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && !lines[0].startsWith('- ')) return formatLine(lines[0]);
  return `<ul class="answer-list">${lines.map((l) => l.startsWith('- ')
    ? `<li class="sub">${formatLine(l.slice(2))}</li>`
    : `<li>${formatLine(l)}</li>`).join('')}</ul>`;
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
  const [, view, id] = (location.hash.slice(1) || '/').split('/');
  return { view: view || 'home', id };
}

function render() {
  const r = route();
  if (r.view === 'deck' && store.deck(r.id)) return renderDeck(r.id);
  if (r.view === 'review' && store.deck(r.id)) return renderReview(r.id);
  renderHome();
}

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

/* ---------- Accueil ---------- */

// Regroupement par dossier de la Bibliothèque : « S1/3.3/cours.txt » → Semestre 1 › UE 3.3.
function groupOf(d) {
  const parts = (d.source || '').split('#')[0].split('/');
  if (parts.length >= 3) {
    const [sem, ue] = parts;
    const n = sem.match(/^S(\d+)$/i);
    return { key: `${sem}/${ue}`, semester: n ? `Semestre ${n[1]}` : sem, title: `UE ${ue}` };
  }
  if (d.source) return { key: 'partages', semester: '', title: 'Cours partagés' };
  return { key: 'perso', semester: '', title: 'Mes paquets' };
}

function groupDecks(rows) {
  const groups = new Map();
  for (const r of rows) {
    const g = groupOf(r.d);
    if (!groups.has(g.key)) groups.set(g.key, { ...g, rows: [], todo: 0 });
    const grp = groups.get(g.key);
    grp.rows.push(r);
    grp.todo += r.s.todo;
  }
  // Semestres / UE dans l'ordre naturel, « Mes paquets » à la fin.
  const rank = (k) => (k === 'perso' ? 2 : k === 'partages' ? 1 : 0);
  return [...groups.values()].sort((a, b) =>
    rank(a.key) - rank(b.key) || a.key.localeCompare(b.key, 'fr', { numeric: true }));
}

// Dans une rubrique UE, le préfixe « IADE – » est superflu.
const shortName = (name) => name.replace(/^IADE\s*[–-]\s*/, '');

// Rubriques repliées : simple confort mémorisé dans ce navigateur.
const CLOSED_KEY = 'memo-groupes-fermes';
function closedGroups() {
  try { return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY) || '[]')); } catch { return new Set(); }
}
const isGroupOpen = (key) => !closedGroups().has(key);
function rememberGroup(key, open) {
  try {
    const s = closedGroups();
    if (open) s.delete(key); else s.add(key);
    localStorage.setItem(CLOSED_KEY, JSON.stringify([...s]));
  } catch { /* stockage indisponible : on ignore */ }
}

function renderHome() {
  session = null;
  const rows = store.decks().map((d) => ({ d, s: stats(d.id) }));
  const todo = rows.reduce((n, r) => n + r.s.todo, 0);

  $app.innerHTML = `
    <header class="topbar">
      <div class="brand"><img src="icons/icon.svg" alt="" class="logo"><h1>Mémo</h1></div>
      <div class="topbar-actions">
        <button class="btn ghost" data-action="import">${ico.upload}<span class="hide-xs">Importer</span></button>
        <button class="icon-btn" data-action="settings" aria-label="Réglages">${ico.gear}</button>
      </div>
    </header>
    <main class="page">
      ${rows.length ? `
        <section class="hero">
          <p class="eyebrow">Aujourd'hui</p>
          <p class="hero-value">${todo ? `${plural(todo, 'carte')} à réviser` : 'Tout est à jour ✓'}</p>
        </section>
        ${groupDecks(rows).map((g) => `
          <details class="group" data-group="${esc(g.key)}" ${isGroupOpen(g.key) ? 'open' : ''}>
            <summary class="group-head">
              <span class="group-title">
                ${g.semester ? `<span class="group-sem">${esc(g.semester)}</span>` : ''}
                <span class="group-name">${esc(g.title)}</span>
              </span>
              <span class="group-meta">${plural(g.rows.length, 'cours')}${g.todo ? ` · <b>${g.todo}</b> à réviser` : ''}</span>
              <span class="group-chevron">${ico.chevron}</span>
            </summary>
            <ul class="deck-list">
              ${g.rows.map(({ d, s }) => `
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
            </ul>
          </details>`).join('')}
        <button class="btn soft wide" data-action="new-deck">${ico.plus} Nouveau paquet</button>
      ` : `
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
      `}
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
      <a class="icon-btn" href="#/" aria-label="Retour">${ico.back}</a>
      <h1 class="title-sm">${esc(d.name)}</h1>
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

$app.addEventListener('toggle', (e) => {
  if (e.target.matches?.('details.group')) rememberGroup(e.target.dataset.group, e.target.open);
}, true);

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
updateLibrary(true);
