package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * V138 — pièces jointes : enregistrement contrôlé (droit, pièce de la société, chemin, taille, type, catégorie), table en
 * lecture seule, suppression tracée (auteur avant validation, droit documents.delete après), exigence de pièce jointe à la
 * soumission d'une facture fournisseur.
 */
@SpringBootTest
class PiecesJointesIT {

  private static final String DATABASE = "qerp_it_pieces_jointes";
  private static final String T = "33333333-3333-3333-3333-333333333138";
  private static final String U = "cccccccc-0000-0000-0000-000000000138";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  private static void owner(String sql) {
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), sql);
  }

  private static String texte(String sql) {
    return PostgresFixture.textAsAdmin(DATABASE, sql);
  }

  /** Membre au nom duquel agit asUser (administrateur par défaut). */
  private static String who = U;
  private static final String U2 = "22222222-2222-2222-2222-222222222138";

  private static String asUser(String sql) throws SQLException {
    try (Connection c = DriverManager.getConnection(PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims = c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + who + "\",\"role\":\"authenticated\"}");
        claims.execute();
      }
      try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
        String r = rs.next() ? rs.getString(1) : null;
        c.commit();
        return r;
      } catch (SQLException e) {
        c.rollback();
        throw e;
      }
    }
  }

  private static final String F = "00000000-0000-0000-0000-0000000f0138";
  private static final String I = "00000000-0000-0000-0000-00000000f138";
  private static final String T2 = "33333333-3333-3333-3333-333333332138";
  private static final String I2 = "00000000-0000-0000-0000-00000002f138";

  private String reg(String type, String doc, String file, String mime, long size, String category) throws SQLException {
    return asUser("SELECT register_attachment('" + type + "', '" + doc + "', '" + T + "/" + type + "/" + doc + "/" + file + "', '" + file + "', '"
        + mime + "', " + size + ", NULL, " + (category == null ? "NULL" : "'" + category + "'") + ")::text");
  }

  @Test
  @DisplayName("enregistrement contrôlé, lecture seule, suppression tracée, pièce exigée à la soumission")
  void piecesJointes() throws SQLException {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    owner("INSERT INTO tenants (id, name) VALUES ('" + T + "', 'Société V138'), ('" + T2 + "', 'Autre V138') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO auth.users (id) VALUES ('" + U2 + "') ON CONFLICT DO NOTHING;"
        + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('" + U + "', '" + T + "', 'Comptable V138'), ('" + U2 + "', '" + T + "', 'Gestionnaire V138') ON CONFLICT (id) DO NOTHING;"
        + "INSERT INTO suppliers (id, tenant_id, name) VALUES ('" + F + "', '" + T + "', 'Fournisseur V138'), ('00000000-0000-0000-0000-00000002f038', '" + T2 + "', 'Autre');"
        + "INSERT INTO ap_invoices (id, tenant_id, invoice_number, supplier_id, invoice_date, due_date, subtotal, tax_amount, total, status, approval_status, created_by) VALUES"
        + " ('" + I + "', '" + T + "', 'F-138', '" + F + "', '2031-03-01', '2031-04-01', 1000, 0, 1000, 'draft', 'draft', '" + U + "'),"
        + " ('" + I2 + "', '" + T2 + "', 'F-AUTRE', '00000000-0000-0000-0000-00000002f038', '2031-03-01', '2031-04-01', 1000, 0, 1000, 'draft', 'draft', '" + U + "')");
    PostgresFixture.applySyscohada(DATABASE, T);
    PostgresFixture.grantRoles(DATABASE, U, "admin", T);
    PostgresFixture.grantRoles(DATABASE, U2, "manager", T);

    assertThat(asUser("SELECT ensure_attachment_categories()::text")).isEqualTo("8");
    String facture = texte("SELECT id::text FROM attachment_categories WHERE tenant_id = '" + T + "' AND code = 'FACTURE'");
    String douane = texte("SELECT id::text FROM attachment_categories WHERE tenant_id = '" + T + "' AND code = 'DOUANE'");

    String a = reg("ap_invoice", I, "scan.pdf", "application/pdf", 2048, facture);
    assertThat(asUser("SELECT file_name || ' ' || size_bytes FROM document_attachments WHERE id = '" + a + "'")).isEqualTo("scan.pdf 2048");
    assertThatThrownBy(() -> reg("ap_invoice", I, "gros.pdf", "application/pdf", 11L * 1024 * 1024, null)).hasMessageContaining("plus de 10 Mo");
    assertThatThrownBy(() -> reg("ap_invoice", I, "prog.exe", "application/x-msdownload", 10, null)).hasMessageContaining("non admis");
    assertThatThrownBy(() -> reg("ap_invoice", I, "x.pdf", "application/pdf", 10, douane)).hasMessageContaining("ne s'applique pas");
    assertThatThrownBy(() -> asUser("SELECT register_attachment('ap_invoice', '" + I2 + "', '" + T + "/ap_invoice/" + I2 + "/x.pdf', 'x.pdf', 'application/pdf', 10)::text"))
        .as("pièce d'une autre société").hasMessageContaining("introuvable");
    assertThatThrownBy(() -> asUser("SELECT register_attachment('ap_invoice', '" + I + "', '" + T2 + "/ap_invoice/" + I + "/x.pdf', 'x.pdf', 'application/pdf', 10)::text"))
        .as("chemin hors de la société").hasMessageContaining("Emplacement");
    assertThatThrownBy(() -> asUser("INSERT INTO document_attachments (tenant_id, doc_type, doc_id, file_name, mime_type, size_bytes, storage_path)"
        + " VALUES ('" + T + "', 'ap_invoice', '" + I + "', 'y', 'application/pdf', 1, 'y') RETURNING id::text")).hasMessageContaining("permission denied");

    // Exigence : la soumission d'une facture fournisseur attend une « Facture du fournisseur » jointe.
    owner("UPDATE attachment_categories SET required_for = ARRAY['ap_invoice'] WHERE id = '" + facture + "'");
    asUser("SELECT delete_attachment('" + a + "', 'Mauvais scan')::text");
    assertThat(texte("SELECT delete_reason FROM document_attachments WHERE id = '" + a + "'")).as("suppression tracée, ligne gardée").isEqualTo("Mauvais scan");
    assertThatThrownBy(() -> owner("UPDATE ap_invoices SET approval_status = 'submitted' WHERE id = '" + I + "'")).hasMessageContaining("Facture du fournisseur");
    who = U2;
    String b = reg("ap_invoice", I, "scan2.pdf", "application/pdf", 4096, facture);
    who = U;
    owner("UPDATE ap_invoices SET approval_status = 'submitted' WHERE id = '" + I + "'");

    // Pièce validée : l'auteur ne supprime plus sans le droit documents.delete ; l'administrateur le peut, avec motif.
    owner("UPDATE ap_invoices SET approval_status = 'approved', status = 'open' WHERE id = '" + I + "'");
    who = U2;
    assertThatThrownBy(() -> asUser("SELECT delete_attachment('" + b + "', 'Erreur')::text")).as("auteur, pièce validée").hasMessageContaining("archivées");
    who = U;
    assertThatThrownBy(() -> asUser("SELECT delete_attachment('" + b + "', ' ')::text")).hasMessageContaining("motif");
    asUser("SELECT delete_attachment('" + b + "', 'Doublon')::text");
    assertThat(texte("SELECT count(*) FROM document_attachments WHERE doc_id = '" + I + "' AND deleted_at IS NULL")).isEqualTo("0");
  }
}
