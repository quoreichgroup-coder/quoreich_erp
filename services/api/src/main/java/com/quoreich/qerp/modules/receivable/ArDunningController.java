package com.quoreich.qerp.modules.receivable;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/v1/ar/dunning")
@Tag(name = "Relances clients", description = "Aperçu et envoi manuel des relances par courriel")
public class ArDunningController {
  private final Sql sql;
  private final String host;
  private final int port;
  private final String username;
  private final String password;
  private final String from;
  private final boolean startTls;

  ArDunningController(Sql sql,
      @Value("${qerp.smtp.host:}") String host,
      @Value("${qerp.smtp.port:587}") int port,
      @Value("${qerp.smtp.username:}") String username,
      @Value("${qerp.smtp.password:}") String password,
      @Value("${qerp.smtp.from:}") String from,
      @Value("${qerp.smtp.starttls:true}") boolean startTls) {
    this.sql = sql;
    this.host = host;
    this.port = port;
    this.username = username;
    this.password = password;
    this.from = from;
    this.startTls = startTls;
  }

  @GetMapping("/candidates")
  @Operation(operationId = "listArDunningCandidates", summary = "Lister les prochaines relances par courriel éligibles")
  public JsonNode candidates() {
    return sql.call("ar_dunning_candidates");
  }

  @GetMapping("/status")
  @Operation(operationId = "getArDunningDeliveryStatus", summary = "Vérifier si le serveur SMTP est configuré")
  public Map<String, Boolean> status() {
    return Map.of("configured", configured());
  }

  @PostMapping("/probe")
  @Operation(operationId = "probeArDunningDelivery", summary = "Tester la connexion SMTP sans envoyer de message")
  public Map<String, Boolean> probe() {
    if (!configured()) throw new ApiRefusal(503, "Le service SMTP n’est pas configuré");
    try {
      JavaMailSenderImpl sender = new JavaMailSenderImpl();
      sender.setHost(host); sender.setPort(port); sender.setUsername(username); sender.setPassword(password);
      sender.getJavaMailProperties().put("mail.smtp.auth", Boolean.toString(!username.isBlank()));
      sender.getJavaMailProperties().put("mail.smtp.starttls.enable", Boolean.toString(startTls));
      sender.getJavaMailProperties().put("mail.smtp.starttls.required", Boolean.toString(startTls));
      sender.getJavaMailProperties().put("mail.smtp.connectiontimeout", "5000");
      sender.getJavaMailProperties().put("mail.smtp.timeout", "10000");
      sender.testConnection();
      return Map.of("ok", true);
    } catch (Exception e) {
      return Map.of("ok", false);
    }
  }

  @GetMapping("/history")
  @Operation(operationId = "listArDunningHistory", summary = "Consulter les relances et leur statut d’envoi")
  public JsonNode history() {
    return sql.list("SELECT * FROM public.ar_dunning_events WHERE tenant_id=public.get_user_tenant_id(auth.uid()) ORDER BY created_at DESC LIMIT 200");
  }

  @PostMapping("/{invoiceId}/send")
  @Operation(operationId = "sendArDunningEmail", summary = "Envoyer une relance par courriel après confirmation")
  public JsonNode send(@PathVariable UUID invoiceId, @RequestBody SendDunning request) {
    if (request == null || request.ruleId() == null) throw new ApiRefusal(422, "La règle de relance est obligatoire");
    if (!configured()) throw new ApiRefusal(503, "Le service SMTP n’est pas configuré");
    JsonNode event = sql.call("prepare_ar_dunning_event", Sql.args("_invoice_id", invoiceId, "_rule_id", request.ruleId()));
    UUID eventId = UUID.fromString(event.path("id").asText());
    JsonNode claimed = sql.call("claim_ar_dunning_event", Map.of("_event_id", eventId));
    // Une fonction PL/pgSQL qui retourne un composite NULL peut être sérialisée
    // par PostgreSQL comme un objet dont tous les champs sont nuls.
    if (claimed == null || claimed.isNull() || claimed.isMissingNode()
        || !"sending".equals(claimed.path("status").asText())) return event;

    try {
      sendMessage(claimed);
    } catch (jakarta.mail.internet.AddressException e) {
      return sql.call("finish_ar_dunning_event", Sql.args("_event_id", eventId, "_outcome", "failed", "_error", "Adresse de destination invalide"));
    } catch (Exception e) {
      String detail = e.getClass().getSimpleName() + ": échec ou acceptation SMTP impossible à confirmer";
      return sql.call("finish_ar_dunning_event", Sql.args("_event_id", eventId, "_outcome", "uncertain", "_error", detail));
    }
    return sql.call("finish_ar_dunning_event", Sql.args("_event_id", eventId, "_outcome", "sent", "_error", null));
  }

  private boolean configured() {
    if (host.isBlank() || port <= 0 || port > 65535 || from.isBlank()
        || !((username.isBlank() && password.isBlank()) || (!username.isBlank() && !password.isBlank()))) return false;
    try {
      var address = new jakarta.mail.internet.InternetAddress(from, true);
      address.validate();
      return true;
    } catch (jakarta.mail.internet.AddressException e) {
      return false;
    }
  }

  private void sendMessage(JsonNode event) throws Exception {
    String recipient = event.path("recipient").asText();
    var address = new jakarta.mail.internet.InternetAddress(recipient, true);
    address.validate();
    JavaMailSenderImpl sender = new JavaMailSenderImpl();
    sender.setHost(host);
    sender.setPort(port);
    sender.setUsername(username);
    sender.setPassword(password);
    sender.setDefaultEncoding("UTF-8");
    sender.getJavaMailProperties().put("mail.smtp.auth", Boolean.toString(!username.isBlank()));
    sender.getJavaMailProperties().put("mail.smtp.starttls.enable", Boolean.toString(startTls));
    sender.getJavaMailProperties().put("mail.smtp.starttls.required", Boolean.toString(startTls));
    sender.getJavaMailProperties().put("mail.smtp.connectiontimeout", "5000");
    sender.getJavaMailProperties().put("mail.smtp.timeout", "10000");
    sender.getJavaMailProperties().put("mail.smtp.writetimeout", "10000");
    var message = sender.createMimeMessage();
    var helper = new MimeMessageHelper(message, false, "UTF-8");
    helper.setFrom(from);
    helper.setTo(address);
    helper.setSubject(event.path("subject").asText());
    helper.setText(event.path("message").asText(), false);
    sender.send(message);
  }

  public record SendDunning(@JsonProperty("rule_id") UUID ruleId) {}
}
