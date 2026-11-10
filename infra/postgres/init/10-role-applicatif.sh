#!/bin/sh
# Provisionne le rôle de connexion de l'API sur le PostgreSQL de développement.
#
# Pourquoi ce geste est ici et pas dans une migration : `V1__bootstrap_roles.sql`
# crée `qerp_api` en NOLOGIN, délibérément — un mot de passe n'a rien à faire
# dans un fichier de migration versionné, qui est rejoué sur toutes les bases et
# relu par des tiers. Donner la capacité de connexion est un geste de
# déploiement, distinct de la création du schéma.
#
# C'est exactement ce que fait `PostgresFixture.provisionApiRole()` pour les
# tests d'intégration : le poste de développement et la chaîne de tests
# provisionnent donc le rôle de la même façon, et une divergence entre les deux
# ne peut pas passer inaperçue.
#
# Ce fichier est exécuté une seule fois, à l'initialisation du volume de données.
# Modifier le mot de passe ici n'a donc aucun effet sur un volume déjà créé :
# il faut passer par `ALTER ROLE`, ou repartir d'un volume neuf.
#
# Le corps est placé dans un sous-shell. L'image officielle exécute un script
# marqué exécutable, mais *source* celui qui ne l'est pas — et le bit exécutable
# ne survit pas toujours au passage par un poste Windows. Sans sous-shell, un
# `set -e` fuirait dans le script d'entrée de PostgreSQL, qui n'en a pas besoin.

(
  set -eu

  # Mot de passe de recette, pour un conteneur jetable accessible uniquement sur
  # l'interface locale de la machine. Ce n'est pas un secret : il n'ouvre sur
  # aucune donnée réelle, et le figer rend le poste de développement utilisable
  # sans préparation. Le mot de passe de production ne vient pas d'ici —
  # l'application ne lit que `${QERP_DB_PASSWORD:}`, sans valeur par défaut.
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
	DO $$
	BEGIN
	  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qerp_api') THEN
	    CREATE ROLE qerp_api LOGIN;
	  END IF;
	END $$;

	-- Les attributs sont réaffirmés à chaque passage plutôt que laissés au
	-- défaut du serveur : `NOBYPASSRLS` est ce qui rend les 157 politiques
	-- effectives, et un défaut modifié au niveau du cluster ne doit pas
	-- pouvoir les désactiver en silence.
	ALTER ROLE qerp_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
	  INHERIT PASSWORD 'qerp_api_dev';
EOSQL

  echo "rôle qerp_api provisionné (LOGIN, NOBYPASSRLS ; membre de authenticated par V1)"
)
