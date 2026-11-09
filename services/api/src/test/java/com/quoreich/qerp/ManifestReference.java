package com.quoreich.qerp;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Function;

/**
 * Lecture du manifeste de parité du lot 0, produit par {@code scripts/schema/schema-manifest.sql}.
 *
 * <p>Le manifeste est un TSV découpé en sections, chacune introduite par une
 * ligne {@code # @@ section: <nom>}. Il est <em>généré</em> depuis la base de
 * référence et jamais écrit à la main : c'est ce qui lui donne valeur de preuve.
 *
 * <p>Ce lecteur existe pour que les tests Java comparent des <em>ensembles de
 * noms d'objets</em> et non des nombres. Un total qui tombe juste peut masquer
 * un objet manquant compensé par un objet en trop, et c'est exactement le genre
 * d'écart qu'un changement de schéma introduit sans qu'on le voie.
 */
final class ManifestReference {

  private static final String CHEMIN = "/schema-manifest/public.manifest.tsv";
  private static final String MARQUEUR_SECTION = "# @@ section: ";

  private final List<String[]> lignes;

  private ManifestReference(List<String[]> lignes) {
    this.lignes = lignes;
  }

  static ManifestReference charger() {
    try (InputStream flux = ManifestReference.class.getResourceAsStream(CHEMIN)) {
      if (flux == null) {
        throw new IllegalStateException("Manifeste de parité introuvable : " + CHEMIN);
      }
      List<String[]> lignes = new ArrayList<>();
      for (String ligne :
          new String(flux.readAllBytes(), StandardCharsets.UTF_8).split("\n")) {
        lignes.add(ligne.split("\t", -1));
      }
      return new ManifestReference(lignes);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /**
   * Colonne demandée de chaque ligne de la section, la ligne d'en-tête exceptée.
   *
   * @param section nom de section, tel qu'écrit après {@code # @@ section: }
   * @param colonne index de colonne, base zéro
   */
  Set<String> colonne(String section, int colonne) {
    return projeter(section, champs -> champs[colonne]);
  }

  /** Clés composées {@code « a/b »} à partir de deux colonnes de la section. */
  Set<String> cles(String section, int premiere, int seconde) {
    return projeter(section, champs -> champs[premiere] + "/" + champs[seconde]);
  }

  /** Noms de tables de la section {@code rls_enabled} dont la RLS est active. */
  Set<String> tablesAvecRlsActive() {
    return projeter("rls_enabled", champs -> "t".equals(champs[1]) ? champs[0] : null);
  }

  private Set<String> projeter(String section, Function<String[], String> projection) {
    Set<String> valeurs = new LinkedHashSet<>();
    boolean dansLaSection = false;
    for (String[] champs : lignes) {
      if (champs.length > 0 && champs[0].startsWith(MARQUEUR_SECTION)) {
        dansLaSection = champs[0].substring(MARQUEUR_SECTION.length()).trim().equals(section);
        continue;
      }
      if (!dansLaSection || champs.length == 0 || champs[0].isBlank()) {
        continue;
      }
      String valeur = projection.apply(champs);
      if (valeur != null && !valeur.isBlank()) {
        valeurs.add(valeur);
      }
    }
    if (valeurs.isEmpty()) {
      throw new IllegalStateException(
          "Section « " + section + " » absente ou vide dans " + CHEMIN
              + " : le manifeste a-t-il été régénéré avec un autre découpage ?");
    }
    return valeurs;
  }
}
