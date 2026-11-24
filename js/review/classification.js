// Classification des coups, inspirée de chess.com mais fondée sur le % de gain perdu :
// perte = % de gain du joueur avant le coup - % de gain après le coup joué.

import { Chess, Position, VALEURS, jouerUci } from "../echecs.js";

export const SEUIL_EXCELLENT = 2;
export const SEUIL_BON = 5;
export const SEUIL_IMPRECISION = 10;
export const SEUIL_ERREUR = 20;

// Brillant : vrai sacrifice, position pas déjà gagnée d'avance, et pas perdante ensuite.
const BRILLANT_GAIN_AVANT_MAX = 90;
const BRILLANT_GAIN_APRES_MIN = 45;
const SACRIFICE_MINIMUM = 2;
// Occasion manquée : l'adversaire venait de se tromper et on ne l'a pas puni (sans devenir perdant).
const MANQUEE_GAIN_AVANT_MIN = 60;
const MANQUEE_GAIN_APRES_MIN = 40;

export const CATEGORIES = {
  brillant: { libelle: "Brillant", symbole: "!!" },
  meilleur: { libelle: "Meilleur coup", symbole: "★" },
  excellent: { libelle: "Excellent", symbole: "!" },
  bon: { libelle: "Bon", symbole: "✓" },
  livre: { libelle: "Coup de livre", symbole: "▤" },
  imprecision: { libelle: "Imprécision", symbole: "?!" },
  erreur: { libelle: "Erreur", symbole: "?" },
  manquee: { libelle: "Occasion manquée", symbole: "✗" },
  gaffe: { libelle: "Gaffe", symbole: "??" },
};

export function classer(gainAvant, gainApres, { estMeilleur = false, coupUnique = false, sacrifice = false,
  erreurAdverseAvant = false, livre = false } = {}) {
  if (livre) return "livre";
  const perte = Math.max(0, gainAvant - gainApres);
  let categorie;
  if (estMeilleur || coupUnique) categorie = "meilleur";
  else if (perte <= SEUIL_EXCELLENT) categorie = "excellent";
  else if (perte <= SEUIL_BON) categorie = "bon";
  else if (perte <= SEUIL_IMPRECISION) categorie = "imprecision";
  else if (perte <= SEUIL_ERREUR) categorie = "erreur";
  else categorie = "gaffe";

  if (sacrifice && (categorie === "meilleur" || categorie === "excellent")
      && gainAvant <= BRILLANT_GAIN_AVANT_MAX && gainApres >= BRILLANT_GAIN_APRES_MIN) return "brillant";
  if (erreurAdverseAvant && ["imprecision", "erreur", "gaffe"].includes(categorie)
      && gainAvant >= MANQUEE_GAIN_AVANT_MIN && gainApres >= MANQUEE_GAIN_APRES_MIN) return "manquee";
  return categorie;
}

/**
 * Le coup laisse-t-il une pièce (pas un pion) à prendre avec perte d'au moins 2 points ?
 * Estimation simple sur la case d'arrivée ; c'est le moteur qui dit si le sacrifice est bon.
 */
export function estSacrifice(fen, uci) {
  const avant = new Position(fen);
  const piece = avant.piece(uci.slice(0, 2));
  if (!piece || piece.type === "p" || piece.type === "k" || uci.length > 4) return false;
  const partie = new Chess(fen);
  const coup = jouerUci(partie, uci);
  if (!coup) return false;
  const prise = coup.captured ? VALEURS[coup.captured] : 0;
  const apres = new Position(partie.fen());
  const arrivee = uci.slice(2, 4);
  const defenseurs = apres.attaquants(arrivee, piece.color);
  let attaquants = apres.attaquants(arrivee, piece.color === "w" ? "b" : "w").map((c) => apres.piece(c).type);
  if (defenseurs.length) attaquants = attaquants.filter((t) => t !== "k"); // le roi ne prend pas une pièce défendue
  if (!attaquants.length) return false;
  const valeur = VALEURS[piece.type];
  const risque = defenseurs.length
    ? valeur - Math.min(...attaquants.map((t) => VALEURS[t])) - prise
    : valeur - prise;
  return risque >= SACRIFICE_MINIMUM;
}
