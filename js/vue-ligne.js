// « Voir la ligne » dans la revue (comme sur chess.com) : une ligne de Stockfish se rejoue sur
// l'échiquier coup par coup, avec une explication pour chaque coup. Les boutons ◀ ▶ sous
// l'échiquier et les flèches du clavier la parcourent ; Échap ou « Revenir à la partie » en sort.

import { aller, etatPlateau, intercepterNavigation, montrerPosition } from "./plateau.js";
import { commenterLigne } from "./explication/ligne.js";

const $ = (sel) => document.querySelector(sel);
const DELAI_LECTURE = 1300; // ms entre deux coups en lecture automatique

let ligne = null; // {titre, fen, intro, coups, i, minuteur}

/** Ouvre une ligne : titre affiché, fen de départ, {uci, eval} de Stockfish. */
export function ouvrirLigne(titre, fen, ligneMoteur) {
  fermer(false);
  const { intro, coups } = commenterLigne(fen, ligneMoteur);
  if (!coups.length) return;
  ligne = { titre, fen, intro, coups, i: 1, minuteur: null };
  intercepterNavigation(gererNavigation);
  afficher();
  // Sur téléphone, la carte est sous l'échiquier : on cale la page sur l'échiquier,
  // la carte (coups et explication) suit juste en dessous.
  if (window.matchMedia("(max-width: 820px)").matches) {
    const haut = $("#plateau").getBoundingClientRect().top + window.scrollY - 40;
    window.scrollTo({ top: haut, behavior: "smooth" });
  }
}

function gererNavigation(action) {
  if (!ligne) return false;
  if (action === "ferme") { // la partie a été déplacée ailleurs (clic dans la liste des coups…)
    nettoyer();
    return true;
  }
  const n = ligne.coups.length;
  if (action === "quitter") fermer(true);
  else if (action === "precedent") aller_(ligne.i - 1);
  else if (action === "suivant") aller_(ligne.i + 1);
  else if (action === "debut") aller_(0);
  else if (action === "fin") aller_(n);
  else if (action === "retourner") afficher();
  else return false;
  return true;
}

function aller_(i, garderLecture = false) {
  if (!ligne) return;
  if (!garderLecture) arreterLecture();
  ligne.i = Math.max(0, Math.min(ligne.coups.length, i));
  afficher();
}

function fermer(revenir) {
  if (!ligne) return;
  nettoyer();
  intercepterNavigation(null);
  if (revenir) aller(etatPlateau().ply);
}

function nettoyer() {
  arreterLecture();
  ligne = null;
  $("#carte-ligne").hidden = true;
  document.body.classList.remove("en-ligne");
}

function basculerLecture() {
  if (!ligne) return;
  if (ligne.minuteur) return arreterLecture(), afficher();
  if (ligne.i >= ligne.coups.length) ligne.i = 0; // relire depuis le début
  const pas = () => {
    if (!ligne) return;
    if (ligne.i >= ligne.coups.length) {
      arreterLecture();
      afficher();
      return;
    }
    aller_(ligne.i + 1, true);
    ligne.minuteur = setTimeout(pas, DELAI_LECTURE);
  };
  ligne.minuteur = setTimeout(pas, ligne.i === 0 ? 300 : DELAI_LECTURE / 2);
  afficher();
}

function arreterLecture() {
  if (ligne?.minuteur) clearTimeout(ligne.minuteur);
  if (ligne) ligne.minuteur = null;
}

// --- Affichage -------------------------------------------------------------------

function afficher() {
  const { titre, fen, intro, coups, i } = ligne;
  const courant = coups[i - 1] ?? null;
  const suivant = coups[i] ?? null;
  // Flèche discrète vers le coup suivant de la ligne.
  const formes = suivant ? [{ orig: suivant.uci.slice(0, 2), dest: suivant.uci.slice(2, 4), brush: "paleBlue" }] : [];
  montrerPosition(courant ? courant.fen : fen, courant?.uci ?? null, formes);
  $("#badge-coup").hidden = true;
  document.body.classList.add("en-ligne");

  const carte = $("#carte-ligne");
  carte.replaceChildren();
  carte.hidden = false;

  const entete = el("div", "entete-ligne");
  const fermerBtn = el("button", "fermer-ligne", "✕ Revenir à la partie");
  fermerBtn.addEventListener("click", () => fermer(true));
  entete.append(el("h3", "", titre), fermerBtn);
  carte.append(entete);
  if (intro) carte.append(el("p", "intro-ligne", intro));

  // Les coups de la ligne, cliquables
  const liste = el("div", "coups-ligne");
  coups.forEach((c, k) => {
    if (c.couleur === "w" || k === 0) liste.append(el("span", "num-ligne", c.couleur === "w" ? `${c.numero}.` : `${c.numero}…`));
    const b = el("button", `coup-ligne${k + 1 === i ? " actif" : ""}${c.san.endsWith("#") ? " mat" : ""}`, c.san);
    b.addEventListener("click", () => aller_(k + 1));
    liste.append(b);
  });
  carte.append(liste);

  // Explication du coup affiché
  const explication = el("div", "explication");
  if (courant) {
    explication.append(el("p", "san-ligne", `${courant.numero}${courant.couleur === "w" ? "." : "…"} ${courant.san}`));
    for (const phrase of courant.phrases) explication.append(el("p", "", phrase));
  } else {
    const trait = fen.split(" ")[1] === "w" ? "aux Blancs" : "aux Noirs";
    explication.append(el("p", "", `Position de départ de la ligne : c'est ${trait} de jouer. Avance coup par coup avec ▶.`));
  }
  carte.append(explication);

  // Commandes
  const commandes = el("div", "commandes-ligne");
  const boutons = [
    ["⏮", "Début de la ligne", () => aller_(0), i === 0],
    ["◀", "Coup précédent (←)", () => aller_(i - 1), i === 0],
    [ligne.minuteur ? "⏸ Pause" : "⏵ Lecture", "Jouer la ligne automatiquement", basculerLecture, false],
    ["▶", "Coup suivant (→)", () => aller_(i + 1), i >= coups.length],
    ["⏭", "Fin de la ligne", () => aller_(coups.length), i >= coups.length],
  ];
  for (const [texte, aide, action, inactif] of boutons) {
    const b = el("button", texte.length > 1 ? "lecture" : "", texte);
    b.title = aide;
    b.disabled = inactif;
    b.addEventListener("click", action);
    commandes.append(b);
  }
  carte.append(commandes, el("p", "doux aide-ligne", `Coup ${i} sur ${coups.length} · flèches ← → du clavier, Échap pour revenir`));
}

function el(balise, classe = "", texte = null) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== null) e.textContent = texte;
  return e;
}
