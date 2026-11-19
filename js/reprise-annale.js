/* Mémo : reprise d'une annale (officielle ou non officielle) interrompue.
   Les réponses cochées ou écrites sont gardées au fil de l'eau, par annale,
   et remises en place à la réouverture. Elles sont effacées dès la correction,
   ou avec « Repartir de zéro » / « Tout recommencer ».
   Script commun aux pages d'annales : il ne touche qu'au formulaire #quiz. */
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

  var minuterie = null;
  function enregistrer() {
    clearTimeout(minuterie);
    minuterie = setTimeout(function () {
      if (corrige()) return;
      var tout = lire(), r = releve();
      if (r) tout[id] = r; else delete tout[id];
      ecrire(tout);
    }, 250);
  }
  form.addEventListener('input', enregistrer);
  form.addEventListener('change', enregistrer);
  // Fermeture de l'onglet ou retour à l'app pendant la saisie : on écrit tout de suite.
  addEventListener('pagehide', function () { if (minuterie) { clearTimeout(minuterie); minuterie = null; if (!corrige()) { var tout = lire(), r = releve(); if (r) tout[id] = r; else delete tout[id]; ecrire(tout); } } });

  // Correction affichée : la tentative est terminée, plus rien à reprendre.
  new MutationObserver(function () { if (corrige()) { clearTimeout(minuterie); effacer(); retirerBandeau(); } })
    .observe(resultats, { attributes: true, attributeFilter: ['hidden'] });
  var reset = document.getElementById('reset');
  if (reset) reset.addEventListener('click', function () { clearTimeout(minuterie); effacer(); });

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
  bandeau.innerHTML = '<span>Tentative reprise : ' + remis + ' réponse' + (remis > 1 ? 's' : '') +
    ' remise' + (remis > 1 ? 's' : '') + ' en place.</span><button type="button">Repartir de zéro</button>';
  bandeau.querySelector('button').addEventListener('click', function () {
    if (!confirm('Effacer les réponses de cette tentative et repartir de zéro ?')) return;
    clearTimeout(minuterie); effacer(); location.reload();
  });
  var style = document.createElement('style');
  style.textContent = '.memo-reprise{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 14px;' +
    'margin:0 0 16px;padding:12px 16px;border-radius:14px;border:1px solid rgba(139,92,246,.45);' +
    'background:linear-gradient(90deg,rgba(59,130,246,.14),rgba(139,92,246,.14),rgba(236,72,153,.12));font-weight:600;line-height:1.4}' +
    '.memo-reprise span{min-width:0;overflow-wrap:anywhere}' +
    '.memo-reprise button{flex:none;font:inherit;font-size:.9em;padding:6px 12px;border-radius:999px;cursor:pointer;' +
    'border:1px solid currentColor;background:transparent;color:inherit}';
  document.head.appendChild(style);
  form.parentNode.insertBefore(bandeau, form);
  function retirerBandeau() { if (bandeau && bandeau.parentNode) bandeau.parentNode.removeChild(bandeau); }
})();
