// Stockage local du navigateur (IndexedDB) : parties importées, analyses, cache chess.com.
// Tout reste sur l'appareil : rien n'est envoyé ailleurs.

const NOM = "analyseur-echecs";
const VERSION = 1;
const TABLES = ["parties", "analyses", "cache"];

let ouverture = null;

function base() {
  if (!ouverture) {
    ouverture = new Promise((resoudre, rejeter) => {
      const requete = indexedDB.open(NOM, VERSION);
      requete.onupgradeneeded = () => {
        for (const table of TABLES) {
          if (!requete.result.objectStoreNames.contains(table)) requete.result.createObjectStore(table);
        }
      };
      requete.onsuccess = () => resoudre(requete.result);
      requete.onerror = () => rejeter(requete.error);
    }).catch((err) => {
      ouverture = null; // navigation privée stricte, etc. : on réessaiera
      throw err;
    });
  }
  return ouverture;
}

async function transaction(table, mode, action) {
  const db = await base();
  return new Promise((resoudre, rejeter) => {
    const tx = db.transaction(table, mode);
    const requete = action(tx.objectStore(table));
    tx.oncomplete = () => resoudre(requete?.result);
    tx.onerror = () => rejeter(tx.error);
  });
}

export async function lire(table, cle) {
  try {
    return (await transaction(table, "readonly", (s) => s.get(cle))) ?? null;
  } catch {
    return null; // le stockage est un confort : sans lui, l'appli marche quand même
  }
}

export async function ecrire(table, cle, valeur) {
  try {
    await transaction(table, "readwrite", (s) => s.put(valeur, cle));
  } catch {
    /* stockage indisponible ou plein : tant pis pour le cache */
  }
}
