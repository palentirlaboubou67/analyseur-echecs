# Construit dist\AnalyseurEchecs.exe (version bureau hors ligne, voir outils\appli_bureau.py).
# Usage, depuis le dossier echecs-web :   powershell -ExecutionPolicy Bypass -File outils\construire_exe.ps1
# Ajoute -Installer pour le copier dans %LOCALAPPDATA%\Programs et créer les raccourcis.
# Besoin : Python 3 (PyInstaller et Pillow sont installés dans .venv-exe la première fois).
param([switch]$Installer)
$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent $PSScriptRoot
Set-Location $racine

# 1. Environnement de construction isolé
if (-not (Test-Path ".venv-exe\Scripts\python.exe")) {
    python -m venv .venv-exe
    & .venv-exe\Scripts\python.exe -m pip install --quiet --upgrade pip
    & .venv-exe\Scripts\python.exe -m pip install --quiet pyinstaller pillow
}
$py = Resolve-Path ".venv-exe\Scripts\python.exe"

# 2. Copie des seuls fichiers du site (sans tests, outils ni TSV sources)
$site = Join-Path $racine "build\site"
if (Test-Path $site) { Remove-Item -Recurse -Force $site }
New-Item -ItemType Directory -Force "$site\ressources" | Out-Null
foreach ($element in "index.html", "manifest.webmanifest", "sw.js", "LICENSE", "css", "js", "vendor", "moteur", "icones", "polices") {
    Copy-Item -Recurse $element $site
}
Copy-Item "ressources\ouvertures.json" "$site\ressources"

# 3. Icône Windows à partir de l'icône du site
& $py -c "from PIL import Image; Image.open('icones/icone-512.png').save('build/icone.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"

# 4. Un seul .exe, sans console
& $py -m PyInstaller --noconfirm --clean --onefile --windowed --name AnalyseurEchecs `
    --icon "$racine\build\icone.ico" --add-data "$site;site" `
    --distpath "$racine\dist" --workpath "$racine\build\pyinstaller" --specpath "$racine\build" `
    "$racine\outils\appli_bureau.py"
if ($LASTEXITCODE -ne 0) { throw "PyInstaller a échoué" }
Write-Host "Construit : $racine\dist\AnalyseurEchecs.exe"

# 5. Installation facultative (dossier utilisateur, pas besoin d'être administrateur)
if ($Installer) {
    $dossier = Join-Path $env:LOCALAPPDATA "Programs\AnalyseurEchecs"
    New-Item -ItemType Directory -Force $dossier | Out-Null
    $exe = Join-Path $dossier "AnalyseurEchecs.exe"
    # Si l'appli est ouverte, Windows interdit d'écraser le .exe mais permet de le renommer :
    # l'ancien est mis de côté et le nouveau servira au prochain lancement.
    $ancien = Join-Path $dossier "AnalyseurEchecs.ancien.exe"
    Remove-Item -Force $ancien -ErrorAction SilentlyContinue
    if (Test-Path $exe) {
        try { Remove-Item -Force $exe -ErrorAction Stop } catch { Rename-Item $exe $ancien }
    }
    Copy-Item -Force "dist\AnalyseurEchecs.exe" $dossier
    $shell = New-Object -ComObject WScript.Shell
    $menu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
    foreach ($lien in (Join-Path ([Environment]::GetFolderPath("Desktop")) "Analyseur d'échecs.lnk"), (Join-Path $menu "Analyseur d'échecs.lnk")) {
        $raccourci = $shell.CreateShortcut($lien)
        $raccourci.TargetPath = $exe
        $raccourci.WorkingDirectory = $dossier
        $raccourci.IconLocation = "$exe,0"
        $raccourci.Description = "Analyseur d'échecs (hors ligne)"
        $raccourci.Save()
    }
    Write-Host "Installé dans $dossier (raccourcis sur le Bureau et dans le menu Démarrer)"
}
