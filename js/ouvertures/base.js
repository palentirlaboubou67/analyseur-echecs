// Base d'ouvertures : jeu de données ECO libre de Lichess (CC0), pré-calculé dans
// ressources/ouvertures.json par outils/construire_ouvertures.py.
// Tout est indexé par position, ce qui gère les transpositions.

import { cle } from "../echecs.js";

const URL_DONNEES = new URL("../../ressources/ouvertures.json", import.meta.url);

// Familles traduites en français ; la variante reste en anglais (pas de traduction officielle).
const FAMILLES_FR = {
  "Alekhine Defense": "Défense Alekhine", "Benoni Defense": "Défense Benoni", "Bird Opening": "Ouverture Bird",
  "Bishop's Opening": "Ouverture du fou", "Blackmar-Diemer Gambit": "Gambit Blackmar-Diemer",
  "Bogo-Indian Defense": "Défense bogo-indienne", "Caro-Kann Defense": "Défense Caro-Kann",
  "Catalan Opening": "Ouverture catalane", "Center Game": "Partie du centre", "Dutch Defense": "Défense hollandaise",
  "English Opening": "Ouverture anglaise", "Englund Gambit": "Gambit Englund", "Four Knights Game": "Partie des quatre cavaliers",
  "French Defense": "Défense française", "Grünfeld Defense": "Défense Grünfeld", "Indian Defense": "Défense indienne",
  "Italian Game": "Partie italienne", "King's Gambit": "Gambit du roi", "King's Gambit Accepted": "Gambit du roi accepté",
  "King's Gambit Declined": "Gambit du roi refusé", "King's Indian Attack": "Attaque est-indienne",
  "King's Indian Defense": "Défense est-indienne", "King's Knight Opening": "Ouverture du cavalier roi",
  "King's Pawn Game": "Début du pion roi", "Latvian Gambit": "Gambit letton", "Modern Defense": "Défense moderne",
  "Nimzo-Indian Defense": "Défense nimzo-indienne", "Nimzowitsch Defense": "Défense Nimzowitsch",
  "Petrov's Defense": "Défense Petrov", "Philidor Defense": "Défense Philidor", "Pirc Defense": "Défense Pirc",
  "Ponziani Opening": "Partie Ponziani", "Queen's Gambit": "Gambit dame", "Queen's Gambit Accepted": "Gambit dame accepté",
  "Queen's Gambit Declined": "Gambit dame refusé", "Queen's Indian Defense": "Défense ouest-indienne",
  "Queen's Pawn Game": "Début du pion dame", "Réti Opening": "Ouverture Réti", "Ruy Lopez": "Partie espagnole",
  "Scandinavian Defense": "Défense scandinave", "Scotch Game": "Partie écossaise", "Semi-Slav Defense": "Défense semi-slave",
  "Sicilian Defense": "Défense sicilienne", "Slav Defense": "Défense slave", "Tarrasch Defense": "Défense Tarrasch",
  "Vienna Game": "Partie viennoise",
};

// Ouvertures proposées en premier (noms exacts de la base Lichess).
const POPULAIRES = [
  "Italian Game", "Ruy Lopez", "Scotch Game", "Vienna Game", "Queen's Pawn Game: London System",
  "Queen's Gambit", "English Opening", "Bishop's Opening",
  "Sicilian Defense", "French Defense", "Caro-Kann Defense", "Scandinavian Defense", "Pirc Defense",
  "Petrov's Defense", "Philidor Defense", "Queen's Gambit Declined", "Slav Defense",
  "King's Indian Defense", "Dutch Defense",
];
const MOTS_NOIRS = ["Defense", "Declined", "Accepted", "Countergambit"];

export function traduire(nom) {
  const i = nom.indexOf(":");
  const famille = i < 0 ? nom : nom.slice(0, i);
  const variante = i < 0 ? "" : nom.slice(i + 1);
  if (famille === "Queen's Pawn Game" && variante.trim().startsWith("London System")) {
    return "Système de Londres" + variante.trim().slice("London System".length);
  }
  const fr = FAMILLES_FR[famille] ?? famille;
  return i < 0 ? fr : `${fr} :${variante}`;
}

class BaseOuvertures {
  constructor(donnees) {
    this.ouvertures = donnees.ouvertures.map(([eco, nom, ucis, sans], i) => {
      const famille = nom.split(":")[0];
      return {
        id: `${eco}-${i}`, eco, nom, nom_fr: traduire(nom),
        camp: MOTS_NOIRS.some((m) => famille.includes(m)) ? "noirs" : "blancs",
        ucis: ucis.split(" "), sans: sans.split(" "),
      };
    });
    this.parId = new Map(this.ouvertures.map((o) => [o.id, o]));
    this.positions = donnees.positions; // clé -> [indice du nom ou -1, "uci:nb,..."]
  }

  estLivre(fen) {
    return cle(fen) in this.positions;
  }

  nomPosition(fen) {
    const entree = this.positions[cle(fen)];
    return entree && entree[0] >= 0 ? this.ouvertures[entree[0]] : null;
  }

  /** Coups de théorie depuis cette position : [{uci, nb}] (nb = lignes de la base qui le jouent). */
  coupsLivre(fen) {
    const entree = this.positions[cle(fen)];
    if (!entree || !entree[1]) return [];
    return entree[1].split(",").map((s) => {
      const [uci, nb] = s.split(":");
      return { uci, nb: Number(nb) };
    });
  }

  ouverture(id) {
    return this.parId.get(id) ?? null;
  }

  parNom(nom) {
    return this.ouvertures.find((o) => o.nom === nom) ?? null;
  }

  populaires() {
    return POPULAIRES.map((n) => this.parNom(n)).filter(Boolean);
  }
}

let chargement = null;

/** Base partagée, téléchargée au premier usage (~250 Ko compressés). */
export function baseOuvertures() {
  if (!chargement) {
    chargement = fetch(URL_DONNEES)
      .then((r) => {
        if (!r.ok) throw new Error(`base d'ouvertures introuvable (${r.status})`);
        return r.json();
      })
      .then((donnees) => new BaseOuvertures(donnees))
      .catch((err) => {
        chargement = null;
        throw err;
      });
  }
  return chargement;
}
