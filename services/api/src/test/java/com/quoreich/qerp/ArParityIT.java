package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.quoreich.qerp.tenant.TenantContextHolder;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

/**
 * Parité AR : le chemin API produit en base exactement ce que produit le chemin historique.
 *
 * <p>Le chemin historique est celui du client web sur Supabase ({@code use-ar-data.ts}) : un
 * INSERT direct de la facture en {@code status = 'sent'} avec le total calculé par le navigateur,
 * puis un INSERT direct de l'encaissement. Il est rejoué ici tel quel, en SQL, sous le rôle
 * {@code authenticated} avec les mêmes claims que PostgREST — donc sous les mêmes politiques et
 * les mêmes triggers. Les deux chemins reçoivent les mêmes montants ; on compare ensuite, en
 * propriétaire, la facture, son écriture et les écritures d'encaissement, ligne à ligne par compte.
 *
 * <p>La société Alpha applique le référentiel SYSCOHADA révisé (V18) : les écritures portent donc
 * les comptes 411, 701, 4431 et 521, résolus par rôle comptable et non plus codés en dur.
 *
 * <p>Les deux chemins écrivent dans la même base, migrée jusqu'à V16 : la parité porte sur la
 * logique (API contre INSERT direct), pas sur deux schémas.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ArParityIT {

  private static final String DATABASE = "qerp_it_ar_parity";
  private static final String CUSTOMER_ALPHA = "c0000001-0000-0000-0000-000000000000";
  private static final String ALPHA_VIEWER = "aaaaaaaa-0000-0000-0000-000000000003";

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private MockMvc mockMvc;
  @Autowired private ObjectMapper json;

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    String a = PostgresFixture.ALPHA_TENANT;
    PostgresFixture.applySyscohada(DATABASE, a);
    PostgresFixture.execute(
        PostgresFixture.urlOf(DATABASE),
        "INSERT INTO auth.users (id) VALUES ('"
            + ALPHA_VIEWER
            + "') ON CONFLICT DO NOTHING;"
            + "INSERT INTO profiles (id, tenant_id, full_name) VALUES ('"
            + ALPHA_VIEWER
            + "', '"
            + a
            + "', 'Lecteur Alpha') ON CONFLICT (id) DO NOTHING");
    // Beta : administrateur, mais société SANS plan comptable (cas constaté en production).
    PostgresFixture.grantRoles(DATABASE, PostgresFixture.ALPHA_USER, "accountant", a, ALPHA_VIEWER, "viewer", a,
        PostgresFixture.BETA_USER, "admin", PostgresFixture.BETA_TENANT);
    TenantContextHolder.clear();
  }

  // ─── Chemin historique : ce que fait le client web via PostgREST ───

  /** Exécute une instruction sous l'identité d'un utilisateur, comme PostgREST. */
  private static String asUser(String user, String sql, Object... params) throws SQLException {
    try (Connection c =
        DriverManager.getConnection(
            PostgresFixture.urlOf(DATABASE), PostgresFixture.API_USER, PostgresFixture.API_PASSWORD)) {
      c.setAutoCommit(false);
      try (PreparedStatement claims =
          c.prepareStatement("SELECT set_config('request.jwt.claims', ?, true)")) {
        claims.setString(1, "{\"sub\":\"" + user + "\",\"role\":\"authenticated\"}");
        claims.execute();
      }
      try (PreparedStatement st = c.prepareStatement(sql)) {
        for (int i = 0; i < params.length; i++) st.setObject(i + 1, params[i]);
        String result = null;
        if (st.execute()) {
          try (ResultSet rs = st.getResultSet()) {
            if (rs.next()) result = rs.getString(1);
          }
        }
        c.commit();
        return result;
      } catch (SQLException e) {
        c.rollback();
        throw e;
      }
    }
  }

  /** {@code useCreateARInvoice} sans API : INSERT direct en 'sent', total fourni par le client. */
  private static String legacyCreate(String user, String number, String date) throws SQLException {
    return asUser(
        user,
        "INSERT INTO ar_invoices (invoice_number, customer_id, invoice_date, due_date, subtotal,"
            + " tax_amount, total, tenant_id, created_by, status, amount_paid) VALUES (?, ?::uuid,"
            + " ?::date, '2030-12-31', 1000.00, 180.00, 1180.00, get_user_tenant_id(auth.uid()),"
            + " auth.uid(), 'sent', 0) RETURNING id",
        number,
        CUSTOMER_ALPHA,
        date);
  }

  /** {@code useRecordARPayment} sans API : INSERT direct dans payments. */
  private static void legacyPay(String invoiceId, String amount, String reference)
      throws SQLException {
    asUser(
        PostgresFixture.ALPHA_USER,
        "INSERT INTO payments (ar_invoice_id, amount, payment_date, payment_method, reference,"
            + " tenant_id, payment_type, created_by) VALUES (?::uuid, ?::numeric, '2030-02-01',"
            + " 'bank_transfer', ?, get_user_tenant_id(auth.uid()), 'ar_receipt', auth.uid())",
        invoiceId,
        amount,
        reference);
  }

  // ─── Chemin API ───

  private String apiCreate(String number, String date) throws Exception {
    String body =
        mockMvc
            .perform(
                post("/api/v1/ar/invoices")
                    .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        "{\"invoiceNumber\":\""
                            + number
                            + "\",\"customerId\":\""
                            + CUSTOMER_ALPHA
                            + "\",\"invoiceDate\":\""
                            + date
                            + "\",\"dueDate\":\"2030-12-31\",\"subtotal\":1000.00,"
                            + "\"taxAmount\":180.00}"))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return json.readTree(body).get("id").asString();
  }

  private void apiPay(String invoiceId, String amount, String reference) throws Exception {
    mockMvc
        .perform(
            post("/api/v1/ar/invoices/" + invoiceId + "/payments")
                .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"amount\":"
                        + amount
                        + ",\"paymentDate\":\"2030-02-01\",\"reference\":\""
                        + reference
                        + "\",\"paymentMethod\":\"bank_transfer\"}"))
        .andExpect(status().isOk());
  }

  // ─── Observation, en propriétaire (hors RLS) ───

  private static List<String> rows(String sql, Object... params) {
    List<String> out = new ArrayList<>();
    try (Connection c =
            DriverManager.getConnection(
                PostgresFixture.urlOf(DATABASE),
                PostgresFixture.ADMIN_USER,
                PostgresFixture.ADMIN_PASSWORD);
        PreparedStatement st = c.prepareStatement(sql)) {
      for (int i = 0; i < params.length; i++) st.setObject(i + 1, params[i]);
      try (ResultSet rs = st.executeQuery()) {
        int n = rs.getMetaData().getColumnCount();
        while (rs.next()) {
          StringBuilder row = new StringBuilder();
          for (int i = 1; i <= n; i++) row.append(i > 1 ? " | " : "").append(rs.getString(i));
          out.add(row.toString());
        }
      }
    } catch (SQLException e) {
      throw new IllegalStateException("Observation échouée : " + sql, e);
    }
    return out;
  }

  /**
   * Empreinte comptable d'une facture : facture, écriture de facture, écritures d'encaissement.
   * Ni identifiant, ni numéro, ni horodatage — seulement ce qui doit être identique.
   */
  private static List<String> fingerprint(String invoiceId, String receiptPrefix) {
    List<String> f = new ArrayList<>();
    f.addAll(
        rows(
            "SELECT 'facture', subtotal, tax_amount, total, amount_paid, status,"
                + " journal_entry_id IS NOT NULL FROM ar_invoices WHERE id = ?::uuid",
            invoiceId));
    f.addAll(
        rows(
            "SELECT 'ecriture-facture', je.status, je.source, je.entry_date, a.code, l.debit,"
                + " l.credit FROM ar_invoices i JOIN journal_entries je ON je.id = i.journal_entry_id"
                + " JOIN journal_lines l ON l.entry_id = je.id JOIN gl_accounts a ON a.id ="
                + " l.account_id WHERE i.id = ?::uuid ORDER BY a.code, l.debit, l.credit",
            invoiceId));
    f.addAll(
        rows(
            "SELECT 'ecritures-encaissement', count(DISTINCT je.id), a.code, sum(l.debit),"
                + " sum(l.credit), min(je.status) FROM journal_entries je JOIN journal_lines l ON"
                + " l.entry_id = je.id JOIN gl_accounts a ON a.id = l.account_id WHERE je.source ="
                + " 'ar_receipt' AND je.description LIKE 'AR Receipt: ' || ? || '%' GROUP BY"
                + " a.code ORDER BY a.code",
            receiptPrefix));
    return f;
  }

  @Test
  @DisplayName("facture, paiement partiel, paiement final : même état et mêmes écritures")
  void memeCycleMemesEcritures() throws Exception {
    String legacy = legacyCreate(PostgresFixture.ALPHA_USER, "PAR-HIST-001", "2030-01-15");
    String api = apiCreate("PAR-API-001", "2030-01-15");
    List<String> emise = fingerprint(api, "REC-API-001");
    assertThat(emise).isEqualTo(fingerprint(legacy, "REC-HIST-001"));
    // Comptes SYSCOHADA résolus par rôle : DR 411 TTC, CR 4431 TVA, CR 701 HT.
    assertThat(emise.stream().filter(l -> l.startsWith("ecriture-facture")).toList())
        .containsExactly(
            "ecriture-facture | posted | ar_invoice | 2030-01-15 | 411 | 1180.00 | 0.00",
            "ecriture-facture | posted | ar_invoice | 2030-01-15 | 4431 | 0.00 | 180.00",
            "ecriture-facture | posted | ar_invoice | 2030-01-15 | 701 | 0.00 | 1000.00");

    legacyPay(legacy, "500.00", "REC-HIST-001-a");
    apiPay(api, "500.00", "REC-API-001-a");
    List<String> partiel = fingerprint(api, "REC-API-001");
    assertThat(partiel).isEqualTo(fingerprint(legacy, "REC-HIST-001"));
    assertThat(partiel.getFirst()).contains("500.00").contains("partially_paid");

    legacyPay(legacy, "680.00", "REC-HIST-001-b");
    apiPay(api, "680.00", "REC-API-001-b");
    List<String> solde = fingerprint(api, "REC-API-001");
    assertThat(solde).isEqualTo(fingerprint(legacy, "REC-HIST-001"));
    assertThat(solde.getFirst()).contains("1180.00 | paid");
  }

  /**
   * Le dump branchait {@code on_ap_payment_recorded} par trois triggers sur {@code payments} : chaque
   * encaissement produisait trois écritures identiques. V16 n'en garde qu'un ; ce test vérifie
   * l'effet comptable, une seule écriture DR Banque / CR Clients du montant exact, dans les deux
   * chemins.
   */
  @Test
  @DisplayName("un encaissement produit exactement une écriture, dans les deux chemins")
  void encaissementComptabiliseUneSeuleFois() throws Exception {
    String legacy = legacyCreate(PostgresFixture.ALPHA_USER, "PAR-HIST-002", "2030-01-16");
    String api = apiCreate("PAR-API-002", "2030-01-16");
    legacyPay(legacy, "100.00", "TRIPLE-HIST");
    apiPay(api, "100.00", "TRIPLE-API");

    for (String ref : new String[] {"TRIPLE-HIST", "TRIPLE-API"}) {
      assertThat(
              rows(
                  "SELECT count(DISTINCT je.id), sum(l.debit) FROM journal_entries je JOIN journal_lines l ON"
                      + " l.entry_id = je.id WHERE je.source = 'ar_receipt' AND je.description = ?",
                  "AR Receipt: " + ref))
          .containsExactly("1 | 100.00");
    }
  }

  @Test
  @DisplayName("période close : refus dans les deux chemins, aucune facture ni écriture")
  void periodeCloseRefuseeDansLesDeuxChemins() throws Exception {
    PostgresFixture.execute(
        PostgresFixture.urlOf(DATABASE),
        "INSERT INTO period_locks (tenant_id, period, module, status) SELECT '"
            + PostgresFixture.ALPHA_TENANT
            + "', '2021-03', 'GL', 'closed' WHERE NOT EXISTS (SELECT 1 FROM period_locks WHERE"
            + " tenant_id = '"
            + PostgresFixture.ALPHA_TENANT
            + "' AND period = '2021-03' AND module = 'GL')");
    List<String> avant = rows("SELECT count(*) FROM ar_invoices UNION ALL SELECT count(*) FROM journal_entries");

    assertThatThrownBy(() -> legacyCreate(PostgresFixture.ALPHA_USER, "PAR-HIST-CLOS", "2021-03-10"))
        .isInstanceOf(SQLException.class);
    mockMvc
        .perform(
            post("/api/v1/ar/invoices")
                .with(jwt().jwt(b -> b.subject(PostgresFixture.ALPHA_USER)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"invoiceNumber\":\"PAR-API-CLOS\",\"customerId\":\""
                        + CUSTOMER_ALPHA
                        + "\",\"invoiceDate\":\"2021-03-10\",\"dueDate\":\"2021-04-10\","
                        + "\"subtotal\":1000.00,"
                        + "\"taxAmount\":180.00}"))
        .andExpect(status().isConflict());

    assertThat(rows("SELECT count(*) FROM ar_invoices UNION ALL SELECT count(*) FROM journal_entries"))
        .isEqualTo(avant);
  }

  /**
   * Plan comptable incomplet (V17) : refus dans les deux chemins, sans aucun effet, avec un message
   * qui nomme les comptes. Avant V17, la facture passait sans écriture (WARNING invisible) et
   * l'encaissement passait sans écriture (rien du tout) — c'est ce qu'on a constaté sur le dump.
   */
  @Test
  @DisplayName("plan comptable incomplet : facture puis encaissement refusés dans les deux chemins")
  void planComptableIncompletRefuseSansEffet() throws Exception {
    String b = PostgresFixture.BETA_TENANT;
    String customerBeta = "c0000004-0000-0000-0000-000000000000";
    List<String> avant =
        rows("SELECT count(*) FROM ar_invoices UNION ALL SELECT count(*) FROM journal_entries");

    // 1. Aucun compte : la facture émise est refusée.
    assertThatThrownBy(
            () ->
                asUser(
                    PostgresFixture.BETA_USER,
                    "INSERT INTO ar_invoices (invoice_number, customer_id, invoice_date, due_date,"
                        + " subtotal, tax_amount, total, tenant_id, created_by, status, amount_paid)"
                        + " VALUES ('PAR-HIST-PLAN', ?::uuid, '2030-01-21', '2030-12-31', 1000.00,"
                        + " 180.00, 1180.00, get_user_tenant_id(auth.uid()), auth.uid(), 'sent', 0)",
                    customerBeta))
        .isInstanceOf(SQLException.class)
        .hasMessageContaining("Compte clients (AR_RECEIVABLE), Ventes (SALES_REVENUE), TVA collectée (VAT_OUTPUT)");
    mockMvc
        .perform(
            post("/api/v1/ar/invoices")
                .with(jwt().jwt(j -> j.subject(PostgresFixture.BETA_USER)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"invoiceNumber\":\"PAR-API-PLAN\",\"customerId\":\""
                        + customerBeta
                        + "\",\"invoiceDate\":\"2030-01-21\",\"dueDate\":\"2030-12-31\","
                        + "\"subtotal\":1000.00,\"taxAmount\":180.00}"))
        .andExpect(status().is(422))
        .andExpect(
            jsonPath("$.error")
                .value(
                    "Paramétrage comptable incomplet : Compte clients (AR_RECEIVABLE), Ventes"
                        + " (SALES_REVENUE), TVA collectée (VAT_OUTPUT) ; la facture PAR-API-PLAN ne"
                        + " peut pas être émise"));
    assertThat(rows("SELECT count(*) FROM ar_invoices UNION ALL SELECT count(*) FROM journal_entries"))
        .isEqualTo(avant);

    // 2. Référentiel appliqué, mais le rôle Banque retiré : la facture passe, l'encaissement est
    //    refusé.
    PostgresFixture.applySyscohada(DATABASE, b);
    PostgresFixture.execute(
        PostgresFixture.urlOf(DATABASE),
        "DELETE FROM tenant_posting_accounts WHERE tenant_id = '" + b + "' AND role_code = 'BANK'");
    String facture =
        asUser(
            PostgresFixture.BETA_USER,
            "INSERT INTO ar_invoices (invoice_number, customer_id, invoice_date, due_date,"
                + " subtotal, tax_amount, total, tenant_id, created_by, status, amount_paid)"
                + " VALUES ('PAR-HIST-PLAN-2', ?::uuid, '2030-01-21', '2030-12-31', 1000.00,"
                + " 180.00, 1180.00, get_user_tenant_id(auth.uid()), auth.uid(), 'sent', 0)"
                + " RETURNING id",
            customerBeta);
    List<String> avantPaiement =
        rows(
            "SELECT count(*)::text FROM payments UNION ALL SELECT count(*)::text FROM journal_entries"
                + " UNION ALL SELECT amount_paid || ' ' || status FROM ar_invoices WHERE id = ?::uuid",
            facture);

    assertThatThrownBy(
            () ->
                asUser(
                    PostgresFixture.BETA_USER,
                    "INSERT INTO payments (ar_invoice_id, amount, tenant_id, payment_type,"
                        + " created_by) VALUES (?::uuid, 100.00, get_user_tenant_id(auth.uid()),"
                        + " 'ar_receipt', auth.uid())",
                    facture))
        .isInstanceOf(SQLException.class)
        .hasMessageContaining("Banque (BANK)");
    mockMvc
        .perform(
            post("/api/v1/ar/invoices/" + facture + "/payments")
                .with(jwt().jwt(j -> j.subject(PostgresFixture.BETA_USER)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"amount\":100.00}"))
        .andExpect(status().is(422))
        .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("Banque (BANK)")));
    assertThat(
            rows(
                "SELECT count(*)::text FROM payments UNION ALL SELECT count(*)::text FROM journal_entries"
                    + " UNION ALL SELECT amount_paid || ' ' || status FROM ar_invoices"
                    + " WHERE id = ?::uuid",
                facture))
        .isEqualTo(avantPaiement);
  }

  /**
   * Écart historique résorbé par V42 : le chemin Supabase laissait un lecteur émettre une facture
   * et son écriture ({@code on_ar_invoice_posted} est SECURITY DEFINER) ; la base le refuse
   * désormais, comme l'API. Les deux chemins sont figés ici.
   */
  @Test
  @DisplayName("lecteur : facturation refusée par la base (V42) comme par l'API")
  void lecteurAutoriseHistoriquementRefuseParLApi() throws Exception {
    assertThatThrownBy(() -> legacyCreate(ALPHA_VIEWER, "PAR-HIST-LECTEUR", "2030-01-20"))
        .hasMessageContaining("Droit insuffisant");
    assertThat(rows("SELECT count(*) FROM ar_invoices WHERE invoice_number = 'PAR-HIST-LECTEUR'"))
        .containsExactly("0");

    mockMvc
        .perform(
            post("/api/v1/ar/invoices")
                .with(jwt().jwt(b -> b.subject(ALPHA_VIEWER)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"invoiceNumber\":\"PAR-API-LECTEUR\",\"customerId\":\""
                        + CUSTOMER_ALPHA
                        + "\",\"invoiceDate\":\"2030-01-20\",\"dueDate\":\"2030-12-31\","
                        + "\"subtotal\":1000.00,"
                        + "\"taxAmount\":180.00}"))
        .andExpect(status().isForbidden());
  }
}
