(() => {
  const endpoint = 'https://memo-statistiques.malikbm88.workers.dev';
  const identityKey = 'memo-stats-browser-v1';

  function identity() {
    let id = localStorage.getItem(identityKey);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(identityKey, id);
    }
    return id;
  }

  async function send(path, data) {
    const response = await fetch(endpoint + path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({browser: identity(), revision: Date.now(), ...data}),
      keepalive: true,
    });
    if (!response.ok) throw new Error('Contribution indisponible');
  }

  let timer;
  function shareFlashcards() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const data = JSON.parse(localStorage.getItem('memo-data-v1'));
        const grades = [0, 0, 0, 0];
        for (const card of Object.values(data?.cards || {})) {
          const deck = data.decks?.[card.deckId];
          if (!card.deleted && deck && !deck.deleted && !deck.hidden &&
              Number.isInteger(card.lastGrade) && card.lastGrade >= 0 && card.lastGrade <= 3) grades[card.lastGrade]++;
        }
        const snapshot = JSON.stringify(grades);
        const previous = localStorage.getItem('memo-stats-last-grades');
        if (snapshot === previous || (!previous && grades.every(n => n === 0))) return;
        await send('/flashcards', {grades});
        localStorage.setItem('memo-stats-last-grades', snapshot);
      } catch { /* La progression locale reste disponible hors ligne. */ }
    }, 750);
  }

  const info = window.MEMO_QUIZ;
  const score = document.getElementById('score');
  const results = document.getElementById('results');
  if (info?.href && score && results) {
    const exam = info.href;
    const pendingKey = 'memo-pending-score:' + exam;
    let pending;
    try { pending = JSON.parse(localStorage.getItem(pendingKey)); } catch {}

    async function submit(note) {
      try {
        await send('/annales', {exam, ...note});
        if (pending === note) pending = null;
        const stored = JSON.parse(localStorage.getItem(pendingKey));
        if (stored?.revision === note.revision) localStorage.removeItem(pendingKey);
      } catch { /* Nouvelle tentative au retour du réseau ou à la prochaine visite. */ }
    }

    let debounce;
    let lastScore;
    function record() {
      clearTimeout(debounce);
      if (results.hidden) {
        lastScore = undefined;
        return;
      }
      debounce = setTimeout(() => {
        if (results.hidden) return;
        const match = score.textContent.match(/(-?[\d \u202f\u00a0]+(?:[.,]\d+)?)\s*\/\s*20/);
        const value = match ? Number(match[1].replace(/\s/g, '').replace(',', '.')) : NaN;
        const grade = Math.round(value * 100);
        if (!Number.isFinite(grade) || grade <= 0 || grade > 2000 || grade === lastScore) return;
        lastScore = grade;
        pending = {score: grade, revision: Math.max(Date.now(), (pending?.revision || 0) + 1)};
        try { localStorage.setItem(pendingKey, JSON.stringify(pending)); } catch {}
        submit(pending);
      }, 300);
    }

    const observer = new MutationObserver(record);
    observer.observe(score, {childList:true, subtree:true, characterData:true});
    observer.observe(results, {attributes:true, attributeFilter:['hidden']});
    window.addEventListener('online', () => { if (pending) submit(pending); });
    if (pending) submit(pending);
  }

  // Visites par navigateur : une visite = ouverture de Mémo (app ou annale) ou retour après
  // 30 min sans activité. Hors ligne, la visite attend (avec sa date) et part au retour du réseau.
  const lastSeenKey = 'memo-visite-vue';
  const waitingKey = 'memo-visites-attente';
  const PAUSE = 30 * 60_000;
  const readWaiting = () => { try { return JSON.parse(localStorage.getItem(waitingKey)) || []; } catch { return []; } };
  let flushing = false;
  // Type d'appareil (pour compter les appareils uniques dans les stats) : rien d'autre n'est envoyé.
  function deviceType() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPod/.test(ua)) return 'iphone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad'; // iPadOS se présente comme un Mac
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'android' : 'android-tablette';
    if (/CrOS/.test(ua)) return 'chromeos';
    if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
    if (/Windows/.test(ua)) return 'windows';
    if (/Linux/.test(ua)) return 'linux';
    return 'autre';
  }
  async function flushVisits() {
    if (flushing || !navigator.onLine) return;
    flushing = true;
    try {
      for (const revision of readWaiting()) {
        await send('/visite', {revision, device: deviceType()});
        localStorage.setItem(waitingKey, JSON.stringify(readWaiting().filter((r) => r !== revision)));
      }
    } catch { /* Nouvel essai au prochain retour du réseau ou à la prochaine visite. */ }
    flushing = false;
  }
  function seen() {
    try {
      const now = Date.now();
      const last = Number(localStorage.getItem(lastSeenKey)) || 0;
      localStorage.setItem(lastSeenKey, String(now));
      if (now - last > PAUSE) localStorage.setItem(waitingKey, JSON.stringify([...readWaiting(), now].slice(-50)));
    } catch { return; }
    flushVisits();
  }
  seen();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') seen();
    else try { localStorage.setItem(lastSeenKey, String(Date.now())); } catch {}
  });
  window.addEventListener('online', flushVisits);
  // Activité dans la page : la visite en cours se prolonge (au plus une écriture par minute).
  let touched = 0;
  const touch = () => {
    if (Date.now() - touched < 60_000) return;
    touched = Date.now();
    try { localStorage.setItem(lastSeenKey, String(touched)); } catch {}
  };
  ['pointerdown', 'keydown', 'scroll'].forEach((t) => window.addEventListener(t, touch, {passive: true}));
  window.addEventListener('pagehide', () => { try { localStorage.setItem(lastSeenKey, String(Date.now())); } catch {} });

  window.memoCollectives = {shareFlashcards, endpoint};
})();
