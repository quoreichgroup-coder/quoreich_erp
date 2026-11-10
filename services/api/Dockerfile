# Image de l'API QUOREICH.
#
# Construction en deux étapes : la première compile avec le JDK et le Maven
# Wrapper du dépôt, la seconde n'embarque qu'un JRE. L'image finale ne contient
# donc ni Maven, ni sources, ni dépôt local Maven — seulement l'exécutable et
# ses dépendances.
#
# Aucun secret n'est figé ici, et aucune valeur par défaut exploitable ne
# remplace `QERP_DB_PASSWORD` : `application.yml` lit `${QERP_DB_PASSWORD:}`, une
# chaîne vide. Une image qui démarrerait avec un mot de passe compilé dedans
# serait une fuite publiée dans le registre.

# ---------------------------------------------------------------------------
# Étape 1 — compilation
# ---------------------------------------------------------------------------
# Alpine, et pas l'image Ubuntu `eclipse-temurin:25-jdk`, pour une raison
# précise : `mvnw` bascule silencieusement de `.zip` à `.tar.gz` quand `unzip`
# est absent de l'image —
#
#   if ! command -v unzip >/dev/null; then
#     distributionUrl="${distributionUrl%.zip}.tar.gz"
#
# — alors que `distributionSha256Sum` reste l'empreinte du `.zip`. L'archive
# téléchargée est alors saine et l'empreinte exacte, mais comparée au mauvais
# fichier : le wrapper s'arrête sur « your Maven distribution might be
# compromised », message qui envoie chercher un problème de sécurité là où il
# n'y a qu'un paquet manquant. Vérifié : l'image Ubuntu n'a ni `unzip`, ni
# `curl`, ni `wget` ; l'image Alpine a `unzip`, `tar` et `sha256sum`.
#
# Installer `unzip` à la main marcherait aussi ; choisir l'image qui le fournit
# évite une couche `apt-get` et aligne l'étape de compilation sur l'étape
# d'exécution, déjà en Alpine.
FROM eclipse-temurin:25-jdk-alpine AS construction

WORKDIR /build

# Le Maven Wrapper est utilisé tel quel plutôt que l'image `maven:3.10` : c'est
# lui qui est vérifié par la somme SHA-256 de `maven-wrapper.properties`, et le
# contourner dans l'image laisserait la CI emprunter un chemin que le poste de
# développement n'emprunte pas.
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./

# Les dépendances sont résolues avant la copie des sources : tant que `pom.xml`
# ne change pas, cette couche est réutilisée et une modification de code ne
# retélécharge pas tout le dépôt Maven.
RUN ./mvnw -B -ntp dependency:go-offline

COPY src/ src/

# `maven.test.skip` et non `-DskipTests` : depuis Spring Boot 4.1, `-DskipTests`
# ne saute plus la compilation des tests, donc le traitement AOT des tests. Les
# tests ne sont de toute façon pas exécutés ici — ils le sont dans la CI, sur un
# PostgreSQL jetable, et dans une image qui n'a ni Docker ni accès réseau à un
# registre d'images.
RUN ./mvnw -B -ntp -Dmaven.test.skip=true package

# ---------------------------------------------------------------------------
# Étape 2 — exécution
# ---------------------------------------------------------------------------
FROM eclipse-temurin:25-jre-alpine

# `wget` de BusyBox suffit au contrôle de santé de Compose et au HEALTHCHECK :
# embarquer `curl` pour cela ajouterait un paquet et sa surface de vulnérabilités.
RUN addgroup -S qerp && adduser -S -G qerp -h /app qerp

WORKDIR /app

COPY --from=construction --chown=qerp:qerp /build/target/qerp-api-*.jar app.jar

USER qerp

EXPOSE 8080

# `MaxRAMPercentage` plutôt que `-Xmx` : la limite du conteneur peut changer sans
# qu'il faille reconstruire l'image. Le reste des réglages est le comportement par
# défaut d'une JVM récente, rappelé pour qu'il soit explicite plutôt que supposé.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError -Dfile.encoding=UTF-8"

# Les délais sont mesurés, pas choisis. Démarrage à froid observé sur le poste
# de développement, hôte chargé : 4 min 35 entre le lancement de la JVM et le
# premier `/health` qui répond, dont 2 min 12 pour la seule initialisation du
# contexte web. Les 15 migrations Flyway durent à elles seules 1 min 46 dans le
# conteneur. Avec `start-period=60s`, le conteneur était donc déclaré `unhealthy`
# avant même d'avoir fini de démarrer ; et avec `timeout=3s`, le journal de
# Docker montrait le contrôle de santé lui-même expirant —
#
#   timed out starting health check for container ...
#
# c'est-à-dire un `wget` qui n'a pas eu le temps de démarrer, et non une
# application en panne. Un contrôle de santé qui rougit sur un hôte lent
# n'informe pas : il apprend à ignorer le contrôle.
HEALTHCHECK --interval=15s --timeout=10s --start-period=180s --retries=6 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

# `exec` : la JVM devient PID 1 et reçoit SIGTERM directement, ce que
# `server.shutdown=graceful` attend pour terminer les requêtes en cours.
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
