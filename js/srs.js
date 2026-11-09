// Algorithme de répétition espacée : SM-2 simplifié (celui d'Anki à l'origine).
// Notes : 0 = À revoir, 1 = Difficile, 2 = Bien, 3 = Facile.

export const MIN = 60_000;
export const DAY = 86_400_000;

export function startOfDay(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfToday(now = Date.now()) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Date d'échéance : début du jour situé `days` jours plus tard. */
export function dueInDays(days, now = Date.now()) {
  const d = new Date(startOfDay(now));
  d.setDate(d.getDate() + days);
  return d.getTime();
}

// Les cartes « À revoir » reviennent entre 1 et 3 jours plus tard, au hasard :
// si on en rate beaucoup le même jour, elles se répartissent sur plusieurs sessions.
export const AGAIN_MIN = 1;
export const AGAIN_MAX = 3;

/** Petite variation aléatoire (± 10 %) pour éviter que des cartes reviennent toutes le même jour. */
function fuzz(days, rand) {
  if (days < 3) return days;
  const spread = Math.max(1, Math.round(days * 0.1));
  return days + Math.round((rand() * 2 - 1) * spread);
}

/** Retourne les nouveaux champs de planification d'une carte après une note. */
export function schedule(card, grade, now = Date.now(), rand = Math.random) {
  const ease = card.ease || 2.5;
  const prev = card.interval || 0;
  const reps = card.reps || 0;
  const lapses = card.lapses || 0;

  if (grade === 0) {
    // Échec : la carte repart de zéro et revient dans une prochaine session.
    const days = AGAIN_MIN + Math.floor(rand() * (AGAIN_MAX - AGAIN_MIN + 1));
    return {
      seen: true,
      reps: 0,
      interval: 0,
      lapses: reps > 0 ? lapses + 1 : lapses,
      ease: Math.max(1.3, ease - 0.2),
      due: dueInDays(days, now),
    };
  }

  const days = fuzz(nextInterval(reps, prev, ease, grade), rand);
  const easeDelta = [0, -0.15, 0, 0.15][grade];
  return {
    seen: true,
    reps: reps + 1,
    interval: days,
    lapses,
    ease: Math.max(1.3, ease + easeDelta),
    due: dueInDays(days, now),
  };
}

function nextInterval(reps, prev, ease, grade) {
  if (reps === 0) return [0, 1, 1, 4][grade];
  if (reps === 1) return [0, 2, 3, 6][grade];
  const factor = [0, 1.2, ease, ease * 1.3][grade];
  return Math.max(prev + 1, Math.round(prev * factor));
}

export function formatDays(days) {
  if (days < 30) return `${days} j`;
  if (days < 365) return `${Math.round(days / 30)} mois`;
  const y = Math.round((days / 365) * 10) / 10;
  return `${String(y).replace('.', ',')} an${y >= 2 ? 's' : ''}`;
}

/** Libellés affichés sous les 4 boutons. */
export function previewIntervals(card) {
  return [0, 1, 2, 3].map((g) =>
    g === 0 ? `${AGAIN_MIN}–${AGAIN_MAX} j` : formatDays(schedule(card, g, Date.now(), () => 0.5).interval));
}

/** Texte court « prochaine révision » pour la liste des cartes. */
export function dueLabel(card, now = Date.now()) {
  if (!card.seen) return 'Nouvelle';
  if (card.due <= endOfToday(now)) return "Aujourd'hui";
  const days = Math.ceil((card.due - endOfToday(now)) / DAY);
  return days === 1 ? 'Demain' : `Dans ${formatDays(days)}`;
}
