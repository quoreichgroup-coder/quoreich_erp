package com.quoreich.qerp.hr;

import com.quoreich.qerp.tenant.TenantContextHolder;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V153 — acquisition automatique des congés sur site : chaque jour, {@code qerp_jobs.hr_leave_accrue_all} rattrape,
 * pour toutes les sociétés, les mois complets écoulés des types à acquisition automatique (une seule fois par mois
 * et par type). Dans le nuage, le même rattrapage a lieu à chaque lecture des soldes et avant chaque approbation.
 */
@Component
@ConditionalOnProperty(name = "qerp.hr.accrual-enabled", havingValue = "true", matchIfMissing = true)
public class HrLeaveAccrualJob {

  @Configuration(proxyBeanMethods = false)
  @EnableScheduling
  @ConditionalOnProperty(name = "qerp.hr.accrual-enabled", havingValue = "true", matchIfMissing = true)
  static class Activation {}

  private static final Logger log = LoggerFactory.getLogger(HrLeaveAccrualJob.class);
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;

  public HrLeaveAccrualJob(JdbcTemplate jdbc, TransactionTemplate tx) {
    this.jdbc = jdbc;
    this.tx = tx;
  }

  @Scheduled(initialDelayString = "${qerp.hr.accrual-initial-delay-ms:600000}", fixedDelayString = "${qerp.hr.accrual-delay-ms:86400000}")
  public void tick() {
    runDue();
  }

  /** Rattrape les acquisitions échues ; renvoie le nombre d'écritures d'acquisition créées. */
  public int runDue() {
    TenantContextHolder.clear();
    Integer count = tx.execute(status -> jdbc.queryForObject("SELECT qerp_jobs.hr_leave_accrue_all()", Integer.class));
    int n = count == null ? 0 : count;
    if (n > 0) log.info("{}", Map.of("audit", "hr-leave-accrual", "entries", n));
    return n;
  }
}
