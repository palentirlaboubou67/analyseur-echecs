"""Version bureau (Windows) de l'Analyseur d'échecs, utilisable sans internet.

Ce lanceur sert les fichiers du site sur http://127.0.0.1:5331/ (uniquement sur ce PC)
et les ouvre dans une fenêtre d'application Microsoft Edge (mode --app, sans barre
d'adresse), avec un profil dédié pour que parties et analyses restent enregistrées.
Quand la fenêtre est fermée, le serveur s'arrête.

Il est transformé en AnalyseurEchecs.exe par outils/construire_exe.ps1 (PyInstaller).
Pendant le développement : python outils/appli_bureau.py
"""

import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Port fixe : le navigateur range les données (IndexedDB, préférences) par adresse,
# changer de port ferait « perdre » les parties enregistrées.
PORT = 5331
ADRESSE = f"http://127.0.0.1:{PORT}/"
DONNEES = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "AnalyseurEchecs"

if getattr(sys, "frozen", False):           # dans le .exe : fichiers extraits par PyInstaller
    RACINE = Path(sys._MEIPASS) / "site"
else:                                       # en développement : le dossier du dépôt
    RACINE = Path(__file__).resolve().parent.parent


class Gestionnaire(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm",
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        # Pas de cache : après une mise à jour du .exe, la fenêtre charge le nouveau code.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):           # pas de console dans le .exe
        pass


def deja_lance():
    """Vrai si une autre fenêtre de l'appli sert déjà le site sur ce port."""
    try:
        with urllib.request.urlopen(ADRESSE + "manifest.webmanifest", timeout=1) as reponse:
            return b"Analyseur" in reponse.read()
    except OSError:
        return False


def trouver_edge():
    candidats = [shutil.which("msedge")]
    for variable in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        base = os.environ.get(variable)
        if base:
            candidats.append(os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
    return next((c for c in candidats if c and os.path.exists(c)), None)


def ouvrir_fenetre():
    """Ouvre la fenêtre et renvoie le processus Edge (None si Edge est introuvable)."""
    edge = trouver_edge()
    if not edge:
        webbrowser.open(ADRESSE)
        return None
    return subprocess.Popen([
        edge, f"--app={ADRESSE}", f"--user-data-dir={DONNEES / 'profil'}",
        "--no-first-run", "--no-default-browser-check", "--disable-sync",
        "--window-size=1300,880",
    ])


# --- Fenêtre toujours visible --------------------------------------------------------
# Edge retient la dernière position de la fenêtre : si elle était sur un 2e écran éteint ou
# débranché, l'appli « ne s'ouvre pas » (elle est hors de vue). On la ramène donc sur
# l'écran principal et au premier plan.

TITRE = "Analyseur d'échecs"


def ramener_fenetre(delai=20):
    """Attend la fenêtre (titre de la page) puis la place sur l'écran principal, au premier plan."""
    if sys.platform != "win32":
        return
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    try:
        user32.SetProcessDPIAware()          # coordonnées réelles, quelle que soit la mise à l'échelle
    except Exception:
        pass
    rappel_t = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def fenetres():
        trouvees = []

        def rappel(h, _):
            if user32.IsWindowVisible(h):
                n = user32.GetWindowTextLengthW(h)
                tampon = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(h, tampon, n + 1)
                if tampon.value == TITRE:   # titre exact : les fenêtres Edge normales finissent par « - Microsoft Edge »
                    trouvees.append(h)
            return True

        user32.EnumWindows(rappel_t(rappel), 0)
        return trouvees

    fin = time.time() + delai
    while time.time() < fin:
        trouvees = fenetres()
        if trouvees:
            break
        time.sleep(0.3)
    else:
        return

    MONITOR_DEFAULTTONULL, MONITOR_DEFAULTTOPRIMARY = 0, 1
    principal = user32.MonitorFromPoint(wintypes.POINT(0, 0), MONITOR_DEFAULTTOPRIMARY)
    zone = wintypes.RECT()
    user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(zone), 0)  # SPI_GETWORKAREA : écran principal
    largeur_zone, hauteur_zone = zone.right - zone.left, zone.bottom - zone.top
    for h in trouvees:
        if user32.MonitorFromWindow(h, MONITOR_DEFAULTTONULL) != principal:
            etait_agrandie = bool(user32.IsZoomed(h))
            user32.ShowWindow(h, 9)          # SW_RESTORE
            largeur, hauteur = min(1300, largeur_zone - 40), min(880, hauteur_zone - 40)
            user32.SetWindowPos(h, None, zone.left + (largeur_zone - largeur) // 2,
                                zone.top + (hauteur_zone - hauteur) // 2, largeur, hauteur, 0x0044)
            if etait_agrandie:
                user32.ShowWindow(h, 3)      # SW_MAXIMIZE, sur l'écran principal cette fois
        elif user32.IsIconic(h):
            user32.ShowWindow(h, 9)
    user32.SetForegroundWindow(trouvees[-1])


def main():
    if deja_lance():                         # 2e lancement : on rouvre juste une fenêtre
        ouvrir_fenetre()
        ramener_fenetre()
        return

    serveur = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Gestionnaire, directory=str(RACINE)))
    threading.Thread(target=serveur.serve_forever, daemon=True).start()

    fenetre = ouvrir_fenetre()
    threading.Thread(target=ramener_fenetre, daemon=True).start()
    if fenetre is None:                      # navigateur par défaut : on ne sait pas quand il ferme
        while True:
            time.sleep(3600)
    fenetre.wait()
    # Edge peut garder un processus quelques instants après la fermeture : on attend
    # que plus rien n'utilise le profil avant d'arrêter le serveur.
    verrou = DONNEES / "profil" / "lockfile"
    for _ in range(20):
        if not verrou.exists():
            break
        try:
            verrou.unlink()                  # n'y arrive pas tant qu'Edge tient le profil
            break
        except OSError:
            time.sleep(1)
    serveur.shutdown()


if __name__ == "__main__":
    main()
