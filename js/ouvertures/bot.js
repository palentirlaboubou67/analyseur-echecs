// Logique de l'entraînement « affronter une ouverture » (sans interface) :
// - le bot joue FORCÉMENT l'ouverture choisie : tant qu'elle n'est pas atteinte, le joueur doit
//   jouer les coups de la ligne (sinon son coup est refusé et le coach lui montre le bon) ;
// - ensuite le bot continue avec la théorie de la base, puis Stockfish au niveau choisi ;
// - après chaque coup du joueur, le coach le juge et l'explique.

import { Chess, jouerUci } from "../echecs.js";
import { jugerCoup } from "../review/juger.js";
import { moteur } from "../moteur/stockfish.js";

// Même au plus bas, Stockfish « pur » est bien trop fort pour un joueur de 800 Elo : on l'affaiblit
// en tirant au sort parmi plusieurs bons coups, avec une probabilité exp(-perte en cp / température).
export const NIVEAUX = {
  1: { nom: "Débutant", reglage: { profondeur: 4, tempsMax: 150 }, nbLignes: 8, temperature: 300 },
  2: { nom: "Facile", reglage: { profondeur: 6, tempsMax: 200 }, nbLignes: 6, temperature: 150 },
  3: { nom: "Moyen", reglage: { profondeur: 8, tempsMax: 300 }, nbLignes: 5, temperature: 70 },
  4: { nom: "Fort", reglage: { profondeur: 12, tempsMax: 500 }, nbLignes: 3, temperature: 25 },
  5: { nom: "Maximum", reglage: { profondeur: 16, tempsMax: 1000 }, nbLignes: 1, temperature: 0 },
};
const REGLAGE_COACH = { profondeur: 12, tempsMax: 600 };
const PRIORITE = 10; // le coach passe avant une analyse de partie en cours

/** Tire une ligne au sort : probabilité ∝ exp(-perte en centipions / température). */
export function choisirLigne(lignes, couleur, temperature, hasard = Math.random) {
  if (temperature <= 0 || lignes.length === 1) return lignes[0];
  const score = (l) => {
    const blanc = l.eval.type === "mat" ? (100000 - Math.abs(l.eval.valeur)) * Math.sign(l.eval.valeur) : l.eval.valeur;
    return couleur === "w" ? blanc : -blanc;
  };
  const scores = lignes.map(score);
  const meilleur = Math.max(...scores);
  const poids = scores.map((s) => Math.exp(-Math.min(meilleur - s, 3000) / temperature));
  let tirage = hasard() * poids.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lignes.length; i++) {
    tirage -= poids[i];
    if (tirage <= 0) return lignes[i];
  }
  return lignes.at(-1);
}

function tirerCoupLivre(candidats, hasard) {
  let tirage = hasard() * candidats.reduce((s, c) => s + c.nb, 0);
  for (const c of candidats) {
    tirage -= c.nb;
    if (tirage <= 0) return c.uci;
  }
  return candidats.at(-1).uci;
}

export class Entrainement {
  /**
   * base : base d'ouvertures ; cible : ouverture choisie ; couleurBot : 'w' ou 'b' ; niveau : 1-5.
   */
  constructor(base, cible, couleurBot, niveau, hasard = Math.random) {
    Object.assign(this, { base, cible, couleurBot, niveau: NIVEAUX[niveau], hasard });
    this.partie = new Chess();
    this.ucis = [];
    this.infos = []; // par demi-coup : {par: 'bot'|'joueur', source?, coach?}
    this.sortieLivre = null; // demi-coup (1, 2...) du premier coup hors théorie
  }

  get fen() { return this.partie.fen(); }
  get auBot() { return this.partie.turn() === this.couleurBot && !this.terminee; }
  get terminee() { return this.partie.isGameOver(); }
  get enLivre() { return this.sortieLivre === null; }
  get cibleAtteinte() { return this.cible.ucis.every((u, i) => this.ucis[i] === u); }
  get surLeChemin() {
    return this.ucis.length < this.cible.ucis.length && this.ucis.every((u, i) => this.cible.ucis[i] === u);
  }

  /** Coup imposé par l'ouverture à ce moment de la partie (null si la ligne est finie). */
  coupDeLaLigne() {
    return this.surLeChemin ? this.cible.ucis[this.ucis.length] : null;
  }

  jouer(uci, infos) {
    const fenAvant = this.fen;
    const coup = jouerUci(this.partie, uci);
    if (!coup) return null;
    this.ucis.push(uci);
    if (this.sortieLivre === null && !this.base.estLivre(this.fen)) this.sortieLivre = this.ucis.length;
    this.infos.push({ fenAvant, san: coup.san, uci, ...infos });
    return coup;
  }

  /** Annule le dernier coup du joueur (et la réponse du bot s'il a répondu). */
  annuler() {
    const retirer = () => {
      this.partie.undo();
      this.ucis.pop();
      this.infos.pop();
      if (this.sortieLivre !== null && this.ucis.length < this.sortieLivre) this.sortieLivre = null;
    };
    if (this.infos.at(-1)?.par === "bot") retirer();
    if (this.infos.at(-1)?.par === "joueur") retirer();
  }

  // --- Coups du bot -------------------------------------------------------------------

  async coupDuBot(lignesConnues = null) {
    const ligne = this.coupDeLaLigne();
    if (ligne) return this.jouer(ligne, { par: "bot", source: "ouverture" });
    if (this.enLivre) {
      const candidats = this.base.coupsLivre(this.fen);
      if (candidats.length) return this.jouer(tirerCoupLivre(candidats, this.hasard), { par: "bot", source: "livre" });
    }
    let lignes = lignesConnues;
    if (!lignes || lignes.length < Math.min(this.niveau.nbLignes, this.partie.moves().length)) {
      lignes = await moteur.analyser(this.fen, this.niveau.reglage, this.niveau.nbLignes, PRIORITE);
    }
    const choix = lignes.length ? choisirLigne(lignes.slice(0, this.niveau.nbLignes), this.partie.turn(), this.niveau.temperature, this.hasard).uci[0]
      : this.partie.moves({ verbose: true })[0].lan;
    return this.jouer(choix, { par: "bot", source: "moteur" });
  }

  // --- Coups du joueur et coach ----------------------------------------------------------

  /**
   * Vérifie un coup du joueur avant de le jouer.
   * -> {accepte: false, attendu: {uci, san}} si l'ouverture impose un autre coup.
   */
  verifier(uci) {
    const attendu = this.coupDeLaLigne();
    if (attendu && attendu !== uci) {
      const san = new Chess(this.fen).move({ from: attendu.slice(0, 2), to: attendu.slice(2, 4), promotion: attendu[4] }).san;
      return { accepte: false, attendu: { uci: attendu, san } };
    }
    return { accepte: true };
  }

  /**
   * Joue le coup du joueur et prépare l'avis du coach.
   * -> {coup, coach: {classification, phrases, meilleur, precision, theorie}, lignesApres}
   */
  async coupDuJoueur(uci) {
    const fenAvant = this.fen;
    const etaitEnLivre = this.enLivre;
    const ligneImposee = this.coupDeLaLigne();
    const coupsTheoriques = etaitEnLivre ? this.base.coupsLivre(fenAvant) : [];
    const coup = this.jouer(uci, { par: "joueur" });
    if (!coup) return null;
    const indice = this.infos.length - 1;

    // Coup de théorie : pas besoin du moteur.
    if (this.enLivre) {
      const nom = this.base.nomPosition(this.fen)?.nom_fr;
      const coach = {
        classification: "livre",
        phrases: [ligneImposee ? `C'est bien le coup de la ${this.cible.nom_fr}.` : "Coup connu de la théorie des ouvertures.",
          ...(nom ? [`Position : ${nom}.`] : [])],
        meilleur: null, precision: 100, theorie: true,
      };
      this.infos[indice].coach = coach;
      return { coup, coach, lignesApres: null };
    }

    const [lignesAvant, lignesApres] = this.terminee
      ? [await moteur.analyser(fenAvant, REGLAGE_COACH, 3, PRIORITE), []]
      : await Promise.all([
        moteur.analyser(fenAvant, REGLAGE_COACH, 3, PRIORITE),
        moteur.analyser(this.fen, { ...REGLAGE_COACH }, Math.max(3, this.niveau.nbLignes), PRIORITE),
      ]);
    const precedentBot = this.infos[indice - 1];
    const avis = jugerCoup(fenAvant, uci, lignesAvant, lignesApres,
      precedentBot ? { fen: precedentBot.fenAvant, uci: precedentBot.uci } : null);
    const phrases = [];
    if (etaitEnLivre && coupsTheoriques.length) {
      const principal = coupsTheoriques.reduce((a, b) => (b.nb > a.nb ? b : a));
      const san = new Chess(fenAvant).move({ from: principal.uci.slice(0, 2), to: principal.uci.slice(2, 4), promotion: principal.uci[4] }).san;
      phrases.push(`Ce coup sort de la théorie : le coup théorique le plus joué ici est ${san}.`);
    }
    const coach = { ...avis, phrases: [...phrases, ...avis.phrases], theorie: false };
    this.infos[indice].coach = coach;
    return { coup, coach, lignesApres };
  }

  /** Bilan des coups du joueur jugés par le coach. */
  bilan() {
    const avis = this.infos.filter((i) => i.par === "joueur" && i.coach).map((i) => i.coach);
    const compteurs = {};
    for (const a of avis) compteurs[a.classification] = (compteurs[a.classification] ?? 0) + 1;
    const precision = avis.length ? round(avis.reduce((s, a) => s + a.precision, 0) / avis.length) : null;
    return { compteurs, precision, nombre: avis.length };
  }

  /** PGN de la partie, pour l'analyser dans la review. */
  pgn(nomJoueur = "Moi") {
    const bot = `Bot ${this.niveau.nom} (${this.cible.nom_fr})`;
    const [blancs, noirs] = this.couleurBot === "w" ? [bot, nomJoueur] : [nomJoueur, bot];
    const resultat = this.partie.isCheckmate() ? (this.partie.turn() === "w" ? "0-1" : "1-0") : this.partie.isGameOver() ? "1/2-1/2" : "*";
    const coups = this.infos.map((i, k) => (k % 2 === 0 ? `${k / 2 + 1}. ${i.san}` : i.san)).join(" ");
    return `[Event "Entraînement : ${this.cible.nom_fr}"]\n[White "${blancs}"]\n[Black "${noirs}"]\n[Result "${resultat}"]\n\n${coups} ${resultat}`;
  }
}

const round = (x) => Math.round(x * 10) / 10;
