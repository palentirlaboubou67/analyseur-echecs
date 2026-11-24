// Outils d'échecs communs : chess.js pour les règles (coups légaux, SAN, mats…) et une petite
// géométrie maison pour ce que chess.js ne donne pas (cases attaquées par une pièce, clouages).

import { Chess } from "../vendor/chess.js";

export { Chess };

export const FEN_DEPART = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const VALEURS = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// nom, article défini, article indéfini, pluriel, féminin
export const NOMS = {
  p: ["pion", "le", "un", "pions", false],
  n: ["cavalier", "le", "un", "cavaliers", false],
  b: ["fou", "le", "un", "fous", false],
  r: ["tour", "la", "une", "tours", true],
  q: ["dame", "la", "une", "dames", true],
  k: ["roi", "le", "le", "rois", false],
};

/** Clé d'une position : pièces, trait et roques (on ignore la case en passant et les compteurs). */
export function cle(fen) {
  return fen.split(" ").slice(0, 3).join(" ");
}

export const adversaire = (couleur) => (couleur === "w" ? "b" : "w");
export const couleurFr = (couleur) => (couleur === "w" ? "blancs" : "noirs");

/** Joue un coup UCI ("e2e4", "e7e8q") ; renvoie le Move de chess.js ou null s'il est illégal. */
export function jouerUci(partie, uci) {
  try {
    return partie.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

export function uciDe(coup) {
  return coup.from + coup.to + (coup.promotion ?? "");
}

/** SAN d'une suite de coups UCI depuis une FEN (s'arrête au premier coup illégal). */
export function sansDepuis(fen, ucis) {
  const partie = new Chess(fen);
  const sans = [];
  for (const uci of ucis) {
    const coup = jouerUci(partie, uci);
    if (!coup) break;
    sans.push(coup.san);
  }
  return sans;
}

/** Pièce prise par un coup UCI (type chess.js : 'p', 'n'...), ou null. */
export function piecePrise(fen, uci) {
  const coup = jouerUci(new Chess(fen), uci);
  return coup?.captured ?? null;
}

// --- Géométrie ---------------------------------------------------------------------------

const COLONNES = "abcdefgh";
export const nomCase = (c, r) => COLONNES[c] + (r + 1);
const coordonnees = (sq) => [COLONNES.indexOf(sq[0]), Number(sq[1]) - 1];

const DIAGONALES = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const DROITES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SAUTS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const AUTOUR = [...DIAGONALES, ...DROITES];

/** Vue « géométrique » d'une position : pièces par case, attaques, clouages. */
export class Position {
  constructor(fen) {
    this.fen = fen;
    this.trait = fen.split(" ")[1];
    this.pieces = new Map(); // "e4" -> {type, color}
    fen.split(" ")[0].split("/").forEach((rangee, i) => {
      let c = 0;
      for (const ch of rangee) {
        if (/\d/.test(ch)) c += Number(ch);
        else {
          this.pieces.set(nomCase(c, 7 - i), { type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? "w" : "b" });
          c += 1;
        }
      }
    });
  }

  piece(sq) {
    return this.pieces.get(sq) ?? null;
  }

  /** Cases attaquées par la pièce posée en `sq` (les pièces à longue portée s'arrêtent au premier obstacle). */
  attaquesDe(sq) {
    const piece = this.piece(sq);
    if (!piece) return [];
    const [c, r] = coordonnees(sq);
    const cases = [];
    const ajouter = (dc, dr) => {
      const nc = c + dc, nr = r + dr;
      if (nc >= 0 && nc < 8 && nr >= 0 && nr < 8) cases.push(nomCase(nc, nr));
    };
    const glisser = (directions) => {
      for (const [dc, dr] of directions) {
        let nc = c + dc, nr = r + dr;
        while (nc >= 0 && nc < 8 && nr >= 0 && nr < 8) {
          const cible = nomCase(nc, nr);
          cases.push(cible);
          if (this.pieces.has(cible)) break;
          nc += dc;
          nr += dr;
        }
      }
    };
    switch (piece.type) {
      case "p": {
        const sens = piece.color === "w" ? 1 : -1;
        ajouter(1, sens);
        ajouter(-1, sens);
        break;
      }
      case "n": SAUTS.forEach(([dc, dr]) => ajouter(dc, dr)); break;
      case "k": AUTOUR.forEach(([dc, dr]) => ajouter(dc, dr)); break;
      case "b": glisser(DIAGONALES); break;
      case "r": glisser(DROITES); break;
      case "q": glisser(AUTOUR); break;
    }
    return cases;
  }

  /** Cases des pièces de `couleur` qui attaquent `sq`. */
  attaquants(sq, couleur) {
    const resultat = [];
    for (const [case_, piece] of this.pieces) {
      if (piece.color === couleur && this.attaquesDe(case_).includes(sq)) resultat.push(case_);
    }
    return resultat;
  }

  roi(couleur) {
    for (const [sq, p] of this.pieces) if (p.type === "k" && p.color === couleur) return sq;
    return null;
  }

  /** Si la pièce en `sq` est clouée contre son roi, renvoie la case de la pièce qui la cloue. */
  cloueur(sq) {
    const piece = this.piece(sq);
    if (!piece || piece.type === "k") return null;
    const roi = this.roi(piece.color);
    if (!roi) return null;
    const [rc, rr] = coordonnees(roi);
    const [pc, pr] = coordonnees(sq);
    const dc = Math.sign(pc - rc), dr = Math.sign(pr - rr);
    const aligne = (pc - rc === 0 || pr - rr === 0 || Math.abs(pc - rc) === Math.abs(pr - rr));
    if (!aligne) return null;
    // Rien entre le roi et la pièce…
    let c = rc + dc, r = rr + dr;
    while (c !== pc || r !== pr) {
      if (this.pieces.has(nomCase(c, r))) return null;
      c += dc;
      r += dr;
    }
    // … et derrière elle, une pièce adverse à longue portée qui agit dans cette direction.
    const diagonale = dc !== 0 && dr !== 0;
    c = pc + dc;
    r = pr + dr;
    while (c >= 0 && c < 8 && r >= 0 && r < 8) {
      const autre = this.piece(nomCase(c, r));
      if (autre) {
        const glisse = autre.type === "q" || (diagonale ? autre.type === "b" : autre.type === "r");
        return autre.color !== piece.color && glisse ? nomCase(c, r) : null;
      }
      c += dc;
      r += dr;
    }
    return null;
  }

  materiel(couleur) {
    let total = 0;
    for (const p of this.pieces.values()) if (p.color === couleur) total += VALEURS[p.type];
    return total;
  }
}
