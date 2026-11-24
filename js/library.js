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
      let changed = false;
      // Téléchargements en parallèle (6 à la fois), puis mise à jour dans l'ordre de la liste.
      const texts = new Array(files.length);
      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          const i = next++;
          texts[i] = await fetchText(`paquets/${files[i]}`).catch((err) => err);
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
      for (const [i, file] of files.entries()) {
        try {
          if (texts[i] instanceof Error) throw texts[i];
          const { decks } = parseText(texts[i], file.replace(/\.[^.]+$/, ''));
          if (!decks.length) continue;
          // [img:images/x.jpg] est relatif au dossier du cours → chemin complet depuis l'app
          const dir = `paquets/${file.replace(/[^/]*$/, '')}`;
          const fix = (s) => s.replace(/\[img:(?!https?:|paquets\/)([^\]]+)\]/g, (_, p) => `[img:${dir}${p.trim()}]`);
          decks.forEach((d) => d.cards.forEach((c) => { c.front = fix(c.front); c.back = fix(c.back); if (c.was) c.was = c.was.map(fix); }));
          // Enregistrement unique après la boucle : réécrire les données (plusieurs centaines de Ko)
          // pour chacun des cours bloquait l'app à chaque ouverture, même sans aucun changement.
          const r = store.importDecks(decks, { prune: true, source: file, autosave: false });
          changed ||= r.changed;
          total.added += r.added;
          total.updated += r.updated;
          total.removed += r.removed;
        } catch (err) {
          console.warn('Cours non chargé :', err.message);
        }
      }
      if (changed) store.save();
      // Cours retirés de liste.txt : on retire aussi leur paquet de l'app
      if (files.length) total.removed += store.pruneLibraryDecks(files);
      total.changed = changed || total.removed > 0;
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
