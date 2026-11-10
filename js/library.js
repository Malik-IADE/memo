// Bibliothèque : cours partagés hébergés avec l'app, dans le dossier « paquets/ ».
// « paquets/liste.txt » contient un nom de fichier par ligne. À chaque ouverture,
// l'app télécharge ces fichiers et met à jour les paquets correspondants
// (nouvelles questions ajoutées, questions retirées supprimées, progression conservée).

import * as store from './store.js';
import { parseText } from './format.js';

const LIST = 'paquets/liste.txt';
const MIN_DELAY = 5 * 60_000; // pas plus d'une vérification toutes les 5 min

let lastSync = 0;
let running = null;

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  return res.text();
}

export function syncLibrary({ force = false } = {}) {
  if (running) return running;
  if (!force && Date.now() - lastSync < MIN_DELAY) return Promise.resolve(null);

  running = (async () => {
    try {
      const files = (await fetchText(LIST))
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('//') && !l.startsWith('#'));

      const total = { added: 0, updated: 0, removed: 0 };
      for (const file of files) {
        try {
          const { decks } = parseText(await fetchText(`paquets/${file}`), file.replace(/\.[^.]+$/, ''));
          if (!decks.length) continue;
          // [img:images/x.jpg] est relatif au dossier du cours → chemin complet depuis l'app
          const dir = `paquets/${file.replace(/[^/]*$/, '')}`;
          const fix = (s) => s.replace(/\[img:(?!https?:|paquets\/)([^\]]+)\]/g, (_, p) => `[img:${dir}${p.trim()}]`);
          decks.forEach((d) => d.cards.forEach((c) => { c.front = fix(c.front); c.back = fix(c.back); }));
          const r = store.importDecks(decks, { prune: true, source: file });
          total.added += r.added;
          total.updated += r.updated;
          total.removed += r.removed;
        } catch (err) {
          console.warn('Cours non chargé :', err.message);
        }
      }
      // Cours retirés de liste.txt : on retire aussi leur paquet de l'app
      if (files.length) total.removed += store.pruneLibraryDecks(files);
      lastSync = Date.now();
      return total;
    } catch {
      return null; // hors ligne ou pas de bibliothèque : on garde les données locales
    } finally {
      running = null;
    }
  })();
  return running;
}
