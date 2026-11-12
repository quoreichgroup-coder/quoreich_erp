package com.quoreich.qerp.invoice;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Factures clients et encaissements.
 *
 * <p>Aucune règle comptable n'est recodée ici : l'écriture équilibrée, le calcul du total, le
 * solde, le statut et le verrou de période sont ceux des triggers du schéma (parité par
 * construction avec l'implémentation SQL). Aucun filtre société non plus : la RLS s'en charge,
 * comme pour les clients.
 */
@Repository
public class ArInvoiceQuery {

  private static final String COLUMNS =
      "id, invoice_number, customer_id, invoice_date, due_date, subtotal, tax_amount, total,"
          + " amount_paid, status, journal_entry_id";

  private static final RowMapper<ArInvoiceView> MAPPER =
      (rs, i) -> {
        BigDecimal total = rs.getBigDecimal("total");
        BigDecimal paid = rs.getBigDecimal("amount_paid");
        return new ArInvoiceView(
            rs.getObject("id", UUID.class),
            rs.getString("invoice_number"),
            rs.getObject("customer_id", UUID.class),
            rs.getObject("invoice_date", LocalDate.class),
            rs.getObject("due_date", LocalDate.class),
            rs.getBigDecimal("subtotal"),
            rs.getBigDecimal("tax_amount"),
            total,
            paid,
            total.subtract(paid),
            rs.getString("status"),
            rs.getObject("journal_entry_id", UUID.class));
      };

  /**
   * Droit d'écriture AR : {@code admin} ou {@code accountant} <em>dans la société courante</em>.
   *
   * <p>Pourquoi le contrôle est ici et pas laissé à la base : {@code on_ar_invoice_posted} est
   * {@code SECURITY DEFINER}, si bien que l'écriture comptable qu'il insère contourne
   * {@code je_insert_accountant}, et {@code ar_invoices}/{@code payments} n'ont qu'une politique
   * d'isolation société. Sans ce contrôle, un {@code viewer} émettrait facture et écriture. Les
   * rôles retenus sont ceux que la base exige pour écrire une écriture à la main.
   *
   * <p>Plus strict que {@code has_role()}, qui ignore {@code user_roles.tenant_id} : un rôle
   * détenu dans une autre société ne donne aucun droit ici.
   */
  private static final String CAN_WRITE =
      "SELECT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = auth.uid()"
          + " AND r.tenant_id = get_user_tenant_id(auth.uid())"
          + " AND r.role IN ('admin', 'accountant'))";

  private final JdbcTemplate jdbc;

  public ArInvoiceQuery(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  private void requireWriter() {
    if (!Boolean.TRUE.equals(jdbc.queryForObject(CAN_WRITE, Boolean.class))) {
      throw new ArWriteForbidden();
    }
  }

  @Transactional(readOnly = true)
  public List<ArInvoiceView> findVisible() {
    return jdbc.query(
        "SELECT " + COLUMNS + " FROM ar_invoices ORDER BY invoice_date DESC, invoice_number",
        MAPPER);
  }

  @Transactional(readOnly = true)
  public Optional<ArInvoiceView> findById(UUID id) {
    return jdbc.query("SELECT " + COLUMNS + " FROM ar_invoices WHERE id = ?", MAPPER, id).stream()
        .findFirst();
  }

  /**
   * Crée une facture émise : insertion en 'draft', puis passage à 'sent' dans la même transaction.
   *
   * <p>Les deux temps sont nécessaires. À l'INSERT, {@code trg_on_ar_invoice_posted} s'exécute
   * avant {@code trg_validate_ar_invoice} (ordre alphabétique des triggers BEFORE) : le total n'est
   * pas encore calculé et l'écriture serait déséquilibrée (DR=0). Au passage à 'sent', le total est
   * déjà posé et le trigger comptabilise l'écriture équilibrée.
   */
  @Transactional
  public ArInvoiceView create(CreateArInvoice in) {
    requireWriter();
    UUID id =
        jdbc.queryForObject(
            "INSERT INTO ar_invoices (tenant_id, invoice_number, customer_id, invoice_date,"
                + " due_date, subtotal, tax_amount, status, created_by)"
                + " VALUES (get_user_tenant_id(auth.uid()), ?, ?, COALESCE(?, CURRENT_DATE), ?, ?,"
                + " COALESCE(?, 0), 'draft', auth.uid()) RETURNING id",
            UUID.class,
            in.invoiceNumber(),
            in.customerId(),
            in.invoiceDate(),
            in.dueDate(),
            in.subtotal(),
            in.taxAmount());
    // Sections choisies : posées sur la facture encore en brouillon, lues par
    // on_ar_invoice_posted au passage à 'sent'. Une section d'un autre axe, ou d'une autre
    // société (invisible sous la RLS), est refusée ici avec un message clair ; une section
    // inactive l'est à la comptabilisation (QG002), qui connaît la date.
    for (CreateArInvoice.InvoiceAnalytic a : in.analyticsOrEmpty()) {
      Boolean ok =
          jdbc.queryForObject(
              "SELECT EXISTS (SELECT 1 FROM analytic_values v JOIN analytic_axes x ON x.id = v.axis_id"
                  + " WHERE v.id = ? AND v.axis_id = ?)",
              Boolean.class,
              a.valueId(),
              a.axisId());
      if (!Boolean.TRUE.equals(ok)) {
        throw new ArInvoiceUnprocessable("Section analytique inconnue pour cet axe dans la société");
      }
      jdbc.update(
          "INSERT INTO ar_invoice_analytics (tenant_id, invoice_id, axis_id, value_id)"
              + " VALUES (get_user_tenant_id(auth.uid()), ?, ?, ?)",
          id,
          a.axisId(),
          a.valueId());
    }
    jdbc.update("UPDATE ar_invoices SET status = 'sent' WHERE id = ?", id);
    return findById(id).orElseThrow();
  }

  /**
   * Enregistre un encaissement ; vide si la facture n'est pas visible (autre société).
   *
   * <p>Visibilité avant droit : une autre société reçoit 404, pas 403, et n'apprend donc pas que
   * la facture existe.
   */
  @Transactional
  public Optional<ArInvoiceView> pay(UUID invoiceId, RecordArPayment in) {
    if (findById(invoiceId).isEmpty()) {
      return Optional.empty();
    }
    requireWriter();
    jdbc.update(
        "INSERT INTO payments (tenant_id, payment_type, ar_invoice_id, amount, payment_date,"
            + " reference, payment_method, created_by) VALUES (get_user_tenant_id(auth.uid()),"
            + " 'ar_receipt', ?, ?, COALESCE(?, CURRENT_DATE), ?, COALESCE(?, 'bank_transfer'),"
            + " auth.uid())",
        invoiceId,
        in.amount(),
        in.paymentDate(),
        in.reference(),
        in.paymentMethod());
    return findById(invoiceId);
  }
}
