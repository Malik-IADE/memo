// Format de fichier texte simple pour ajouter des cartes.
//
//   # Nom du paquet
//   Question :: Réponse
//   Autre question :: Ligne 1\nLigne 2
//   // un commentaire
//
// - Une ligne « # ... » commence un paquet (plusieurs paquets possibles par fichier).
// - Le séparateur est « :: » (ou une tabulation, pour coller depuis un tableur).
// - « \n » dans le texte crée un retour à la ligne.

export const SEP = '::';

export function parseText(text, fallbackName = 'Nouveau paquet') {
  const decks = [];
  const errors = [];
  let current = null;
  const clean = (s) => s.trim().replace(/\\n/g, '\n');

  text.replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('//')) return;

    if (line.startsWith('#') && !line.includes(SEP)) {
      current = { name: line.replace(/^#+\s*/, '').trim() || fallbackName, cards: [] };
      decks.push(current);
      return;
    }

    let idx = line.indexOf(SEP);
    let len = SEP.length;
    if (idx < 0) { idx = line.indexOf('\t'); len = 1; }
    const front = idx < 0 ? '' : clean(line.slice(0, idx));
    const back = idx < 0 ? '' : clean(line.slice(idx + len));
    if (!front || !back) { errors.push(i + 1); return; }

    if (!current) { current = { name: fallbackName, cards: [] }; decks.push(current); }
    current.cards.push({ front, back });
  });

  return { decks: decks.filter((d) => d.cards.length), errors };
}

export function deckToText(deck, cards) {
  const esc = (s) => s.replace(/\r?\n/g, '\\n');
  return `# ${deck.name}\n` + cards.map((c) => `${esc(c.front)} ${SEP} ${esc(c.back)}`).join('\n') + '\n';
}
