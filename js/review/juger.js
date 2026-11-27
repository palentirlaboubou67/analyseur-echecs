// Avis du coach sur UN coup, à partir des lignes de Stockfish avant et après le coup.
// Partagé par l'entraînement (bot.js) et les coups joués librement dans la revue (vue-ligne.js).
// Pure : ne lance pas le moteur, on lui donne les lignes déjà calculées.

import { Chess, jouerUci } from "../echecs.js";
import { classer, estSacrifice } from "./classification.js";
import { gainPour, precisionCoup } from "./probabilites.js";
import { expliquerCoup } from "../explication/redaction.js";

const arrondi = (x) => Math.round(x * 10) / 10;

/**
 * fenAvant : position avant le coup ; uci : le coup ; lignesAvant / lignesApres : lignes de Stockfish
 * ({eval, uci[], san[]}) dans la position avant et après ; precedent : {fen, uci} du coup adverse
 * précédent (pour compter les reprises), ou null.
 * Renvoie {classification, phrases, meilleur: {uci, san}|null, precision, perte} ou null si illégal.
 */
export function jugerCoup(fenAvant, uci, lignesAvant, lignesApres, precedent = null) {
  const partie = new Chess(fenAvant);
  const coup = jouerUci(partie, uci);
  if (!coup) return null;
  const couleur = coup.color === "w" ? "blancs" : "noirs";
  const meilleure = lignesAvant[0];
  const estMeilleur = meilleure?.uci[0] === uci;
  const coupUnique = new Chess(fenAvant).moves().length === 1;
  const gainAvant = meilleure ? gainPour(meilleure.eval, couleur) : 50;
  const evalApres = partie.isCheckmate()
    ? { type: "mat", valeur: 0, vainqueur: couleur }
    : lignesApres[0]?.eval ?? { type: "cp", valeur: 0 };
  // Si le coup joué fait partie des lignes de la recherche « avant », son éval est la plus fiable.
  const ligneJouee = lignesAvant.find((l) => l.uci[0] === uci);
  let gainApres = gainPour(evalApres, couleur);
  if (estMeilleur || coupUnique) gainApres = gainAvant;
  else if (ligneJouee) gainApres = gainPour(ligneJouee.eval, couleur);

  const classification = classer(gainAvant, gainApres, { estMeilleur, coupUnique, sacrifice: estSacrifice(fenAvant, uci) });
  const perte = arrondi(Math.max(0, gainAvant - gainApres));
  const info = { classification, gain_avant: arrondi(gainAvant), gain_apres: arrondi(gainApres), perte };
  const phrases = expliquerCoup(fenAvant, uci, coup.san, { lignes: lignesAvant }, { lignes: lignesApres }, info, null, precedent);
  return {
    classification,
    phrases,
    meilleur: meilleure && !estMeilleur ? { uci: meilleure.uci[0], san: meilleure.san[0] } : null,
    precision: arrondi(precisionCoup(gainAvant, gainApres)),
    perte,
  };
}
