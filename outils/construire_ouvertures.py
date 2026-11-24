"""Construit ressources/ouvertures.json à partir des fichiers TSV de Lichess.

À relancer seulement si les fichiers de ressources/ouvertures-tsv/ changent
(source : https://github.com/lichess-org/chess-openings, licence CC0).

Usage (python-chess requis, par exemple avec le venv de l'ancienne version) :
    python outils/construire_ouvertures.py

Format produit (compact, chargé une fois par le navigateur) :
    {
      "ouvertures": [[eco, nom anglais, "uci uci ...", "san san ..."], ...],
      "positions":  {clé: [indice de l'ouverture qui s'y termine ou -1, "uci:nb,uci:nb"]}
    }
La clé d'une position = les 3 premiers champs de la FEN (pièces, trait, roques) : on ignore la case
en passant, que python-chess et chess.js n'écrivent pas de la même façon. Le JavaScript fait pareil.
"""

import csv
import json
from collections import Counter
from pathlib import Path

import chess

RACINE = Path(__file__).resolve().parent.parent
SOURCE = RACINE / "ressources" / "ouvertures-tsv"
CIBLE = RACINE / "ressources" / "ouvertures.json"


def cle(plateau: chess.Board) -> str:
    return " ".join(plateau.fen().split()[:3])


def main() -> None:
    ouvertures = []
    enfants: dict[str, Counter] = {}
    noms: dict[str, int] = {}
    for fichier in sorted(SOURCE.glob("*.tsv")):
        with open(fichier, encoding="utf-8") as f:
            for ligne in csv.DictReader(f, delimiter="\t"):
                plateau = chess.Board()
                ucis, sans = [], []
                for jeton in ligne["pgn"].split():
                    if jeton.endswith("."):
                        continue
                    coup = plateau.parse_san(jeton)
                    enfants.setdefault(cle(plateau), Counter())[coup.uci()] += 1
                    ucis.append(coup.uci())
                    sans.append(jeton)
                    plateau.push(coup)
                    enfants.setdefault(cle(plateau), Counter())
                noms.setdefault(cle(plateau), len(ouvertures))  # transposition : la première trouvée
                ouvertures.append([ligne["eco"], ligne["name"], " ".join(ucis), " ".join(sans)])

    positions = {
        k: [noms.get(k, -1), ",".join(f"{u}:{n}" for u, n in c.most_common())]
        for k, c in enfants.items()
    }
    CIBLE.write_text(json.dumps({"ouvertures": ouvertures, "positions": positions},
                                ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(ouvertures)} ouvertures, {len(positions)} positions -> {CIBLE} ({CIBLE.stat().st_size // 1024} Ko)")


if __name__ == "__main__":
    main()
