// « API » de l'application, entièrement dans le navigateur : même interface que l'ancienne
// version serveur, pour que l'interface n'ait pas à savoir où le travail est fait.

import { ErreurChessCom, partiesRecentes, resumePartie } from "./importation/chesscom.js";
import { ErreurPGN, lirePgn } from "./importation/pgn.js";
import { REGLAGES, analyserPartie } from "./moteur/analyse.js";
import { expliquerPartie } from "./explication/redaction.js";
import { baseOuvertures } from "./ouvertures/base.js";
import { marquerLivre } from "./review/livre.js";
import * as stockage from "./stockage.js";

export async function partiesChessCom(pseudo, nombre) {
  try {
    const jeux = await partiesRecentes(pseudo, nombre);
    const parties = [];
    for (const jeu of jeux) {
      const resume = resumePartie(jeu, pseudo);
      await stockage.ecrire("parties", resume.id, { source: "chesscom", pgn: jeu.pgn, resume });
      parties.push(resume);
    }
    return { pseudo, parties };
  } catch (err) {
    throw err instanceof ErreurChessCom ? err : new Error(`Import impossible (${err.message}).`);
  }
}

async function empreinte(texte) {
  try {
    const octets = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(texte));
    return [...new Uint8Array(octets)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    let h = 2166136261; // FNV-1a, si crypto.subtle n'est pas disponible
    for (const c of texte) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0).toString(16);
  }
}

export async function importerPGN(pgn) {
  const texte = (pgn ?? "").trim();
  const partie = lirePgn(texte); // lève ErreurPGN avec un message en français
  const id = `pgn-${await empreinte(texte)}`;
  await stockage.ecrire("parties", id, { source: "pgn", pgn: texte, resume: null });
  return { id, resume: null, partie };
}

export async function lirePartie(id) {
  const enregistree = await stockage.lire("parties", id);
  if (!enregistree) throw new Error("Partie introuvable sur cet appareil. Réimporte-la depuis l'accueil.");
  return { id, resume: enregistree.resume, partie: lirePgn(enregistree.pgn) };
}

// --- Analyses (tâches en arrière-plan, une partie à la fois) -----------------------

const taches = new Map(); // "id|reglage" -> {statut, fait, total, message?}

async function analyseComplete(id, reglage, analyse) {
  const { partie } = await lirePartie(id);
  let resultat = analyse;
  try {
    resultat = marquerLivre(partie, analyse, await baseOuvertures());
  } catch { /* base d'ouvertures indisponible : on garde l'analyse brute */ }
  resultat.explications = expliquerPartie(partie, resultat);
  return { statut: "terminee", analyse: resultat };
}

export async function etatAnalyse(id, reglage) {
  const enregistree = await stockage.lire("analyses", `${id}|${reglage}`);
  if (enregistree) return analyseComplete(id, reglage, enregistree);
  const tache = taches.get(`${id}|${reglage}`);
  if (tache?.statut === "terminee") return analyseComplete(id, reglage, tache.analyse); // stockage indisponible
  return { ...(tache ?? { statut: "absente" }) };
}

export async function lancerAnalyse(id, reglage) {
  if (!REGLAGES[reglage]) throw new Error("Réglage inconnu.");
  const etat = await etatAnalyse(id, reglage);
  if (etat.statut !== "absente" && etat.statut !== "erreur") return etat;

  const cleTache = `${id}|${reglage}`;
  const tache = { statut: "en_cours", fait: 0, total: 0 };
  taches.set(cleTache, tache);
  (async () => {
    try {
      const { partie } = await lirePartie(id);
      const analyse = await analyserPartie(partie, reglage, (fait, total) => Object.assign(tache, { fait, total }));
      await stockage.ecrire("analyses", cleTache, analyse);
      Object.assign(tache, { statut: "terminee", analyse }); // gardée aussi en mémoire
    } catch (err) {
      Object.assign(tache, { statut: "erreur", message: err.message });
    }
  })();
  return { ...tache };
}

export { ErreurPGN };
