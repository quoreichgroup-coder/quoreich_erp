package com.quoreich.qerp.modules.shell;

import com.quoreich.qerp.tenant.TenantContextHolder;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.text.Normalizer;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
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
import tools.jackson.databind.ObjectMapper;

/**
 * Cours BCEAO publiés (V130) : lecture de la page « Cours des devises contre franc CFA à appliquer aux transferts »
 * (bceao.int, une date à la fois), enregistrement comme cours de référence par {@code import_reference_rates}. Toutes
 * les {@code qerp.rates.bceao-delay-ms} (6 h par défaut) le cours du jour est repris ; un cours passé se reprend à la
 * demande. Jumeau de la fonction bceao-rates du nuage. Aucune donnée de la société n'est envoyée : une simple lecture
 * de page publique.
 */
@Component
public class BceaoRates {

  @Configuration(proxyBeanMethods = false)
  @EnableScheduling
  @ConditionalOnProperty(name = "qerp.rates.bceao-enabled", havingValue = "true", matchIfMissing = true)
  static class Activation {}

  private static final Logger log = LoggerFactory.getLogger(BceaoRates.class);
  private static final ObjectMapper JSON = new ObjectMapper();
  static final String SOURCE = "BCEAO — cours des transferts";
  private static final Map<String, String> CURRENCIES = Map.of(
      "euro", "EUR", "dollar us", "USD", "yen japonais", "JPY", "livre sterling", "GBP", "franc suisse", "CHF",
      "dollar canadien", "CAD", "yuan chinois", "CNY", "dirham emirats arabes unis", "AED");
  private static final Map<String, Integer> MONTHS = Map.ofEntries(Map.entry("janvier", 1), Map.entry("fevrier", 2), Map.entry("mars", 3),
      Map.entry("avril", 4), Map.entry("mai", 5), Map.entry("juin", 6), Map.entry("juillet", 7), Map.entry("aout", 8),
      Map.entry("septembre", 9), Map.entry("octobre", 10), Map.entry("novembre", 11), Map.entry("decembre", 12));
  private static final Pattern ROW = Pattern.compile("<tr>\\s*<td>([^<]+)</td>\\s*<td>([0-9 .,\\u00a0]+)</td>\\s*<td>([0-9 .,\\u00a0]+)</td>", Pattern.CASE_INSENSITIVE);
  private static final Pattern TITLE = Pattern.compile("Cours des devises du\\s+\\S+\\s+(\\d{1,2})\\s+([^\\s<]+)\\s+(\\d{4})", Pattern.CASE_INSENSITIVE);

  public record Rate(String currency, BigDecimal buy, BigDecimal sell) {}

  public record Published(LocalDate date, List<Rate> rates) {}

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final String url;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).followRedirects(HttpClient.Redirect.NORMAL).build();

  public BceaoRates(JdbcTemplate jdbc, TransactionTemplate tx,
      @Value("${qerp.rates.bceao-url:https://www.bceao.int/fr/cours/get_all_devise_by_date}") String url) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.url = url;
  }

  private static String key(String name) {
    return Normalizer.normalize(name.strip().toLowerCase(), Normalizer.Form.NFD).replaceAll("\\p{M}", "").replaceAll("\\s+", " ");
  }

  private static BigDecimal number(String s) {
    return new BigDecimal(s.replace(" ", "").replace(" ", "").replace(".", "").replace(",", "."));
  }

  /** Lit le tableau publié ; la date est celle du titre de la page (un jour non ouvré renvoie le dernier cours publié). */
  public static Published parse(String html) {
    LocalDate date = null;
    Matcher t = TITLE.matcher(html);
    if (t.find()) {
      Integer month = MONTHS.get(key(t.group(2)));
      if (month != null) date = LocalDate.of(Integer.parseInt(t.group(3)), month, Integer.parseInt(t.group(1)));
    }
    List<Rate> rates = new ArrayList<>();
    Matcher m = ROW.matcher(html);
    while (m.find()) {
      String code = CURRENCIES.get(key(m.group(1)));
      if (code != null) rates.add(new Rate(code, number(m.group(2)), number(m.group(3))));
    }
    return new Published(date, rates);
  }

  private Published fetch(LocalDate day) throws java.io.IOException, InterruptedException {
    HttpRequest req = HttpRequest.newBuilder(URI.create(url + "?dateJour=" + day)).timeout(Duration.ofSeconds(30))
        .header("User-Agent", "QERP-cours-BCEAO/1.0").GET().build();
    HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
    if (res.statusCode() != 200) throw new IllegalStateException("BCEAO : réponse " + res.statusCode());
    return parse(res.body());
  }

  /**
   * Reprend les cours publiés pour une date ; un jour sans publication (week-end, férié, cours du jour pas encore
   * publié) reprend le dernier jour publié dans les 7 jours précédents. Renvoie la date publiée et le nombre de cours.
   */
  public Map<String, Object> importDate(LocalDate requested) {
    try {
      Published p = null;
      for (int back = 0; back < 7 && (p == null || p.rates().isEmpty()); back++) p = fetch(requested.minusDays(back));
      if (p == null || p.date() == null || p.rates().isEmpty()) throw new IllegalStateException("BCEAO : aucun cours publié du " + requested.minusDays(6) + " au " + requested);
      final Published published = p;
      String rates = JSON.writeValueAsString(published.rates().stream().map(r -> Map.of("currency", r.currency(), "buy", r.buy(), "sell", r.sell())).toList());
      Integer n = tx.execute(s -> jdbc.queryForObject("SELECT public.import_reference_rates('XOF', ?::date, ?, ?::jsonb)", Integer.class,
          published.date().toString(), SOURCE, rates));
      return Map.of("published_date", published.date().toString(), "imported", n == null ? 0 : n);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("BCEAO : lecture interrompue", e);
    } catch (java.io.IOException e) {
      throw new IllegalStateException("BCEAO : site injoignable (" + e.getMessage() + ")", e);
    }
  }

  /** Reprise périodique du cours du jour ; désactivable (qerp.rates.bceao-enabled=false), toujours désactivée en test. */
  @Component
  @ConditionalOnProperty(name = "qerp.rates.bceao-enabled", havingValue = "true", matchIfMissing = true)
  static class Daily {
    private final BceaoRates rates;

    Daily(BceaoRates rates) {
      this.rates = rates;
    }

    @Scheduled(initialDelayString = "${qerp.rates.bceao-initial-delay-ms:120000}", fixedDelayString = "${qerp.rates.bceao-delay-ms:21600000}")
    public void run() {
      TenantContextHolder.clear();
      try {
        log.info("Cours BCEAO repris : {}", rates.importDate(LocalDate.now()));
      } catch (RuntimeException e) {
        log.warn("Cours BCEAO non repris : {}", e.getMessage());
      }
    }
  }
}
