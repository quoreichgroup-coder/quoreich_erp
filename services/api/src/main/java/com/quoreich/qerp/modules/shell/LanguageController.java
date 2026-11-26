package com.quoreich.qerp.modules.shell;

import static com.quoreich.qerp.platform.Sql.args;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * Langue, locale et fuseau (V155). La résolution (utilisateur autorisé, société, plateforme, source) et
 * toutes les validations sont faites par la base, comme sur le chemin Supabase : l'API ne fait que relayer.
 * La préférence de l'utilisateur est ouverte à tout membre ; le réglage de la société exige
 * {@code languages.settings} (contrôlé par la base, et par {@code module-access.json} pour la route).
 */
@RestController
@RequestMapping("/api/v1")
@Tag(name = "Langues", description = "Langue, format régional et fuseau de l'utilisateur et de la société")
public class LanguageController {

  private final Sql sql;

  public LanguageController(Sql sql) {
    this.sql = sql;
  }

  @GetMapping("/me/language")
  @Operation(operationId = "getMyLanguage", summary = "Langue et format résolus pour l'utilisateur, avec les langues et formats disponibles")
  public JsonNode mine() {
    return sql.one("""
        SELECT public.my_language_context()
          || jsonb_build_object(
               'languages', (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sort_order), '[]'::jsonb)
                               FROM public.languages l WHERE l.is_active),
               'locales', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order), '[]'::jsonb)
                             FROM public.supported_locales s WHERE s.is_active)) AS context
        """).get("context");
  }

  @PutMapping("/me/language")
  @Operation(operationId = "setMyLanguage", summary = "Enregistrer sa langue et son format (null = hériter de la société)")
  public JsonNode setMine(@RequestBody MyLanguage request) {
    return sql.call("set_my_language_preferences", args("_language", request.language(), "_locale", request.locale()));
  }

  @PutMapping("/languages/settings")
  @Operation(operationId = "setCompanyLanguages", summary = "Langue, format, fuseau par défaut et langues autorisées de la société")
  public JsonNode setCompany(@RequestBody CompanyLanguages request) {
    // Les tableaux passent en JSON (Sql.call) : une liste, jamais un String[].
    List<String> languages = request.languages() == null ? List.of() : List.copyOf(request.languages());
    return sql.call("set_company_language_settings", args("_default_language", request.defaultLanguage(),
        "_default_locale", request.defaultLocale(), "_timezone", request.timezone(), "_languages", languages));
  }

  public record MyLanguage(String language, String locale) {}

  public record CompanyLanguages(@JsonProperty("default_language") String defaultLanguage,
      @JsonProperty("default_locale") String defaultLocale, String timezone, List<String> languages) {}
}
