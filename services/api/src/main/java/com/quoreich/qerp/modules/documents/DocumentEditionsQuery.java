package com.quoreich.qerp.modules.documents;

import com.quoreich.qerp.platform.Sql;
import java.util.UUID;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;

@Repository
class DocumentEditionsQuery {
  private final Sql sql;

  DocumentEditionsQuery(Sql sql) {
    this.sql = sql;
  }

  JsonNode templates(String docType) {
    return sql.list("""
        SELECT t.*, (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.version_no DESC), '[]'::jsonb)
                       FROM public.document_template_versions v WHERE v.template_id = t.id) AS versions
        FROM public.document_templates t
        WHERE t.doc_type = ? ORDER BY t.name, t.id
        """, docType);
  }

  JsonNode installPurchaseOrderTemplates() {
    return sql.call("install_purchase_order_templates");
  }

  JsonNode saveTemplate(UUID id, String name, JsonNode layout, String reason, String language) {
    return sql.call("save_document_template", Sql.args("_id", id, "_name", name, "_layout", layout, "_reason", reason, "_language", language));
  }

  JsonNode publishTemplate(UUID version, String reason) {
    return sql.call("publish_document_template", Sql.args("_version", version, "_reason", reason));
  }

  JsonNode setDefaultTemplate(UUID template) {
    return sql.call("set_default_document_template", Sql.args("_template", template));
  }

  JsonNode editions(UUID invoiceId, UUID poId) {
    if (poId != null) return sql.list("""
        SELECT e.* FROM public.issued_documents e
        WHERE e.po_id = ? ORDER BY e.created_at DESC, e.id
        """, poId);
    return sql.list("""
        SELECT e.* FROM public.issued_documents e
        WHERE e.ar_invoice_id = ? ORDER BY e.created_at DESC, e.id
        """, invoiceId);
  }

  JsonNode request(UUID invoice, UUID po, UUID template, UUID replace, String reason, String language) {
    if (po != null) return sql.call("request_purchase_order_edition", Sql.args("_po", po, "_template", template, "_replace", replace, "_reason", reason));
    return sql.call("request_document_edition", Sql.args("_invoice", invoice, "_template", template, "_replace", replace, "_reason", reason, "_language", language));
  }

  JsonNode retry(UUID id) {
    return sql.call("retry_document_edition", Sql.args("_id", id));
  }

  JsonNode ready(UUID id) {
    return sql.one("""
        SELECT e.tenant_id, e.reference, e.storage_path, e.pdf_sha256 FROM public.issued_documents e
        WHERE e.id = ? AND e.status = 'ready'
        """, id);
  }

  JsonNode claim(UUID id, UUID actor) {
    return sql.call("claim_document_edition", Sql.args("_id", id, "_actor", actor));
  }

  JsonNode complete(UUID id, UUID actor, String path, String sha256, String renderer, String version) {
    return sql.call("complete_document_edition", Sql.args("_id", id, "_actor", actor, "_path", path,
        "_sha256", sha256, "_renderer", renderer, "_renderer_version", version));
  }

  JsonNode fail(UUID id, UUID actor, String error) {
    return sql.call("fail_document_edition", Sql.args("_id", id, "_actor", actor, "_error", error));
  }
}
