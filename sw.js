// Service worker : l'application s'installe sur l'écran d'accueil (téléphone ou PC) et marche
// hors ligne. Stratégie « réseau d'abord » : la version la plus récente est servie quand elle est
// disponible, sinon la copie en cache. Les appels à chess.com (autre origine) ne passent pas ici.

const CACHE = "analyseur-echecs-v1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./icones/icone.svg",
  "./icones/icone-192.png",
  "./icones/icone-512.png",
  "./vendor/chess.js",
  "./vendor/chessground.js",
  "./vendor/chessground.base.css",
  "./vendor/chessground.brown.css",
  "./vendor/chessground.cburnett.css",
  "./moteur/stockfish-19-lite-single.js",
  "./moteur/stockfish-19-lite-single.wasm",
  "./ressources/ouvertures.json",
  "./js/api.js",
  "./js/app.js",
  "./js/echecs.js",
  "./js/entrainement.js",
  "./js/plateau.js",
  "./js/stockage.js",
  "./js/vue-analyse.js",
  "./js/explication/faits.js",
  "./js/explication/redaction.js",
  "./js/importation/chesscom.js",
  "./js/importation/pgn.js",
  "./js/moteur/analyse.js",
  "./js/moteur/stockfish.js",
  "./js/ouvertures/base.js",
  "./js/ouvertures/bot.js",
  "./js/review/classification.js",
  "./js/review/livre.js",
  "./js/review/probabilites.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((cle) => cle !== CACHE).map((cle) => caches.delete(cle))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    // `no-cache` : toujours revalider auprès du serveur, pour ne jamais mélanger deux versions.
    fetch(request, { cache: "no-cache" })
      .then((reponse) => {
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copie));
        }
        return reponse;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((enCache) => enCache || (request.mode === "navigate" ? caches.match("./index.html") : Response.error()))),
  );
});
