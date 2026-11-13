package com.quoreich.qerp.customer;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Lecture et écriture des clients de la société de l'appelant.
 *
 * <h2>Les requêtes ne filtrent pas par société, et c'est délibéré</h2>
 * Il n'y a ni {@code WHERE tenant_id = ...} ni paramètre de société. La clause serait redondante
 * avec les politiques RLS et, surtout, elle donnerait l'illusion que l'isolation dépend du code
 * applicatif. Elle n'en dépend pas : elle dépend de la connexion, sur laquelle
 * {@code TenantAwareDataSource} a posé {@code request.jwt.claims}, et de la politique
 * {@code tenant_id = get_user_tenant_id(auth.uid())}. Sans contexte de session, la lecture renvoie
 * <strong>zéro ligne</strong> (vérifié par {@code TenantIsolationIT}) et l'écriture est refusée.
 *
 * <p>À l'insertion, la société est celle du profil ({@code get_user_tenant_id(auth.uid())}), jamais
 * une valeur du client : la RLS refuserait de toute façon une autre société.
 */
@Repository
public class CustomerQuery {

  private static final String COLONNES =
      "id, name, status, email, phone, address, tax_id, COALESCE(credit_limit, 0) AS credit_limit,"
          + " COALESCE(payment_terms, 30) AS payment_terms";

  private static final RowMapper<CustomerView> VUE =
      (rs, rowNum) ->
          new CustomerView(
              rs.getObject("id", UUID.class),
              rs.getString("name"),
              rs.getString("status"),
              rs.getString("email"),
              rs.getString("phone"),
              rs.getString("address"),
              rs.getString("tax_id"),
              rs.getBigDecimal("credit_limit"),
              rs.getInt("payment_terms"));

  private final JdbcTemplate jdbc;

  public CustomerQuery(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(readOnly = true)
  public List<CustomerView> findVisible() {
    return jdbc.query("SELECT " + COLONNES + " FROM customers ORDER BY name", VUE);
  }

  @Transactional
  public CustomerView create(CustomerInput in) {
    return jdbc.queryForObject(
        "INSERT INTO customers (tenant_id, name, email, phone, address, tax_id, credit_limit, payment_terms)"
            + " VALUES (get_user_tenant_id(auth.uid()), ?, ?, ?, ?, ?, ?, ?) RETURNING " + COLONNES,
        VUE,
        in.name().strip(), in.cleanEmail(), blank(in.phone()), blank(in.address()), blank(in.taxId()),
        in.creditLimitOrZero(), in.paymentTermsOrDefault());
  }

  /** Mise à jour d'une fiche de la société ; {@code null} si elle n'est pas visible (404). */
  @Transactional
  public CustomerView update(UUID id, CustomerInput in) {
    List<CustomerView> rows =
        jdbc.query(
            "UPDATE customers SET name = ?, email = ?, phone = ?, address = ?, tax_id = ?, credit_limit = ?,"
                + " payment_terms = ? WHERE id = ? RETURNING " + COLONNES,
            VUE,
            in.name().strip(), in.cleanEmail(), blank(in.phone()), blank(in.address()), blank(in.taxId()),
            in.creditLimitOrZero(), in.paymentTermsOrDefault(), id);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  private static String blank(String s) {
    return s == null || s.isBlank() ? null : s.strip();
  }
}
