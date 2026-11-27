// Variantes dans la revue (comme l'analyse de partie de chess.com) :
//  - « Voir la ligne » : une ligne de Stockfish se rejoue coup par coup, chaque coup expliqué ;
//  - jeu libre : on déplace soi-même une pièce depuis n'importe quel coup de la partie (ou au milieu
//    d'une ligne) ; ça crée « Ma variante », Stockfish évalue en direct et le coach juge chaque coup.
// La partie d'origine n'est jamais modifiée. Les boutons ◀ ▶ sous l'échiquier et les flèches du
// clavier parcourent la variante ; Échap, « Revenir à la partie » ou un clic dans la liste en sortent.

import { aller, definirFleches, etatPlateau, intercepterNavigation, montrerPosition, surCoupJoue } from "./plateau.js";
import { Chess, jouerUci } from "./echecs.js";
import { commenterLigne } from "./explication/ligne.js";
import { jugerCoup } from "./review/juger.js";
import { CATEGORIES } from "./review/classification.js";
import { gainBlancs } from "./review/probabilites.js";
import { evaluationTerminale, estTerminee } from "./moteur/analyse.js";
import { moteur } from "./moteur/stockfish.js";
import { majBarre, texteEval } from "./vue-analyse.js";

const $ = (sel) => document.querySelector(sel);
const DELAI_LECTURE = 1300;                            // ms entre deux coups en lecture automatique
const REGLAGE_DIRECT = { profondeur: 14, tempsMax: 700 }; // analyse des positions de la variante
const PRIORITE = 10;                                    // avant une analyse de partie en cours
const BONS = new Set(["brillant", "meilleur", "excellent", "bon", "livre"]);

// ligne = {titre, fen, intro, coups: [{uci, san, fen, fenAvant, numero, couleur, phrases, parMoi, avis}],
//          i (coups affichés : 0 = position de départ), minuteur}
let ligne = null;
let jetonEval = 0;

// --- Lignes de Stockfish par position (cache) -----------------------------------------

const cacheLignes = new Map(); // fen -> Promise<lignes>

/** Lignes déjà calculées (analyse de la partie) : évite de relancer le moteur. */
export function memoriserLignes(fen, lignes) {
  if (lignes?.length && !cacheLignes.has(fen)) cacheLignes.set(fen, Promise.resolve(lignes));
}

function lignesDe(fen) {
  if (estTerminee(fen)) return Promise.resolve([]);
  if (!cacheLignes.has(fen)) {
    cacheLignes.set(fen, moteur.analyser(fen, REGLAGE_DIRECT, 3, PRIORITE).catch(() => {
      cacheLignes.delete(fen);
      return [];
    }));
  }
  return cacheLignes.get(fen);
}

// --- Ouvrir une ligne de Stockfish --------------------------------------------------------

/** Ouvre une ligne : titre affiché, fen de départ, {uci, eval} de Stockfish. */
export function ouvrirLigne(titre, fen, ligneMoteur) {
  const { intro, coups } = commenterLigne(fen, ligneMoteur);
  if (!coups.length) return;
  demarrer({ titre, fen, intro, coups: coups.map((c, k) => ({ ...c, fenAvant: k ? coups[k - 1].fen : fen })), i: 1 });
}

function demarrer(nouvelle) {
  fermer(false);
  ligne = { minuteur: null, ...nouvelle };
  intercepterNavigation(gererNavigation);
  afficher();
  // Sur téléphone, la carte est sous l'échiquier : on cale la page sur l'échiquier,
  // la carte (coups et explication) suit juste en dessous.
  if (window.matchMedia("(max-width: 820px)").matches) {
    const haut = $("#plateau").getBoundingClientRect().top + window.scrollY - 40;
    window.scrollTo({ top: haut, behavior: "smooth" });
  }
}

// --- Jouer soi-même un coup ---------------------------------------------------------------

surCoupJoue((fenAvant, uci) => {
  if (!ligne) {
    const { partie, ply } = etatPlateau();
    // Le coup qui a vraiment été joué dans la partie : on avance simplement dans la partie.
    if (partie.coups[ply]?.uci === uci) return aller(ply + 1);
    const precedent = partie.coups[ply - 1];
    const depuis = precedent
      ? `après ${precedent.numero}${precedent.couleur === "blancs" ? "." : "…"} ${precedent.san}`
      : "depuis la position de départ";
    demarrer({
      titre: "Ma variante",
      fen: fenAvant,
      intro: `Tes coups ${depuis}. La partie d'origine n'est pas modifiée.`,
      coups: [], i: 0,
    });
  } else if (ligne.coups[ligne.i]?.uci === uci) {
    return allerA(ligne.i + 1); // le coup suivant de la ligne : on avance dedans
  }
  jouerDansLigne(fenAvant, uci);
});

function jouerDansLigne(fenAvant, uci) {
  const partie = new Chess(fenAvant);
  const numero = Number(fenAvant.split(" ")[5]);
  const coup = jouerUci(partie, uci);
  if (!coup) return afficher();
  arreterLecture();
  if (ligne.titre !== "Ma variante") {
    ligne.titre = "Ma variante";
    ligne.intro = "Tu as pris la main : à partir d'ici, ce sont tes coups.";
  }
  ligne.coups = ligne.coups.slice(0, ligne.i); // un nouveau coup remplace la suite
  const entree = {
    uci, san: coup.san, fen: partie.fen(), fenAvant, numero, couleur: coup.color,
    phrases: [], parMoi: true, avis: null,
  };
  ligne.coups.push(entree);
  ligne.i = ligne.coups.length;
  afficher();
  juger(entree);
}

/** Le coach juge le coup (Stockfish avant / après), puis on réaffiche s'il est toujours visible. */
async function juger(entree) {
  const [avant, apres] = await Promise.all([lignesDe(entree.fenAvant), lignesDe(entree.fen)]);
  entree.avis = jugerCoup(entree.fenAvant, entree.uci, avant, apres)
    ?? { classification: "bon", phrases: [], meilleur: null };
  if (ligne?.coups.includes(entree)) afficher();
}

// --- Navigation ----------------------------------------------------------------------

function gererNavigation(action) {
  if (!ligne) return false;
  if (action === "ferme") { // la partie a été déplacée ailleurs (clic dans la liste des coups…)
    nettoyer();
    return true;
  }
  const n = ligne.coups.length;
  if (action === "quitter") fermer(true);
  else if (action === "precedent") allerA(ligne.i - 1);
  else if (action === "suivant") allerA(ligne.i + 1);
  else if (action === "debut") allerA(0);
  else if (action === "fin") allerA(n);
  else if (action === "retourner") afficher();
  else return false;
  return true;
}

function allerA(i, garderLecture = false) {
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
  jetonEval++;
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
    allerA(ligne.i + 1, true);
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

const fenCourante = () => (ligne.i ? ligne.coups[ligne.i - 1].fen : ligne.fen);

/** Flèches : coup suivant de la ligne, ce qu'il fallait jouer à la place de mon coup, meilleur coup. */
function formes(lignes = null) {
  const res = [];
  const fleche = (uci, brush) => res.push({ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush });
  const courant = ligne.coups[ligne.i - 1];
  const suivant = ligne.coups[ligne.i];
  if (suivant) fleche(suivant.uci, "paleBlue");
  else if (lignes?.[0] && $("#option-suivant").checked) fleche(lignes[0].uci[0], "blue");
  if (courant?.parMoi && courant.avis?.meilleur && !BONS.has(courant.avis.classification)) fleche(courant.avis.meilleur.uci, "green");
  return res;
}

function afficher() {
  const { titre, fen, intro, coups, i } = ligne;
  const courant = coups[i - 1] ?? null;
  montrerPosition(fenCourante(), courant?.uci ?? null, formes());
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
  carte.append(el("p", "eval-direct", "Stockfish réfléchit…"));

  // Les coups de la ligne, cliquables
  if (coups.length) {
    const liste = el("div", "coups-ligne");
    coups.forEach((c, k) => {
      if (c.couleur === "w" || k === 0) liste.append(el("span", "num-ligne", c.couleur === "w" ? `${c.numero}.` : `${c.numero}…`));
      const classes = ["coup-ligne", k + 1 === i && "actif", c.san.endsWith("#") && "mat", c.parMoi && "moi"].filter(Boolean);
      const b = el("button", classes.join(" "), c.san);
      if (c.parMoi && c.avis && !BONS.has(c.avis.classification)) b.append(el("span", "symbole", CATEGORIES[c.avis.classification].symbole));
      b.addEventListener("click", () => allerA(k + 1));
      liste.append(b);
    });
    carte.append(liste);
  }

  carte.append(explication(courant));

  // Commandes
  const commandes = el("div", "commandes-ligne");
  const boutons = [
    ["⏮", "Début de la variante", () => allerA(0), i === 0],
    ["◀", "Coup précédent (←)", () => allerA(i - 1), i === 0],
    [ligne.minuteur ? "⏸ Pause" : "⏵ Lecture", "Rejouer la variante automatiquement", basculerLecture, !coups.length],
    ["▶", "Coup suivant (→)", () => allerA(i + 1), i >= coups.length],
    ["⏭", "Fin de la variante", () => allerA(coups.length), i >= coups.length],
  ];
  for (const [texte, aide, action, inactif] of boutons) {
    const b = el("button", texte.length > 1 ? "lecture" : "", texte);
    b.title = aide;
    b.disabled = inactif;
    b.addEventListener("click", action);
    commandes.append(b);
  }
  carte.append(commandes, el("p", "doux aide-ligne",
    `${coups.length ? `Coup ${i} sur ${coups.length} · ` : ""}déplace une pièce pour essayer un autre coup · ← → pour avancer, Échap pour revenir`));

  evaluerPosition();
}

function explication(courant) {
  const bloc = el("div", "explication");
  if (!courant) {
    const trait = ligne.fen.split(" ")[1] === "w" ? "aux Blancs" : "aux Noirs";
    bloc.append(el("p", "", ligne.coups.length
      ? `Position de départ : c'est ${trait} de jouer. Avance coup par coup avec ▶.`
      : `C'est ${trait} de jouer : déplace une pièce sur l'échiquier. Le coach te dira ce qu'il en pense.`));
    return bloc;
  }
  const titre = el("p", "san-ligne titre-coup", `${courant.numero}${courant.couleur === "w" ? "." : "…"} ${courant.san}`);
  bloc.append(titre);
  if (!courant.parMoi) {
    for (const phrase of courant.phrases) bloc.append(el("p", "", phrase));
    return bloc;
  }
  if (!courant.avis) {
    bloc.append(el("p", "", "Le coach regarde ton coup avec Stockfish…"));
    return bloc;
  }
  const cat = CATEGORIES[courant.avis.classification];
  titre.append(el("span", `etiquette cat-${courant.avis.classification}`, `${cat.symbole} ${cat.libelle}`));
  if (courant.avis.meilleur && !BONS.has(courant.avis.classification)) {
    const p = el("p", "");
    p.append("Meilleur coup : ", el("strong", "", courant.avis.meilleur.san), " (flèche verte).");
    bloc.append(p);
  }
  for (const phrase of courant.avis.phrases) bloc.append(el("p", "", phrase));
  return bloc;
}

/** Évaluation en direct de la position affichée : barre, texte, flèche du meilleur coup. */
async function evaluerPosition() {
  const jeton = ++jetonEval;
  const fen = fenCourante();
  const lignes = await lignesDe(fen);
  if (jeton !== jetonEval || !ligne) return;
  const ev = lignes[0]?.eval ?? evaluationTerminale(fen);
  const { orientation } = etatPlateau();
  $("#barre-eval").classList.toggle("inverse", orientation === "black");
  majBarre({ eval: ev, gain_blancs: gainBlancs(ev) }, orientation);
  const texte = $("#carte-ligne .eval-direct");
  if (texte) {
    const partie = new Chess(fen);
    texte.textContent = partie.isCheckmate() ? "Échec et mat."
      : partie.isStalemate() ? "Pat : partie nulle."
      : `Stockfish : ${texteEval(ev)}${lignes[0] ? ` · meilleur coup ${lignes[0].san[0]}` : ""}`;
  }
  definirFleches(formes(lignes));
}

function el(balise, classe = "", texte = null) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== null) e.textContent = texte;
  return e;
}
