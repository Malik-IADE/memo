// Service worker : permet à l'app de fonctionner hors ligne.
// Stratégie « réseau d'abord » : la dernière version est utilisée quand il y a
// du réseau, la copie en cache sinon. Changez CACHE à chaque mise en ligne.
const CACHE = 'memo-v73';
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/srs.js', 'js/format.js', 'js/library.js', 'js/collectives.js', 'js/quiz.js', 'js/reprise-annale.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-512.png',
  'exemples/capitales.txt',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Images (schémas, ECG, scans) : elles changent rarement → cache d'abord, affichage immédiat.
// Le reste : réseau d'abord, mais copie en cache si le réseau traîne plus de 4 s (wifi d'hôpital…).
const IMAGE = /\.(webp|jpe?g|png|svg|gif)$/i;
const TIMEOUT = 4000;

function store(req, res) {
  // On ne garde que les vraies réponses du site (pas les erreurs 404/500).
  if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const fallback = () => caches.match(req, { ignoreSearch: true })
    .then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));

  if (IMAGE.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => store(req, res))));
    return;
  }
  // Cours partagés : toujours la version du serveur quand le réseau répond, même lentement
  // (sinon une ancienne copie des cartes peut rester affichée). Cache seulement hors ligne.
  if (url.pathname.includes('/paquets/') || url.pathname.includes('/quiz/')) {
    e.respondWith(fetch(req).then((res) => store(req, res), fallback));
    return;
  }
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const finish = (p) => { if (!done) { done = true; resolve(p); } };
    const net = fetch(req).then((res) => store(req, res));
    const timer = setTimeout(() => caches.match(req, { ignoreSearch: true }).then((r) => r && finish(r)), TIMEOUT);
    net.then((res) => { clearTimeout(timer); finish(res); }, () => { clearTimeout(timer); finish(fallback()); });
  }));
});
