// Lecture d'un PGN en une structure simple, prête à afficher et à analyser.
// On ne garde que la ligne principale : variantes, commentaires et annotations ($n) sont ignorés,
// sauf les pendules [%clk h:mm:ss] de chess.com.

import { Chess, FEN_DEPART, uciDe } from "../echecs.js";

export class ErreurPGN extends Error {}

const RESULTATS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);

/** Découpe le texte en parties (sur les lignes d'en-tête qui suivent des coups). */
function premierePartie(texte) {
  const lignes = texte.split(/\r?\n/);
  let vuCoups = false, fin = lignes.length, plusieurs = false;
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i].trim();
    if (l.startsWith("[") && vuCoups) {
      fin = i;
      plusieurs = true;
      break;
    }
    if (l && !l.startsWith("[")) vuCoups = true;
  }
  return { texte: lignes.slice(0, fin).join("\n"), plusieurs };
}

/** Jetons du texte des coups : coups SAN, avec la pendule trouvée dans le commentaire qui suit. */
function lireCoups(texte) {
  const jetons = [];
  let i = 0, profondeur = 0;
  while (i < texte.length) {
    const c = texte[i];
    if (c === "{") {
      const fin = texte.indexOf("}", i);
      const commentaire = texte.slice(i + 1, fin < 0 ? texte.length : fin);
      const horloge = commentaire.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
      if (horloge && profondeur === 0 && jetons.length) {
        jetons.at(-1).pendule = Number(horloge[1]) * 3600 + Number(horloge[2]) * 60 + Number(horloge[3]);
      }
      i = fin < 0 ? texte.length : fin + 1;
    } else if (c === ";") {
      const fin = texte.indexOf("\n", i);
      i = fin < 0 ? texte.length : fin + 1;
    } else if (c === "(") { profondeur += 1; i += 1; }
    else if (c === ")") { profondeur = Math.max(0, profondeur - 1); i += 1; }
    else if (/\s/.test(c)) i += 1;
    else {
      let j = i;
      while (j < texte.length && !/[\s{}();]/.test(texte[j])) j += 1;
      const mot = texte.slice(i, j);
      i = j;
      if (profondeur > 0 || mot.startsWith("$") || RESULTATS.has(mot)) continue;
      const san = mot.replace(/^\d+\.+/, "").replace(/[!?]+$/, "");
      if (san && !/^\d+\.*$/.test(san)) jetons.push({ san, pendule: null });
    }
  }
  return jetons;
}

export function lirePgn(texteBrut) {
  if (!texteBrut || !texteBrut.trim()) throw new ErreurPGN("Le PGN est vide.");
  const { texte, plusieurs } = premierePartie(texteBrut.trim());

  const entetes = {};
  const corps = texte.replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm, (_, cle, valeur) => {
    entetes[cle] = valeur.replace(/\\"/g, '"');
    return "";
  });
  if (entetes.Variant && !/^(standard|chess)$/i.test(entetes.Variant)) {
    throw new ErreurPGN("Seules les parties d'échecs classiques sont prises en charge (pas les variantes).");
  }

  let partie;
  try {
    partie = new Chess(entetes.FEN || FEN_DEPART);
  } catch (err) {
    throw new ErreurPGN(`La position de départ (en-tête FEN) est invalide (${err.message}).`);
  }
  const fenDepart = partie.fen();

  const coups = [];
  for (const { san, pendule } of lireCoups(corps)) {
    const couleur = partie.turn() === "w" ? "blancs" : "noirs";
    const numero = partie.moveNumber();
    let coup;
    try {
      coup = partie.move(san, { strict: false });
    } catch {
      throw new ErreurPGN(`Le PGN contient un coup illisible ou illégal (${san}).`);
    }
    coups.push({ ply: coups.length + 1, numero, couleur, san: coup.san, uci: uciDe(coup), fen: partie.fen(), pendule });
  }
  if (!coups.length) throw new ErreurPGN("Aucun coup trouvé dans ce PGN.");

  return {
    entetes,
    fen_depart: fenDepart,
    coups,
    resultat: entetes.Result || "*",
    avertissements: plusieurs ? ["Le texte contenait plusieurs parties : seule la première est affichée."] : [],
  };
}
