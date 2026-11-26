# Rendu PDF isolé

`docker compose -f infra/pdf/compose.yml up -d --build` démarre Gotenberg 9.2.0 sur le réseau interne `qerp-pdf`. Docker ne publie aucun port. Pour raccorder l'API de développement sans exposer le moteur, utilisez l'overlay `compose.api.yml` :

```powershell
docker compose -f infra/pdf/compose.yml up -d --build
$env:QERP_DEV_DB_PORT = '54433'
$env:QERP_API_PORT = '8092'
docker compose -f infra/compose.dev.yml -f infra/pdf/compose.api.yml up -d --build api
```

L'overlay relie uniquement l'API à `qerp-pdf`, utilise `http://gotenberg:3000` et conserve la base `qerp_reel` du service Postgres de développement. Gotenberg reste sur son seul réseau Docker interne ; aucun port n'est publié.

Pour tester un client de conversion jetable depuis l'hôte, ajoutez `-f infra/pdf/compose.local.yml` après le premier fichier Compose. Ce fichier demande la publication sur `127.0.0.1:3009`, configurable par `QERP_PDF_PORT`. Le réseau interne de Docker Desktop peut empêcher l'accès depuis l'hôte ; l'overlay API ci-dessus garde le moteur privé et constitue le parcours local recommandé.

Conservez `qerp.files.dir` sur un volume privé persistant, inscriptible par le compte de l’API et compatible avec les liens physiques. Les PDF finalisés sont sous `<société>/issued/<édition>.pdf`. L’opération de création du lien publie le fichier complet d’un seul coup et laisse en place tout fichier déjà présent.

L’API envoie `index.html` à `/forms/chromium/convert/html` avec l’étape `remediate` PDF/A-2b. Elle exige `Gotenberg-Remediation-Residual: 0` avant d’archiver le résultat. Si le moteur se trouve derrière un proxy authentifié, `QERP_PDF_AUTHORIZATION` accepte la valeur complète de l’en-tête `Authorization`.

Le conteneur utilise l’image Chromium seule. Le réseau interne et les filtres du moteur bloquent les accès sortants. Les téléchargements, les webhooks et JavaScript sont désactivés. [Gotenberg 9.2.0](https://github.com/gotenberg/gotenberg/releases/tag/v9.2.0) · [Configuration](https://gotenberg.dev/docs/configuration) · [PDF/A](https://gotenberg.dev/docs/pdf/remediate)

## Polices

Les polices variables et leurs licences SIL Open Font License proviennent des instantanés Google Fonts suivants.

- Montserrat, romain et italique. [Sources Google Fonts](https://github.com/google/fonts/tree/26975696d3c3e450ebae6be2da3f2b86ad65500e/ofl/montserrat)
- Playfair Display, romain et italique. [Sources Google Fonts](https://github.com/google/fonts/tree/f4f3b47f2c7e88edeb26d0127d314f75be2b1bb3/ofl/playfairdisplay)
