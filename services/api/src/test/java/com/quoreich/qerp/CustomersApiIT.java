package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

/**
 * Fiche client par l'API (sur site) : la création va dans la société du profil, la saisie est
 * validée, une société ne modifie pas le client d'une autre. Sans ces points d'entrée, le front
 * « sur site » créait ses clients dans Supabase et ses factures dans la base locale.
 */
@SpringBootTest
@AutoConfigureMockMvc
class CustomersApiIT {

  private static final String DATABASE = "qerp_it_customers_api";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String B = PostgresFixture.BETA_TENANT;

  @DynamicPropertySource
  static void proprietes(DynamicPropertyRegistry registry) {
    PostgresFixture.configureContext(DATABASE, registry);
  }

  @Autowired private MockMvc mockMvc;
  @Autowired private ObjectMapper json;

  @BeforeEach
  void preparer() {
    PostgresFixture.loadReferenceDatasetOnce(DATABASE);
    TenantContextHolder.clear();
  }

  private static org.springframework.test.web.servlet.request.RequestPostProcessor as(String user) {
    return jwt().jwt(b -> b.subject(user));
  }

  @Test
  @DisplayName("création dans la société du profil, fiche complète relue, modification")
  void creationEtModification() throws Exception {
    String corps = "{\"name\":\"  Client API IT \",\"email\":\"Contact@Client-API.example\",\"taxId\":\"IFU-123\","
        + "\"creditLimit\":500000,\"paymentTerms\":45}";
    String reponse = mockMvc.perform(post("/api/v1/customers").with(as(PostgresFixture.ALPHA_USER))
            .contentType(MediaType.APPLICATION_JSON).content(corps))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.name").value("Client API IT"))
        .andExpect(jsonPath("$.email").value("contact@client-api.example"))
        .andExpect(jsonPath("$.paymentTerms").value(45))
        .andReturn().getResponse().getContentAsString();
    String id = json.readTree(reponse).get("id").asString();

    assertThat(PostgresFixture.countAsAdmin(DATABASE,
        "SELECT count(*) FROM customers WHERE id = '" + id + "' AND tenant_id = '" + A + "'"))
        .as("rangé dans la société du profil, sans paramètre de société")
        .isEqualTo(1);

    mockMvc.perform(put("/api/v1/customers/" + id).with(as(PostgresFixture.ALPHA_USER))
            .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Client API IT modifié\",\"paymentTerms\":60}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("Client API IT modifié"))
        .andExpect(jsonPath("$.creditLimit").value(0));

    mockMvc.perform(get("/api/v1/customers").with(as(PostgresFixture.BETA_USER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == '" + id + "')]").isEmpty());
  }

  @Test
  @DisplayName("saisie invalide refusée (400) ; client d'une autre société introuvable (404), sans effet")
  void refus() throws Exception {
    mockMvc.perform(post("/api/v1/customers").with(as(PostgresFixture.ALPHA_USER))
            .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\" \"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error").value("Le nom du client est obligatoire"));
    mockMvc.perform(post("/api/v1/customers").with(as(PostgresFixture.ALPHA_USER))
            .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"X\",\"creditLimit\":-1}"))
        .andExpect(status().isBadRequest());

    String clientAlpha = "c0000001-0000-0000-0000-000000000000";
    mockMvc.perform(put("/api/v1/customers/" + clientAlpha).with(as(PostgresFixture.BETA_USER))
            .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Détourné\"}"))
        .andExpect(status().isNotFound());
    assertThat(PostgresFixture.countAsAdmin(DATABASE,
        "SELECT count(*) FROM customers WHERE id = '" + clientAlpha + "' AND name = 'Détourné'"))
        .isZero();
    assertThat(B).isNotEqualTo(A);
  }
}
