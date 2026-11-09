package com.quoreich.qerp;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noFields;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Invariants structurels du monolithe modulaire.
 *
 * <h2>Pourquoi ces règles et pas d'autres</h2>
 * Le programme de bascule prévoit un monolithe modulaire : les modules sont
 * séparés par convention de paquets, sans frontière technique qui les isole. Une
 * convention non testée se dissout au troisième contributeur. Ces règles ne
 * défendent pas l'esthétique, elles défendent les deux propriétés dont dépend la
 * sécurité du produit :
 *
 * <ol>
 *   <li><b>le périmètre société vit dans la connexion, pas dans le code
 *       métier</b> — d'où l'interdiction, pour le module client, de dépendre du
 *       module société : s'il pouvait lire le contexte pour filtrer lui-même, il
 *       finirait par le faire, et une requête oubliant le filtre serait une
 *       fuite inter-sociétés ;
 *   <li><b>aucune connexion ne contourne le pool</b> — un {@code
 *       DriverManager.getConnection} ouvrirait une connexion sans revendications,
 *       donc sans contexte société, donc sans RLS.
 * </ol>
 */
@AnalyzeClasses(
    packages = "com.quoreich.qerp",
    importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

  @ArchTest
  static final ArchRule leModuleClientNeDependPasDuModuleSociete =
      noClasses()
          .that()
          .resideInAPackage("..customer..")
          .should()
          .dependOnClassesThat()
          .resideInAPackage("..tenant..")
          .because(
              "le périmètre société est appliqué par la RLS via la connexion ; "
                  + "un module métier qui lit le contexte pour filtrer lui-même finira par oublier de le faire");

  @ArchTest
  static final ArchRule leModuleSocieteNeDependPasDuModuleClient =
      noClasses()
          .that()
          .resideInAPackage("..tenant..")
          .should()
          .dependOnClassesThat()
          .resideInAPackage("..customer..")
          .because("le module société est une couche basse : rien du métier ne doit y remonter");

  @ArchTest
  static final ArchRule laCoucheWebNeDependPasDesModulesMetier =
      noClasses()
          .that()
          .resideInAPackage("..web..")
          .should()
          .dependOnClassesThat()
          .resideInAPackage("..customer..")
          .because("la couche web expose des points d'entrée, elle ne porte pas la logique métier");

  @ArchTest
  static final ArchRule aucuneClasseHorsTenantNOuvreDeConnexionDirecte =
      noClasses()
          .that()
          .resideOutsideOfPackage("..tenant..")
          .should()
          .callMethod(java.sql.DriverManager.class, "getConnection", java.lang.String.class)
          .orShould()
          .callMethod(java.sql.DriverManager.class, "getConnection", java.lang.String.class, java.util.Properties.class)
          .because(
              "une connexion hors du pool ne porterait pas les revendications JWT, "
                  + "donc aucune politique RLS ne s'appliquerait : elle lirait toutes les sociétés");

  @ArchTest
  static final ArchRule lesControleursNeParlentPasDirectementALaBase =
      noClasses()
          .that()
          .haveSimpleNameEndingWith("Controller")
          .should()
          .dependOnClassesThat()
          .haveFullyQualifiedName("javax.sql.DataSource")
          .orShould()
          .dependOnClassesThat()
          .haveFullyQualifiedName("org.springframework.jdbc.core.JdbcTemplate")
          .because(
              "un contrôleur qui interroge la base contourne la couche de requête, "
                  + "et avec elle les points où le périmètre société est vérifié");

  @ArchTest
  static final ArchRule pasDInjectionParChamp =
      noFields()
          .should()
          .beAnnotatedWith(Autowired.class)
          .because(
              "l'injection par champ masque les dépendances et empêche d'instancier la classe "
                  + "dans un test unitaire sans conteneur Spring");
}
