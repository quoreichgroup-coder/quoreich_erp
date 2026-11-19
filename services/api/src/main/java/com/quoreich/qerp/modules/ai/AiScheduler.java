package com.quoreich.qerp.modules.ai;

import com.quoreich.qerp.tenant.TenantContextHolder;
import com.quoreich.qerp.tenant.TenantPrincipal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Exécution des analyses IA planifiées sur site (jumeau de la fonction ai-scheduler du nuage). Toutes les
 * {@code qerp.ai.scheduler-delay-ms} (5 min par défaut), les planifications échues sont réservées par
 * {@code qerp_jobs.ai_claim_due_schedules} (V117) et exécutées avec l'identité de la personne qui les a planifiées
 * (ou d'un administrateur de la société), sous la RLS ordinaire. Un échec (fournisseur absent, refus) est tracé
 * dans l'historique par l'analyse elle-même ; la planification avance de toute façon d'une période.
 */
@Component
@ConditionalOnProperty(name = "qerp.ai.scheduler-enabled", havingValue = "true", matchIfMissing = true)
public class AiScheduler {

  @Configuration(proxyBeanMethods = false)
  @EnableScheduling
  @ConditionalOnProperty(name = "qerp.ai.scheduler-enabled", havingValue = "true", matchIfMissing = true)
  static class Activation {}

  private static final Logger log = LoggerFactory.getLogger(AiScheduler.class);
  private static final ObjectMapper JSON = new ObjectMapper();

  public record Due(UUID scheduleId, UUID tenantId, String type, Map<String, Object> params, UUID runAs) {}

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final AiAnalyses analyses;
  private final int batch;

  public AiScheduler(JdbcTemplate jdbc, TransactionTemplate tx, AiAnalyses analyses, @Value("${qerp.ai.scheduler-batch:20}") int batch) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.analyses = analyses;
    this.batch = Math.max(1, batch);
  }

  @Scheduled(initialDelayString = "${qerp.ai.scheduler-delay-ms:300000}", fixedDelayString = "${qerp.ai.scheduler-delay-ms:300000}")
  public void tick() {
    runDue();
  }

  /** Réserve et exécute les planifications échues ; renvoie le nombre traité. */
  public int runDue() {
    TenantContextHolder.clear();
    // Réservation validée tout de suite (sa propre transaction) : une analyse qui échoue ne la défait pas.
    List<Due> due = tx.execute(status -> jdbc.query("SELECT * FROM qerp_jobs.ai_claim_due_schedules(?)", (rs, i) -> new Due(
        rs.getObject("schedule_id", UUID.class), rs.getObject("tenant_id", UUID.class), rs.getString("analysis_type"),
        JSON.readValue(rs.getString("params"), new TypeReference<Map<String, Object>>() {}), rs.getObject("run_as", UUID.class)), batch));
    int ok = 0;
    for (Due d : due) {
      if (d.runAs() == null) {
        log.warn("Analyse planifiée {} ignorée : aucun membre habilité dans la société {}", d.scheduleId(), d.tenantId());
        continue;
      }
      TenantContextHolder.set(new TenantPrincipal(d.runAs(), d.tenantId()));
      try {
        if ("cashflow_forecast".equals(d.type())) analyses.cashflow(d.params(), "scheduled");
        else analyses.anomalies(d.params(), "scheduled");
        ok++;
      } catch (RuntimeException e) {
        log.info("Analyse planifiée {} ({}) non aboutie : {}", d.scheduleId(), d.type(), e.getMessage());
      } finally {
        TenantContextHolder.clear();
      }
    }
    if (!due.isEmpty()) log.info("{}", Map.of("audit", "ai-scheduler", "processed", due.size(), "ok", ok, "failed", due.size() - ok));
    return due.size();
  }
}
