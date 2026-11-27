// Duel 1 contre 1 en direct : écrans de l'app et connexion au Worker « memo-duel ».
//
// Le serveur tire les questions, tient le chrono et calcule les notes : l'app ne reçoit
// les bonnes réponses qu'à la fin de la manche. Anonyme : ni nom ni compte, seulement
// « Toi » et « Adversaire ». La partie en cours (code + jeton) est gardée dans
// « memo-duel-v1 » pour la reprendre après un rechargement ou une coupure réseau.
import * as quiz from './quiz.js';

const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const SERVEUR = LOCAL ? 'http://127.0.0.1:8787' : 'https://memo-duel.malikbm88.workers.dev';
const CLE = 'memo-duel-v1';
const SESSION_MAX = 3 * 3600e3;
const NQ = [10, 15, 20, 30];
const TEMPS = [15, 30, 45, 60];
const LETTRES = 'ABCDEFGH';
const ECHEC = {
  reseau: 'Pas de connexion : le duel a besoin d’internet.',
  trop: 'Trop d’essais rapprochés. Réessaie dans une minute.',
  introuvable: 'Code introuvable, expiré ou partie déjà commencée.',
  complet: 'Cette partie a déjà ses deux joueurs.',
  quiz: 'Les questions n’ont pas pu être chargées. Réessaie.',
};
const FIN = {
  annulee: 'La partie a été annulée par son créateur.',
  expiree: 'Le code a expiré : personne n’a rejoint la partie en 15 minutes.',
  introuvable: 'Cette partie n’existe plus.',
  remplacee: 'La partie s’est ouverte dans un autre onglet ou un autre appareil.',
  fin: 'La partie est terminée.',
};

let h = null;      // outils de l'app (esc, ico, topbarFolder, toast…)
let $app = null;
const reglages = { nq: 15, temps: 30 };
let explication = true;
let co = null;     // connexion à la partie en cours

export function init(outils) {
  h = outils;
  $app = outils.$app;
  document.addEventListener('click', clic);
  document.addEventListener('keydown', clavier);
}

/* ---------- Partie gardée dans le navigateur ---------- */

function lireSession() {
  try {
    const s = JSON.parse(localStorage.getItem(CLE));
    return s && /^[A-Z0-9]{6}$/.test(s.code) && Date.now() - s.t < SESSION_MAX ? s : null;
  } catch { return null; }
}
function ecrireSession(s) {
  try { if (s) localStorage.setItem(CLE, JSON.stringify({ code: s.code, jeton: s.jeton, t: Date.now() })); else localStorage.removeItem(CLE); } catch {}
}

/* ---------- Écrans ---------- */

const enPartie = () => location.hash === '#/duel/partie';

export function render(id) {
  if (id !== 'partie') detacher();
  if (id === 'creer') return ecranCreer();
  if (id === 'rejoindre') return ecranRejoindre();
  if (id === 'partie') return ecranPartie();
  return ecranMenu();
}

const icones = {
  cle: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  copie: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  sablier: '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/></svg>',
  reprendre: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4v16l14-8z"/></svg>',
};

function ecranMenu() {
  const s = lireSession();
  $app.innerHTML = `${h.topbarFolder('#/', 'Duel 1 contre 1')}
    <main class="page duel">
      <div class="duel-actions">
        ${s ? `<a class="duel-big" href="#/duel/partie"><span class="duel-big-ic">${icones.reprendre}</span><b>Reprendre la partie en cours<small>Code ${h.esc(s.code)}</small></b><span class="duel-big-chev">${h.ico.chevron}</span></a>` : ''}
        <a class="duel-big" href="#/duel/creer"><span class="duel-big-ic">${h.ico.plus}</span><b>Créer une partie</b><span class="duel-big-chev">${h.ico.chevron}</span></a>
        <a class="duel-big" href="#/duel/rejoindre"><span class="duel-big-ic">${icones.cle}</span><b>Rejoindre une partie</b><span class="duel-big-chev">${h.ico.chevron}</span></a>
      </div>
      <button type="button" class="duel-explain" data-duel="explication" aria-expanded="${explication}" aria-controls="duel-regles">${icones.info} Explication</button>
      <section class="duel-regles" id="duel-regles" ${explication ? '' : 'hidden'}>
        <h2>Comment ça marche</h2>
        <ol>
          <li><span>Un joueur <b>crée la partie</b> : il choisit le nombre de questions, le temps par question et une UE au hasard (ou toutes les UE).</span></li>
          <li><span>Mémo affiche un <b>code de 6 caractères</b> à envoyer à l’adversaire, qui le tape dans «&nbsp;Rejoindre une partie&nbsp;».</span></li>
          <li><span>Un <b>compte à rebours de 3 secondes</b> lance le duel : mêmes questions, même ordre.</span></li>
          <li><span>Chacun avance <b>à son rythme</b>. À la fin du temps, la réponse cochée est validée telle quelle.</span></li>
          <li><span>Barème des quiz, ramené sur 20. À égalité, le plus rapide gagne.</span></li>
        </ol>
        <p class="duel-tip">${icones.info}<span><b>Anonyme</b> : ni compte ni nom. Le code sert pour une seule partie et expire au bout de 15 minutes.</span></p>
      </section>
    </main>`;
}

async function ecranCreer() {
  const liste = quiz.knownList().length ? quiz.knownList() : await quiz.loadList();
  if (location.hash !== '#/duel/creer') return;
  const parUe = new Map();
  for (const f of liste) if (f.sem && f.ue) parUe.set(`${f.sem}/${f.ue}`, (parUe.get(`${f.sem}/${f.ue}`) || 0) + 1);
  const ues = [...parUe.keys()].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  const sems = new Set(ues.map((k) => k.split('/')[0]));
  const seg = (cle, vals, unite, label) => `<div class="duel-seg" role="group" aria-label="${label}">${vals.map((v) =>
    `<button type="button" class="${reglages[cle] === v ? 'on' : ''}" data-duel="reglage" data-cle="${cle}" data-v="${v}" aria-pressed="${reglages[cle] === v}">${v}${unite}</button>`).join('')}</div>`;
  const ligne = (portee, nom, meta) => `<li><button type="button" class="folder-row" data-duel="creer" data-portee="${h.esc(portee)}">
      <span class="folder-icon duel-ic">${h.ico.shuffle}</span>
      <span class="folder-text"><span class="folder-name">${h.esc(nom)}</span><span class="folder-meta">${h.esc(meta)}</span></span>
      <span class="folder-chev">${h.ico.chevron}</span></button></li>`;
  $app.innerHTML = `${h.topbarFolder('#/duel', 'Créer une partie', 'Duel 1 contre 1')}
    <main class="page duel">
      <section class="duel-card">
        <div class="duel-set"><span>Questions</span><output id="duel-o-nq">${reglages.nq}</output></div>
        ${seg('nq', NQ, '', 'Nombre de questions')}
        <div class="duel-set"><span>Temps par question</span><output id="duel-o-temps">${reglages.temps} s</output></div>
        ${seg('temps', TEMPS, ' s', 'Temps par question')}
      </section>
      <p class="section-label">Choisis le quiz</p>
      <ul class="folder-list">
        ${ligne('tout', 'Quizz aléatoire toutes les UE', `${liste.length} quiz mélangés`)}
        ${ues.map((k) => {
          const [sem, ue] = k.split('/');
          return ligne(k, `Quizz aléatoire UE ${ue}${sems.size > 1 ? ` · ${sem}` : ''}`, `${parUe.get(k)} quiz`);
        }).join('')}
      </ul>
    </main>`;
}

function ecranRejoindre(erreur = '', saisi = '') {
  $app.innerHTML = `${h.topbarFolder('#/duel', 'Rejoindre', 'Duel 1 contre 1')}
    <main class="page duel">
      <form class="duel-saisie" data-duel-form="rejoindre" novalidate>
        <label for="duel-code">Entre le code reçu</label>
        <input id="duel-code" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
          maxlength="7" placeholder="ABC 123" aria-describedby="duel-err" enterkeyhint="go">
        <p class="duel-err" id="duel-err" role="alert" ${erreur ? '' : 'hidden'}>${h.esc(erreur)}</p>
        <button class="btn primary wide big duel-grad" type="submit" disabled>Rejoindre</button>
      </form>
    </main>`;
  const inp = $app.querySelector('#duel-code');
  const btn = $app.querySelector('.duel-saisie button');
  inp.addEventListener('input', () => {
    const brut = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    inp.value = brut.length > 3 ? `${brut.slice(0, 3)} ${brut.slice(3)}` : brut;
    btn.disabled = brut.length !== 6;
    $app.querySelector('#duel-err').hidden = true;
  });
  if (saisi) { inp.value = saisi; inp.dispatchEvent(new Event('input')); $app.querySelector('#duel-err').hidden = !erreur; }
  $app.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = inp.value.replace(/\s/g, '');
    if (code.length !== 6 || btn.dataset.busy) return;
    btn.dataset.busy = '1'; btn.disabled = true; btn.textContent = 'Connexion…';
    const r = await appel('/rejoindre', { code });
    if (location.hash !== '#/duel/rejoindre') return;
    if (r.erreur) { ecranRejoindre(ECHEC[r.erreur] || 'Le serveur du duel ne répond pas. Réessaie.', inp.value); return; }
    ecrireSession(r);
    location.hash = '#/duel/partie';
  });
  inp.focus();
}

async function appel(chemin, corps) {
  let res;
  // text/plain : requête « simple », sans aller-retour de contrôle CORS avant l'envoi.
  try { res = await fetch(SERVEUR + chemin, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(corps) }); } catch { return { erreur: 'reseau' }; }
  const data = await res.json().catch(() => ({}));
  return res.ok ? data : { erreur: data.erreur || 'serveur' };
}

async function creer(btn) {
  if (btn.dataset.busy) return;
  const meta = btn.querySelector('.folder-meta');
  const avant = meta.textContent;
  btn.dataset.busy = '1'; btn.classList.add('is-busy'); meta.textContent = 'Création de la partie…';
  const r = await appel('/creer', { portee: btn.dataset.portee, nq: reglages.nq, temps: reglages.temps });
  delete btn.dataset.busy; btn.classList.remove('is-busy'); meta.textContent = avant;
  if (location.hash !== '#/duel/creer') return;
  if (r.erreur) { h.toast(ECHEC[r.erreur] || 'Le serveur du duel ne répond pas. Réessaie.'); return; }
  ecrireSession(r);
  location.hash = '#/duel/partie';
}

/* ---------- Connexion à la partie ---------- */

function ecranPartie() {
  const s = lireSession();
  if (!s) { location.replace('#/duel'); return; }
  if (!co || co.code !== s.code) connecter(s);
  if (co.etat) afficher(co.etat, true);
  else $app.innerHTML = `${barre('Duel 1 contre 1')}<main class="page duel"><p class="duel-attente-txt"><span class="duel-dots"><i></i><i></i><i></i></span> Connexion à la partie…</p></main>`;
}

function connecter(s) {
  detacher();
  co = { code: s.code, jeton: s.jeton, essais: 0, ouvert: false, etat: null, vue: '', choix: new Set(), envoye: '', choixDe: '', onglet: 'moi', confetti: 0 };
  ouvrir(co);
}

function ouvrir(c) {
  const ws = new WebSocket(`${SERVEUR.replace(/^http/, 'ws')}/ws?code=${encodeURIComponent(c.code)}&jeton=${encodeURIComponent(c.jeton)}`);
  c.ws = ws;
  ws.onopen = () => {
    c.essais = 0; c.ouvert = true; reseau(false);
    clearInterval(c.ping);
    c.ping = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 25000); // garde la connexion ouverte
  };
  ws.onmessage = (e) => {
    if (co !== c || e.data === 'pong') return;
    let s;
    try { s = JSON.parse(e.data); } catch { return; }
    if (s.t !== 'etat') return;
    c.etat = s;
    c.recu = Date.now(); // les durées du serveur (reste, dans) partent de cet instant
    if (enPartie()) afficher(s);
  };
  ws.onclose = (e) => {
    clearInterval(c.ping);
    if (co !== c || c.ferme) return;
    if (e.code === 4001) return terminer(e.reason in FIN ? e.reason : 'fin');
    if (e.code === 4000) return terminer('remplacee', true);
    if (navigator.onLine !== false) c.essais++;
    // Jamais ouverte après 3 essais en ligne : la partie (ou le jeton) n'existe plus.
    if (!c.ouvert && c.essais >= 3) return terminer('introuvable');
    reseau(true);
    setTimeout(() => { if (co === c && !c.ferme) ouvrir(c); }, Math.min(8000, 500 * 2 ** Math.min(c.essais, 4)));
  };
}

/** Quitte l'écran de la partie : la connexion se ferme, la partie reste gardée pour y revenir. */
export function detacher() {
  if (!co) return;
  co.ferme = true;
  clearInterval(co.ping); clearInterval(co.minuteur); clearInterval(co.rebours);
  try { co.ws?.close(1000); } catch {}
  co = null;
  document.querySelector('.duel-compte')?.remove();
  confettisStop();
}

function envoyer(m) {
  if (co?.ws?.readyState === 1) { co.ws.send(JSON.stringify(m)); return true; }
  return false;
}

function terminer(raison, garder = false) {
  if (!garder) ecrireSession(null);
  detacher();
  if (!enPartie()) return;
  $app.innerHTML = `${h.topbarFolder('#/duel', 'Duel 1 contre 1')}
    <main class="page duel">
      <section class="duel-boite"><h2>Partie fermée</h2><p>${h.esc(FIN[raison] || FIN.fin)}</p></section>
      <a class="btn primary wide big duel-grad" href="#/duel">Retour au duel</a>
    </main>`;
}

function reseau(coupe) {
  const el = $app.querySelector('.duel-reseau');
  if (el) el.hidden = !coupe;
}

/* ---------- Affichage de la partie (piloté par l'état envoyé par le serveur) ---------- */

function barre(titre, droite = '<span class="icon-btn" aria-hidden="true"></span>') {
  return `<header class="topbar">
      <button type="button" class="icon-btn" data-duel="quitter" aria-label="Quitter">${h.ico.close}</button>
      <h1 class="title-sm">${h.esc(titre)}</h1>${droite}
    </header>
    <p class="duel-reseau" role="status" hidden>Connexion perdue… reconnexion en cours</p>`;
}

function afficher(s, force = false) {
  const cle = s.phase === 'jeu' ? `jeu-${s.manche}-${s.q.i}`
    : s.phase === 'resultat' ? `res-${s.manche}-${s.revanche === 'moi' ? 'r' : ''}` : `${s.phase}-${s.manche}`;
  if (!force && cle === co.vue) return majPartielle(s);
  if (cle !== co.vue) co.confirmer = false; // une confirmation ne survit pas au changement d'écran
  co.vue = cle;
  clearInterval(co.minuteur);
  if (s.phase === 'attente') return vueAttente(s);
  if (s.phase === 'jeu') return vueQuestion(s);
  if (s.phase === 'fini') return vueFini(s);
  if (s.phase === 'resultat') return s.revanche === 'moi' ? vueRevancheAttente(s) : vueResultat(s);
}

function majPartielle(s) {
  if (s.phase === 'attente') return vueAttente(s); // écran léger : redessiné en entier
  if (s.phase === 'jeu') {
    const el = $app.querySelector('.duel-adv');
    if (el) el.innerHTML = advPastille(s);
  }
  if (s.phase === 'fini') {
    const el = $app.querySelector('.duel-prog');
    if (el) el.outerHTML = progAdv(s);
  }
  if (s.phase === 'resultat') {
    const z = $app.querySelector('#duel-zone-revanche');
    if (z) z.innerHTML = zoneRevanche(s);
    const b = $app.querySelector('#duel-bandeau');
    if (b) b.innerHTML = bandeauRevanche(s);
  }
}

const joueursHtml = (s, moiOk = 'Prêt') => `<div class="duel-joueurs">
    <div class="duel-pl"><span class="duel-av a">T</span><b>Toi</b><span class="ok">${moiOk}</span></div>
    <span class="duel-vs">VS</span>
    <div class="duel-pl">${s.adversaire
      ? `<span class="duel-av b">A</span><b>Adversaire</b><span class="${s.enLigne ? 'ok' : ''}">${s.enLigne ? 'Connecté' : 'Connexion…'}</span>`
      : '<span class="duel-av vide">?</span><b>Adversaire</b><span>En attente…</span>'}</div>
  </div>`;

const infoQuiz = (s) => `<section class="duel-card duel-info"><span class="folder-icon duel-ic">${h.ico.shuffle}</span>
  <span><b>${h.esc(s.titre)}</b><span>${h.plural(s.nq, 'question')} · ${s.temps} s par question</span></span></section>`;

function confirmation(s) {
  if (!co.confirmer) return '';
  const txt = s.phase === 'attente'
    ? '<strong>Annuler la partie ?</strong> Le code ne fonctionnera plus.'
    : '<strong>Quitter le duel ?</strong> Ton adversaire gagnera par forfait.';
  return `<div class="quiz-confirm" role="alert"><p>${txt}</p>
    <div class="quiz-confirm-actions">
      <button type="button" class="btn danger small" data-duel="quitter-oui">${s.phase === 'attente' ? 'Annuler la partie' : 'Quitter'}</button>
      <button type="button" class="btn ghost small" data-duel="quitter-non">Continuer</button>
    </div></div>`;
}

function vueAttente(s) {
  const code = s.code;
  const minutes = Math.max(1, Math.ceil(s.expire / 60000));
  $app.innerHTML = `${barre('Partie créée')}
    <main class="page duel">
      ${confirmation(s)}
      <section class="duel-code-boite">
        <p>Donne ce code à ton adversaire</p>
        <div class="duel-code" aria-label="Code ${code.split('').join(' ')}">${[...code.slice(0, 3)].map((x) => `<span>${x}</span>`).join('')}<span class="gap"></span>${[...code.slice(3)].map((x) => `<span>${x}</span>`).join('')}</div>
        <button type="button" class="duel-copie" data-duel="copier">${icones.copie}<span>Copier le code</span></button>
      </section>
      ${joueursHtml(s)}
      <p class="duel-attente-txt"><span class="duel-dots"><i></i><i></i><i></i></span> ${s.adversaire ? 'Ton adversaire arrive…' : 'En attente de ton adversaire'}</p>
      ${infoQuiz(s)}
      <p class="duel-tip">${icones.info}<span>Le duel démarre tout seul dès que ton adversaire a rejoint la partie. Garde cette page ouverte. Code valable encore ${minutes} min.</span></p>
    </main>`;
}

const advPastille = (s) => `<span class="duel-av b">A</span> Adversaire : ${s.adv.fini ? 'fini' : `${Math.min(s.adv.faites + 1, s.nq)}/${s.nq}`}`;

function vueQuestion(s) {
  const q = s.q;
  const multi = q.type !== 'QCU';
  const cleQ = `${s.manche}-${q.i}`; // la manche compte : une revanche repart à la question 1
  if (co.choixDe !== cleQ) { co.choix = new Set(); co.choixDe = cleQ; }
  const total = s.temps * 1000;
  co.limite = co.recu + q.reste;
  co.debut = co.recu + (s.dans || 0);
  $app.innerHTML = `<div class="review quiz duel-jeu">
      ${barre(s.titre, `<span class="quiz-count">${q.i + 1}<span class="muted"> / ${s.nq}</span></span>`)}
      <main class="quiz-main">
        ${confirmation(s)}
        <div class="duel-tete"><span class="duel-adv">${advPastille(s)}</span></div>
        <div class="duel-chrono"><div class="duel-chrono-barre"><i></i></div><span class="duel-chrono-s">${s.temps} s</span></div>
        <article class="quiz-card">
          <div class="quiz-meta">
            <span class="tag ${multi ? 'tag-qcm' : 'tag-qcu'}">${multi ? 'QCM · une ou plusieurs réponses' : 'QCU · une seule réponse'}</span>
            ${q.theme ? `<span class="quiz-src">${h.esc(q.theme)}</span>` : ''}
          </div>
          <h2 class="quiz-stem">${h.rich(q.stem)}</h2>
          <ol class="quiz-opts" role="${multi ? 'group' : 'radiogroup'}">
            ${q.opts.map((o, k) => `<li><button type="button" class="quiz-opt ${co.choix.has(k) ? 'is-chosen' : ''}" data-duel="choix" data-k="${k}"
                role="${multi ? 'checkbox' : 'radio'}" aria-checked="${co.choix.has(k)}">
              <span class="opt-letter">${LETTRES[k]}</span><span class="opt-body"><span class="opt-text">${h.nb(h.esc(o))}</span></span>
            </button></li>`).join('')}
          </ol>
        </article>
      </main>
      <footer class="answer-bar">
        <button class="btn primary wide big duel-grad" data-duel="valider" ${co.choix.size ? '' : 'disabled'}>${q.i + 1 < s.nq ? 'Valider et continuer' : 'Valider et terminer'}</button>
        <p class="hint hide-touch">${LETTRES.slice(0, q.opts.length).split('').join(' ')} : choisir · Entrée : valider</p>
      </footer>
    </div>`;
  if (co.envoye === cleQ) bloquer();
  const barreEl = $app.querySelector('.duel-chrono-barre i');
  const txt = $app.querySelector('.duel-chrono-s');
  const boite = $app.querySelector('.duel-chrono');
  const tic = () => {
    if (!co) return;
    const now = Date.now();
    const reste = Math.max(0, Math.min(co.limite - now, total));
    barreEl.style.transform = `scaleX(${reste / total})`;
    txt.textContent = `${Math.ceil(reste / 1000)} s`;
    boite.classList.toggle('bas', reste <= 5000 && now >= co.debut);
    if (reste <= 0) { clearInterval(co.minuteur); valider(true); }
  };
  tic();
  co.minuteur = setInterval(tic, 100);
  if (co.debut > Date.now() && co.rebours == null) compteARebours(co.debut - Date.now());
}

function compteARebours(ms) {
  const el = document.createElement('div');
  el.className = 'duel-compte';
  el.setAttribute('role', 'status');
  document.body.append(el);
  const fin = Date.now() + ms;
  let vu = 0;
  const tic = () => {
    const n = Math.ceil((fin - Date.now()) / 1000);
    if (n <= 0 || !co) { clearInterval(co?.rebours); if (co) co.rebours = undefined; el.remove(); return; }
    if (n !== vu) { vu = n; el.innerHTML = `<div><p>Le duel commence</p><b>${Math.min(n, 3)}</b></div>`; }
  };
  tic();
  co.rebours = setInterval(tic, 100);
}

function choisir(k) {
  const s = co?.etat;
  if (!s || s.phase !== 'jeu' || co.envoye === co.choixDe || k >= s.q.opts.length) return;
  if (s.q.type === 'QCU') co.choix = co.choix.has(k) ? new Set() : new Set([k]);
  else if (co.choix.has(k)) co.choix.delete(k); else co.choix.add(k);
  $app.querySelectorAll('.quiz-opt[data-k]').forEach((b) => {
    const on = co.choix.has(+b.dataset.k);
    b.classList.toggle('is-chosen', on);
    b.setAttribute('aria-checked', String(on));
  });
  const v = $app.querySelector('[data-duel="valider"]');
  if (v) v.disabled = !co.choix.size;
}

function valider(auto = false) {
  const s = co?.etat;
  if (!s || s.phase !== 'jeu' || co.envoye === co.choixDe || Date.now() < co.debut) return;
  if (!auto && !co.choix.size) return;
  if (!envoyer({ t: 'reponse', i: s.q.i, choix: [...co.choix] })) return; // hors ligne : le serveur comptera la question à la fin du chrono
  co.envoye = co.choixDe;
  bloquer();
}

function bloquer() {
  $app.querySelectorAll('.quiz-opt').forEach((b) => { b.disabled = true; });
  const v = $app.querySelector('[data-duel="valider"]');
  if (v) { v.disabled = true; v.textContent = 'Envoi…'; }
}

const progAdv = (s) => `<div class="duel-prog">
    <div class="duel-prog-l"><span>Adversaire</span><span>${s.adv.fini ? 'Terminé' : `Question ${Math.min(s.adv.faites + 1, s.nq)} / ${s.nq}`}</span></div>
    <div class="duel-prog-barre"><i style="width:${(s.adv.faites / s.nq) * 100}%"></i></div>
  </div>`;

function vueFini(s) {
  $app.innerHTML = `${barre('Duel terminé pour toi')}
    <main class="page duel">
      <section class="duel-boite">
        <span class="duel-sablier">${icones.sablier}</span>
        <h2>Bien joué, tu as fini !</h2>
        <p>Ton adversaire n’a pas encore terminé. Les résultats s’afficheront dès qu’il aura répondu à sa dernière question.</p>
        ${progAdv(s)}
        <p>Ta note reste secrète jusqu’à la fin.</p>
      </section>
      <p class="duel-tip">${icones.info}<span>Tu peux laisser l’écran ouvert. Si ton adversaire quitte la partie plus d’une minute, tu gagnes par forfait.</span></p>
    </main>`;
}

/* ---------- Résultat, corrections et revanche ---------- */

const fmt = (x) => String(x).replace('.', ',');
function duree(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
}

function verdict(r) {
  const ecart = Math.abs(r.moi.note - r.adv.note);
  const pts = `${fmt(ecart)} point${ecart > 1 ? 's' : ''}`;
  if (r.gagnant === 'moi') {
    if (r.forfait === 'adv') return ['Victoire par forfait 🎉', 'Ton adversaire a quitté la partie.'];
    return ecart ? ['Victoire ! 🎉', `Tu gagnes avec ${pts} d’avance.`] : ['Victoire au temps ! 🎉', 'Même note, mais tu as été le plus rapide.'];
  }
  if (r.gagnant === 'adv') {
    if (r.forfait === 'moi') return ['Défaite par abandon', 'Tu as quitté la partie.'];
    return ecart ? ['Défaite', `Ton adversaire l’emporte de ${pts}.`] : ['Défaite au temps', 'Même note : ton adversaire a été plus rapide.'];
  }
  return ['Égalité parfaite', 'Même note et même temps.'];
}

function vueResultat(s) {
  const r = s.resultat;
  const [titre, sous] = verdict(r);
  const carte = (qui, cls, x, gagne) => `<div class="duel-res ${gagne ? 'gagne' : ''}">${gagne ? '<span class="duel-couronne" aria-hidden="true">👑</span>' : ''}
      <span class="duel-av ${cls}">${qui[0]}</span><b>${qui}</b>
      <span class="duel-note">${fmt(x.note)}<small>/20</small></span><span class="duel-meta">Temps total ${duree(x.temps)}</span></div>`;
  $app.innerHTML = `${barre('Résultat du duel')}
    <main class="page duel">
      <div id="duel-bandeau">${bandeauRevanche(s)}</div>
      <h2 class="duel-verdict">${titre}</h2>
      <p class="duel-verdict-s">${sous}</p>
      <div class="duel-podium">${carte('Toi', 'a', r.moi, r.gagnant === 'moi')}${carte('Adversaire', 'b', r.adv, r.gagnant === 'adv')}</div>
      <p class="qn-bareme center">Barème : sans erreur 1 point · une erreur 0,5 · deux erreurs ou plus 0</p>
      <p class="section-label">Corrections</p>
      <div class="duel-onglets" role="tablist">
        <button type="button" role="tab" data-duel="onglet" data-o="moi" aria-selected="${co.onglet === 'moi'}">Mes réponses</button>
        <button type="button" role="tab" data-duel="onglet" data-o="adv" aria-selected="${co.onglet === 'adv'}">Réponses de l’adversaire</button>
      </div>
      <div class="qn-rows" id="duel-corrections">${corrections(r, co.onglet)}</div>
      <div id="duel-zone-revanche">${zoneRevanche(s)}</div>
    </main>`;
  if (r.gagnant === 'moi' && co.confetti !== s.manche) { co.confetti = s.manche; confettis(); }
}

function corrections(r, qui) {
  const cls = (p) => (p === 1 ? 'p1' : p === 0.5 ? 'p05' : 'p0');
  const refLabel = (ref) => (/^[\d\s,–\-àet]+$/i.test(ref) ? `p. ${ref}` : ref);
  return r.questions.map((q, i) => {
    const a = q[qui];
    const ch = new Set(a.c);
    // « Valider » demande au moins un choix : une réponse vide vient toujours du chrono écoulé.
    const etat = a.absent ? 'Non jouée (partie arrêtée)' : a.tard || !a.c.length ? 'Temps écoulé : aucune réponse cochée' : '';
    return `<details class="qn-row">
      <summary>
        <span class="qn-num">${i + 1}</span>
        <span class="qn-txt"><span class="qn-theme">${h.esc(q.titre || q.theme)}</span><span class="qn-short">${h.nb(h.esc(q.stem))}</span></span>
        <span class="qn-pts ${cls(a.pts)}">${fmt(a.pts)}</span>
        <span class="qn-chev" aria-hidden="true">${h.ico.chevDown}</span>
      </summary>
      <div class="qn-body">
        <p class="qn-stem">${h.rich(q.stem)}</p>
        ${etat ? `<p class="duel-tard">⏱ ${etat}</p>` : ''}
        <ul class="qn-opts">${q.opts.map((o, k) => {
          const c = ch.has(k);
          const st = o.ok && c ? 'right' : o.ok ? 'missed' : c ? 'wrong' : 'off';
          return `<li class="qn-opt ${st}"><span class="qn-l">${st === 'wrong' ? '✗' : st === 'off' ? LETTRES[k] : '✓'}</span><span>${h.nb(h.esc(o.t))}${o.n ? `<span class="opt-note">${h.nb(h.esc(o.n))}</span>` : ''}</span></li>`;
        }).join('')}</ul>
        <div class="qn-legend"><span class="right">cochée et juste</span><span class="missed">juste, non cochée</span><span class="wrong">cochée à tort</span></div>
        ${q.exp.length || q.ref ? `<section class="quiz-correction"><h3>Correction</h3>
          ${q.exp.map((p) => `<p>${h.nb(h.esc(p))}</p>`).join('')}
          ${q.ref ? `<p class="quiz-ref">Source : cours « ${h.esc(q.titre)} », ${h.esc(refLabel(q.ref))}</p>` : ''}</section>` : ''}
      </div>
    </details>`;
  }).join('');
}

function bandeauRevanche(s) {
  if (s.revanche !== 'adv') return '';
  return `<section class="duel-revanche-in" role="alert">
      <p>🔁 <b>Ton adversaire propose une revanche</b><span>Même quiz, mêmes réglages, nouvelles questions.</span></p>
      <div class="duel-deux"><button type="button" class="btn ghost" data-duel="revanche-non">Refuser</button>
        <button type="button" class="btn primary duel-grad" data-duel="revanche-oui">Accepter</button></div>
    </section>`;
}

function zoneRevanche(s) {
  return `${s.refus ? '<p class="duel-refus">Ton adversaire a refusé la revanche.</p>' : ''}
    ${!s.enLigne ? '<p class="duel-tip">Ton adversaire a quitté la page : une revanche lui sera proposée s’il revient.</p>' : ''}
    <div class="stack">
      ${s.revanche === 'adv' ? '' : '<button type="button" class="btn primary wide big duel-grad" data-duel="revanche">Revanche</button>'}
      <button type="button" class="btn ghost wide" data-duel="sortir">Retour à l’accueil</button>
    </div>`;
}

function vueRevancheAttente(s) {
  $app.innerHTML = `${barre('Revanche')}
    <main class="page duel">
      <section class="duel-boite">
        <span class="duel-sablier">${icones.sablier}</span>
        <h2>Revanche proposée</h2>
        <p>En attente de la réponse de ton adversaire…</p>
        <span class="duel-dots"><i></i><i></i><i></i></span>
      </section>
      ${infoQuiz(s)}
      <p class="duel-tip">${icones.info}<span>Nouvelles questions : celles déjà tombées pendant ce duel sont écartées. Elles ne reviennent que si le quiz n’en a plus assez.</span></p>
      <button type="button" class="btn ghost wide" data-duel="revanche-annuler">Annuler la revanche</button>
    </main>`;
}

/* ---------- Confettis (sans bibliothèque) ---------- */

let confRaf = 0;
function confettis() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  confettisStop();
  const cv = document.createElement('canvas');
  cv.className = 'duel-confettis';
  cv.setAttribute('aria-hidden', 'true');
  document.body.append(cv);
  const ctx = cv.getContext('2d');
  const dpr = devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const cols = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'];
  const P = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.3,
    vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 11 - 4, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 5, h: 9 + Math.random() * 6, c: cols[(Math.random() * cols.length) | 0],
  }));
  const t0 = performance.now();
  const pas = (t) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of P) {
      p.vy += 0.28; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); ctx.restore();
    }
    if (t - t0 < 3500) confRaf = requestAnimationFrame(pas); else confettisStop();
  };
  confRaf = requestAnimationFrame(pas);
}
function confettisStop() {
  cancelAnimationFrame(confRaf);
  document.querySelectorAll('.duel-confettis').forEach((c) => c.remove());
}

/* ---------- Clics et clavier ---------- */

function clic(e) {
  const b = e.target.closest('[data-duel]');
  if (!b || !$app.contains(b)) return;
  const a = b.dataset.duel;
  if (a === 'explication') {
    explication = !explication;
    b.setAttribute('aria-expanded', String(explication));
    $app.querySelector('#duel-regles').hidden = !explication;
  } else if (a === 'reglage') {
    const cle = b.dataset.cle, v = +b.dataset.v;
    reglages[cle] = v;
    b.parentNode.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    $app.querySelector(`#duel-o-${cle}`).textContent = cle === 'temps' ? `${v} s` : v;
  } else if (a === 'creer') creer(b);
  else if (a === 'copier') {
    const code = co?.etat?.code;
    if (!code) return;
    navigator.clipboard?.writeText(code).then(() => { b.querySelector('span').textContent = 'Code copié ✓'; }, () => h.toast(`Code : ${code}`));
  } else if (a === 'choix') choisir(+b.dataset.k);
  else if (a === 'valider') valider();
  else if (a === 'quitter') quitter();
  else if (a === 'quitter-oui') { envoyer({ t: 'abandon' }); if (co?.etat?.phase === 'attente') { ecrireSession(null); detacher(); location.hash = '#/duel'; } else { co.confirmer = false; } }
  else if (a === 'quitter-non') { co.confirmer = false; afficher(co.etat, true); }
  else if (a === 'onglet') {
    co.onglet = b.dataset.o;
    $app.querySelectorAll('.duel-onglets button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $app.querySelector('#duel-corrections').innerHTML = corrections(co.etat.resultat, co.onglet);
  } else if (a === 'revanche') envoyer({ t: 'revanche' }) || h.toast('Connexion perdue : réessaie dans un instant.');
  else if (a === 'revanche-oui') envoyer({ t: 'revanche-oui' });
  else if (a === 'revanche-non') envoyer({ t: 'revanche-non' });
  else if (a === 'revanche-annuler') envoyer({ t: 'revanche-annuler' });
  else if (a === 'sortir') { ecrireSession(null); detacher(); location.hash = '#/'; }
}

function quitter() {
  const s = co?.etat;
  if (!s) { detacher(); location.hash = '#/duel'; return; }
  if (s.phase === 'resultat') { ecrireSession(null); detacher(); location.hash = '#/'; return; }
  if (s.phase === 'fini') { location.hash = '#/duel'; return; } // le résultat reste à voir via « Reprendre »
  co.confirmer = true;
  afficher(s, true);
  $app.querySelector('.quiz-confirm')?.scrollIntoView({ block: 'center' });
}

function clavier(e) {
  if (!co?.etat || co.etat.phase !== 'jeu' || !enPartie() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const k = LETTRES.indexOf(e.key.toUpperCase());
  if (k >= 0 && e.key.length === 1) { e.preventDefault(); choisir(k); }
  else if (e.key === 'Enter') { e.preventDefault(); valider(); }
}
