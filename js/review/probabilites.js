// Conversion évaluation -> probabilité de gain, et précision, à la manière de Lichess.
//
// Une évaluation est un objet (point de vue des Blancs) :
//   {type: "cp", valeur: 35}                        avantage en centipions
//   {type: "mat", valeur: 3}                        les Blancs matent en 3 (négatif : les Noirs)
//   {type: "mat", valeur: 0, vainqueur: "noirs"}    position de mat déjà sur l'échiquier
//
// Raisonner en % de gain plutôt qu'en centipions rend les pertes comparables :
// lâcher 2 pions à +0.5 est grave, à +9 ça ne change presque rien.
// Formules : https://lichess.org/page/accuracy

const PLAFOND_CP = 1000; // au-delà de ±10 pions la formule sature : Lichess plafonne aussi

export function gainBlancs(ev) {
  if (ev.type === "mat") {
    if (ev.valeur > 0) return 100;
    if (ev.valeur < 0) return 0;
    return ev.vainqueur === "blancs" ? 100 : 0;
  }
  const cp = Math.max(-PLAFOND_CP, Math.min(PLAFOND_CP, ev.valeur));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** % de gain du camp `couleur` ('blancs' ou 'noirs'). */
export function gainPour(ev, couleur) {
  const g = gainBlancs(ev);
  return couleur === "blancs" ? g : 100 - g;
}

/** Précision (0-100) d'un coup selon le % de gain perdu. */
export function precisionCoup(gainAvant, gainApres) {
  const perte = Math.max(0, gainAvant - gainApres);
  const brute = 103.1668 * Math.exp(-0.04354 * perte) - 3.1669 + 1; // +1 : incertitude du moteur
  return Math.max(0, Math.min(100, brute));
}

const ecartType = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};

/**
 * Précision globale de chaque joueur (méthode Lichess).
 * gainsBlancs : % de gain des Blancs pour chaque position (precisions.length + 1 valeurs).
 * Chaque coup est pondéré par la volatilité de la partie autour de lui ; la note finale est la
 * moyenne de la moyenne pondérée et de la moyenne harmonique (qui punit fort les gaffes).
 */
export function precisionPartie(gainsBlancs, precisions, couleurs) {
  const n = precisions.length;
  const resultat = { blancs: null, noirs: null };
  if (n === 0) return resultat;
  const taille = Math.max(2, Math.min(8, Math.floor((n + 1) / 10)));
  const fenetres = [];
  for (let i = 0; i < taille - 2; i++) fenetres.push(gainsBlancs.slice(0, taille));
  for (let i = 0; i < n + 2 - taille; i++) fenetres.push(gainsBlancs.slice(i, i + taille));
  const poids = fenetres.slice(0, n).map((f) => Math.max(0.5, Math.min(12, ecartType(f))));

  for (const couleur of ["blancs", "noirs"]) {
    const indices = precisions.map((_, i) => i).filter((i) => couleurs[i] === couleur);
    if (!indices.length) continue;
    const ponderee = indices.reduce((s, i) => s + precisions[i] * poids[i], 0) / indices.reduce((s, i) => s + poids[i], 0);
    const harmonique = indices.length / indices.reduce((s, i) => s + 1 / Math.max(precisions[i], 1), 0);
    resultat[couleur] = Math.round(((ponderee + harmonique) / 2) * 10) / 10;
  }
  return resultat;
}
