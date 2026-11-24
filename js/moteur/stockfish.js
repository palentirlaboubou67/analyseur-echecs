// Stockfish 19 (WebAssembly, version « lite » à un seul thread) dans un Web Worker.
// Il fonctionne sur n'importe quel hébergement statique (GitHub Pages compris), sur PC comme sur téléphone.
// Un seul moteur pour toute l'application : les demandes passent par une file avec priorités
// (le coach d'entraînement passe avant l'analyse d'une partie en cours).

import { sansDepuis } from "../echecs.js";

const URL_MOTEUR = new URL("../../moteur/stockfish-19-lite-single.js", import.meta.url);
const LONGUEUR_LIGNE = 10; // demi-coups gardés par ligne

export class ErreurMoteur extends Error {}

class Moteur {
  constructor() {
    this.file = [];
    this.occupe = false;
    this.multipv = 1;
    this.ecouteurs = new Set();
    this.pret = null;
  }

  demarrer() {
    if (!this.pret) {
      this.pret = new Promise((resoudre, rejeter) => {
        try {
          this.worker = new Worker(URL_MOTEUR);
        } catch (err) {
          rejeter(new ErreurMoteur(`Impossible de démarrer Stockfish (${err.message}).`));
          return;
        }
        this.worker.onmessage = (e) => {
          const ligne = typeof e.data === "string" ? e.data : String(e.data ?? "");
          for (const f of [...this.ecouteurs]) f(ligne);
        };
        this.worker.onerror = () => rejeter(new ErreurMoteur("Stockfish n'a pas pu se charger dans ce navigateur."));
        this.envoyerEtAttendre("uci", (l) => l === "uciok")
          .then(() => this.envoyerEtAttendre("isready", (l) => l === "readyok"))
          .then(resoudre, rejeter);
      });
    }
    return this.pret;
  }

  envoyerEtAttendre(commande, estFin, surLigne = () => {}) {
    return new Promise((resoudre) => {
      const ecouteur = (ligne) => {
        surLigne(ligne);
        if (estFin(ligne)) {
          this.ecouteurs.delete(ecouteur);
          resoudre();
        }
      };
      this.ecouteurs.add(ecouteur);
      this.worker.postMessage(commande);
    });
  }

  /**
   * Meilleures lignes d'une position : [{eval, uci, san}], la meilleure d'abord.
   * reglage = {profondeur, tempsMax (ms)} ; le premier atteint arrête la recherche.
   */
  analyser(fen, reglage, nbLignes = 3, priorite = 0) {
    return new Promise((resoudre, rejeter) => {
      this.file.push({ fen, reglage, nbLignes, priorite, resoudre, rejeter, ordre: performance.now() });
      this.suivant();
    });
  }

  async suivant() {
    if (this.occupe || !this.file.length) return;
    this.file.sort((a, b) => b.priorite - a.priorite || a.ordre - b.ordre);
    const tache = this.file.shift();
    this.occupe = true;
    try {
      await this.demarrer();
      tache.resoudre(await this.chercher(tache.fen, tache.reglage, tache.nbLignes));
    } catch (err) {
      tache.rejeter(err instanceof ErreurMoteur ? err : new ErreurMoteur(`Erreur de Stockfish (${err.message}).`));
    } finally {
      this.occupe = false;
      this.suivant();
    }
  }

  async chercher(fen, { profondeur, tempsMax }, nbLignes) {
    if (nbLignes !== this.multipv) {
      this.worker.postMessage(`setoption name MultiPV value ${nbLignes}`);
      this.multipv = nbLignes;
    }
    this.worker.postMessage(`position fen ${fen}`);
    const parLigne = new Map();
    await this.envoyerEtAttendre(`go depth ${profondeur} movetime ${tempsMax}`, (l) => l.startsWith("bestmove"), (l) => {
      const info = lireInfo(l);
      if (info) parLigne.set(info.multipv, info);
    });
    const trait = fen.split(" ")[1];
    return [...parLigne.values()]
      .sort((a, b) => a.multipv - b.multipv)
      .map((info) => {
        const uci = info.pv.slice(0, LONGUEUR_LIGNE);
        // UCI donne le score du point de vue du camp au trait : on le ramène aux Blancs.
        const signe = trait === "w" ? 1 : -1;
        return { eval: { type: info.type, valeur: info.valeur * signe }, uci, san: sansDepuis(fen, uci) };
      })
      .filter((l) => l.san.length);
  }
}

/** "info depth 12 multipv 2 score cp -35 ... pv e7e5 g1f3" -> {multipv, type, valeur, pv} */
function lireInfo(ligne) {
  if (!ligne.startsWith("info ") || !ligne.includes(" pv ") || ligne.includes("bound")) return null;
  const mots = ligne.split(" ");
  const multipv = mots.includes("multipv") ? Number(mots[mots.indexOf("multipv") + 1]) : 1;
  const i = mots.indexOf("score");
  if (i < 0) return null;
  const type = mots[i + 1] === "mate" ? "mat" : "cp";
  return { multipv, type, valeur: Number(mots[i + 2]), pv: mots.slice(mots.indexOf("pv") + 1) };
}

export const moteur = new Moteur();
