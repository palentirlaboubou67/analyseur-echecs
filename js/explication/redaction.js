// Rédaction des explications de chaque coup, en français simple (joueur ~800 Elo).
//
// Aucune IA : des phrases modèles remplies avec les faits de `faits.js` et les lignes de Stockfish.
// Une phrase n'est produite que si le fait qu'elle énonce est établi ; sinon on se rabat sur une
// formulation prudente (« Stockfish recommandait… »).

import { Chess, Position, VALEURS, adversaire, jouerUci } from "../echecs.js";
import {
  aPieceEn, accord, bilanLigne, contient, ideeOuverture, nomPiece, numeroter, pieceEn, piecesEnPrise,
} from "./faits.js";

const BONNES = new Set(["brillant", "meilleur", "excellent", "bon", "livre"]);
const LONGUEUR = 6; // demi-coups montrés dans une ligne

const PHRASES_OUVERTURE_BONNES = {
  roque: "Le roque met le roi à l'abri et fait entrer la tour dans le jeu.",
  developpement: "Ce coup sort {piece} : en ouverture, on développe ses pièces vite.",
  centre: "Ce pion prend sa place au centre de l'échiquier.",
};
const PHRASES_OUVERTURE_MAUVAISES = {
  dame_tot: "Sortir la dame très tôt fait souvent perdre du temps : elle se fait chasser par les pièces adverses.",
  roi: "Le roi bouge et perd le droit de roquer : il sera plus difficile à mettre à l'abri.",
};
const IDEES_MEILLEUR = {
  roque: "mettait le roi à l'abri en roquant",
  developpement: "développait {piece}",
  centre: "occupait le centre",
};

const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export function phraseTactique(t) {
  if (!t) return [];
  if (t.type === "fourchette") {
    const cibles = t.cibles.slice(0, 3).map(([type, sq]) => `${nomPiece(type)} en ${sq}`).join(" et ");
    return [`C'est une fourchette : ${pieceEn(t.piece, t.case)} attaque ${cibles} en même temps.`];
  }
  if (t.type === "clouage") {
    const [type, sq] = t.cibles[0];
    return [`C'est un clouage : ${pieceEn(type, sq)} ne peut plus bouger sans exposer son roi ${aPieceEn(t.piece, t.case)}.`];
  }
  if (t.type === "decouverte") {
    const [type] = t.cibles[0];
    if (type === "k") return [`C'est un échec à la découverte : la pièce qui bouge libère ${pieceEn(t.piece, t.case)}.`];
    return [`C'est une attaque à la découverte : la pièce qui bouge libère ${pieceEn(t.piece, t.case)}, qui attaque ${nomPiece(type)}.`];
  }
  if (t.type === "prise_gratuite") return [`${majuscule(pieceEn(t.piece, t.case))} n'était pas défendu${accord(t.piece)}.`];
  return [];
}

/**
 * Phrases expliquant un coup.
 * fen : position avant le coup ; positionAvant/Apres : {lignes} de Stockfish ;
 * info : {classification, gain_avant, gain_apres, ouverture?} ; precedent : {fen, uci} du coup adverse précédent.
 */
export function expliquerCoup(fen, uci, san, positionAvant, positionApres, info, infoPrecedent = null, precedent = null) {
  const partie = new Chess(fen);
  if (!jouerUci(partie, uci)) return [];
  if (partie.isCheckmate()) return ["Échec et mat ! La partie est terminée."];

  const lignes = positionAvant.lignes ?? [];
  const reponse = positionApres?.lignes?.[0] ?? null;
  // Ligne du coup joué : celle de Stockfish si elle fait partie de ses lignes,
  // sinon le coup joué suivi de la meilleure réponse adverse.
  let ligneJouee = lignes.find((l) => l.uci[0] === uci) ?? null;
  if (!ligneJouee && reponse) ligneJouee = { uci: [uci, ...reponse.uci], san: [san, ...reponse.san], eval: reponse.eval };

  const ctx = new Contexte(fen, partie.fen(), uci, info, infoPrecedent, lignes[0] ?? null, reponse, ligneJouee, precedent);
  return BONNES.has(info.classification) ? ctx.bonCoup() : ctx.mauvaisCoup();
}

class Contexte {
  constructor(fen, fenApres, uci, info, infoPrecedent, meilleure, reponse, ligneJouee, precedent) {
    Object.assign(this, { fen, fenApres, uci, info, infoPrecedent, meilleure, reponse, ligneJouee, precedent });
    this.plateau = new Position(fen);
    this.apres = new Position(fenApres);
    this.camp = this.plateau.trait;
    this.piece = this.plateau.piece(uci.slice(0, 2)).type;
    this.depart = uci.slice(0, 2);
    this.arrivee = uci.slice(2, 4);
  }

  bilanDepuisIci(ligne) {
    return bilanLigne(this.fen, ligne, this.precedent);
  }

  // --- Bons coups -----------------------------------------------------------------

  bonCoup() {
    const categorie = this.info.classification;
    if (categorie === "livre") {
      const o = this.info.ouverture;
      return [o ? `Un coup connu de la théorie des ouvertures (${o}).` : "Un coup connu de la théorie des ouvertures."];
    }
    const phrases = [];
    const bilan = this.ligneJouee ? this.bilanDepuisIci(this.ligneJouee) : null;
    const punit = this.infoPrecedent && ["erreur", "gaffe", "manquee"].includes(this.infoPrecedent.classification);

    if (categorie === "brillant") {
      phrases.push(`Un sacrifice ! ${majuscule(pieceEn(this.piece, this.arrivee))} reste en prise, mais Stockfish confirme que c'est le meilleur choix.`);
    }
    if (bilan?.mat) {
      phrases.push(`Ce coup mène à un mat en ${bilan.mat} : ${numeroter(this.fen, bilan.sans, 2 * bilan.mat - 1)}.`);
    } else if (bilan?.gain) {
      const debut = punit ? "Bien vu ! Ce coup punit l'erreur adverse et gagne" : "Ce coup gagne";
      phrases.push(`${debut} ${bilan.materielGagne} : ${numeroter(this.fen, bilan.sans, LONGUEUR)}.`);
      phrases.push(...phraseTactique(bilan.tactique));
    } else if (bilan?.reprise) {
      phrases.push(`Ce coup reprend ${pieceEn(bilan.reprise, this.arrivee)}.`);
    } else if (categorie !== "brillant") {
      phrases.push(...this.ideeDuCoup(bilan?.tactique ?? null));
    }

    if ((categorie === "excellent" || categorie === "bon") && this.meilleure) phrases.push(this.comparaisonMeilleur());
    if (!phrases.length) phrases.push("C'était le meilleur coup selon Stockfish.");
    return phrases;
  }

  ideeDuCoup(tactique) {
    const menaceesAvant = piecesEnPrise(this.plateau, this.camp);
    const menaceesApres = piecesEnPrise(this.apres, this.camp);
    if (contient(menaceesAvant, [this.piece, this.depart]) && !contient(menaceesApres, [this.piece, this.arrivee])) {
      return [`Ce coup met à l'abri ${pieceEn(this.piece, this.depart)}, qui était attaqué${accord(this.piece)}.`];
    }
    const protegees = menaceesAvant.filter((p) => p[1] !== this.depart && !contient(menaceesApres, p) && this.apres.piece(p[1]));
    if (protegees.length) {
      const [type, sq] = protegees[0];
      return [`Ce coup protège ${pieceEn(type, sq)}, qui était attaqué${accord(type)}.`];
    }
    if (tactique && ["fourchette", "clouage", "decouverte"].includes(tactique.type)) return phraseTactique(tactique);

    const cibles = piecesEnPrise(this.apres, adversaire(this.camp))
      .filter(([, sq]) => this.apres.attaquants(sq, this.camp).includes(this.arrivee));
    if (cibles.length) {
      const [type, sq] = cibles[0];
      return [`Ce coup attaque ${pieceEn(type, sq)}, qui va devoir être protégé${accord(type)} ou déplacé${accord(type)}.`];
    }
    const idee = ideeOuverture(this.fen, this.uci);
    if (PHRASES_OUVERTURE_BONNES[idee]) return [PHRASES_OUVERTURE_BONNES[idee].replace("{piece}", nomPiece(this.piece))];
    if (tactique?.type === "echec") return ["Ce coup donne échec et oblige l'adversaire à répondre."];
    return [];
  }

  comparaisonMeilleur() {
    const meilleurSan = this.meilleure.san[0];
    const bilan = this.bilanDepuisIci(this.meilleure);
    if (bilan.mat) return `Mais il y avait mieux : ${meilleurSan} menait à un mat en ${bilan.mat}.`;
    if (bilan.gain) return `Stockfish préférait ${meilleurSan}, qui gagnait ${bilan.materielGagne}.`;
    if (this.info.classification === "excellent") return `Presque aussi fort que le choix de Stockfish, ${meilleurSan}.`;
    return `Correct, mais Stockfish préférait ${meilleurSan} (${numeroter(this.fen, this.meilleure.san, 4)}).`;
  }

  // --- Coups imprécis, erreurs, gaffes ------------------------------------------------

  mauvaisCoup() {
    const phrases = [];
    // La réponse adverse, en comptant notre coup dans l'échange (s'il prenait quelque chose).
    const bilanReponse = this.reponse ? bilanLigne(this.fenApres, this.reponse, { fen: this.fen, uci: this.uci }) : null;

    // 1. Ce que le coup permet à l'adversaire.
    if (bilanReponse?.mat) {
      phrases.push(bilanReponse.mat === 1
        ? `Ce coup permet un mat immédiat : ${numeroter(this.fenApres, bilanReponse.sans, 1)}.`
        : `Ce coup permet à l'adversaire de mater en ${bilanReponse.mat} : ${numeroter(this.fenApres, bilanReponse.sans, 2 * bilanReponse.mat - 1)}.`);
    } else if (bilanReponse?.gain) {
      phrases.push(`Après ce coup, l'adversaire gagne ${bilanReponse.materielGagne} : ${numeroter(this.fenApres, bilanReponse.sans, LONGUEUR)}.`);
      const tactique = phraseTactique(bilanReponse.tactique);
      phrases.push(...(tactique.length ? tactique : this.pieceLaisseeEnPrise()));
    } else {
      const tactique = bilanReponse?.tactique;
      if (tactique && ["fourchette", "clouage", "decouverte"].includes(tactique.type)) {
        phrases.push(`L'adversaire peut répondre ${this.reponse.san[0]}.`, ...phraseTactique(tactique));
      } else {
        phrases.push(this.phraseGenerale());
      }
      const idee = ideeOuverture(this.fen, this.uci);
      if (PHRASES_OUVERTURE_MAUVAISES[idee]) phrases.push(PHRASES_OUVERTURE_MAUVAISES[idee]);
    }

    // 2. Ce qu'il fallait jouer, et pourquoi.
    if (this.meilleure) phrases.push(this.phraseMeilleur(bilanReponse));
    return phrases;
  }

  phraseGenerale() {
    const avant = this.info.gain_avant, apres = this.info.gain_apres;
    if (avant >= 60 && apres < 60) return "Ce coup laisse filer l'avantage.";
    if (apres < 40 && avant >= 40) return "Ce coup donne l'avantage à l'adversaire.";
    return "Ce n'est pas le coup le plus précis.";
  }

  pieceLaisseeEnPrise() {
    const premier = this.reponse.uci[0];
    const prise = jouerUci(new Chess(this.fenApres), premier)?.captured;
    if (!prise || prise === "p") return [];
    const sq = premier.slice(2, 4);
    if (!contient(piecesEnPrise(this.apres, this.camp), [prise, sq])) return [];
    if (!this.apres.attaquants(sq, this.camp).length) return [`${majuscule(pieceEn(prise, sq))} n'était pas défendu${accord(prise)}.`];
    return [`${majuscule(pieceEn(prise, sq))} était attaqué${accord(prise)} par une pièce moins chère.`];
  }

  phraseMeilleur(bilanReponse) {
    const meilleurUci = this.meilleure.uci[0];
    const meilleurSan = this.meilleure.san[0];
    const bilan = this.bilanDepuisIci(this.meilleure);
    const intro = this.info.classification === "manquee" ? "L'adversaire venait de se tromper : " : "";

    if (bilan.mat) return `${intro}Il y avait un mat en ${bilan.mat} : ${numeroter(this.fen, bilan.sans, 2 * bilan.mat - 1)}.`;
    if (bilan.gain) {
      const phrase = `${intro}Il fallait jouer ${meilleurSan}, qui gagnait ${bilan.materielGagne} : ${numeroter(this.fen, bilan.sans, LONGUEUR)}.`;
      const tactique = phraseTactique(bilan.tactique);
      return tactique.length ? `${phrase} ${tactique[0]}` : phrase;
    }
    if (bilan.reprise && this.arrivee !== meilleurUci.slice(2, 4)) {
      return `Il fallait reprendre ${pieceEn(bilan.reprise, meilleurUci.slice(2, 4))} avec ${meilleurSan} : sans cela, l'adversaire garde ce qu'il vient de prendre.`;
    }
    if (bilanReponse?.mat) return `Il fallait jouer ${meilleurSan}, qui évitait ce mat.`;
    const sauvee = this.pieceSauveePar(meilleurUci);
    if (sauvee) return `Il fallait jouer ${meilleurSan}, qui ${sauvee}.`;
    if (bilanReponse?.gain) return `Il fallait jouer ${meilleurSan} pour ne rien perdre (${numeroter(this.fen, this.meilleure.san, 4)}).`;

    const idee = ideeOuverture(this.fen, meilleurUci);
    if (IDEES_MEILLEUR[idee]) {
      const piece = this.plateau.piece(meilleurUci.slice(0, 2)).type;
      return `${intro}Il fallait plutôt jouer ${meilleurSan}, qui ${IDEES_MEILLEUR[idee].replace("{piece}", nomPiece(piece))}.`;
    }
    const avant = this.info.gain_avant;
    const but = avant >= 60 ? "gardait l'avantage" : avant >= 40 ? "gardait l'équilibre" : "limitait les dégâts";
    return `${intro}Stockfish recommandait ${meilleurSan} (${numeroter(this.fen, this.meilleure.san, 4)}), qui ${but}.`;
  }

  /** Si la réponse adverse prenait une de nos pièces et que le meilleur coup l'évitait. */
  pieceSauveePar(meilleurUci) {
    if (!this.reponse) return null;
    const premier = this.reponse.uci[0];
    const prise = jouerUci(new Chess(this.fenApres), premier)?.captured;
    if (!prise || VALEURS[prise] < 3) return null;
    const sq = premier.slice(2, 4);
    const partie = new Chess(this.fen);
    if (!jouerUci(partie, meilleurUci)) return null;
    const apresMeilleur = new Position(partie.fen());
    if (meilleurUci.slice(0, 2) === sq && !contient(piecesEnPrise(apresMeilleur, this.camp), [prise, meilleurUci.slice(2, 4)])) {
      return `mettait ${pieceEn(prise, sq)} à l'abri`;
    }
    const piece = apresMeilleur.piece(sq);
    if (piece && piece.color === this.camp && !contient(piecesEnPrise(apresMeilleur, this.camp), [prise, sq])) {
      return `protégeait ${pieceEn(prise, sq)}`;
    }
    return null;
  }
}

/** Une liste de phrases par coup d'une partie analysée (jamais d'exception). */
export function expliquerPartie(partie, analyse) {
  const fens = [partie.fen_depart, ...partie.coups.map((c) => c.fen)];
  return partie.coups.map((coup, k) => {
    try {
      return expliquerCoup(fens[k], coup.uci, coup.san, analyse.positions[k], analyse.positions[k + 1],
        analyse.coups[k], k ? analyse.coups[k - 1] : null, k ? { fen: fens[k - 1], uci: partie.coups[k - 1].uci } : null);
    } catch {
      return [];
    }
  });
}
