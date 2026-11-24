// Analyse d'une partie complète avec Stockfish, puis classification de chaque coup.

import { Chess } from "../echecs.js";
import { CATEGORIES, classer, estSacrifice } from "../review/classification.js";
import { gainBlancs, gainPour, precisionCoup, precisionPartie } from "../review/probabilites.js";
import { moteur } from "./stockfish.js";

// Le moteur s'arrête à la profondeur demandée OU au temps maximum (ms), au premier atteint :
// dans les positions très déséquilibrées, chercher 3 lignes à profondeur fixe peut être très long.
export const REGLAGES = {
  rapide: { nom: "Rapide", profondeur: 10, tempsMax: 250 },
  normale: { nom: "Normale", profondeur: 14, tempsMax: 700 },
  profonde: { nom: "Profonde", profondeur: 18, tempsMax: 2000 },
};

export function evaluationTerminale(fen) {
  const partie = new Chess(fen);
  if (partie.isCheckmate()) return { type: "mat", valeur: 0, vainqueur: partie.turn() === "w" ? "noirs" : "blancs" };
  return { type: "cp", valeur: 0 };
}

export function estTerminee(fen) {
  const partie = new Chess(fen);
  return partie.isCheckmate() || partie.isStalemate() || partie.isInsufficientMaterial();
}

/** Positions analysées -> classification de chaque coup (même logique que la version Python). */
export function classerCoups(partie, positions) {
  const fens = [partie.fen_depart, ...partie.coups.map((c) => c.fen)];
  const coups = [];
  partie.coups.forEach((coup, k) => {
    const avant = positions[k], apres = positions[k + 1];
    const gainAvant = gainPour(avant.eval, coup.couleur);
    let gainApres = gainPour(apres.eval, coup.couleur);
    const meilleure = avant.lignes[0] ?? null;
    const estMeilleur = Boolean(meilleure) && meilleure.uci[0] === coup.uci;
    const coupUnique = new Chess(fens[k]).moves().length === 1;
    // Si le coup joué fait partie des lignes calculées, on prend l'éval de CETTE recherche :
    // comparer deux recherches différentes crée des « pertes » fantômes dues à l'horizon du moteur.
    const ligneJouee = avant.lignes.find((l) => l.uci[0] === coup.uci);
    if (estMeilleur || coupUnique) gainApres = gainAvant;
    else if (ligneJouee) gainApres = gainPour(ligneJouee.eval, coup.couleur);

    const classification = classer(gainAvant, gainApres, {
      estMeilleur, coupUnique,
      sacrifice: estSacrifice(fens[k], coup.uci),
      erreurAdverseAvant: k > 0 && ["erreur", "gaffe"].includes(coups[k - 1].classification),
    });
    coups.push({
      ply: coup.ply,
      classification,
      gain_avant: arrondi(gainAvant),
      gain_apres: arrondi(gainApres),
      perte: arrondi(Math.max(0, gainAvant - gainApres)),
      precision: arrondi(precisionCoup(gainAvant, gainApres)),
      meilleur: meilleure ? { uci: meilleure.uci[0], san: meilleure.san[0] } : null,
    });
  });
  return coups;
}

export function resumer(partie, positions, coups) {
  const couleurs = partie.coups.map((c) => c.couleur);
  const compteurs = { blancs: {}, noirs: {} };
  for (const cat of Object.keys(CATEGORIES)) compteurs.blancs[cat] = compteurs.noirs[cat] = 0;
  coups.forEach((c, i) => { compteurs[couleurs[i]][c.classification] += 1; });
  return {
    precision: precisionPartie(positions.map((p) => p.gain_blancs), coups.map((c) => c.precision), couleurs),
    compteurs,
  };
}

/** Analyse complète. `progression(fait, total)` est appelée après chaque position. */
export async function analyserPartie(partie, nomReglage, progression = () => {}) {
  const reglage = REGLAGES[nomReglage];
  const fens = [partie.fen_depart, ...partie.coups.map((c) => c.fen)];
  const positions = [];
  for (let i = 0; i < fens.length; i++) {
    let lignes = [], evaluation;
    if (estTerminee(fens[i])) evaluation = evaluationTerminale(fens[i]);
    else {
      lignes = await moteur.analyser(fens[i], reglage, 3);
      evaluation = lignes[0]?.eval ?? evaluationTerminale(fens[i]);
    }
    positions.push({ eval: evaluation, gain_blancs: arrondi(gainBlancs(evaluation)), lignes });
    progression(i + 1, fens.length);
  }
  const coups = classerCoups(partie, positions);
  return {
    moteur: "Stockfish 19 (navigateur)",
    reglage: { nom: nomReglage, profondeur: reglage.profondeur },
    positions,
    coups,
    resume: resumer(partie, positions, coups),
  };
}

const arrondi = (x) => Math.round(x * 10) / 10;
