<#
  Libère la mémoire du poste pour les tests QUOREICH : arrête les conteneurs Docker des AUTRES
  projets (rien n'est supprimé), en note la liste, et les redémarre ensuite.

    powershell -File scripts/dev/liberer-memoire.ps1             # arrêter (garde qerp-*)
    powershell -File scripts/dev/liberer-memoire.ps1 -Reprendre  # redémarrer ce qui a été arrêté

  La liste est écrite hors dépôt : %LOCALAPPDATA%\qerp\conteneurs-arretes.txt. Un second arrêt
  complète la liste au lieu de l'écraser, pour ne rien oublier à la reprise.
#>
param([switch]$Reprendre)

$ErrorActionPreference = "Stop"
$dossier = Join-Path $env:LOCALAPPDATA "qerp"
$liste = Join-Path $dossier "conteneurs-arretes.txt"
New-Item -ItemType Directory -Force $dossier | Out-Null

if ($Reprendre) {
  if (-not (Test-Path $liste)) { Write-Output "Rien à reprendre ($liste absent)."; exit 0 }
  $noms = Get-Content $liste | Where-Object { $_ -ne "" } | Sort-Object -Unique
  foreach ($n in $noms) {
    docker start $n | Out-Null
    if ($?) { Write-Output "redémarré : $n" } else { Write-Output "ÉCHEC : $n" }
  }
  Remove-Item $liste
  exit 0
}

$enCours = docker ps --format "{{.Names}}" | Where-Object { $_ -and $_ -notlike "qerp-*" }
if (-not $enCours) { Write-Output "Aucun conteneur hors QUOREICH en cours."; exit 0 }
Add-Content -Path $liste -Value $enCours
foreach ($n in $enCours) {
  docker stop $n | Out-Null
  Write-Output "arrêté : $n"
}
Write-Output "Liste pour la reprise : $liste"
