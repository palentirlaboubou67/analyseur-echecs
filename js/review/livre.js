// Repérage des coups de livre (théorie des ouvertures) dans une partie analysée.

import { FEN_DEPART } from "../echecs.js";
import { resumer } from "../moteur/analyse.js";
import { SEUIL_BON } from "./classification.js";

/**
 * Copie de l'analyse où les coups de théorie sont classés « livre ».
 * Un coup est de livre tant que toutes les positions depuis le début sont dans la base.
 * Garde-fou : un coup de théorie qui perd plus de 5 % (gambit douteux) garde sa vraie classification.
 */
export function marquerLivre(partie, analyse, base) {
  const resultat = structuredClone(analyse);
  let enLivre = partie.fen_depart === FEN_DEPART; // la base ne part que de la position initiale
  let nom = null;
  partie.coups.forEach((coup, k) => {
    const info = resultat.coups[k];
    enLivre = enLivre && base.estLivre(coup.fen);
    if (enLivre) {
      const ouverture = base.nomPosition(coup.fen);
      if (ouverture) nom = { eco: ouverture.eco, nom: ouverture.nom, nom_fr: ouverture.nom_fr };
      if (info.perte <= SEUIL_BON) info.classification = "livre";
    }
    info.ouverture = nom?.nom_fr ?? null;
  });
  resultat.ouverture = nom;
  resultat.resume = resumer(partie, resultat.positions, resultat.coups);
  return resultat;
}
