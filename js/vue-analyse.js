// Affichage de l'analyse Stockfish : barre d'évaluation, flèches, classification des coups,
// graphique, résumé de précision et détail du coup courant.

import * as api from "./api.js";
import { aller, definirFleches, etatPlateau, surChangementPosition, surNouvellePartie } from "./plateau.js";
import { CATEGORIES } from "./review/classification.js";
import { memoriserLignes, ouvrirLigne } from "./vue-ligne.js";

const $ = (sel) => document.querySelector(sel);
const CLE_REGLAGE = "analyseur.reglage";
const CLE_SUIVANT = "analyseur.suivant";
const REGLAGES = ["profonde", "normale", "rapide"]; // du plus précis au moins précis
const NS_SVG = "http://www.w3.org/2000/svg";
// Catégories signalées par un symbole dans la liste des coups et un point sur le graphique.
const SIGNALEES = new Set(["brillant", "imprecision", "erreur", "manquee", "gaffe"]);
const BONS_COUPS = new Set(["brillant", "meilleur", "livre"]);

let analyse = null; // analyse affichée
let jeton = 0;      // change à chaque partie : les sondages d'une partie précédente s'arrêtent

// --- Stockage local (préférences seulement) ---------------------------------

function lire(cle, defaut) {
  try { return localStorage.getItem(cle) ?? defaut; } catch { return defaut; }
}
function ecrire(cle, valeur) {
  try { localStorage.setItem(cle, valeur); } catch { /* navigation privée */ }
}

// --- Lancement et suivi --------------------------------------------------------

surNouvellePartie(async ({ id }) => {
  analyse = null;
  const monJeton = ++jeton;
  reinitialiser();
  // Une analyse déjà faite (au réglage le plus précis disponible) s'affiche directement.
  for (const reglage of REGLAGES) {
    const etat = await api.etatAnalyse(id, reglage).catch(() => null);
    if (monJeton !== jeton) return;
    if (etat?.statut === "terminee") {
      $("#reglage-analyse").value = reglage;
      afficherAnalyse(etat.analyse);
      return;
    }
  }
  lancer();
});

async function lancer() {
  const { id } = etatPlateau();
  const reglage = $("#reglage-analyse").value;
  const monJeton = ++jeton;
  ecrire(CLE_REGLAGE, reglage);
  $("#bouton-analyser").disabled = true;
  $("#etat-analyse").classList.remove("erreur");
  try {
    suivre(await api.lancerAnalyse(id, reglage), monJeton, id, reglage);
  } catch (err) {
    erreur(err.message);
  }
}

function suivre(etat, monJeton, id, reglage) {
  if (monJeton !== jeton) return;
  if (etat.statut === "terminee") return afficherAnalyse(etat.analyse);
  if (etat.statut === "erreur") return erreur(etat.message);

  const prog = $("#progression-analyse");
  prog.hidden = false;
  const pct = etat.total ? (100 * etat.fait) / etat.total : 0;
  prog.querySelector(".barre").style.width = `${pct}%`;
  prog.querySelector("span").textContent = etat.statut === "en_cours" && etat.total
    ? `Stockfish analyse la partie… ${etat.fait} / ${etat.total} positions`
    : "Démarrage de Stockfish…";
  $("#etat-analyse").textContent = "";
  setTimeout(async () => {
    try {
      suivre(await api.etatAnalyse(id, reglage), monJeton, id, reglage);
    } catch (err) {
      if (monJeton === jeton) erreur(err.message);
    }
  }, 700);
}

function erreur(message) {
  $("#progression-analyse").hidden = true;
  $("#bouton-analyser").disabled = false;
  $("#etat-analyse").textContent = message;
  $("#etat-analyse").classList.add("erreur");
}

function reinitialiser() {
  $("#progression-analyse").hidden = true;
  $("#bouton-analyser").disabled = false;
  $("#etat-analyse").textContent = "";
  $("#resume-analyse").replaceChildren();
  $("#carte-compteurs").hidden = true;
  $("#graphique").setAttribute("hidden", ""); // un <svg> n'a pas de propriété .hidden
  $("#carte-coup").hidden = true;
  $("#badge-coup").hidden = true;
  document.querySelectorAll("#liste-coups .coup").forEach((el) => {
    delete el.dataset.classe;
    el.querySelector(".symbole")?.remove();
  });
}

function afficherAnalyse(donnees) {
  reinitialiser();
  analyse = donnees;
  const { profondeur } = donnees.reglage;
  $("#etat-analyse").textContent = `${donnees.moteur} · profondeur ${profondeur} max.`;
  // Les lignes déjà calculées servent aussi aux variantes jouées à la main.
  const { partie } = etatPlateau();
  const fens = [partie.fen_depart, ...partie.coups.map((c) => c.fen)];
  donnees.positions.forEach((position, i) => memoriserLignes(fens[i], position.lignes));
  afficherResume();
  annoterListe();
  dessinerGraphique();
  majPosition(etatPlateau());
}

// --- Résumé de la partie ----------------------------------------------------------

function afficherResume() {
  const { precision, compteurs } = analyse.resume;
  const { entetes } = etatPlateau().partie;
  const conteneur = $("#resume-analyse");

  const precisions = el("div", "precisions");
  for (const [couleur, nom] of [["blancs", entetes.White], ["noirs", entetes.Black]]) {
    const bloc = el("div", `precision ${couleur}`);
    bloc.append(el("span", "nom", nom || couleur), el("strong", "", precision[couleur] != null ? nombre(precision[couleur]) : "–"), el("small", "", "précision"));
    precisions.append(bloc);
  }

  conteneur.append(precisions);
  if (analyse.ouverture) {
    const { nom_fr, eco } = analyse.ouverture;
    conteneur.append(el("p", "doux", `📖 Ouverture : ${nom_fr} (${eco})`));
  }

  const table = el("table", "compteurs");
  const entete = document.createElement("tr");
  entete.append(el("th", "nombre", "Blancs"), el("th"), el("th", "nombre", "Noirs"));
  table.append(entete);
  for (const [cle, cat] of Object.entries(CATEGORIES)) {
    const tr = document.createElement("tr");
    const libelle = el("td", "libelle");
    libelle.append(el("span", `pastille cat-${cle}`, cat.symbole), document.createTextNode(` ${cat.libelle}`));
    tr.append(el("td", "nombre", compteurs.blancs[cle]), libelle, el("td", "nombre", compteurs.noirs[cle]));
    table.append(tr);
  }
  $("#compteurs").replaceChildren(table);
  $("#carte-compteurs").hidden = false;
}

function annoterListe() {
  for (const coup of analyse.coups) {
    const bouton = document.querySelector(`#liste-coups .coup[data-ply="${coup.ply}"]`);
    if (!bouton) continue;
    bouton.dataset.classe = coup.classification;
    if (SIGNALEES.has(coup.classification)) {
      bouton.append(el("span", "symbole", CATEGORIES[coup.classification].symbole));
    }
  }
}

// --- Graphique d'évaluation ---------------------------------------------------------

function dessinerGraphique() {
  const svg = $("#graphique");
  const n = analyse.positions.length - 1;
  if (n < 1) return;
  const L = 560, H = 110;
  const x = (i) => (i * L) / n;
  const y = (gain) => H - (gain * H) / 100;

  svg.setAttribute("viewBox", `0 0 ${L} ${H}`);
  svg.replaceChildren();
  svg.append(svgEl("rect", { x: 0, y: 0, width: L, height: H, class: "fond" }));
  const points = analyse.positions.map((p, i) => `${x(i).toFixed(1)},${y(p.gain_blancs).toFixed(1)}`);
  svg.append(svgEl("path", { d: `M0,${H} L${points.join(" L")} L${L},${H} Z`, class: "aire" }));
  svg.append(svgEl("line", { x1: 0, y1: H / 2, x2: L, y2: H / 2, class: "milieu" }));
  svg.append(svgEl("line", { id: "curseur-graphique", x1: 0, y1: 0, x2: 0, y2: H, class: "curseur" }));
  for (const coup of analyse.coups) {
    if (!SIGNALEES.has(coup.classification)) continue;
    const point = svgEl("circle", {
      cx: x(coup.ply), cy: y(analyse.positions[coup.ply].gain_blancs), r: 4,
      class: `point cat-${coup.classification}`,
    });
    point.append(svgEl("title", {}, `${CATEGORIES[coup.classification].libelle}`));
    svg.append(point);
  }
  svg.onclick = (e) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0) aller(Math.round(((e.clientX - rect.left) / rect.width) * n));
  };
  svg.removeAttribute("hidden");
}

// --- Position courante : barre, flèches, badge, détail ------------------------------

surChangementPosition(majPosition);
$("#option-suivant").checked = lire(CLE_SUIVANT, "0") === "1";
$("#option-suivant").addEventListener("change", (e) => {
  ecrire(CLE_SUIVANT, e.target.checked ? "1" : "0");
  majPosition(etatPlateau());
});
$("#reglage-analyse").value = lire(CLE_REGLAGE, "normale");
$("#bouton-analyser").addEventListener("click", lancer);

function majPosition(etat) {
  if (document.body.classList.contains("en-ligne")) return; // une variante est affichée
  const barre = $("#barre-eval");
  barre.classList.toggle("inverse", etat.orientation === "black");
  if (!analyse) {
    majBarre({ eval: null, gain_blancs: 50 }, etat.orientation);
    definirFleches([]);
    return;
  }
  const { ply, partie } = etat;
  const position = analyse.positions[ply];
  const coupJoue = partie.coups[ply - 1];
  const infoCoup = analyse.coups[ply - 1];
  majBarre(position, etat.orientation);

  const formes = [];
  if (infoCoup?.meilleur && !BONS_COUPS.has(infoCoup.classification) && infoCoup.meilleur.uci !== coupJoue.uci) {
    formes.push(fleche(infoCoup.meilleur.uci, "green")); // ce qu'il fallait jouer à la place
  }
  if ($("#option-suivant").checked && position.lignes[0]) {
    formes.push(fleche(position.lignes[0].uci[0], "blue")); // meilleur coup dans la position affichée
  }
  definirFleches(formes);

  placerBadge(coupJoue, infoCoup, etat.orientation);
  $("#curseur-graphique")?.setAttribute("x1", (ply * 560) / (analyse.positions.length - 1));
  $("#curseur-graphique")?.setAttribute("x2", (ply * 560) / (analyse.positions.length - 1));
  afficherDetailCoup(etat, coupJoue, infoCoup);
}

function fleche(uci, brush) {
  return { orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush };
}

export function majBarre(position, orientation) {
  const barre = $("#barre-eval");
  const gainBas = orientation === "white" ? position.gain_blancs : 100 - position.gain_blancs;
  barre.querySelector(".part-bas").style.height = `${gainBas}%`;
  const valeur = barre.querySelector(".valeur");
  valeur.textContent = position.eval ? texteEval(position.eval) : "";
  valeur.classList.toggle("en-haut", gainBas < 50);
}

function placerBadge(coupJoue, infoCoup, orientation) {
  const badge = $("#badge-coup");
  if (!coupJoue || !infoCoup) {
    badge.hidden = true;
    return;
  }
  const dest = coupJoue.uci.slice(2, 4);
  const colonne = "abcdefgh".indexOf(dest[0]);
  const rangee = Number(dest[1]);
  const col = orientation === "white" ? colonne : 7 - colonne;
  const lig = orientation === "white" ? 8 - rangee : rangee - 1;
  badge.style.left = `${(col + 1) * 12.5}%`;
  badge.style.top = `${lig * 12.5}%`;
  badge.className = `badge-coup cat-${infoCoup.classification}`;
  badge.textContent = CATEGORIES[infoCoup.classification].symbole;
  badge.title = CATEGORIES[infoCoup.classification].libelle;
  badge.hidden = false;
}

function afficherDetailCoup({ ply, partie }, coupJoue, infoCoup) {
  const carte = $("#carte-coup");
  carte.replaceChildren();
  carte.hidden = false;

  if (!coupJoue) {
    carte.append(el("h3", "", "Position de départ"));
  } else {
    const cat = CATEGORIES[infoCoup.classification];
    const titre = el("h3", "titre-coup");
    titre.append(
      document.createTextNode(`${coupJoue.numero}${coupJoue.couleur === "blancs" ? "." : "…"} ${coupJoue.san} `),
      el("span", `etiquette cat-${infoCoup.classification}`, `${cat.symbole} ${cat.libelle}`),
    );
    carte.append(titre);
    // Explications rédigées par le serveur (faits de la position + lignes de Stockfish).
    const phrases = analyse.explications?.[ply - 1];
    const explication = el("div", "explication");
    for (const phrase of phrases?.length ? phrases : [phraseCoup(infoCoup)]) {
      explication.append(el("p", "", phrase));
    }
    carte.append(explication);
    if (!BONS_COUPS.has(infoCoup.classification)) {
      carte.append(el("p", "doux", `Chances de gain : ${nombre(infoCoup.gain_avant)} % → ${nombre(infoCoup.gain_apres)} %`));
    }
  }

  // Lignes du moteur dans la position d'où partait le coup (ou la position de départ).
  const positionAvant = analyse.positions[Math.max(0, ply - 1)];
  const fenAvant = ply > 1 ? partie.coups[ply - 2].fen : partie.fen_depart;
  const fenApres = coupJoue ? coupJoue.fen : partie.fen_depart;

  // Boutons « Voir la ligne » (comme sur chess.com) : rejouer la ligne sur l'échiquier.
  const actions = el("div", "actions-ligne");
  const meilleure = positionAvant.lignes[0];
  if (coupJoue && meilleure && infoCoup.meilleur && infoCoup.meilleur.uci !== coupJoue.uci) {
    const mat = matDe(meilleure.eval);
    actions.append(boutonLigne(
      mat ? `♚ Voir le mat en ${mat.n} manqué` : "▶ Voir ce qu'il fallait jouer",
      mat ? "Le mat qu'il fallait jouer" : `Ce qu'il fallait jouer à la place de ${coupJoue.san}`,
      fenAvant, meilleure, Boolean(mat),
    ));
  }
  const suite = analyse.positions[ply]?.lignes?.[0];
  if (suite) {
    const mat = matDe(suite.eval);
    const titre = coupJoue ? `La suite après ${coupJoue.san}` : "La suite";
    actions.append(boutonLigne(
      mat ? `♚ Voir le mat en ${mat.n} ${mat.camp}` : "▶ Voir la suite",
      mat ? `Mat en ${mat.n} ${mat.camp}` : titre, fenApres, suite, Boolean(mat),
    ));
  }
  if (actions.children.length) carte.append(actions);

  if (positionAvant.lignes.length) {
    carte.append(el("h4", "", coupJoue ? "Ce que proposait Stockfish" : "Lignes de Stockfish"));
    const liste = el("ol", "lignes-moteur");
    for (const ligne of positionAvant.lignes) {
      const li = document.createElement("li");
      const voir = el("button", "voir-ligne", "▶");
      voir.title = "Rejouer cette ligne sur l'échiquier";
      voir.addEventListener("click", () => ouvrirLigne("Ligne de Stockfish", fenAvant, ligne));
      li.append(voir, el("span", "eval-ligne", texteEval(ligne.eval)), el("span", "", numeroter(fenAvant, ligne.san)));
      liste.append(li);
    }
    carte.append(liste);
  }
}

/** Mat annoncé par une évaluation : {n, camp: "des Blancs"|"des Noirs"} ou null. */
function matDe(ev) {
  if (ev?.type !== "mat" || !ev.valeur) return null;
  return { n: Math.abs(ev.valeur), camp: ev.valeur > 0 ? "des Blancs" : "des Noirs" };
}

function boutonLigne(texte, titre, fen, ligne, estMat) {
  const b = el("button", `bouton-ligne${estMat ? " mat" : ""}`, texte);
  b.addEventListener("click", () => ouvrirLigne(titre, fen, ligne));
  return b;
}

function phraseCoup(info) {
  switch (info.classification) {
    case "brillant": return "Un sacrifice qui tient selon Stockfish : bien vu !";
    case "meilleur": return "C'était le meilleur coup selon Stockfish.";
    case "livre": return "Un coup connu de la théorie des ouvertures.";
    case "excellent":
    case "bon":
      return `Bon choix. Stockfish préférait ${info.meilleur?.san ?? "?"}, mais la différence est faible (−${nombre(info.perte)} %).`;
    default:
      return `Stockfish recommandait ${info.meilleur?.san ?? "?"}. Ce coup fait perdre ${nombre(info.perte)} % de chances de gain.`;
  }
}

/** 11.3 -> "11,3" */
function nombre(valeur) {
  return valeur.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

// --- Petits utilitaires ----------------------------------------------------------------

/** Évaluation lisible, du point de vue des Blancs : +1.2, −0.4, M3, −M2, 1-0. */
export function texteEval(ev) {
  if (ev.type === "mat") {
    if (ev.valeur === 0) return ev.vainqueur === "blancs" ? "1-0" : "0-1";
    return ev.valeur > 0 ? `M${ev.valeur}` : `−M${-ev.valeur}`;
  }
  const pions = ev.valeur / 100;
  return `${pions > 0 ? "+" : pions < 0 ? "−" : ""}${Math.abs(pions).toFixed(1)}`;
}

/** ["Nf3", "Nc6", "Bb5"] depuis une FEN où les Noirs jouent au coup 3 -> "3… Nf3 4. Nc6 Bb5". */
function numeroter(fen, sans) {
  const [, trait, , , , numero] = fen.split(" ");
  let n = Number(numero);
  let blancs = trait === "w";
  const morceaux = [];
  sans.slice(0, 8).forEach((san, i) => {
    if (blancs) morceaux.push(`${n}. ${san}`);
    else morceaux.push(i === 0 ? `${n}… ${san}` : san);
    if (!blancs) n += 1;
    blancs = !blancs;
  });
  return morceaux.join(" ");
}

function el(balise, classe = "", texte = null) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== null && texte !== undefined) e.textContent = texte;
  return e;
}

function svgEl(balise, attributs, texte) {
  const e = document.createElementNS(NS_SVG, balise);
  for (const [k, v] of Object.entries(attributs)) e.setAttribute(k, v);
  if (texte) e.textContent = texte;
  return e;
}
