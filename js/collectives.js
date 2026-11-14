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

  window.memoCollectives = {shareFlashcards, endpoint};
})();
