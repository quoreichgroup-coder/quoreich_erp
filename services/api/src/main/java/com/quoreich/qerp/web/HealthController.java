package com.quoreich.qerp.web;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sonde de vivacité sur {@code /health}.
 *
 * <h2>Ce que ce point ne dit pas</h2>
 * Il ne vérifie <strong>pas</strong> la base : il répond « UP » dès que le
 * processus sert des requêtes. C'est la définition d'une sonde de vivacité — si
 * elle testait la base, une base momentanément indisponible ferait redémarrer
 * l'API en boucle, ce qui n'aurait aucune chance de la réparer.
 *
 * <p>La sonde de disponibilité, qui interroge réellement la base, est celle
 * d'Actuator : {@code /actuator/health/readiness}. C'est elle qu'il faut câbler
 * sur un équilibreur de charge. Les deux sont exposées parce qu'elles répondent à
 * deux questions différentes, et que les confondre est l'erreur classique.
 */
@RestController
public class HealthController {

  @GetMapping("/health")
  public Map<String, String> liveness() {
    return Map.of("status", "UP");
  }
}
