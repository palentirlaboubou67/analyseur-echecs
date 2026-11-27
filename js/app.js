// Point d'entrée : accueil (import), routage par #hash, raccourcis clavier.

import * as api from "./api.js";
import { afficherPartie, idAffiche, naviguer } from "./plateau.js";
import "./vue-analyse.js"; // s'abonne aux changements de partie et de position
import { afficherEntrainement } from "./entrainement.js";

const $ = (sel) => document.querySelector(sel);
const CLE_PSEUDO = "analyseur.pseudo";
const PAR_PAGE = 50;

const accueil = { pseudo: "", nombre: PAR_PAGE, parties: [] };

// --- Stockage local (pratique seulement : l'appli marche sans) -------------

function lireStockage(cle) {
  try { return localStorage.getItem(cle) || ""; } catch { return ""; }
}
function ecrireStockage(cle, valeur) {
  try { localStorage.setItem(cle, valeur); } catch { /* navigation privée */ }
}

// --- Accueil : parties chess.com -------------------------------------------

async function chargerParties() {
  const etatListe = $("#etat-liste");
  etatListe.textContent = "Chargement des parties…";
  etatListe.classList.remove("erreur");
  $("#bouton-plus").hidden = true;
  try {
    const donnees = await api.partiesChessCom(accueil.pseudo, accueil.nombre);
    accueil.parties = donnees.parties;
    ecrireStockage(CLE_PSEUDO, accueil.pseudo);
    afficherListe();
  } catch (err) {
    etatListe.textContent = err.message;
    etatListe.classList.add("erreur");
  }
}

function afficherListe() {
  const cadence = $("#filtre-cadence").value;
  const resultat = $("#filtre-resultat").value;
  const visibles = accueil.parties.filter(
    (p) => (!cadence || p.cadence.classe === cadence) && (!resultat || p.resultat === resultat),
  );

  const liste = $("#liste-parties");
  liste.replaceChildren(...visibles.map(elementPartie));
  $("#etat-liste").textContent = accueil.parties.length
    ? `${visibles.length} partie${visibles.length > 1 ? "s" : ""} affichée${visibles.length > 1 ? "s" : ""} sur ${accueil.parties.length} chargée${accueil.parties.length > 1 ? "s" : ""}.`
    : "Aucune partie trouvée pour ce pseudo.";
  // S'il y avait moins de parties que demandé, on a tout récupéré.
  $("#bouton-plus").hidden = accueil.parties.length < accueil.nombre;
}

function elementPartie(p) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = `#/partie/${encodeURIComponent(p.id)}`;
  a.className = `partie ${p.resultat}`;

  const pion = document.createElement("span");
  pion.className = `pion ${p.couleur}`;
  pion.title = p.couleur === "blancs" ? "Tu avais les Blancs" : "Tu avais les Noirs";

  const centre = document.createElement("span");
  centre.className = "centre";
  const adv = document.createElement("strong");
  adv.textContent = `${p.adversaire.pseudo} (${p.adversaire.elo ?? "?"})`;
  const details = document.createElement("small");
  details.textContent = [p.cadence.libelle, p.ouverture, dateCourte(p.date)].filter(Boolean).join(" · ");
  centre.append(adv, details);

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = { victoire: "Victoire", defaite: "Défaite", nulle: "Nulle" }[p.resultat];
  badge.title = p.motif;

  a.append(pion, centre, badge);
  li.append(a);
  return li;
}

function dateCourte(iso) {
  const d = new Date(iso);
  const minutes = (Date.now() - d.getTime()) / 60000;
  if (minutes < 60) return `il y a ${Math.max(1, Math.round(minutes))} min`;
  if (minutes < 24 * 60) return `il y a ${Math.round(minutes / 60)} h`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// --- Accueil : PGN collé ----------------------------------------------------

async function importerPGNColle() {
  const etatPgn = $("#etat-pgn");
  etatPgn.textContent = "";
  etatPgn.classList.remove("erreur");
  try {
    const donnees = await api.importerPGN($("#texte-pgn").value);
    afficherPartie(donnees, accueil.pseudo);
    location.hash = `#/partie/${encodeURIComponent(donnees.id)}`;
  } catch (err) {
    etatPgn.textContent = err.message;
    etatPgn.classList.add("erreur");
  }
}

// --- Routage ----------------------------------------------------------------

async function router() {
  const correspondance = location.hash.match(/^#\/partie\/(.+)$/);
  const surPartie = Boolean(correspondance);
  const surEntrainement = location.hash.startsWith("#/entrainement");
  $("#vue-accueil").hidden = surPartie || surEntrainement;
  $("#vue-partie").hidden = !surPartie;
  $("#vue-entrainement").hidden = !surEntrainement;
  document.querySelectorAll("[data-menu]").forEach((lien) => {
    lien.classList.toggle("actif", (lien.dataset.menu === "entrainement") === surEntrainement);
  });
  if (surEntrainement) return afficherEntrainement();
  if (location.hash === "#mes-parties") $("#mes-parties").scrollIntoView({ behavior: "smooth" });
  if (!surPartie) return;

  const id = decodeURIComponent(correspondance[1]);
  if (idAffiche() === id) return; // déjà affichée (ex. juste après un import PGN)
  try {
    afficherPartie(await api.lirePartie(id), accueil.pseudo);
  } catch (err) {
    $("#infos-partie").textContent = err.message;
  }
}

// --- Branchements -----------------------------------------------------------

$("#form-pseudo").addEventListener("submit", (e) => {
  e.preventDefault();
  accueil.pseudo = $("#pseudo").value.trim();
  accueil.nombre = PAR_PAGE;
  chargerParties();
});
$("#bouton-plus").addEventListener("click", () => {
  accueil.nombre += PAR_PAGE;
  chargerParties();
});
$("#filtre-cadence").addEventListener("change", afficherListe);
$("#filtre-resultat").addEventListener("change", afficherListe);
$("#bouton-pgn").addEventListener("click", importerPGNColle);

document.querySelectorAll("[data-nav]").forEach((bouton) =>
  bouton.addEventListener("click", () => naviguer(bouton.dataset.nav)),
);
document.addEventListener("keydown", (e) => {
  const dansUnChamp = e.target instanceof Element && e.target.closest("input, textarea, select");
  if ($("#vue-partie").hidden || dansUnChamp) return;
  const actions = { ArrowLeft: "precedent", ArrowRight: "suivant", Home: "debut", End: "fin", f: "retourner" };
  if (actions[e.key]) {
    e.preventDefault();
    naviguer(actions[e.key]);
  }
});
window.addEventListener("hashchange", router);

// Démarrage : on recharge la liste du dernier pseudo utilisé.
accueil.pseudo = lireStockage(CLE_PSEUDO);
if (accueil.pseudo) {
  $("#pseudo").value = accueil.pseudo;
  chargerParties();
}
router();

// Service worker : l'appli s'installe sur l'écran d'accueil et marche hors ligne
// (sauf l'import chess.com, qui a besoin d'internet).
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
