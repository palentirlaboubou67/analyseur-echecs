// Faits concrets tirés d'une position ou d'une ligne de Stockfish.
//
// Règle d'or : ne rien affirmer qui ne soit pas vérifiable.
// - Les faits « statiques » (pièce attaquée et non défendue, clouage, fourchette) sont lus sur
//   l'échiquier : ils sont vrais par construction.
// - Les gains de matériel ne sont annoncés que le long d'une ligne calculée par Stockfish, et
//   seulement si l'évaluation du moteur au bout de la ligne les confirme (sinon il y a une
//   compensation qu'on ne sait pas expliquer, et on se tait).

import { Chess, NOMS, Position, VALEURS, adversaire, jouerUci } from "../echecs.js";

const NOMBRES = { 2: "deux", 3: "trois", 4: "quatre", 5: "cinq" };
const MARGE_COHERENCE = 150; // centipions tolérés entre matériel gagné et évaluation du moteur
// Un gain n'est attribué au premier coup que si le camp capture vite (au plus tard à son 2e coup) :
// un gain qui n'arrive que loin dans la ligne dépend surtout des choix de l'adversaire.
const DERNIER_DEMI_COUP_DE_PRISE = 2;
const DEMI_COUPS_MAX = 8;

// --- Petites briques de texte ----------------------------------------------------

export const nomPiece = (t) => `${NOMS[t][1]} ${NOMS[t][0]}`;
export const pieceEn = (t, sq) => `${nomPiece(t)} en ${sq}`;
export const aPieceEn = (t, sq) => `${NOMS[t][1] === "le" ? "au" : "à la"} ${NOMS[t][0]} en ${sq}`;
export const accord = (t) => (NOMS[t][4] ? "e" : "");

function compter(liste) {
  const c = {};
  for (const t of liste) c[t] = (c[t] ?? 0) + 1;
  return c;
}

function lister(compte) {
  const morceaux = Object.entries(compte)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => VALEURS[b] - VALEURS[a])
    .map(([t, n]) => (n === 1 ? `${NOMS[t][2]} ${NOMS[t][0]}` : `${NOMBRES[n] ?? n} ${NOMS[t][3]}`));
  if (morceaux.length > 1) return `${morceaux.slice(0, -1).join(", ")} et ${morceaux.at(-1)}`;
  return morceaux[0] ?? "du matériel";
}

/** Matériel gagné net, en mots : 'un cavalier', 'deux pions', 'une dame contre une tour'... */
export function decrireMateriel(gagnes, perdus) {
  const g = compter(gagnes), p = compter(perdus);
  for (const t of Object.keys(g)) {
    const commun = Math.min(g[t], p[t] ?? 0);
    g[t] -= commun;
    if (p[t]) p[t] -= commun;
  }
  // Un cavalier vaut un fou : on les compense entre eux.
  const mineures = (c) => (c.n ?? 0) + (c.b ?? 0);
  while (mineures(g) && mineures(p)) {
    g[(g.n ?? 0) > 0 ? "n" : "b"] -= 1;
    p[(p.n ?? 0) > 0 ? "n" : "b"] -= 1;
  }
  const typesG = Object.keys(g).filter((t) => g[t] > 0);
  const typesP = Object.keys(p).filter((t) => p[t] > 0);
  const total = (c) => Object.entries(c).reduce((s, [t, n]) => s + n, 0);
  if (!typesG.length) return "";
  if (typesG.length === 1 && typesG[0] === "r" && g.r === 1 && total(p) === 1 && typesP.every((t) => t === "n" || t === "b")) {
    return "la qualité (une tour contre une pièce mineure)";
  }
  if (typesG.length === 1 && !typesP.length) return lister(g);
  if (total(g) === 1 && total(p) === 1) return `${lister(g)} contre ${lister(p)}`;
  const net = Object.entries(g).reduce((s, [t, n]) => s + VALEURS[t] * n, 0)
    - Object.entries(p).reduce((s, [t, n]) => s + VALEURS[t] * n, 0);
  return net > 1 ? `du matériel (l'équivalent de ${NOMBRES[net] ?? net} pions)` : "un pion";
}

/** ['Nf3', 'Nc6'] depuis une FEN où les Blancs jouent au coup 2 -> '2. Nf3 Nc6'. */
export function numeroter(fen, sans, maximum = 6) {
  const [, trait, , , , numero] = fen.split(" ");
  let n = Number(numero) || 1, blancs = trait === "w";
  const morceaux = [];
  sans.slice(0, maximum).forEach((san, i) => {
    if (blancs) morceaux.push(`${n}. ${san}`);
    else {
      morceaux.push(i === 0 ? `${n}… ${san}` : san);
      n += 1;
    }
    blancs = !blancs;
  });
  return morceaux.join(" ");
}

/** Évaluation en centipions du point de vue de `couleur` ('w'/'b'), un mat valant ±100 000. */
export function evalPour(ev, couleur) {
  let blanc;
  if (ev.type === "mat") {
    if (ev.valeur === 0) blanc = ev.vainqueur === "blancs" ? 100000 : -100000;
    else blanc = ev.valeur > 0 ? 100000 : -100000;
  } else blanc = ev.valeur;
  return couleur === "w" ? blanc : -blanc;
}

/** Nombre de coups avant le mat si `couleur` mate, sinon null. */
export function matPour(ev, couleur) {
  if (ev.type !== "mat" || ev.valeur === 0) return null;
  const v = couleur === "w" ? ev.valeur : -ev.valeur;
  return v > 0 ? v : null;
}

// --- Faits statiques ---------------------------------------------------------------

/** Pièces (hors pions et roi) de `couleur` attaquées et non défendues ou attaquées par moins cher. */
export function piecesEnPrise(position, couleur) {
  const resultat = [];
  for (const [sq, piece] of position.pieces) {
    if (piece.color !== couleur || piece.type === "p" || piece.type === "k") continue;
    const attaquants = position.attaquants(sq, adversaire(couleur));
    if (!attaquants.length) continue;
    const defenseurs = position.attaquants(sq, couleur);
    const moinsCher = Math.min(...attaquants.map((a) => VALEURS[position.piece(a).type] || 100));
    if (!defenseurs.length || moinsCher < VALEURS[piece.type]) resultat.push([piece.type, sq]);
  }
  return resultat;
}

const contient = (liste, [t, sq]) => liste.some(([t2, sq2]) => t2 === t && sq2 === sq);
export { contient };

/**
 * Le motif tactique le plus marquant créé par un coup, lu sur l'échiquier.
 * -> {type: mat|fourchette|clouage|decouverte|prise_gratuite|echec, piece, case, cibles} ou null
 */
export function tactiqueDuCoup(fen, uci) {
  const partie = new Chess(fen);
  const avant = new Position(fen);
  const coup = jouerUci(partie, uci);
  if (!coup) return null;
  const camp = coup.color;
  const apres = new Position(partie.fen());
  const arrivee = coup.to;
  const typeJoue = coup.promotion ?? coup.piece;

  if (partie.isCheckmate()) return { type: "mat", piece: typeJoue, case: arrivee, cibles: [] };

  // Fourchette : la pièce jouée attaque au moins deux cibles intéressantes (roi, pièce plus chère
  // qu'elle, ou pièce non défendue) et ne se fait pas prendre aussitôt. Les pions ne comptent pas.
  const cibles = [];
  for (const sq of apres.attaquesDe(arrivee)) {
    const cible = apres.piece(sq);
    if (!cible || cible.color === camp || cible.type === "p") continue;
    if (cible.type === "k" || VALEURS[cible.type] > VALEURS[typeJoue] || !apres.attaquants(sq, cible.color).length) {
      cibles.push([cible.type, sq]);
    }
  }
  if (cibles.length >= 2 && !contient(piecesEnPrise(apres, camp), [typeJoue, arrivee])) {
    return { type: "fourchette", piece: typeJoue, case: arrivee, cibles };
  }

  // Clouage : une pièce adverse (au moins une pièce mineure) ne peut plus bouger sans exposer son roi.
  for (const [sq, cible] of apres.pieces) {
    if (cible.color !== camp && cible.type !== "k" && VALEURS[cible.type] >= 3 && apres.cloueur(sq) === arrivee) {
      return { type: "clouage", piece: typeJoue, case: arrivee, cibles: [[cible.type, sq]] };
    }
  }

  // Attaque à la découverte : une AUTRE pièce du camp attaque maintenant le roi ou la dame adverse.
  if (!coup.isKingsideCastle() && !coup.isQueensideCastle()) {
    for (const [sq, autre] of apres.pieces) {
      if (autre.color !== camp || sq === arrivee) continue;
      const avantAttaques = avant.piece(sq) ? avant.attaquesDe(sq) : [];
      for (const cibleSq of apres.attaquesDe(sq)) {
        if (avantAttaques.includes(cibleSq)) continue;
        const cible = apres.piece(cibleSq);
        if (cible && cible.color !== camp && (cible.type === "k" || cible.type === "q")) {
          return { type: "decouverte", piece: autre.type, case: sq, cibles: [[cible.type, cibleSq]] };
        }
      }
    }
  }

  if (coup.captured && coup.captured !== "p" && !avant.attaquants(arrivee, adversaire(camp)).length) {
    return { type: "prise_gratuite", piece: coup.captured, case: arrivee, cibles: [] };
  }
  if (partie.inCheck()) return { type: "echec", piece: typeJoue, case: arrivee, cibles: [] };
  return null;
}

/**
 * Ce que rapporte une ligne {uci, san, eval} au camp qui a le trait dans `fen`.
 * `precedent` = {fen, uci} : coup adverse qui vient d'être joué, compté dans l'échange
 * (reprendre une pièce qu'on vient de perdre n'est pas un gain).
 * La ligne est coupée dès que les échanges sont finis (deux demi-coups sans prise).
 */
export function bilanLigne(fen, ligne, precedent = null) {
  const partie = new Chess(fen);
  const camp = partie.turn();
  const gagnes = [], perdus = [];
  const promotions = { camp: 0, adverse: 0 };
  let dernierePrise = null, premierePriseCamp = null, prisePrecedente = null;

  if (precedent) {
    const coupPrecedent = jouerUci(new Chess(precedent.fen), precedent.uci);
    prisePrecedente = coupPrecedent?.captured ?? null;
    if (prisePrecedente) {
      perdus.push(prisePrecedente);
      dernierePrise = -1;
    }
  }

  const ucis = ligne.uci.slice(0, DEMI_COUPS_MAX);
  for (let i = 0; i < ucis.length; i++) {
    const coup = jouerUci(partie, ucis[i]);
    if (!coup) break;
    const parLeCamp = coup.color === camp;
    if (coup.captured || coup.promotion) {
      dernierePrise = i;
      if (parLeCamp && premierePriseCamp === null) premierePriseCamp = i;
    }
    if (coup.captured) (parLeCamp ? gagnes : perdus).push(coup.captured);
    if (coup.promotion) promotions[parLeCamp ? "camp" : "adverse"] += VALEURS[coup.promotion] - 1;
    if ((dernierePrise === null && i >= 3) || (dernierePrise !== null && i - dernierePrise >= 2)) break;
  }

  const somme = (l) => l.reduce((s, t) => s + VALEURS[t], 0);
  const net = somme(gagnes) + promotions.camp - somme(perdus) - promotions.adverse;
  // Le moteur confirme-t-il ? Son éval au bout de la ligne doit refléter le matériel qu'on aura.
  const position = new Position(partie.fen());
  const ecart = position.materiel(camp) - position.materiel(adversaire(camp));
  const confirme = net >= 1 && premierePriseCamp !== null && premierePriseCamp <= DERNIER_DEMI_COUP_DE_PRISE
    && evalPour(ligne.eval, camp) >= ecart * 100 - MARGE_COHERENCE;

  let description = null;
  if (confirme) {
    description = decrireMateriel(gagnes, perdus) || null;
    if (promotions.camp) description = description ? `${description} et une promotion` : "une promotion (un pion devient dame)";
  }

  const premier = ligne.uci[0];
  let reprise = null;
  if (prisePrecedente && premier.slice(2, 4) === precedent.uci.slice(2, 4)) {
    reprise = jouerUci(new Chess(fen), premier)?.captured ?? null;
  }
  let tactique = tactiqueDuCoup(fen, premier);
  if (tactique?.type === "prise_gratuite" && reprise) tactique = null; // reprendre n'est pas « gratuit »
  return {
    sans: ligne.san,
    mat: matPour(ligne.eval, camp),
    gain: confirme ? net : 0,
    materielGagne: description,
    tactique,
    reprise,
  };
}

// --- Principes d'ouverture -------------------------------------------------------------

/** 'roque' | 'developpement' | 'centre' | 'dame_tot' | 'roi' pour les 10 premiers coups, sinon null. */
export function ideeOuverture(fen, uci) {
  const numero = Number(fen.split(" ")[5]) || 1;
  if (numero > 10) return null;
  const partie = new Chess(fen);
  const coup = jouerUci(partie, uci);
  if (!coup) return null;
  if (coup.isKingsideCastle() || coup.isQueensideCastle()) return "roque";
  const rangeeDepart = coup.color === "w" ? "1" : "8";
  if ((coup.piece === "n" || coup.piece === "b") && coup.from[1] === rangeeDepart) return "developpement";
  const rangeePions = coup.color === "w" ? "2" : "7";
  if (coup.piece === "p" && coup.from[1] === rangeePions && ["d4", "e4", "d5", "e5"].includes(coup.to)) return "centre";
  if (coup.piece === "q" && numero <= 6) return "dame_tot";
  if (coup.piece === "k") return "roi";
  return null;
}
