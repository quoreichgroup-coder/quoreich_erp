package com.quoreich.qerp.modules.documents;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.quoreich.qerp.platform.DatabaseRefusalAdvice;
import com.quoreich.qerp.platform.Sql;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.ObjectMapper;

class DocumentEditionsControllerTest {
  private static final UUID SOURCE = UUID.fromString("00000000-0000-0000-0000-000000000143");
  private static final UUID TEMPLATE = UUID.fromString("00000000-0000-0000-0000-000000000243");
  private static final UUID REPLACED = UUID.fromString("00000000-0000-0000-0000-000000000343");
  private static final ObjectMapper JSON = new ObjectMapper();
  private final Sql sql = mock(Sql.class);
  private DocumentEditionsService service;
  private MockMvc mvc;

  @BeforeEach
  void setup() {
    var query = new DocumentEditionsQuery(sql);
    service = new DocumentEditionsService(query, mock(DocumentArchive.class),
        new GotenbergPdfClient("", Duration.ofSeconds(1)), "9.2.0");
    mvc = MockMvcBuilders.standaloneSetup(new DocumentEditionsController(query, service))
        .setControllerAdvice(new DatabaseRefusalAdvice()).build();
  }

  @AfterEach
  void close() {
    service.close();
  }

  @Test
  void filtersPurchaseOrderTemplatesAndKeepsInvoiceAsDefault() throws Exception {
    when(sql.list(anyString(), any(Object[].class))).thenReturn(JSON.createArrayNode());
    mvc.perform(get("/api/v1/document-templates").param("docType", "purchase_order"))
        .andExpect(status().isOk());
    verify(sql).list(argThat(statement -> statement.contains("t.doc_type = ?")), eq("purchase_order"));
    mvc.perform(get("/api/v1/document-templates")).andExpect(status().isOk());
    verify(sql).list(argThat(statement -> statement.contains("t.doc_type = ?")), eq("ar_invoice"));
  }

  @Test
  void refusesUnknownTemplateTypesBeforeReadingData() throws Exception {
    mvc.perform(get("/api/v1/document-templates").param("docType", "arbitrary"))
        .andExpect(status().isUnprocessableEntity());
    verifyNoInteractions(sql);
  }

  @Test
  void installsTheTwoPublishedPurchaseOrderTemplatesThroughTheAuthenticatedRpc() throws Exception {
    when(sql.call("install_purchase_order_templates")).thenReturn(JSON.readTree("""
        [{"name":"Standard","versions":[{"status":"published"}]},
         {"name":"Reference","versions":[{"status":"published"}]}]
        """));
    mvc.perform(post("/api/v1/document-templates/purchase-orders/defaults")
        .contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
        .andExpect(jsonPath("$[0].versions[0].status").value("published"));
  }

  @Test
  void listsPurchaseOrderEditionsWithoutFallingBackToInvoices() throws Exception {
    when(sql.list(anyString(), any(Object[].class))).thenReturn(JSON.createArrayNode());
    mvc.perform(get("/api/v1/document-editions").param("poId", SOURCE.toString()))
        .andExpect(status().isOk());
    verify(sql).list(argThat(statement -> statement.contains("e.po_id = ?")), eq(SOURCE));
    mvc.perform(get("/api/v1/document-editions").param("invoiceId", SOURCE.toString()))
        .andExpect(status().isOk());
    verify(sql).list(argThat(statement -> statement.contains("e.ar_invoice_id = ?")), eq(SOURCE));
  }

  @Test
  void refusesMissingOrAmbiguousEditionListSourcesBeforeReadingData() throws Exception {
    mvc.perform(get("/api/v1/document-editions")).andExpect(status().isUnprocessableEntity());
    mvc.perform(get("/api/v1/document-editions").param("invoiceId", SOURCE.toString()).param("poId", SOURCE.toString()))
        .andExpect(status().isUnprocessableEntity());
    verifyNoInteractions(sql);
  }

  @Test
  void requestsPurchaseOrderEditionWithItsTemplateAndReplacementAndKeepsInvoiceRequests() throws Exception {
    when(sql.call(eq("request_purchase_order_edition"), any())).thenReturn(JSON.readTree("""
        {"id":"00000000-0000-0000-0000-000000000443","status":"ready","po_id":"%s","ar_invoice_id":null}
        """.formatted(SOURCE)));
    mvc.perform(post("/api/v1/document-editions").contentType(MediaType.APPLICATION_JSON).content("""
        {"po_id":"%s","template_id":"%s","replace_id":"%s","reason":"Correction"}
        """.formatted(SOURCE, TEMPLATE, REPLACED)))
        .andExpect(status().isOk()).andExpect(jsonPath("$.po_id").value(SOURCE.toString()));
    verify(sql).call("request_purchase_order_edition", Sql.args("_po", SOURCE, "_template", TEMPLATE,
        "_replace", REPLACED, "_reason", "Correction"));

    when(sql.call(eq("request_document_edition"), any())).thenReturn(JSON.readTree("{\"status\":\"ready\"}"));
    mvc.perform(post("/api/v1/document-editions").contentType(MediaType.APPLICATION_JSON)
        .content("{\"invoice_id\":\"" + SOURCE + "\"}"))
        .andExpect(status().isOk());
    // V155 : la langue documentaire est transmise (null = proposée par la base depuis le client).
    verify(sql).call("request_document_edition", Sql.args("_invoice", SOURCE, "_template", null,
        "_replace", null, "_reason", null, "_language", null));

    mvc.perform(post("/api/v1/document-editions").contentType(MediaType.APPLICATION_JSON)
        .content("{\"invoice_id\":\"" + SOURCE + "\",\"language\":\"en\"}"))
        .andExpect(status().isOk());
    verify(sql).call("request_document_edition", Sql.args("_invoice", SOURCE, "_template", null,
        "_replace", null, "_reason", null, "_language", "en"));
  }

  @Test
  void refusesMissingOrAmbiguousCreationSourcesBeforeIssuingAnything() throws Exception {
    mvc.perform(post("/api/v1/document-editions").contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isUnprocessableEntity());
    mvc.perform(post("/api/v1/document-editions").contentType(MediaType.APPLICATION_JSON).content("""
        {"invoice_id":"%s","po_id":"%s"}
        """.formatted(SOURCE, SOURCE))).andExpect(status().isUnprocessableEntity());
    verifyNoInteractions(sql);
  }
}
