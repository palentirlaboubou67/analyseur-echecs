// Interface de l'entraînement « affronter une ouverture », avec coach après chaque coup.

import { Chessground } from "../vendor/chessground.js";
import * as api from "./api.js";
import { baseOuvertures } from "./ouvertures/base.js";
import { Entrainement, NIVEAUX } from "./ouvertures/bot.js";
import { moteur } from "./moteur/stockfish.js";
import { CATEGORIES } from "./review/classification.js";

const $ = (sel) => document.querySelector(sel);
const CLE_REGLAGES = "analyseur.entrainement";
const MAUVAIS = new Set(["imprecision", "erreur", "manquee", "gaffe"]);
const SINGULIERS = {
  brillant: "coup brillant", meilleur: "meilleur coup", excellent: "coup excellent", bon: "bon coup",
  livre: "coup de théorie", imprecision: "imprécision", erreur: "erreur", manquee: "occasion manquée", gaffe: "gaffe",
};
const PLURIELS = {
  brillant: "coups brillants", meilleur: "meilleurs coups", excellent: "coups excellents", bon: "bons coups",
  livre: "coups de théorie", imprecision: "imprécisions", erreur: "erreurs", manquee: "occasions manquées", gaffe: "gaffes",
};
const nombre = (x) => x.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

let base = null;
let ent = null;      // partie d'entraînement en cours (Entrainement)
let cg = null;
let occupe = false;  // le coach ou le bot réfléchit
let orientation = "white";

// --- Préférences (confort seulement) ------------------------------------------------

function lireReglages() {
  try { return JSON.parse(localStorage.getItem(CLE_REGLAGES)) || {}; } catch { return {}; }
}
function ecrireReglages(valeur) {
  try { localStorage.setItem(CLE_REGLAGES, JSON.stringify(valeur)); } catch { /* navigation privée */ }
}

// --- Réglages -------------------------------------------------------------------------

/** Appelée par le routeur quand on arrive sur #/entrainement. */
export async function afficherEntrainement() {
  if (base) return;
  $("#etat-reglages").textContent = "Chargement des ouvertures…";
  try {
    base = await baseOuvertures();
  } catch (err) {
    $("#etat-reglages").textContent = `Impossible de charger les ouvertures (${err.message}).`;
    $("#etat-reglages").classList.add("erreur");
    return;
  }
  $("#etat-reglages").textContent = "";
  remplirChoix();
  moteur.demarrer().catch(() => {}); // on prépare Stockfish pendant que le joueur choisit
}

function remplirChoix() {
  const select = $("#choix-ouverture");
  for (const [camp, libelle] of [["blancs", "Ouvertures des Blancs"], ["noirs", "Défenses des Noirs"]]) {
    const groupe = document.createElement("optgroup");
    groupe.label = libelle;
    for (const o of base.populaires().filter((x) => x.camp === camp)) groupe.append(new Option(o.nom_fr, o.id));
    select.append(groupe);
  }
  $("#liste-ouvertures").replaceChildren(...base.ouvertures.map((o) => new Option(libelleRecherche(o))));
  for (const [id, n] of Object.entries(NIVEAUX)) $("#niveau-bot").append(new Option(n.nom, id));

  const prefs = lireReglages();
  if (prefs.ouverture && base.ouverture(prefs.ouverture)) ajouterEtChoisir(base.ouverture(prefs.ouverture));
  $("#niveau-bot").value = prefs.niveau ?? 2;
  majOuvertureChoisie(prefs.couleurBot);
}

const libelleRecherche = (o) => `${o.nom_fr} — ${o.sans.join(" ")}`;

function ajouterEtChoisir(o) {
  const select = $("#choix-ouverture");
  if (![...select.options].some((opt) => opt.value === o.id)) select.append(new Option(o.nom_fr, o.id));
  select.value = o.id;
}

function majOuvertureChoisie(couleurImposee) {
  const o = base.ouverture($("#choix-ouverture").value);
  if (!o) return;
  $("#coups-ouverture").textContent = `Ligne : ${numeroter(o.sans)}`;
  // Par défaut, le bot joue le camp qui « fait » l'ouverture (Blancs pour l'Italienne, Noirs pour la Sicilienne).
  $("#couleur-bot").value = couleurImposee ?? (o.camp === "blancs" ? "w" : "b");
}

$("#choix-ouverture").addEventListener("change", () => majOuvertureChoisie());
$("#recherche-ouverture").addEventListener("change", (e) => {
  const o = base?.ouvertures.find((x) => libelleRecherche(x) === e.target.value);
  if (!o) return;
  ajouterEtChoisir(o);
  e.target.value = "";
  majOuvertureChoisie();
});

$("#bouton-commencer").addEventListener("click", () => {
  const cible = base?.ouverture($("#choix-ouverture").value);
  if (!cible) return;
  const couleurBot = $("#couleur-bot").value;
  const niveau = Number($("#niveau-bot").value);
  ecrireReglages({ ouverture: cible.id, couleurBot, niveau });
  commencer(cible, couleurBot, niveau);
});

// --- Partie ---------------------------------------------------------------------------

function commencer(cible, couleurBot, niveau) {
  ent = new Entrainement(base, cible, couleurBot, niveau);
  orientation = couleurBot === "w" ? "black" : "white";
  $("#reglages-entrainement").hidden = true;
  $("#jeu-entrainement").hidden = false;
  $("#titre-entrainement").textContent = `${cible.nom_fr} — le bot a les ${couleurBot === "w" ? "Blancs" : "Noirs"}`;
  $("#nom-haut").textContent = `🤖 Bot (${NIVEAUX[niveau].nom})`;
  $("#nom-bas").textContent = "Toi";
  afficherAvis({ titre: "C'est parti !", phrases: [`Le bot va jouer la ${cible.nom_fr} : ${numeroter(cible.sans)}.`,
    "Tant que la ligne n'est pas atteinte, joue les coups de l'ouverture : le coach te guide."] });

  if (!cg) {
    cg = Chessground($("#plateau-entrainement"), {
      coordinates: true,
      animation: { duration: 200 },
      movable: { free: false, showDests: true, events: { after: coupDuJoueur } },
      premovable: { enabled: false },
      drawable: { enabled: true },
    });
    window.addEventListener("resize", () => cg.redrawAll());
  }
  cg.set({ orientation });
  afficherPlateau();
  if (ent.auBot) tourDuBot();
}

function destinations() {
  const dests = new Map();
  for (const m of ent.partie.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}

function afficherPlateau(fleches = []) {
  const dernier = ent.infos.at(-1);
  const trait = ent.partie.turn() === "w" ? "white" : "black";
  const aMoi = !ent.auBot && !ent.terminee && !occupe;
  cg.set({
    fen: ent.fen,
    turnColor: trait,
    lastMove: dernier ? [dernier.uci.slice(0, 2), dernier.uci.slice(2, 4)] : undefined,
    check: ent.partie.inCheck(),
    movable: { color: aMoi ? trait : undefined, dests: aMoi ? destinations() : new Map() },
  });
  cg.setAutoShapes(fleches);
  majStatut();
  afficherTheorie();
  afficherCoups();
  afficherBilan();
  $("#bouton-annuler").disabled = occupe || !ent.infos.some((i) => i.par === "joueur");
  $("#bouton-indice").disabled = occupe || ent.auBot || ent.terminee;
  $("#bouton-analyser-partie").disabled = ent.infos.length < 2;
}

function majStatut() {
  let texte;
  if (ent.terminee) {
    const p = ent.partie;
    texte = p.isCheckmate() ? `Échec et mat : ${p.turn() === "w" ? "0-1" : "1-0"}` : "Partie nulle";
  } else texte = occupe || ent.auBot ? "Le bot réfléchit…" : "À toi de jouer";
  $("#statut-entrainement").textContent = texte;
}

function afficherTheorie() {
  const el = $("#theorie-entrainement");
  const ligne = ent.coupDeLaLigne();
  if (ligne) {
    el.textContent = `➡ Ouverture en cours : ${numeroter(ent.cible.sans)}`;
  } else if (ent.enLivre) {
    el.textContent = `📖 Dans la théorie${base.nomPosition(ent.fen) ? ` : ${base.nomPosition(ent.fen).nom_fr}` : ""}`;
  } else {
    el.textContent = `🤖 Hors théorie : Stockfish joue (niveau ${ent.niveau.nom})`;
  }
  el.classList.toggle("hors", !ligne && !ent.enLivre);
}

async function coupDuJoueur(orig, dest) {
  if (occupe || !ent) return;
  const piece = cg.state.pieces.get(dest);
  const promotion = piece?.role === "pawn" && (dest[1] === "8" || dest[1] === "1") ? "q" : "";
  const uci = orig + dest + promotion;

  // L'ouverture est imposée : un autre coup est refusé, et le coach montre le bon.
  const verdict = ent.verifier(uci);
  if (!verdict.accepte) {
    afficherAvis({
      classe: "imprecision", titre: "Ce n'est pas la ligne de l'ouverture",
      phrases: [`Pour affronter la ${ent.cible.nom_fr}, il faut jouer ${verdict.attendu.san} ici (flèche verte). Rejoue !`,
        `Ligne complète : ${numeroter(ent.cible.sans)}.`],
    });
    afficherPlateau([fleche(verdict.attendu.uci, "green")]);
    return;
  }

  occupe = true;
  const avantAtteinte = ent.cibleAtteinte;
  const promesse = ent.coupDuJoueur(uci);
  afficherPlateau();
  afficherAvis({ titre: "Le coach regarde ton coup…", phrases: [] });
  let resultat;
  try {
    resultat = await promesse;
  } catch (err) {
    occupe = false;
    afficherAvis({ classe: "erreur", titre: "Stockfish ne répond pas", phrases: [err.message] });
    afficherPlateau();
    return;
  }
  const { coach, lignesApres } = resultat;
  const atteinte = !avantAtteinte && ent.cibleAtteinte;
  afficherAvis({
    classe: coach.classification,
    titre: CATEGORIES[coach.classification].libelle + (coach.theorie ? "" : ` · précision ${nombre(coach.precision)}`),
    phrases: [...coach.phrases, ...(atteinte ? [`✅ Position de la ${ent.cible.nom_fr} atteinte : à partir d'ici, tu joues librement.`] : [])],
    meilleur: coach.meilleur,
  });
  const fleches = coach.meilleur ? [fleche(coach.meilleur.uci, "green")] : [];
  afficherPlateau(fleches);

  if (ent.auBot) {
    // Après une erreur, on laisse le temps de voir la flèche du meilleur coup avant que le bot joue.
    await pause(MAUVAIS.has(coach.classification) ? 1400 : 350);
    await tourDuBot(lignesApres);
  } else {
    occupe = false;
    afficherPlateau(fleches);
  }
}

async function tourDuBot(lignesConnues = null) {
  occupe = true;
  majStatut();
  try {
    await ent.coupDuBot(lignesConnues);
  } catch (err) {
    afficherAvis({ classe: "erreur", titre: "Stockfish ne répond pas", phrases: [err.message] });
  }
  occupe = false;
  afficherPlateau();
}

// --- Affichage du coach, du bilan, des coups ----------------------------------------------

function afficherAvis({ classe = null, titre, phrases, meilleur = null }) {
  // Résumé d'une ligne sous l'échiquier (utile sur téléphone, où la carte du coach est plus bas).
  const court = $("#coach-court");
  court.hidden = !classe;
  court.replaceChildren();
  if (classe) {
    court.append(el("span", `etiquette cat-${classe}`, `${CATEGORIES[classe].symbole} ${CATEGORIES[classe].libelle}`));
    if (meilleur) court.append(document.createTextNode(` Meilleur coup : ${meilleur.san}`));
  }

  const avis = $("#avis-coach");
  avis.replaceChildren();
  const entete = document.createElement("div");
  entete.className = "titre-coup";
  if (classe) entete.append(el("span", `etiquette cat-${classe}`, `${CATEGORIES[classe].symbole} ${titre}`));
  else entete.append(el("strong", "", titre));
  avis.append(entete);
  const explication = el("div", "explication");
  for (const p of phrases) explication.append(el("p", "", p));
  if (meilleur) explication.append(el("p", "meilleur-coup", `Meilleur coup : ${meilleur.san}`));
  if (phrases.length || meilleur) avis.append(explication);
}

function afficherBilan() {
  const { compteurs, precision, nombre: coupsJuges } = ent.bilan();
  const zone = $("#bilan-entrainement");
  zone.replaceChildren();
  if (!coupsJuges) {
    zone.append(el("p", "doux", "Le coach juge chacun de tes coups : le bilan apparaîtra ici."));
    return;
  }
  zone.append(el("p", "precision-moyenne", `Précision moyenne : ${nombre(precision)}`));
  const liste = el("div", "pastilles");
  for (const [cle, cat] of Object.entries(CATEGORIES)) {
    const n = compteurs[cle];
    if (!n) continue;
    const item = el("span", "item-bilan");
    item.append(el("span", `pastille cat-${cle}`, cat.symbole), document.createTextNode(` ${n} ${(n > 1 ? PLURIELS : SINGULIERS)[cle]}`));
    liste.append(item);
  }
  zone.append(liste);
}

function afficherCoups() {
  const zone = $("#coups-entrainement");
  zone.replaceChildren();
  let ligne = null;
  ent.infos.forEach((info, i) => {
    if (i % 2 === 0) {
      ligne = el("div", "ligne-coup");
      ligne.append(el("span", "num", `${i / 2 + 1}.`));
      zone.append(ligne);
    }
    const coup = el("span", "coup", info.san);
    if (info.par === "joueur" && info.coach) {
      coup.dataset.classe = info.coach.classification;
      coup.title = CATEGORIES[info.coach.classification].libelle;
      if (info.coach.classification !== "meilleur") coup.append(el("span", "symbole", CATEGORIES[info.coach.classification].symbole));
    } else if (info.source === "ouverture" || info.source === "livre") coup.title = "Coup de théorie";
    ligne.append(coup);
  });
  zone.scrollTop = zone.scrollHeight;
}

// --- Boutons -------------------------------------------------------------------------------

$("#bouton-annuler").addEventListener("click", () => {
  if (occupe || !ent) return;
  ent.annuler();
  afficherAvis({ titre: "Coup annulé", phrases: ["Rejoue ton coup."] });
  afficherPlateau();
});

$("#bouton-indice").addEventListener("click", async () => {
  if (occupe || !ent || ent.auBot) return;
  const ligne = ent.coupDeLaLigne();
  if (ligne) {
    afficherAvis({ titre: "Indice", phrases: [`Le coup de l'ouverture est indiqué par la flèche.`] });
    afficherPlateau([fleche(ligne, "blue")]);
    return;
  }
  occupe = true;
  afficherPlateau();
  try {
    const [meilleure] = await moteur.analyser(ent.fen, { profondeur: 12, tempsMax: 600 }, 1, 10);
    occupe = false;
    afficherAvis({ titre: "Indice", phrases: [`Stockfish conseille ${meilleure.san[0]} (flèche bleue).`] });
    afficherPlateau([fleche(meilleure.uci[0], "blue")]);
  } catch (err) {
    occupe = false;
    afficherPlateau();
  }
});

$("#bouton-retourner-jeu").addEventListener("click", () => {
  orientation = orientation === "white" ? "black" : "white";
  cg?.set({ orientation });
});

$("#bouton-nouvelle").addEventListener("click", () => {
  $("#jeu-entrainement").hidden = true;
  $("#reglages-entrainement").hidden = false;
});

$("#bouton-analyser-partie").addEventListener("click", async () => {
  if (!ent) return;
  try {
    const donnees = await api.importerPGN(ent.pgn());
    location.hash = `#/partie/${encodeURIComponent(donnees.id)}`;
  } catch (err) {
    afficherAvis({ classe: "erreur", titre: "Impossible d'ouvrir l'analyse", phrases: [err.message] });
  }
});

// --- Utilitaires ---------------------------------------------------------------------------

const fleche = (uci, brush) => ({ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** ["e4", "e5", "Nf3"] -> "1. e4 e5 2. Nf3" (depuis la position initiale). */
function numeroter(sans) {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(" ");
}

function el(balise, classe = "", texte = null) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== null && texte !== undefined) e.textContent = texte;
  return e;
}
