package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.quoreich.qerp.tenant.TenantContextHolder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.ObjectMapper;

/**
 * Pièces jointes sur site (V138) : dépôt stocké par le serveur avec son empreinte SHA-256, catégories créées au premier
 * usage, liste, téléchargement, type refusé (fichier non gardé), pièce d'une autre société introuvable, suppression avec
 * motif (fichier gardé en archive).
 */
@SpringBootTest(properties = "qerp.files.dir=target/it-files")
@AutoConfigureMockMvc
class AttachmentsApiIT {

  private static final String DATABASE = "qerp_it_attachments_api";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String BETA_ADMIN = PostgresFixture.BETA_USER;

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    PostgresFixture.grantRoles(DATABASE, ADMIN, "admin", A);
    PostgresFixture.grantRoles(DATABASE, BETA_ADMIN, "admin", PostgresFixture.BETA_TENANT);
    TenantContextHolder.clear();
  }

  private static RequestPostProcessor as(String user) {
    return jwt().jwt(b -> b.subject(user));
  }

  @Test
  @DisplayName("dépôt, empreinte, liste, téléchargement, refus, isolation, suppression tracée")
  void piecesJointes() throws Exception {
    String fournisseur = PostgresFixture.textAsAdmin(DATABASE, "INSERT INTO suppliers (tenant_id, name) VALUES ('" + A + "', 'Fournisseur pièces jointes') RETURNING id::text");
    String contrat = json.readTree(mvc.perform(get("/api/v1/attachments/categories").with(as(ADMIN)))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString())
        .valueStream().filter(c -> "CONTRAT".equals(c.get("code").asString())).findFirst().orElseThrow().get("id").asString();

    byte[] contenu = "%PDF-1.4 contrat cadre".getBytes();
    MockMultipartFile pdf = new MockMultipartFile("file", "contrat cadre.pdf", "application/pdf", contenu);
    String id = json.readTree(mvc.perform(multipart("/api/v1/attachments/supplier/" + fournisseur).file(pdf).param("categoryId", contrat).with(as(ADMIN)))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).asString();
    String attendu = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(contenu));
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT sha256 FROM document_attachments WHERE id = '" + id + "'")).isEqualTo(attendu);

    mvc.perform(get("/api/v1/attachments").param("docType", "supplier").param("docId", fournisseur).with(as(ADMIN)))
        .andExpect(status().isOk()).andExpect(jsonPath("$[0].file_name").value("contrat cadre.pdf")).andExpect(jsonPath("$[0].category_label").value("Contrat"));
    mvc.perform(get("/api/v1/attachments/" + id + "/file").with(as(ADMIN))).andExpect(status().isOk()).andExpect(content().bytes(contenu));
    mvc.perform(get("/api/v1/attachments/" + id + "/file").with(as(BETA_ADMIN))).andExpect(status().isNotFound());

    MockMultipartFile exe = new MockMultipartFile("file", "outil.exe", "application/x-msdownload", "MZ".getBytes());
    mvc.perform(multipart("/api/v1/attachments/supplier/" + fournisseur).file(exe).with(as(ADMIN))).andExpect(status().isUnprocessableContent());
    mvc.perform(multipart("/api/v1/attachments/supplier/" + fournisseur).file(pdf).with(as(BETA_ADMIN))).andExpect(status().isUnprocessableContent());

    mvc.perform(MockMvcRequestBuilders.post("/api/v1/attachments/" + id + "/delete").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"\"}"))
        .andExpect(status().isUnprocessableContent());
    mvc.perform(MockMvcRequestBuilders.post("/api/v1/attachments/" + id + "/delete").with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Contrat remplacé\"}"))
        .andExpect(status().isOk());
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT delete_reason FROM document_attachments WHERE id = '" + id + "'")).isEqualTo("Contrat remplacé");
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT count(*) FROM document_attachments WHERE doc_id = '" + fournisseur + "'"))
        .as("le fichier .exe refusé n'a laissé aucune ligne").isEqualTo("1");
  }
}
