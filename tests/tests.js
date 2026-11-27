// Tests de la logique (sans moteur) : ouvrir tests/index.html dans un navigateur.

import { Chess, FEN_DEPART, Position } from "../js/echecs.js";
import { gainBlancs, gainPour, precisionCoup, precisionPartie } from "../js/review/probabilites.js";
import { classer, estSacrifice } from "../js/review/classification.js";
import {
  aPieceEn, bilanLigne, decrireMateriel, ideeOuverture, numeroter, piecesEnPrise, tactiqueDuCoup,
} from "../js/explication/faits.js";
import { expliquerCoup, expliquerPartie } from "../js/explication/redaction.js";
import { ErreurPGN, lirePgn } from "../js/importation/pgn.js";
import { libelleCadence, nomOuvertureChessCom, resumePartie, validerPseudo } from "../js/importation/chesscom.js";
import { baseOuvertures, traduire } from "../js/ouvertures/base.js";
import { Entrainement, choisirLigne } from "../js/ouvertures/bot.js";
import { marquerLivre } from "../js/review/livre.js";
import { commenterLigne } from "../js/explication/ligne.js";
import { jugerCoup } from "../js/review/juger.js";

const tests = [];
const test = (nom, fn) => tests.push({ nom, fn });

function egal(obtenu, attendu, message = "") {
  const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
  if (a !== b) throw new Error(`${message}\n  obtenu : ${a}\n  attendu : ${b}`);
}
function vrai(condition, message = "condition fausse") {
  if (!condition) throw new Error(message);
}
const proche = (a, b, tol = 0.01) => vrai(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
function leve(fn, debut) {
  try { fn(); } catch (err) {
    vrai(err.message.startsWith(debut), `message inattendu : ${err.message}`);
    return;
  }
  throw new Error("aucune erreur levée");
}

const cp = (valeur) => ({ type: "cp", valeur });
const mat = (valeur) => ({ type: "mat", valeur });
function apres(fen, ...ucis) {
  const p = new Chess(fen);
  for (const u of ucis) p.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  return p.fen();
}
function ligne(fen, ucis, ev) {
  const p = new Chess(fen);
  return { uci: ucis, san: ucis.map((u) => p.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san), eval: ev };
}

// --- Probabilités -----------------------------------------------------------------------

test("% de gain : valeurs de référence Lichess", () => {
  proche(gainBlancs(cp(0)), 50);
  proche(gainBlancs(cp(100)), 59.10);
  proche(gainBlancs(cp(300)), 75.11);
  proche(gainBlancs(cp(-300)), 24.89);
  egal(gainBlancs(cp(5000)), gainBlancs(cp(1000)));
  egal(gainBlancs(mat(3)), 100);
  egal(gainBlancs({ type: "mat", valeur: 0, vainqueur: "noirs" }), 0);
  proche(gainPour(cp(120), "noirs"), gainBlancs(cp(-120)));
});

test("précision d'un coup et d'une partie", () => {
  egal(precisionCoup(60, 60), 100);
  egal(precisionCoup(60, 65), 100);
  proche(precisionCoup(60, 50), 64.58);
  egal(precisionPartie([50, 50, 50, 50, 50], [100, 100, 100, 100], ["blancs", "noirs", "blancs", "noirs"]), { blancs: 100, noirs: 100 });
  const gaffe = precisionPartie([50, 50, 95, 95, 95], [100, 3, 100, 100], ["blancs", "noirs", "blancs", "noirs"]);
  vrai(gaffe.blancs === 100 && gaffe.noirs < 50);
});

// --- Classification -----------------------------------------------------------------------

test("classification : seuils, brillant, occasion manquée", () => {
  const cas = [[55, 54, "excellent"], [55, 53, "excellent"], [55, 51, "bon"], [55, 47, "imprecision"], [55, 40, "erreur"], [55, 20, "gaffe"]];
  for (const [a, b, att] of cas) egal(classer(a, b), att, `${a}->${b}`);
  egal(classer(55, 40, { estMeilleur: true }), "meilleur");
  egal(classer(60, 60, { estMeilleur: true, sacrifice: true }), "brillant");
  egal(classer(97, 97, { estMeilleur: true, sacrifice: true }), "meilleur");
  egal(classer(85, 55, { erreurAdverseAvant: true }), "manquee");
  egal(classer(85, 30, { erreurAdverseAvant: true }), "gaffe");
  egal(classer(55, 20, { livre: true }), "livre");
});

test("détection des sacrifices", () => {
  egal(estSacrifice("4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16", "b3b8"), true);
  egal(estSacrifice("rnbqkbnr/ppp2ppp/3p4/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3", "d1g4"), true);
  egal(estSacrifice("r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4", "c4f7"), true);
  egal(estSacrifice("r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4", "b5c6"), false);
  egal(estSacrifice("4k3/7R/8/8/8/8/8/4Q1K1 w - - 0 1", "h7e7"), false);
  egal(estSacrifice("4k3/7R/8/8/8/8/8/6K1 w - - 0 1", "h7e7"), true);
  egal(estSacrifice(FEN_DEPART, "e2e4"), false);
});

// --- Faits ---------------------------------------------------------------------------------

test("description du matériel", () => {
  egal(decrireMateriel(["n"], []), "un cavalier");
  egal(decrireMateriel(["p", "p"], []), "deux pions");
  egal(decrireMateriel(["r"], ["b"]), "la qualité (une tour contre une pièce mineure)");
  egal(decrireMateriel(["q"], ["r"]), "une dame contre une tour");
  egal(decrireMateriel(["n", "p"], ["b"]), "un pion");
  egal(decrireMateriel(["q"], ["r", "p"]), "du matériel (l'équivalent de trois pions)");
  egal(decrireMateriel(["p"], ["p"]), "");
});

test("numérotation et accords", () => {
  egal(numeroter(FEN_DEPART, ["e4", "e5", "Nf3"]), "1. e4 e5 2. Nf3");
  egal(numeroter(apres(FEN_DEPART, "e2e4"), ["e5", "Nf3", "Nc6"]), "1… e5 2. Nf3 Nc6");
  egal(aPieceEn("b", "b4"), "au fou en b4");
  egal(aPieceEn("r", "a1"), "à la tour en a1");
});

test("pièces en prise", () => {
  const p = new Position("4k3/8/6p1/3n1b2/4P3/8/8/3RK3 b - - 0 1");
  egal(piecesEnPrise(p, "b").sort(), [["b", "f5"], ["n", "d5"]]);
  egal(piecesEnPrise(new Position("4k3/2p5/3n4/8/8/8/8/3RK3 b - - 0 1"), "b"), []);
});

test("tactiques : fourchette, clouage, découverte, prise gratuite, mat", () => {
  const f = tactiqueDuCoup("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "b5c7");
  egal(f.type, "fourchette");
  egal(f.cibles.map((c) => c.join("")).sort(), ["ke8", "ra8"]);
  egal(tactiqueDuCoup("4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1", "f1b5").type, "clouage");
  egal(tactiqueDuCoup("4k3/8/8/8/4B3/8/8/4RK2 w - - 0 1", "e4c6").type, "decouverte");
  egal(tactiqueDuCoup("4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1", "d1d5").type, "prise_gratuite");
  egal(tactiqueDuCoup("6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1", "d1d8").type, "mat");
});

test("bilan d'une ligne : gain confirmé, reprise, gain lointain, mat", () => {
  const fen = "4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1";
  const b = bilanLigne(fen, ligne(fen, ["d1d5", "e8e7"], cp(520)));
  egal([b.gain, b.materielGagne], [3, "un cavalier"]);
  egal(bilanLigne(fen, ligne(fen, ["d1d5", "e8e7"], cp(0))).gain, 0);

  let p = FEN_DEPART;
  const coups = ["e2e4", "e7e5", "g1f3", "d7d6", "d2d4", "c8g4", "d4e5"];
  p = apres(p, ...coups);
  const fenReprise = apres(p, "g4f3");
  const reprise = bilanLigne(fenReprise, ligne(fenReprise, ["d1f3", "d6e5"], cp(40)), { fen: p, uci: "g4f3" });
  egal([reprise.gain, reprise.reprise], [0, "b"]);

  const loin = "4k3/8/8/3n4/8/8/8/R3K3 w - - 0 1";
  egal(bilanLigne(loin, ligne(loin, ["a1a2", "e8e7", "a2a3", "e7e8", "a3d3", "e8e7", "d3d5"], cp(500))).gain, 0);
  egal(bilanLigne("6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1", { uci: ["d1d8"], san: ["Rd8#"], eval: mat(1) }).mat, 1);
});

test("idées d'ouverture", () => {
  egal(ideeOuverture(FEN_DEPART, "e2e4"), "centre");
  egal(ideeOuverture(FEN_DEPART, "g1f3"), "developpement");
  egal(ideeOuverture(FEN_DEPART, "a2a3"), null);
  const roque = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
  egal(ideeOuverture(roque, "e1g1"), "roque");
  egal(ideeOuverture(roque, "e1e2"), "roi");
});

// --- Explications ---------------------------------------------------------------------------

const info = (classification, a = 50, b = 50) => ({ classification, gain_avant: a, gain_apres: b, perte: Math.max(0, a - b) });

test("explication : gaffe qui permet un mat", () => {
  const fen = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3";
  const fenApres = apres(fen, "g8f6");
  const phrases = expliquerCoup(fen, "g8f6", "Nf6", { lignes: [ligne(fen, ["g7g6", "h5f3", "g8f6"], cp(-20))] },
    { lignes: [ligne(fenApres, ["h5f7"], mat(1))] }, info("gaffe", 48, 0));
  egal(phrases, ["Ce coup permet un mat immédiat : 4. Qxf7#.", "Il fallait jouer g6, qui évitait ce mat."]);
});

test("explication : oubli de reprendre", () => {
  const avantBxc6 = "r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4";
  const fen = apres(avantBxc6, "b5c6");
  const phrases = expliquerCoup(fen, "g8f6", "Nf6", { lignes: [ligne(fen, ["d7c6", "e1g1", "f7f6"], cp(30))] },
    { lignes: [ligne(apres(fen, "g8f6"), ["c6d7", "c8d7", "e1g1"], cp(320))] }, info("erreur", 45, 20), null,
    { fen: avantBxc6, uci: "b5c6" });
  vrai(phrases.at(-1).startsWith("Il fallait reprendre le fou en c6 avec dxc6"), phrases.join(" | "));
  vrai(!phrases.some((p) => p.includes("gagne")), "gain inventé");
});

test("explication : bon coup qui gagne une pièce, coup de mat, ouverture", () => {
  const fen = "4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1";
  egal(expliquerCoup(fen, "d1d5", "Rxd5", { lignes: [ligne(fen, ["d1d5", "e8e7"], cp(520))] }, { lignes: [] }, info("meilleur")),
    ["Ce coup gagne un cavalier : 1. Rxd5 Ke7.", "Le cavalier en d5 n'était pas défendu."]);
  egal(expliquerCoup("6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1", "d1d8", "Rd8#", { lignes: [] }, { lignes: [] }, info("meilleur")),
    ["Échec et mat ! La partie est terminée."]);
  egal(expliquerCoup(FEN_DEPART, "g1f3", "Nf3", { lignes: [ligne(FEN_DEPART, ["e2e4", "e7e5"], cp(30))] },
    { lignes: [ligne(apres(FEN_DEPART, "g1f3"), ["d7d5"], cp(20))] }, info("excellent", 52, 51)),
  ["Ce coup sort le cavalier : en ouverture, on développe ses pièces vite.", "Presque aussi fort que le choix de Stockfish, e4."]);
  egal(expliquerCoup(FEN_DEPART, "a2a3", "a3", { lignes: [ligne(FEN_DEPART, ["e2e4", "e7e5"], cp(30))] },
    { lignes: [ligne(apres(FEN_DEPART, "a2a3"), ["e7e5"], cp(-10))] }, info("imprecision", 52, 45)),
  ["Ce n'est pas le coup le plus précis.", "Il fallait plutôt jouer e4, qui occupait le centre."]);
});

// --- PGN -------------------------------------------------------------------------------------

const OPERA = `[Event "Paris"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

test("PGN : partie complète", () => {
  const p = lirePgn(OPERA);
  egal(p.coups.length, 33);
  egal(p.entetes.White, "Paul Morphy");
  egal([p.coups[0].san, p.coups[0].uci, p.coups[0].couleur], ["e4", "e2e4", "blancs"]);
  egal([p.coups[22].san, p.coups[22].uci], ["O-O-O", "e1c1"]);
  vrai(new Chess(p.coups.at(-1).fen).isCheckmate());
  egal(expliquerPartie(p, { positions: Array(34).fill({ lignes: [] }), coups: Array(33).fill({}) }).length, 33);
});

test("PGN : pendules, variantes, annotations, position de départ", () => {
  const p = lirePgn('[Event "x"]\n\n1. e4 {[%clk 0:03:01.9]} 1... d5 {[%clk 0:03:00.4]} 2. exd5 $1 (2. Nc3 Nf6) 2... Qxd5!? {Libre [%clk 0:02:50]} *');
  egal(p.coups.map((c) => c.san), ["e4", "d5", "exd5", "Qxd5"]);
  proche(p.coups[0].pendule, 181.9);
  egal(p.coups[3].pendule, 170);
  const f = lirePgn('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 b - - 0 1"]\n\n1... Kd7 2. e4 *');
  egal([f.coups[0].couleur, f.coups[0].numero, f.coups[1].numero], ["noirs", 1, 2]);
  egal(lirePgn(`${OPERA}\n\n${OPERA}`).avertissements.length, 1);
});

test("PGN : erreurs en français", () => {
  leve(() => lirePgn(""), "Le PGN est vide");
  leve(() => lirePgn("bonjour"), "Le PGN contient un coup illisible");
  leve(() => lirePgn("1. e4 e5 2. Nf6"), "Le PGN contient un coup illisible ou illégal");
  leve(() => lirePgn('[FEN "pas une position"]\n\n1. e4'), "La position de départ");
  leve(() => lirePgn('[Variant "Chess960"]\n\n1. e4'), "Seules les parties d'échecs classiques");
  vrai(new ErreurPGN("x") instanceof Error);
});

// --- chess.com -----------------------------------------------------------------------------

test("chess.com : pseudo, cadence, ouverture, résumé", () => {
  egal(validerPseudo(" Hikaru "), "hikaru");
  leve(() => validerPseudo("x/../y"), "Pseudo chess.com invalide");
  egal(libelleCadence("blitz", "180+2"), "Blitz · 3+2");
  egal(libelleCadence("rapid", "600"), "Rapide · 10 min");
  egal(libelleCadence("bullet", "30"), "Bullet · 30 s");
  egal(libelleCadence("daily", "1/259200"), "Quotidienne · 3 j / coup");
  egal(nomOuvertureChessCom("https://www.chess.com/openings/French-Defense-Classical-Steinitz-Variation...6.c3-Nc6"), "French Defense Classical Steinitz Variation");
  const r = resumePartie({
    uuid: "a2", url: "u", end_time: 1795000000, time_class: "rapid", time_control: "600", rules: "chess",
    pgn: '[ECO "C50"]', eco: "https://www.chess.com/openings/Italian-Game",
    white: { username: "autre", rating: 800, result: "win" }, black: { username: "Moi", rating: 790, result: "checkmated" },
  }, "moi");
  egal([r.couleur, r.resultat, r.motif, r.eco, r.ouverture], ["noirs", "defaite", "échec et mat", "C50", "Italian Game"]);
});

// --- Ouvertures, livre, entraînement ---------------------------------------------------------

test("base d'ouvertures et traductions", async () => {
  const base = await baseOuvertures();
  vrai(base.ouvertures.length > 3000);
  egal(base.populaires().length, 19);
  egal(traduire("Italian Game: Two Knights Defense"), "Partie italienne : Two Knights Defense");
  egal(traduire("Queen's Pawn Game: London System"), "Système de Londres");
  vrai(base.estLivre(apres(FEN_DEPART, "d2d4", "d7d5", "g1f3")) && base.estLivre(apres(FEN_DEPART, "g1f3", "d7d5", "d2d4")));
  egal(base.nomPosition(apres(FEN_DEPART, "e2e4", "c7c5")).nom_fr, "Défense sicilienne");
  vrai(base.coupsLivre(apres(FEN_DEPART, "e2e4", "e7e5")).some((c) => c.uci === "g1f3"));
});

test("coups de livre dans une review", async () => {
  const base = await baseOuvertures();
  const partie = lirePgn("1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. Kf1 Nf6");
  const analyse = {
    positions: Array(9).fill({ eval: cp(20), gain_blancs: 52, lignes: [] }),
    coups: Array.from({ length: 8 }, (_, i) => ({ ply: i + 1, classification: "meilleur", perte: 0, precision: 100 })),
  };
  const r = marquerLivre(partie, analyse, base);
  egal(r.coups.map((c) => c.classification), [...Array(6).fill("livre"), "meilleur", "meilleur"]);
  vrai(r.ouverture.nom_fr.startsWith("Partie italienne"));
  egal(r.resume.compteurs.blancs.livre, 3);
  egal(analyse.coups[0].classification, "meilleur");
});

test("entraînement : l'ouverture est imposée, le bot la joue", async () => {
  const base = await baseOuvertures();
  const italienne = base.parNom("Italian Game");
  const ent = new Entrainement(base, italienne, "w", 2, () => 0.5);
  await ent.coupDuBot();
  egal(ent.infos.map((i) => i.san), ["e4"]);
  // Le joueur (Noirs) essaie 1... c5 : refusé, le coach attend 1... e5.
  egal(ent.verifier("c7c5"), { accepte: false, attendu: { uci: "e7e5", san: "e5" } });
  egal(ent.verifier("e7e5"), { accepte: true });
  const { coach } = await ent.coupDuJoueur("e7e5");
  egal(coach.classification, "livre");
  await ent.coupDuBot();
  await ent.coupDuJoueur("b8c6");
  await ent.coupDuBot();
  egal(ent.infos.map((i) => i.san), ["e4", "e5", "Nf3", "Nc6", "Bc4"]);
  vrai(ent.cibleAtteinte && ent.enLivre);
  egal(ent.coupDeLaLigne(), null);
  egal(ent.verifier("h7h5"), { accepte: true }); // ensuite, le joueur est libre

  ent.annuler();
  egal(ent.infos.map((i) => i.san), ["e4", "e5", "Nf3"]);
  vrai(ent.pgn().includes("1. e4 e5 2. Nf3"));
});

test("entraînement : le bot qui a les Noirs impose aussi sa défense", async () => {
  const base = await baseOuvertures();
  const ent = new Entrainement(base, base.parNom("Sicilian Defense"), "b", 2, () => 0.5);
  egal(ent.verifier("d2d4").accepte, false);
  await ent.coupDuJoueur("e2e4");
  await ent.coupDuBot();
  egal(ent.infos.map((i) => i.san), ["e4", "c5"]);
});

test("choix pondéré du bot hors théorie", () => {
  const lignes = [[100, "a"], [50, "b"], [-400, "c"]].map(([v, u]) => ({ eval: cp(v), uci: [u] }));
  egal(choisirLigne(lignes, "w", 0).uci, ["a"]);
  let graine = 1;
  const hasard = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
  const tirages = Array.from({ length: 500 }, () => choisirLigne(lignes, "w", 100, hasard).uci[0]);
  const n = (x) => tirages.filter((t) => t === x).length;
  vrai(n("a") > n("b") && n("b") > n("c"), `${n("a")} ${n("b")} ${n("c")}`);
  egal(choisirLigne(lignes, "b", 1).uci, ["c"]);
  const avecMat = [...lignes, { eval: mat(2), uci: ["m"] }];
  vrai(Array.from({ length: 50 }, () => choisirLigne(avecMat, "w", 300, hasard).uci[0]).every((u) => u === "m"));
});

test("voir la ligne : mat expliqué coup par coup", () => {
  // Coup du berger : 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? puis Qxf7#
  const fen = apres(FEN_DEPART, "e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6");
  const mat1 = commenterLigne(fen, { uci: ["h5f7"], eval: mat(1) });
  egal(mat1.intro, "Les Blancs matent en un coup.");
  egal(mat1.coups[0].san, "Qxf7#");
  egal(mat1.coups[0].phrases[0], "Échec et mat ! La dame prend le pion en f7.");
  vrai(mat1.coups[0].phrases[1].startsWith("Le roi noir est attaqué"));

  // Échec avec une seule parade, prise gratuite, coup illégal qui coupe la ligne
  const fen2 = "4k3/8/8/8/3q4/8/8/R3K3 w - - 0 1";
  const l2 = commenterLigne(fen2, { uci: ["a1a8", "e8e7", "h1h2"], eval: cp(-300) });
  egal(l2.coups.length, 2, "coupé au coup illégal");
  egal(l2.coups[0].numero, 1);
  vrai(l2.coups[0].phrases[0].startsWith("La tour va en a8. Échec !"), l2.coups[0].phrases[0]);
  vrai(l2.intro.includes("gros avantage des Noirs"), l2.intro);
  const l3 = commenterLigne("4k3/8/8/8/8/8/8/R3K1r1 w - - 0 1", { uci: ["a1a8"], eval: cp(0) });
  egal(l3.coups.length, 0, "coup illégal en échec");
});

test("coach d'un coup joué à la main (variante libre)", () => {
  const avant = [{ eval: cp(30), uci: ["e2e4", "e7e5"], san: ["e4", "e5"] }];
  const meilleur = jugerCoup(FEN_DEPART, "e2e4", avant, [{ eval: cp(30), uci: ["e7e5"], san: ["e5"] }]);
  egal(meilleur.classification, "meilleur");
  egal(meilleur.meilleur, null);
  const erreur = jugerCoup(FEN_DEPART, "g2g4", avant, [{ eval: cp(-120), uci: ["d7d5"], san: ["d5"] }]);
  egal(erreur.classification, "erreur");
  egal(erreur.meilleur, { uci: "e2e4", san: "e4" });
  vrai(erreur.phrases.length > 0 && erreur.perte > 10, JSON.stringify(erreur));
  egal(jugerCoup(FEN_DEPART, "e2e5", avant, []), null, "coup illégal");
});

// --- Lancement --------------------------------------------------------------------------------

const zone = document.querySelector("#resultats");
let echecs = 0;
for (const { nom, fn } of tests) {
  const ligneResultat = document.createElement("div");
  try {
    await fn();
    ligneResultat.className = "ok";
    ligneResultat.textContent = `✓ ${nom}`;
  } catch (err) {
    echecs += 1;
    ligneResultat.className = "ko";
    ligneResultat.textContent = `✗ ${nom}`;
    const detail = document.createElement("pre");
    detail.textContent = err.stack || err.message;
    ligneResultat.append(detail);
  }
  zone.append(ligneResultat);
}
const resume = `${tests.length - echecs} / ${tests.length} tests réussis`;
document.querySelector("#resume").textContent = resume;
document.querySelector("#resume").className = echecs ? "ko" : "ok";
document.title = `${echecs ? "ÉCHEC" : "OK"} — ${resume}`;
