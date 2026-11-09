package com.quoreich.qerp.customer;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * Lecture des clients visibles par l'appelant.
 *
 * <h2>La requête ne filtre pas par société, et c'est délibéré</h2>
 * Il n'y a ni {@code WHERE tenant_id = ...} ni paramètre de société. La clause
 * serait redondante avec les 157 politiques RLS et, surtout, elle donnerait
 * l'illusion que l'isolation dépend du code applicatif. Elle n'en dépend pas :
 * elle dépend de la connexion, sur laquelle {@code TenantAwareDataSource} a posé
 * {@code request.jwt.claims}, et de la politique
 * {@code tenant_id = get_user_tenant_id(auth.uid())}.
 *
 * <p>Conséquence directe : si ce code est appelé sans contexte de session, il ne
 * renvoie pas « tout » mais <strong>zéro ligne</strong>. C'est vérifié par
 * {@code TenantIsolationIT}.
 *
 * <p>{@code readOnly = true} borne la transaction et signale l'intention au
 * pilote. Elle n'est pas une mesure de sécurité — une écriture refusée par
 * {@code readOnly} le serait de toute façon par la politique RLS.
 */
@Repository
public class CustomerQuery {

  private final JdbcTemplate jdbc;

  public CustomerQuery(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(readOnly = true)
  public List<CustomerView> findVisible() {
    return jdbc.query(
        "SELECT id, name, status FROM customers ORDER BY name",
        (rs, rowNum) ->
            new CustomerView(rs.getObject("id", java.util.UUID.class), rs.getString("name"),
                rs.getString("status")));
  }
}
