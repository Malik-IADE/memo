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
  if (info?.href && score) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Inclure ma note dans la moyenne';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const target = score.closest('#results') || score.parentElement;
    target.append(button, status);
    button.addEventListener('click', async () => {
      const match = score.textContent.match(/(-?[\d \u202f\u00a0]+(?:[.,]\d+)?)\s*\/\s*20/);
      const value = match ? Number(match[1].replace(/\s/g, '').replace(',', '.')) : NaN;
      if (!Number.isFinite(value) || value < 0 || value > 20) {
        status.textContent = 'Terminez la correction pour partager une note sur 20.';
        return;
      }
      button.disabled = true;
      status.textContent = 'Envoi de la note…';
      try {
        await send('/annales', {exam: info.href, score: Math.round(value * 100)});
        status.textContent = 'Note incluse dans la moyenne.';
      } catch {
        status.textContent = 'Envoi impossible. Réessayez lorsque vous êtes en ligne.';
      } finally {
        button.disabled = false;
      }
    });
    new MutationObserver(() => { status.textContent = ''; }).observe(score, {childList:true, subtree:true, characterData:true});
  }

  window.memoCollectives = {shareFlashcards, endpoint};
})();
