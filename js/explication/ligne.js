// Commentaire coup par coup d'une ligne de Stockfish (« Voir la ligne », comme sur chess.com).
//
// Pas d'IA : chaque phrase vient d'un fait vérifié sur l'échiquier (prise, échec, mat, nombre de
// coups légaux, tactique détectée par faits.js). Pour un mat, l'évaluation « mat en N » de Stockfish
// garantit que la défense ne peut pas l'éviter : on peut donc l'annoncer.

import { Chess, NOMS, jouerUci } from "../echecs.js";
import { nomPiece, tactiqueDuCoup } from "./faits.js";
import { phraseTactique } from "./redaction.js";

const CAMP = { w: "les Blancs", b: "les Noirs" };
const ADJ = { w: "blanc", b: "noir" };
const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Commente une ligne jouée depuis `fen`.
 * ligne : {uci: [...], eval: {type: 'cp'|'mat', valeur (point de vue des Blancs)}}.
 * Renvoie {intro, coups: [{uci, san, fen, numero, couleur, phrases}]} (coupé au premier coup illégal).
 */
export function commenterLigne(fen, ligne) {
  const partie = new Chess(fen);
  const coups = [];
  for (const uci of ligne.uci) {
    const fenAvant = partie.fen();
    const possibles = partie.moves().length;
    const numero = Number(fenAvant.split(" ")[5]);
    const coup = jouerUci(partie, uci);
    if (!coup) break;
    coups.push({
      uci, san: coup.san, fen: partie.fen(), numero, couleur: coup.color,
      phrases: phrasesDuCoup(partie, coup, fenAvant, possibles),
    });
  }
  return { intro: introduction(fen, ligne.eval, coups), coups };
}

function introduction(fen, ev, coups) {
  if (!ev || !coups.length) return "";
  const dernier = coups[coups.length - 1];
  const matFinal = dernier.san.endsWith("#");
  if (ev.type === "mat" && ev.valeur !== 0) {
    const gagnant = ev.valeur > 0 ? "w" : "b";
    const n = Math.abs(ev.valeur);
    const texte = n === 1
      ? `${majuscule(CAMP[gagnant])} matent en un coup.`
      : `${majuscule(CAMP[gagnant])} matent en ${n} coups, quelle que soit la défense ${gagnant === "w" ? "des Noirs" : "des Blancs"}.`;
    return matFinal ? texte : `${texte} (Stockfish ne montre que le début de la ligne.)`;
  }
  if (ev.type === "cp") {
    const pions = ev.valeur / 100;
    if (Math.abs(pions) < 0.5) return "À la fin de la ligne, la position est à peu près équilibrée.";
    const camp = pions > 0 ? "des Blancs" : "des Noirs";
    const ampleur = Math.abs(pions) >= 3 ? "un gros avantage" : Math.abs(pions) >= 1.5 ? "un net avantage" : "un léger avantage";
    return `À la fin de la ligne, Stockfish donne ${ampleur} ${camp} (${pions > 0 ? "+" : "−"}${Math.abs(pions).toFixed(1)}).`;
  }
  return "";
}

function phrasesDuCoup(partie, coup, fenAvant, possibles) {
  const camp = coup.color;
  const autre = camp === "w" ? "b" : "w";
  const phrases = [];

  if (partie.isCheckmate()) {
    phrases.push(`Échec et mat ! ${majuscule(description(coup))}`);
    phrases.push(`Le roi ${ADJ[autre]} est attaqué et n'a plus aucune case pour s'échapper ; rien ne peut s'interposer ni prendre la pièce qui donne échec.`);
    return phrases;
  }

  let phrase = majuscule(description(coup));
  if (partie.inCheck()) {
    phrase += " Échec !";
    const reponses = partie.moves({ verbose: true });
    if (reponses.length === 1) {
      phrase += ` ${majuscule(CAMP[autre])} n'ont qu'un seul coup pour parer l'échec : ${reponses[0].san}.`;
    } else if (reponses.every((r) => r.piece === "k")) {
      phrase += " Le roi est obligé de bouger : aucune pièce ne peut bloquer ni prendre.";
    }
  }
  phrases.push(phrase);

  const tactique = tactiqueDuCoup(fenAvant, coup.from + coup.to + (coup.promotion ?? ""));
  if (tactique && tactique.type !== "echec" && tactique.type !== "mat") phrases.push(...phraseTactique(tactique));
  if (possibles === 1) phrases.push("C'était le seul coup légal.");
  return phrases;
}

/** « la dame prend le fou en f7. », « les Blancs roquent côté roi. », « le pion avance en e4. » */
function description(coup) {
  if (coup.isKingsideCastle()) return `${CAMP[coup.color]} roquent côté roi.`;
  if (coup.isQueensideCastle()) return `${CAMP[coup.color]} roquent côté dame.`;
  const piece = nomPiece(coup.piece);
  let texte;
  if (coup.captured) {
    texte = `${piece} prend ${nomPiece(coup.captured)} en ${coup.to}${coup.isEnPassant() ? " (prise en passant)" : ""}`;
  } else if (coup.piece === "p") {
    texte = `${piece} avance en ${coup.to}`;
  } else {
    texte = `${piece} va en ${coup.to}`;
  }
  if (coup.promotion) texte += ` et devient ${NOMS[coup.promotion][2]} ${NOMS[coup.promotion][0]}`;
  return `${texte}.`;
}
