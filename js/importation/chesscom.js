// Import des parties depuis l'API publique de chess.com (directement depuis le navigateur).
// Doc : https://www.chess.com/news/view/published-data-api
// - Pas d'authentification : « connecter son compte » = donner son pseudo.
// - Requêtes en série (jamais en parallèle) pour ne pas être limité (429).
// - Cache local : un mois terminé n'est téléchargé qu'une fois.

import * as stockage from "../stockage.js";

const URL_API = "https://api.chess.com/pub";
const PSEUDO_VALIDE = /^[A-Za-z0-9_-]{2,30}$/;
const FRAICHEUR_ARCHIVES = 10 * 60 * 1000;
const FRAICHEUR_MOIS_EN_COURS = 2 * 60 * 1000;
const FRAICHEUR_MOIS_PASSE = 30 * 24 * 3600 * 1000;

const CLASSES = { bullet: "Bullet", blitz: "Blitz", rapid: "Rapide", daily: "Quotidienne" };
const MOTIFS = {
  checkmated: "échec et mat", resigned: "abandon", timeout: "temps écoulé", abandoned: "partie abandonnée",
  lose: "défaite", agreed: "nulle par accord", repetition: "répétition de position", stalemate: "pat",
  insufficient: "matériel insuffisant", "50move": "règle des 50 coups", timevsinsufficient: "temps écoulé, matériel insuffisant",
};
const NULLES = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);

export class ErreurChessCom extends Error {}

let enCours = Promise.resolve(); // chaîne de requêtes : une seule à la fois

export function validerPseudo(pseudo) {
  const p = (pseudo ?? "").trim();
  if (!PSEUDO_VALIDE.test(p)) throw new ErreurChessCom("Pseudo chess.com invalide.");
  return p.toLowerCase();
}

class ErreurIntrouvable extends ErreurChessCom {}

async function lireJson(url, fraicheur) {
  const enCache = await stockage.lire("cache", url);
  if (enCache && Date.now() - enCache.recupere_le < fraicheur) return enCache.corps;

  const requete = enCours.then(async () => {
    for (const pause of [0, 2000, 5000]) {
      if (pause) await new Promise((r) => setTimeout(r, pause));
      let reponse;
      try {
        reponse = await fetch(url);
      } catch {
        if (enCache) return enCache.corps; // hors ligne : on se contente du cache
        throw new ErreurChessCom("Impossible de joindre chess.com. Vérifie ta connexion internet.");
      }
      if (reponse.status === 429) continue;
      if (reponse.status === 404 || reponse.status === 410) throw new ErreurIntrouvable("Ce joueur n'existe pas sur chess.com.");
      if (!reponse.ok) throw new ErreurChessCom(`chess.com a répondu par une erreur (${reponse.status}).`);
      const corps = await reponse.json();
      await stockage.ecrire("cache", url, { corps, recupere_le: Date.now() });
      return corps;
    }
    throw new ErreurChessCom("chess.com limite temporairement les requêtes. Réessaie dans une minute.");
  });
  enCours = requete.catch(() => {});
  return requete;
}

/** Les `nombre` dernières parties classiques du joueur, la plus récente en premier. */
export async function partiesRecentes(pseudo, nombre = 50, moisMax = 12) {
  const p = validerPseudo(pseudo);
  const { archives = [] } = await lireJson(`${URL_API}/player/${p}/games/archives`, FRAICHEUR_ARCHIVES);
  const jeux = [];
  const mois = archives.slice(-moisMax).reverse();
  let derniereErreur = null;
  for (let rang = 0; rang < mois.length; rang++) {
    let games = [];
    try {
      ({ games = [] } = await lireJson(mois[rang], rang === 0 ? FRAICHEUR_MOIS_EN_COURS : FRAICHEUR_MOIS_PASSE));
    } catch (err) {
      // chess.com renvoie parfois une erreur sur un mois précis (vu : « internal error » sur le mois
      // en cours d'un très gros compte) : on passe au mois suivant plutôt que de tout abandonner.
      if (!(err instanceof ErreurChessCom)) throw err;
      derniereErreur = err;
      continue;
    }
    for (const jeu of [...games].reverse()) {
      if (jeu.rules !== "chess" || !jeu.pgn) continue; // variantes non prises en charge
      jeux.push(jeu);
      if (jeux.length >= nombre) return jeux;
    }
  }
  if (!jeux.length && derniereErreur && !(derniereErreur instanceof ErreurIntrouvable)) throw derniereErreur;
  if (!jeux.length && derniereErreur) throw new ErreurChessCom("chess.com n'a pas pu fournir les parties de ce joueur pour l'instant. Réessaie plus tard.");
  return jeux;
}

export function libelleCadence(classe, controle) {
  const nom = CLASSES[classe] ?? (classe ? classe[0].toUpperCase() + classe.slice(1) : "?");
  if (!controle) return nom;
  if (controle.includes("/")) return `${nom} · ${Math.floor(Number(controle.split("/")[1]) / 86400)} j / coup`;
  const [base, increment] = controle.split("+");
  const secondes = Number(base);
  const temps = secondes % 60 === 0 ? `${secondes / 60}` : `${secondes} s`;
  if (increment && increment !== "0") return `${nom} · ${temps}+${increment}`;
  return secondes % 60 === 0 ? `${nom} · ${temps} min` : `${nom} · ${temps}`;
}

export function nomOuvertureChessCom(urlEco) {
  if (!urlEco) return null;
  let slug = decodeURIComponent(urlEco.replace(/\/$/, "").split("/").pop());
  slug = slug.split(/-?\d+\./)[0].split("...")[0];
  return slug.replace(/-/g, " ").trim() || null;
}

/** Résumé d'une partie chess.com du point de vue de `pseudo`. */
export function resumePartie(jeu, pseudo) {
  const p = pseudo.toLowerCase();
  const { white, black } = jeu;
  const [couleur, moi, adv] = white.username.toLowerCase() === p ? ["blancs", white, black] : ["noirs", black, white];
  let resultat, motif;
  if (moi.result === "win") [resultat, motif] = ["victoire", MOTIFS[adv.result] ?? adv.result];
  else if (NULLES.has(moi.result)) [resultat, motif] = ["nulle", MOTIFS[moi.result]];
  else [resultat, motif] = ["defaite", MOTIFS[moi.result] ?? moi.result];
  const eco = (jeu.pgn ?? "").match(/\[ECO "([A-E]\d\d)"\]/);
  return {
    id: jeu.uuid || jeu.url.replace(/\/$/, "").split("/").pop(),
    url: jeu.url,
    date: new Date(jeu.end_time * 1000).toISOString(),
    couleur,
    joueur: { pseudo: moi.username, elo: moi.rating },
    adversaire: { pseudo: adv.username, elo: adv.rating },
    cadence: { classe: jeu.time_class, libelle: libelleCadence(jeu.time_class ?? "", jeu.time_control ?? "") },
    resultat,
    motif,
    ouverture: nomOuvertureChessCom(jeu.eco),
    eco: eco ? eco[1] : null,
  };
}
