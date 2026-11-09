# Mémo — cartes de révision

Application web progressive (PWA) façon Anki, en HTML/CSS/JS pur, sans dépendances ni étape de build.

## Lancer en local

```bash
python3 -m http.server 5173
```
Puis ouvrir http://localhost:5173

## Bibliothèque : cours partagés

Les cours du dossier `paquets/` sont chargés automatiquement chez tout le monde. Ils sont rangés par
semestre puis par UE, et l'accueil de l'app reprend ce rangement :

```
paquets/
  liste.txt                 liste des cours chargés (un chemin par ligne)
  S1/
    3.1/  processus-anesthesie.txt, sspi.txt, …
    3.3/  chirurgie-urologique.txt, estomac-plein.txt, …
```

- **Modifier un cours** : éditer `paquets/S1/<UE>/<cours>.txt` sur github.com (icône crayon) → les utilisateurs reçoivent
  les nouvelles questions à la prochaine ouverture de l'app (questions retirées supprimées, progression conservée).
- **Ajouter un cours** : déposer le `.txt` dans le dossier de son UE (ex. `paquets/S1/2.1/`), puis ajouter son chemin
  (ex. `S1/2.1/mon-cours.txt`) dans `paquets/liste.txt`. Un nouveau dossier `S2/…` crée une nouvelle rubrique.
- Garder la question identique pour conserver la progression : changer la question = nouvelle carte.
- Chacun peut masquer un cours (menu ⋯ du paquet) et le réafficher dans les Réglages.

## Format des fichiers de cartes (`.txt`)

```
// Commentaire ignoré
# Nom du paquet
Question :: Réponse
Question longue :: Ligne 1\nLigne 2

# Un autre paquet dans le même fichier
Hello :: Bonjour
```

- `# Nom` commence un paquet (créé s'il n'existe pas).
- Une carte par ligne, séparée par `::` (ou une tabulation, depuis Excel/Numbers).
- `\n` = nouvelle puce dans la réponse, `\n- ` = sous-puce, `Titre : texte` = titre en gras.
- Réimporter un fichier modifié **ajoute les nouvelles questions et met à jour les réponses** sans perdre la progression.
- Exemple : `exemples/capitales.txt`. Un paquet peut être réexporté en `.txt` (menu ⋯ du paquet).

## Algorithme (SM-2 simplifié) — `js/srs.js`

| Bouton    | Effet |
|-----------|-------|
| À revoir  | sort de la session, revient au hasard dans 1 à 3 jours, intervalle remis à zéro, facilité −0,2 |
| Difficile | intervalle × 1,2, facilité −0,15 |
| Bien      | intervalle × facilité (2,5 au départ) |
| Facile    | intervalle × facilité × 1,3, facilité +0,15 |

Premiers intervalles : 1 j → 3 j → puis multiplicatif, avec ±10 % de variation pour étaler les cartes.
Limites réglables par paquet et par jour : 20 nouvelles cartes et 50 révisions (le surplus est reporté aux sessions suivantes, les plus en retard d'abord).

Réimport avec « Supprimer du paquet les cartes qui ne sont plus dans le texte » : synchronise le paquet avec le fichier.

## Structure

```
index.html            page unique
styles.css            interface (clair / sombre automatique)
js/app.js             écrans et interactions
js/store.js           stockage local (prêt pour la synchro : id, updated, deleted)
js/srs.js             algorithme de répétition espacée
js/format.js          lecture / écriture du format texte
sw.js, manifest…      mode hors ligne et installation sur iPhone/Mac
```

## Raccourcis clavier (Mac)

Espace : retourner la carte · 1 2 3 4 : noter · ⌘ + Entrée : ajouter une carte

## Prochaine étape

Synchronisation Mac ↔ iPhone via Firebase (gratuit) + mise en ligne sur GitHub Pages.
