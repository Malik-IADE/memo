/* Mémo : reprise d'une annale (officielle ou non officielle) interrompue.
   Les réponses cochées ou écrites sont gardées au fil de l'eau, par annale,
   et remises en place à la réouverture. Elles sont effacées dès la correction,
   ou avec « Repartir de zéro » / « Tout recommencer ».
   Script commun aux pages d'annales : il ne touche qu'au formulaire #quiz.
   Le second bloc, en fin de fichier, replie la barre de navigation sur mobile. */
(function () {
  var CLE = 'memo-annales-encours-v1';
  var DUREE = 60 * 24 * 3600 * 1000; // une tentative abandonnée depuis 60 jours est oubliée
  var form = document.getElementById('quiz');
  var resultats = document.getElementById('results');
  if (!form || !resultats) return;
  var id = location.pathname.replace(/^.*?\/(annales(?:-nf)?\/)/, '$1');

  function lire() { try { return JSON.parse(localStorage.getItem(CLE)) || {}; } catch (e) { return {}; } }
  function ecrire(tout) { try { localStorage.setItem(CLE, JSON.stringify(tout)); } catch (e) {} }
  function effacer() { var tout = lire(); if (tout[id]) { delete tout[id]; ecrire(tout); } }
  var corrige = function () { return !resultats.hidden; };

  /** Réponses en cours : cases cochées (par question) et textes (par champ). */
  function releve() {
    var choix = {}, textes = {}, n = 0;
    form.querySelectorAll('input[type=checkbox]:checked, input[type=radio]:checked').forEach(function (el) {
      if (!el.name) return;
      (choix[el.name] = choix[el.name] || []).push(el.value);
    });
    form.querySelectorAll('textarea[id]').forEach(function (el) { if (el.value.trim()) textes[el.id] = el.value; });
    n = Object.keys(choix).length + Object.keys(textes).length;
    return n ? { c: choix, x: textes, n: n, t: Date.now() } : null;
  }

  // « minuterie » n'est non nulle que si un enregistrement attend : la remettre à null
  // en l'annulant, sinon « pagehide » réécrirait des réponses qu'on vient d'effacer.
  var minuterie = null;
  function sauver() {
    minuterie = null;
    if (corrige()) return;
    var tout = lire(), r = releve();
    if (r) tout[id] = r; else delete tout[id];
    ecrire(tout);
  }
  function annuler() { clearTimeout(minuterie); minuterie = null; }
  function enregistrer() { clearTimeout(minuterie); minuterie = setTimeout(sauver, 250); }
  form.addEventListener('input', enregistrer);
  form.addEventListener('change', enregistrer);
  // Fermeture de l'onglet ou retour à l'app pendant la saisie : on écrit tout de suite.
  addEventListener('pagehide', function () { if (minuterie) { clearTimeout(minuterie); sauver(); } });

  // Correction affichée : la tentative est terminée, plus rien à reprendre.
  new MutationObserver(function () { if (corrige()) { annuler(); effacer(); retirerBandeau(); } })
    .observe(resultats, { attributes: true, attributeFilter: ['hidden'] });
  var reset = document.getElementById('reset');
  if (reset) reset.addEventListener('click', function () { annuler(); effacer(); retirerBandeau(); });

  /* ---------- Remise en place ---------- */
  var sauve = lire()[id];
  if (!sauve || Date.now() - sauve.t > DUREE) { if (sauve) effacer(); return; }
  var remis = 0;
  Object.keys(sauve.c || {}).forEach(function (nom) {
    var ok = false;
    form.querySelectorAll('input[name="' + CSS.escape(nom) + '"]').forEach(function (el) {
      if (!el.disabled && sauve.c[nom].indexOf(el.value) >= 0) { el.checked = true; ok = true; }
    });
    if (ok) remis++;
  });
  Object.keys(sauve.x || {}).forEach(function (cle) {
    var el = document.getElementById(cle);
    if (el && el.tagName === 'TEXTAREA' && form.contains(el) && !el.readOnly) { el.value = sauve.x[cle]; remis++; }
  });
  if (!remis) { effacer(); return; }
  form.dispatchEvent(new Event('input', { bubbles: true })); // met à jour « X / N questions renseignées »

  var bandeau = document.createElement('div');
  bandeau.className = 'memo-reprise';
  bandeau.setAttribute('role', 'status');
  var message = 'Tentative reprise : ' + remis + ' réponse' + (remis > 1 ? 's' : '') +
    ' remise' + (remis > 1 ? 's' : '') + ' en place.';
  // Confirmation dans le bandeau lui-même (pas de fenêtre « confirm », peu fiable sur mobile).
  function etatNormal() {
    bandeau.classList.remove('confirmer');
    bandeau.innerHTML = '<span>' + message + '</span><div class="memo-reprise-actions">' +
      '<button type="button" data-r="demander">Repartir de zéro</button></div>';
  }
  function etatConfirmer() {
    bandeau.classList.add('confirmer');
    bandeau.innerHTML = '<span><b>Repartir de zéro ?</b> Les réponses de cette tentative seront effacées.</span>' +
      '<div class="memo-reprise-actions"><button type="button" class="oui" data-r="oui">Oui, effacer</button>' +
      '<button type="button" data-r="non">Annuler</button></div>';
    bandeau.querySelector('[data-r="oui"]').focus();
  }
  bandeau.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.r === 'demander') etatConfirmer();
    else if (b.dataset.r === 'non') etatNormal();
    else if (b.dataset.r === 'oui') {
      annuler(); effacer(); retirerBandeau();
      // « Tout recommencer » de l'annale vide le formulaire sans recharger la page.
      if (reset) reset.click(); else location.reload();
    }
  });
  etatNormal();
  var style = document.createElement('style');
  style.textContent = '.memo-reprise{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 14px;' +
    'margin:0 0 16px;padding:12px 16px;border-radius:14px;border:1px solid rgba(139,92,246,.45);' +
    'background:linear-gradient(90deg,rgba(59,130,246,.14),rgba(139,92,246,.14),rgba(236,72,153,.12));font-weight:600;line-height:1.4}' +
    '.memo-reprise span{min-width:0;overflow-wrap:anywhere}' +
    '.memo-reprise-actions{display:flex;flex-wrap:wrap;gap:8px}' +
    '.memo-reprise button{flex:none;font:inherit;font-size:.9em;padding:7px 14px;border-radius:999px;cursor:pointer;' +
    'border:1px solid currentColor;background:transparent;color:inherit}' +
    '.memo-reprise.confirmer{border-color:rgba(220,38,38,.55);background:rgba(220,38,38,.08)}' +
    '.memo-reprise button.oui{background:#dc2626;border-color:#dc2626;color:#fff}';
  document.head.appendChild(style);
  form.parentNode.insertBefore(bandeau, form);
  function retirerBandeau() { if (bandeau && bandeau.parentNode) bandeau.parentNode.removeChild(bandeau); }
})();

/* Mémo : sur mobile, la barre « QCM · QCU · Questions ouvertes · Corriger » se replie
   quand on descend dans le sujet, pour lui laisser la place, et revient quand on
   remonte, en haut de page et au moment de la correction. */
(function () {
  var nav = document.querySelector('nav.nav');
  if (!nav) return;
  var mobile = matchMedia('(max-width: 760px)');
  var SEUIL = 24;          // pixels de défilement dans le même sens avant de changer d'état
  var dernier = scrollY, cumul = 0, bloqueJusqua = 0;

  var style = document.createElement('style');
  style.textContent = 'nav.nav{transition:transform .25s ease,opacity .2s ease,visibility 0s}' +
    'nav.nav.memo-nav-cachee{transform:translateY(-100%);opacity:0;visibility:hidden;pointer-events:none;' +
    'transition:transform .25s ease,opacity .2s ease,visibility 0s linear .25s}' +
    '@media (prefers-reduced-motion:reduce){nav.nav,nav.nav.memo-nav-cachee{transition:none}}';
  document.head.appendChild(style);

  function montrer() { nav.classList.remove('memo-nav-cachee'); }
  function cacher() { if (!nav.contains(document.activeElement)) nav.classList.add('memo-nav-cachee'); }

  addEventListener('scroll', function () {
    var y = scrollY, d = y - dernier;
    dernier = y;
    if (!mobile.matches || y < 120) { montrer(); cumul = 0; return; }
    if (Date.now() < bloqueJusqua) return;
    if (d === 0) return;
    if ((d > 0) !== (cumul > 0)) cumul = 0;   // changement de sens : on repart de zéro
    cumul += d;
    if (cumul > SEUIL) cacher();
    else if (cumul < -SEUIL) montrer();
  }, { passive: true });

  if (mobile.addEventListener) mobile.addEventListener('change', montrer);

  // Correction affichée : la barre revient, sans se replier aussitôt pendant
  // le défilement automatique vers le résultat.
  var resultats = document.getElementById('results');
  if (resultats) new MutationObserver(function () {
    if (!resultats.hidden) { montrer(); cumul = 0; bloqueJusqua = Date.now() + 1200; }
  }).observe(resultats, { attributes: true, attributeFilter: ['hidden'] });
})();
