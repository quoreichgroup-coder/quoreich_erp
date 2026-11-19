package com.quoreich.qerp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.quoreich.qerp.tenant.TenantContextHolder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Identité sur site (V114) par de vrais jetons, sans simulation de l'émetteur : inscription, connexion (le porteur
 * « clé publique » de supabase-js est ignoré), données lues dans la société du compte, verrouillage après échecs,
 * rotation des jetons de renouvellement et révocation de la session en cas de réutilisation, déconnexion effective
 * immédiatement, compte repris du nuage avec son empreinte bcrypt, mot de passe provisoire limité à la société.
 */
@SpringBootTest(properties = {"qerp.identity.key-file=target/it-identity/signing-key.json", "qerp.identity.max-failed-attempts=3", "qerp.identity.refresh-reuse-seconds=2"})
@AutoConfigureMockMvc
class IdentityApiIT {

  private static final String DATABASE = "qerp_it_identity_api";
  private static final String A = PostgresFixture.ALPHA_TENANT;
  private static final String ADMIN = PostgresFixture.ALPHA_USER;
  private static final String PUBLISHABLE = "Bearer sb_publishable_cle-publique-du-client";

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
    TenantContextHolder.clear();
  }

  private MockHttpServletResponse appel(MockHttpServletRequestBuilder req, String bearer, String body) throws Exception {
    if (bearer != null) req.header("Authorization", bearer.startsWith("Bearer ") ? bearer : "Bearer " + bearer);
    if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(body);
    return mvc.perform(req.header("apikey", "sb_publishable_cle")).andReturn().getResponse();
  }

  private JsonNode connexion(String email, String password, int expected) throws Exception {
    MockHttpServletResponse r = appel(post("/auth/v1/token").param("grant_type", "password"), PUBLISHABLE,
        "{\"email\":\"" + email + "\",\"password\":\"" + password + "\",\"gotrue_meta_security\":{}}");
    assertThat(r.getStatus()).as(r.getContentAsString()).isEqualTo(expected);
    return json.readTree(r.getContentAsString());
  }

  private JsonNode renouveler(String refresh) throws Exception {
    return json.readTree(appel(post("/auth/v1/token").param("grant_type", "refresh_token"), PUBLISHABLE, "{\"refresh_token\":\"" + refresh + "\"}").getContentAsString());
  }

  @Test
  @DisplayName("inscription, connexion, compte ; verrouillage ; rotation et réutilisation ; déconnexion immédiate")
  void cycleDeSession() throws Exception {
    String email = "inscription-" + System.nanoTime() + "@exemple.invalid";
    MockHttpServletResponse s = appel(post("/auth/v1/signup"), PUBLISHABLE, "{\"email\":\"" + email + "\",\"password\":\"court\"}");
    assertThat(s.getStatus()).isEqualTo(422);
    s = appel(post("/auth/v1/signup"), PUBLISHABLE, "{\"email\":\"" + email + "\",\"password\":\"Motdepasse-tres-long\",\"data\":{\"full_name\":\"Awa Test\"}}");
    assertThat(s.getStatus()).as(s.getContentAsString()).isEqualTo(200);
    assertThat(appel(post("/auth/v1/signup"), PUBLISHABLE, "{\"email\":\"" + email + "\",\"password\":\"Motdepasse-tres-long\"}").getStatus()).isEqualTo(422);

    JsonNode session = connexion(email.toUpperCase(), "Motdepasse-tres-long", 200);
    String token = session.get("access_token").asString();
    assertThat(session.get("user").get("user_metadata").get("full_name").asString()).isEqualTo("Awa Test");
    JsonNode moi = json.readTree(appel(get("/api/v1/me"), token, null).getContentAsString());
    assertThat(moi.get("tenant_id").isNull()).as("compte sans société, profil créé").isTrue();
    assertThat(appel(get("/auth/v1/user"), token, null).getContentAsString()).contains(email);

    // Rotation : le jeton consommé ne sert plus ; sa réutilisation ferme la session, jetons d'accès compris.
    String r1 = session.get("refresh_token").asString();
    JsonNode s2 = renouveler(r1);
    assertThat(s2.get("access_token")).isNotNull();
    assertThat(appel(get("/auth/v1/user"), s2.get("access_token").asString(), null).getStatus()).isEqualTo(200);
    // Dans le délai (deux onglets au même instant) : nouveau jeton de la même session, pas de fermeture.
    JsonNode simultane = renouveler(r1);
    assertThat(simultane.get("access_token")).as(simultane.toString()).isNotNull();
    Thread.sleep(2_500);
    assertThat(renouveler(r1).get("error_code").asString()).isEqualTo("refresh_token_already_used");
    assertThat(renouveler(s2.get("refresh_token").asString()).get("error_code").asString()).isEqualTo("refresh_token_not_found");
    assertThat(appel(get("/auth/v1/user"), s2.get("access_token").asString(), null).getStatus()).isEqualTo(401);

    // Déconnexion : le jeton d'accès encore valide est refusé tout de suite.
    String t3 = connexion(email, "Motdepasse-tres-long", 200).get("access_token").asString();
    assertThat(appel(post("/auth/v1/logout").param("scope", "global"), t3, null).getStatus()).isEqualTo(204);
    assertThat(appel(get("/api/v1/me"), t3, null).getStatus()).isEqualTo(401);

    // Verrouillage au 3e échec : même le bon mot de passe est refusé ensuite.
    for (int i = 0; i < 3; i++) assertThat(connexion(email, "mauvais-mot-de-passe", 400).get("error_code").asString()).isEqualTo("invalid_credentials");
    assertThat(connexion(email, "Motdepasse-tres-long", 400).get("error_code").asString()).isEqualTo("user_locked");
    assertThat(connexion("inconnu@exemple.invalid", "x", 400).get("error_code").asString()).isEqualTo("invalid_credentials");
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT string_agg(DISTINCT event, ',' ORDER BY event) FROM qerp_identity.events WHERE email = '" + email + "'"))
        .contains("login", "login_failed", "login_locked", "signup");
    assertThat(PostgresFixture.textAsAdmin(DATABASE, "SELECT count(*)::text FROM qerp_identity.refresh_tokens WHERE token_hash !~ '^[0-9a-f]{64}$'")).isEqualTo("0");
  }

  @Test
  @DisplayName("compte repris du nuage (empreinte bcrypt $2a$) : mot de passe conservé, données de sa société")
  void compteRepris() throws Exception {
    String hash = new BCryptPasswordEncoder(10).encode("Mot-de-passe-du-nuage");
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "INSERT INTO qerp_identity.accounts (user_id, email, password_hash, email_confirmed_at) VALUES ('"
        + ADMIN + "', 'alpha.admin@exemple.invalid', '" + hash + "', now()) ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, locked_until = NULL");
    String token = connexion("alpha.admin@exemple.invalid", "Mot-de-passe-du-nuage", 200).get("access_token").asString();
    MockHttpServletResponse moi = appel(get("/api/v1/me"), token, null);
    assertThat(json.readTree(moi.getContentAsString()).get("tenant_id").asString()).isEqualTo(A);
    assertThat(appel(get("/api/v1/customers"), token, null).getStatus()).isEqualTo(200);
    assertThat(appel(get("/api/v1/me"), token.substring(0, token.length() - 4) + "AAAA", null).getStatus()).as("signature altérée").isEqualTo(401);

    // Mot de passe provisoire : un membre de SA société seulement, sessions du membre fermées.
    String email = "membre-" + System.nanoTime() + "@exemple.invalid";
    String membreToken = json.readTree(appel(post("/auth/v1/signup"), PUBLISHABLE, "{\"email\":\"" + email + "\",\"password\":\"Motdepasse-initial\"}").getContentAsString())
        .get("access_token").asString();
    String membre = PostgresFixture.textAsAdmin(DATABASE, "SELECT user_id::text FROM qerp_identity.accounts WHERE email = '" + email + "'");
    String b = "{}";
    assertThat(appel(post("/api/v1/identity/members/" + membre + "/temporary-password"), token, b).getStatus()).as("pas encore dans la société").isEqualTo(403);
    PostgresFixture.execute(PostgresFixture.urlOf(DATABASE), "UPDATE profiles SET tenant_id = '" + A + "' WHERE id = '" + membre + "'");
    MockHttpServletResponse reset = appel(post("/api/v1/identity/members/" + membre + "/temporary-password"), token, b);
    assertThat(reset.getStatus()).as(reset.getContentAsString()).isEqualTo(200);
    String provisoire = json.readTree(reset.getContentAsString()).get("password").asString();
    assertThat(appel(get("/api/v1/me"), membreToken, null).getStatus()).as("sessions du membre fermées").isEqualTo(401);
    connexion(email, provisoire, 200);
    connexion(email, "Motdepasse-initial", 400);
    assertThat(appel(post("/api/v1/identity/members/" + ADMIN + "/temporary-password"), token, b).getStatus()).isEqualTo(422);
  }
}
