package com.quoreich.qerp.modules.documents;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.quoreich.qerp.platform.ApiRefusal;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "Éditions de documents", description = "Modèles versionnés et archives des factures clients")
public class DocumentEditionsController {
  private final DocumentEditionsQuery query;
  private final DocumentEditionsService editions;

  DocumentEditionsController(DocumentEditionsQuery query, DocumentEditionsService editions) {
    this.query = query;
    this.editions = editions;
  }

  @GetMapping("/document-templates")
  @Operation(operationId = "listDocumentTemplates", summary = "Lister les modèles de document et leurs versions")
  public JsonNode templates(@RequestParam(required = false) String docType) {
    if (docType != null && !docType.equals("purchase_order") && !docType.equals("ar_invoice")) {
      throw new ApiRefusal(422, "Type de document inconnu");
    }
    return query.templates(docType == null ? "ar_invoice" : docType);
  }

  @PostMapping("/document-templates/purchase-orders/defaults")
  @Operation(operationId = "installPurchaseOrderTemplates", summary = "Installer les deux modèles de bon de commande")
  public JsonNode installPurchaseOrderTemplates() {
    return query.installPurchaseOrderTemplates();
  }

  @PostMapping("/document-templates")
  @Operation(operationId = "saveDocumentTemplate", summary = "Enregistrer une nouvelle version de modèle")
  public JsonNode saveTemplate(@RequestBody SaveTemplate request) {
    return query.saveTemplate(request.id(), request.name(), request.layout(), request.reason());
  }

  @PostMapping("/document-templates/{version}/publish")
  @Operation(operationId = "publishDocumentTemplate", summary = "Publier une version de modèle")
  public JsonNode publish(@PathVariable UUID version, @RequestBody Publication request) {
    return query.publishTemplate(version, request.reason());
  }

  @PostMapping("/document-templates/{template}/default")
  @Operation(operationId = "setDefaultDocumentTemplate", summary = "Définir le modèle par défaut du type de document")
  public JsonNode setDefaultTemplate(@PathVariable UUID template) {
    return query.setDefaultTemplate(template);
  }

  @GetMapping("/document-editions")
  @Operation(operationId = "listDocumentEditions", summary = "Lister les éditions d’une facture client")
  public JsonNode list(@RequestParam(required = false) UUID invoiceId, @RequestParam(required = false) UUID poId) {
    if ((invoiceId == null) == (poId == null)) throw new ApiRefusal(422, "Indiquez une seule facture ou commande");
    return query.editions(invoiceId, poId);
  }

  @PostMapping("/document-editions")
  @Operation(operationId = "requestDocumentEdition", summary = "Demander une édition ou reprendre l’édition existante")
  public JsonNode request(@RequestBody IssueDocument request) {
    if (request == null || (request.invoiceId() == null) == (request.poId() == null)) {
      throw new ApiRefusal(422, "Indiquez une seule facture ou commande");
    }
    return editions.request(request.invoiceId(), request.poId(), request.templateId(), request.replaceId(), request.reason());
  }

  @PostMapping("/document-editions/{id}/retry")
  @Operation(operationId = "retryDocumentEdition", summary = "Relancer le rendu de la même édition")
  public JsonNode retry(@PathVariable UUID id) {
    return editions.retry(id);
  }

  @GetMapping(value = "/document-editions/{id}/download", produces = MediaType.APPLICATION_PDF_VALUE)
  @Operation(operationId = "downloadDocumentEdition", summary = "Télécharger le PDF archivé d’une édition prête")
  public ResponseEntity<byte[]> download(@PathVariable UUID id) {
    var pdf = editions.download(id);
    return ResponseEntity.ok().cacheControl(CacheControl.noStore())
        .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(pdf.filename()).build().toString())
        .contentType(MediaType.APPLICATION_PDF).contentLength(pdf.bytes().length).body(pdf.bytes());
  }

  public record SaveTemplate(UUID id, String name, JsonNode layout, String reason) {}

  public record Publication(String reason) {}

  public record IssueDocument(@JsonProperty("invoice_id") UUID invoiceId, @JsonProperty("po_id") UUID poId,
      @JsonProperty("template_id") UUID templateId,
      @JsonProperty("replace_id") UUID replaceId, String reason) {}
}
