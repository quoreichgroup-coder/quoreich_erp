package com.quoreich.qerp.authorization;

import java.io.IOException;
import java.util.List;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** Permission namespaces shared with the React navigation and page guard. */
@Component
public class ModuleAccessPolicy {
  public record Rule(List<String> web, List<String> api, List<String> permissions, List<String> exactApi, List<String> methods) {
    public Rule {
      exactApi = exactApi == null ? List.of() : List.copyOf(exactApi);
      methods = methods == null ? List.of() : List.copyOf(methods);
    }
  }
  private final List<Rule> rules;

  public ModuleAccessPolicy(ObjectMapper mapper) throws IOException {
    try (var input = new ClassPathResource("module-access.json").getInputStream()) {
      rules = List.of(mapper.readValue(input, Rule[].class));
    }
  }

  public List<Rule> forApi(String path, String pattern, String method) {
    return rules.stream().filter(r -> r.methods().isEmpty() || r.methods().contains(method))
        .filter(r -> r.exactApi().contains(path) || r.exactApi().contains(pattern) || r.api().stream().anyMatch(prefix ->
            path.equals(prefix) || path.startsWith(prefix + "/"))).toList();
  }

  public boolean allows(Rule rule, List<String> roles, List<String> permissions) {
    return roles.contains("admin") || rule.permissions().stream().anyMatch(prefix ->
        permissions.stream().anyMatch(code -> code.startsWith(prefix)));
  }
}
