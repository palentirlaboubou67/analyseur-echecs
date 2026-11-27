# Analyseur d'échecs

Site web (PC et téléphone) pour progresser aux échecs, en français, pour un joueur d'environ 800 Elo :

- **Entraînement aux ouvertures** : tu choisis une ouverture (Partie italienne, Défense sicilienne,
  Caro-Kann, Système de Londres… ou n'importe laquelle des 3 865 lignes de la base Lichess).
  Le bot la joue **forcément** : tant que la ligne n'est pas atteinte, si tu joues un autre coup,
  il est refusé et le coach te montre le bon. Ensuite le bot continue avec la théorie, puis
  Stockfish prend le relais au niveau choisi.
  **Après chacun de tes coups, le coach te dit** si c'est un coup de théorie, un bon coup, une
  imprécision, une erreur ou une gaffe, quel était le meilleur coup (flèche verte) et **pourquoi**.
  Un bilan suit ta précision pendant la partie ; un bouton envoie la partie dans l'analyse complète.
- **Revoir ses parties chess.com** : ton pseudo suffit (API publique, pas de mot de passe).
  Analyse Stockfish coup par coup : barre d'évaluation, graphique, classification (brillant,
  meilleur, excellent, bon, livre, imprécision, erreur, occasion manquée, gaffe), précision de
  chaque joueur et explication en langage clair de chaque coup. On peut aussi coller un PGN.

Tout tourne **dans le navigateur** : Stockfish 19 (WebAssembly), la base d'ouvertures et les
explications. Rien n'est envoyé ailleurs (seul l'import chess.com contacte api.chess.com).
Les parties et analyses sont gardées sur l'appareil (IndexedDB).

## Utilisation

- Ouvrir le site, puis sur téléphone : menu du navigateur → **« Ajouter à l'écran d'accueil »**
  (ou « Installer l'application » sur PC). Il s'ouvre alors comme une appli, même hors ligne
  (sauf l'import chess.com, qui a besoin d'internet).
- **Version PC hors ligne (Windows)** : `AnalyseurEchecs.exe` s'ouvre dans sa propre fenêtre et
  fonctionne sans internet (sauf l'import chess.com). Pour le construire et l'installer
  (raccourcis Bureau + menu Démarrer, sans droits administrateur) :
  `powershell -ExecutionPolicy Bypass -File outils\construire_exe.ps1 -Installer`
  (Python 3 requis ; PyInstaller est installé dans `.venv-exe` la première fois).
  Le .exe sert le site sur http://127.0.0.1:5331/ et l'ouvre dans Microsoft Edge en mode
  application, avec un profil à part (`%LOCALAPPDATA%\AnalyseurEchecs`) où restent les parties.
  Ses données sont séparées de celles du site en ligne.
- Pour développer : `python outils/serveur_local.py` puis http://localhost:5330/ (sans cache).

## Comment ça marche

| Dossier | Contenu |
|---|---|
| `js/moteur/` | Stockfish dans un Web Worker (file avec priorités), analyse d'une partie |
| `js/review/` | % de gain (formule Lichess), précision, classification, coups de livre |
| `js/explication/` | faits vérifiables (pièces en prise, fourchettes, clouages, bilan matériel) et phrases |
| `js/ouvertures/` | base d'ouvertures, logique de l'entraînement (ouverture forcée, bot, coach) |
| `js/importation/` | lecture PGN, API chess.com |
| `moteur/` | Stockfish 19 « lite single-threaded » (WebAssembly, ~1,8 Mo) |
| `ressources/` | base d'ouvertures Lichess (TSV d'origine + JSON pré-calculé) |
| `vendor/` | chess.js 1.4.0 et chessground 9.2.1, copiés pour marcher hors ligne |
| `tests/` | tests de la logique : ouvrir `tests/index.html` dans un navigateur |

**Les explications n'utilisent pas d'IA.** Chaque phrase est construite à partir de faits lus sur
l'échiquier ou d'une ligne calculée par Stockfish ; un gain de matériel n'est annoncé que si
l'évaluation du moteur le confirme. Sans raison concrète établie, la phrase reste prudente
(« Stockfish recommandait… ») plutôt que d'inventer.

**Niveaux du bot** : même au plus bas, Stockfish brut est bien trop fort pour un joueur de 800 Elo.
Il est donc affaibli : il envisage plusieurs coups et en tire un au sort, d'autant plus souvent
que le coup est bon (`NIVEAUX` dans `js/ouvertures/bot.js`).

La base d'ouvertures se reconstruit avec `python outils/construire_ouvertures.py` (python-chess requis)
si les fichiers de `ressources/ouvertures-tsv/` changent.

## Licences

- Ce projet est distribué sous licence **GPL-3.0** (fichier `LICENSE`), comme Stockfish et chessground qu'il embarque.
- [Stockfish](https://github.com/official-stockfish/Stockfish) (GPL-3.0), version WebAssembly
  [stockfish.js](https://github.com/nmrugg/stockfish.js) 19.0.1 — sources sur ces dépôts.
- [chessground](https://github.com/lichess-org/chessground) 9.2.1 (GPL-3.0),
  [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 (BSD-2-Clause).
- Base d'ouvertures [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0).
- Police [Outfit](https://github.com/Outfitio/Outfit-Fonts) (SIL Open Font License 1.1, `polices/OFL.txt`).
