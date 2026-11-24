"""Serveur local de développement : sert le site sans cache navigateur.

Usage : python outils/serveur_local.py [port]   (par défaut 5330), puis http://localhost:5330/
Le cache est désactivé pour que chaque modification du code soit vue tout de suite.
(Le site publié sur GitHub Pages n'a pas besoin de ce fichier.)
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent


class SansCache(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm",
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5330
    serveur = ThreadingHTTPServer(("127.0.0.1", port), partial(SansCache, directory=str(RACINE)))
    print(f"Site disponible sur http://localhost:{port}/")
    serveur.serve_forever()
