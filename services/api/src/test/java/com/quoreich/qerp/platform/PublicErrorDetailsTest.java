package com.quoreich.qerp.platform;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Contrat d'erreur public (C-04) : seules une clé enregistrée et ses paramètres déclarés et bornés sortent. */
class PublicErrorDetailsTest {

  @Test
  @DisplayName("clé connue et paramètres déclarés : exposés")
  void cleConnue() {
    var keyed = PublicErrorDetails.of("errors:posting.account_missing", "{\"roles\":[\"AR_RECEIVABLE\"],\"document\":\"FV-1\"}");
    assertThat(keyed).isNotNull();
    assertThat(keyed.key()).isEqualTo("errors:posting.account_missing");
    assertThat(keyed.params()).containsEntry("roles", List.of("AR_RECEIVABLE")).containsEntry("document", "FV-1");
  }

  @Test
  @DisplayName("paramètre non déclaré : ignoré, jamais exposé")
  void parametreNonDeclare() {
    var keyed = PublicErrorDetails.of("errors:i18n.language_not_allowed", "{\"language\":\"de\",\"tenant\":\"secret\"}");
    assertThat(keyed.params()).containsOnlyKeys("language");
  }

  @Test
  @DisplayName("ancien HINT en texte libre, clé inconnue ou non canonique : aucune clé")
  void cleAbsente() {
    assertThat(PublicErrorDetails.of("Associer un compte actif à ce rôle.", null)).isNull();
    assertThat(PublicErrorDetails.of("errors:inconnu.cle", null)).isNull();
    assertThat(PublicErrorDetails.of("i18n:posting.account_missing", null)).isNull();
    assertThat(PublicErrorDetails.of("errors:QG001.account_missing", null)).isNull();
    assertThat(PublicErrorDetails.of(null, "{}")).isNull();
  }

  @Test
  @DisplayName("DETAIL illisible, non objet, trop long ou valeur hors bornes : repli sur le message seul")
  void detailInvalide() {
    String key = "errors:i18n.language_not_allowed";
    assertThat(PublicErrorDetails.of(key, "{pas du json")).isNull();
    assertThat(PublicErrorDetails.of(key, "[\"en\"]")).isNull();
    assertThat(PublicErrorDetails.of(key, "{\"language\":{\"x\":1}}")).isNull();
    assertThat(PublicErrorDetails.of(key, "{\"language\":\"" + "x".repeat(201) + "\"}")).isNull();
    assertThat(PublicErrorDetails.of(key, "{\"language\":\"" + "x".repeat(3000) + "\"}")).isNull();
    assertThat(PublicErrorDetails.of("errors:posting.account_missing",
        "{\"roles\":[" + "\"R\",".repeat(20) + "\"R\"]}")).isNull();
  }

  @Test
  @DisplayName("champs structurés du pilote : Hint et Detail lus, corps compatible (code et error inchangés)")
  void messageDuPilote() {
    SQLException e = new ServerError("Paramétrage comptable incomplet : Clients", "QG001",
        new Fields("errors:posting.account_missing", "{\"roles\": [\"AR_RECEIVABLE\"], \"document\": \"FV-2\"}"));
    Map<String, Object> body = PublicErrorDetails.body("QG001", "Paramétrage comptable incomplet : Clients", e);
    assertThat(body).containsEntry("code", "QG001").containsEntry("key", "errors:posting.account_missing")
        .containsEntry("error", "Paramétrage comptable incomplet : Clients");
    assertThat(body.get("params")).isEqualTo(Map.of("roles", List.of("AR_RECEIVABLE"), "document", "FV-2"));

    SQLException ancien = new ServerError("Refus", "QG026", new Fields("Faire autre chose.", null));
    assertThat(PublicErrorDetails.body("QG026", "Refus", ancien)).containsOnlyKeys("code", "error");
    // Une exception sans champs structurés (autre pilote, erreur réseau) ne porte pas de clé.
    assertThat(PublicErrorDetails.body("QG001", "Refus", new SQLException("ERROR: x\n  Hint: errors:posting.account_missing")))
        .containsOnlyKeys("code", "error");
  }

  /** Même forme que {@code org.postgresql.util.PSQLException} et {@code ServerErrorMessage}. */
  public static final class ServerError extends SQLException {
    private final transient Fields fields;
    ServerError(String message, String state, Fields fields) {
      super(message, state);
      this.fields = fields;
    }
    public Fields getServerErrorMessage() {
      return fields;
    }
  }

  public record Fields(String hint, String detail) {
    public String getHint() {
      return hint;
    }
    public String getDetail() {
      return detail;
    }
  }
}
