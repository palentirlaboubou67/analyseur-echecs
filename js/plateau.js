// Vue d'une partie : échiquier, liste des coups, navigation, pendules.

import { Chessground } from "../vendor/chessground.js";
import { Chess } from "./echecs.js";

const $ = (sel) => document.querySelector(sel);

let cg = null;
const etat = { id: null, partie: null, resume: null, ply: 0, orientation: "white" };

// Les autres modules (analyse) s'abonnent aux changements au lieu d'être appelés en dur.
const abonnes = { partie: [], position: [] };
export const surNouvellePartie = (fn) => abonnes.partie.push(fn);
export const surChangementPosition = (fn) => abonnes.position.push(fn);
// Coup joué à la main sur l'échiquier : fn(fenAvant, uci). Géré par vue-ligne.js (variante libre).
let surCoup = null;
export const surCoupJoue = (fn) => { surCoup = fn; };

export function idAffiche() {
  return etat.id;
}

/** État courant en lecture : {id, partie, ply, orientation}. */
export function etatPlateau() {
  return etat;
}

/** Flèches et cercles dessinés par le programme (format chessground DrawShape). */
export function definirFleches(formes) {
  cg?.setAutoShapes(formes);
}

/** Affiche une partie ({id, partie, resume} renvoyé par l'API). */
export function afficherPartie(donnees, pseudo) {
  etat.id = donnees.id;
  etat.partie = donnees.partie;
  etat.resume = donnees.resume;
  etat.ply = 0;
  etat.orientation = orientationParDefaut(donnees, pseudo);

  if (!cg) {
    cg = Chessground($("#plateau"), {
      coordinates: true,
      animation: { duration: 180 },
      // On peut jouer les deux camps : chaque coup ouvre (ou prolonge) une variante.
      movable: { free: false, showDests: true, events: { after: coupALaMain } },
      premovable: { enabled: false },
      draggable: { showGhost: true },
    });
    window.addEventListener("resize", () => cg.redrawAll());
  }
  cg.set({ orientation: etat.orientation });
  remplirInfos();
  remplirListeCoups();
  abonnes.partie.forEach((fn) => fn(etat));
  aller(0);
}

function orientationParDefaut({ resume, partie }, pseudo) {
  if (resume) return resume.couleur === "noirs" ? "black" : "white";
  const noirs = (partie.entetes.Black || "").toLowerCase();
  // « Moi » : nom donné au joueur dans les parties d'entraînement.
  return noirs === "moi" || (pseudo && noirs === pseudo.toLowerCase()) ? "black" : "white";
}

// --- Navigation -----------------------------------------------------------

export function aller(ply) {
  if (!etat.partie || !Number.isFinite(ply)) return;
  if (interception) { // on quittait une ligne de Stockfish : elle se referme
    const fn = interception;
    interception = null;
    fn("ferme");
  }
  const { coups, fen_depart } = etat.partie;
  etat.ply = Math.max(0, Math.min(coups.length, ply));
  const coup = coups[etat.ply - 1];
  const fen = coup ? coup.fen : fen_depart;
  etat.fenAffichee = fen;
  cg.set({
    fen,
    ...jouable(fen),
    lastMove: coup ? [coup.uci.slice(0, 2), coup.uci.slice(2, 4)] : undefined,
    check: coup ? /[+#]$/.test(coup.san) : false,
  });

  document.querySelectorAll("#liste-coups .coup").forEach((el) => {
    el.classList.toggle("actif", Number(el.dataset.ply) === etat.ply);
  });
  garderVisible(document.querySelector(`#liste-coups .coup[data-ply="${etat.ply}"]`));
  majJoueurs();
  abonnes.position.forEach((fn) => fn(etat));
}

/** Affiche une position hors de la partie (ligne de Stockfish), sans changer le coup courant. */
export function montrerPosition(fen, uci = null, formes = []) {
  etat.fenAffichee = fen;
  cg.set({
    fen,
    ...jouable(fen),
    lastMove: uci ? [uci.slice(0, 2), uci.slice(2, 4)] : undefined,
    check: new Chess(fen).inCheck(),
  });
  cg.setAutoShapes(formes);
}

/** Réglages chessground pour que le camp au trait puisse jouer dans `fen`. */
function jouable(fen) {
  const partie = new Chess(fen);
  const dests = new Map();
  for (const m of partie.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    if (!dests.get(m.from).includes(m.to)) dests.get(m.from).push(m.to);
  }
  const couleur = partie.turn() === "w" ? "white" : "black";
  return { turnColor: couleur, movable: { color: couleur, dests } };
}

function coupALaMain(orig, dest) {
  const fen = etat.fenAffichee;
  const partie = new Chess(fen);
  const piece = partie.get(orig);
  // Promotion : toujours en dame (comme dans l'entraînement).
  const promotion = piece?.type === "p" && (dest[1] === "8" || dest[1] === "1") ? "q" : "";
  surCoup?.(fen, orig + dest + promotion);
}

// Pendant qu'on regarde une ligne, les boutons ◀ ▶ (et les flèches du clavier) la parcourent.
let interception = null;
export function intercepterNavigation(fn) {
  interception = fn;
}

export function naviguer(action) {
  if (!etat.partie) return;
  if (interception && action !== "retourner" && interception(action)) return;
  const n = etat.partie.coups.length;
  if (action === "debut") aller(0);
  else if (action === "precedent") aller(etat.ply - 1);
  else if (action === "suivant") aller(etat.ply + 1);
  else if (action === "fin") aller(n);
  else if (action === "retourner") {
    etat.orientation = etat.orientation === "white" ? "black" : "white";
    cg.set({ orientation: etat.orientation });
    majJoueurs();
    if (interception?.("retourner")) return;
    abonnes.position.forEach((fn) => fn(etat));
  }
}

/** Fait défiler la liste des coups (et seulement elle, pas la page) jusqu'au coup actif. */
function garderVisible(el) {
  const liste = $("#liste-coups");
  if (!el) {
    liste.scrollTop = 0;
    return;
  }
  const haut = el.offsetTop - liste.offsetTop;
  if (haut < liste.scrollTop) liste.scrollTop = haut;
  else if (haut + el.offsetHeight > liste.scrollTop + liste.clientHeight) {
    liste.scrollTop = haut + el.offsetHeight - liste.clientHeight;
  }
}

// --- Affichage ------------------------------------------------------------

function remplirListeCoups() {
  const conteneur = $("#liste-coups");
  conteneur.replaceChildren();
  let ligne = null;
  for (const coup of etat.partie.coups) {
    // Une ligne par numéro de coup ; une partie peut commencer par un coup noir (FEN).
    if (coup.couleur === "blancs" || !ligne) {
      ligne = document.createElement("div");
      ligne.className = "ligne-coup";
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = `${coup.numero}.`;
      ligne.append(num);
      if (coup.couleur === "noirs") ligne.append(celluleVide());
      conteneur.append(ligne);
    }
    const el = document.createElement("button");
    el.className = "coup";
    el.dataset.ply = coup.ply;
    el.textContent = coup.san;
    el.addEventListener("click", () => aller(coup.ply));
    ligne.append(el);
    if (coup.couleur === "noirs") ligne = null;
  }
}

function celluleVide() {
  const vide = document.createElement("span");
  vide.className = "coup vide";
  vide.textContent = "…";
  return vide;
}

function remplirInfos() {
  const { entetes, avertissements } = etat.partie;
  const r = etat.resume;
  const infos = $("#infos-partie");
  infos.replaceChildren();

  const titre = document.createElement("h3");
  titre.textContent = `${entetes.White || "Blancs"} – ${entetes.Black || "Noirs"}`;
  infos.append(titre);

  const lignes = [];
  if (r) {
    const libelles = { victoire: "Victoire", defaite: "Défaite", nulle: "Nulle" };
    lignes.push(["Résultat", `${libelles[r.resultat]} (${r.motif}) · ${etat.partie.resultat}`]);
    lignes.push(["Cadence", r.cadence.libelle]);
    if (r.ouverture) lignes.push(["Ouverture", r.eco ? `${r.ouverture} (${r.eco})` : r.ouverture]);
    lignes.push(["Date", new Date(r.date).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })]);
  } else {
    lignes.push(["Résultat", entetes.Termination ? `${etat.partie.resultat} · ${entetes.Termination}` : etat.partie.resultat]);
    if (entetes.Opening) lignes.push(["Ouverture", entetes.Opening]);
    if (entetes.Event && entetes.Event !== "?") lignes.push(["Événement", entetes.Event]);
    if (entetes.Date && !entetes.Date.startsWith("?")) lignes.push(["Date", entetes.Date.replaceAll(".", "/")]);
  }
  const dl = document.createElement("dl");
  for (const [cle, valeur] of lignes) {
    const dt = document.createElement("dt");
    dt.textContent = cle;
    const dd = document.createElement("dd");
    dd.textContent = valeur;
    dl.append(dt, dd);
  }
  infos.append(dl);

  if (r?.url) {
    const lien = document.createElement("a");
    lien.href = r.url;
    lien.target = "_blank";
    lien.rel = "noopener";
    lien.textContent = "Voir sur chess.com ↗";
    infos.append(lien);
  }
  for (const texte of avertissements) {
    const p = document.createElement("p");
    p.className = "avertissement";
    p.textContent = texte;
    infos.append(p);
  }
}

function majJoueurs() {
  const { entetes } = etat.partie;
  const bas = etat.orientation;
  const haut = bas === "white" ? "black" : "white";
  remplirJoueur("#joueur-haut", haut, entetes);
  remplirJoueur("#joueur-bas", bas, entetes);
}

function remplirJoueur(sel, couleur, entetes) {
  const el = $(sel);
  const nom = couleur === "white" ? entetes.White : entetes.Black;
  const elo = couleur === "white" ? entetes.WhiteElo : entetes.BlackElo;
  el.querySelector(".nom").textContent = `${couleur === "white" ? "○" : "●"} ${nom || "?"}${elo && elo !== "?" ? ` (${elo})` : ""}`;
  el.querySelector(".pendule").textContent = formaterPendule(penduleA(couleur === "white" ? "blancs" : "noirs"));
}

/** Temps restant d'un camp à la position affichée : sa dernière pendule connue. */
function penduleA(couleur) {
  const { coups, entetes } = etat.partie;
  for (let i = etat.ply - 1; i >= 0; i--) {
    if (coups[i].couleur === couleur && coups[i].pendule != null) return coups[i].pendule;
  }
  const base = Number((entetes.TimeControl || "").split("+")[0]);
  return Number.isFinite(base) && base > 0 && !(entetes.TimeControl || "").includes("/") ? base : null;
}

function formaterPendule(secondes) {
  if (secondes == null) return "";
  const h = Math.floor(secondes / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  const s = secondes % 60;
  const ss = secondes < 20 ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
