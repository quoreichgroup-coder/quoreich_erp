package com.quoreich.qerp.authorization;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.util.UriUtils;

/** Reads current database permissions before entering a module, including for GET requests. */
@Configuration(proxyBeanMethods = false)
public class ModuleAccessConfiguration implements WebMvcConfigurer {
  private final ModuleAccessPolicy policy;
  private final AuthorizationQuery authorizations;

  public ModuleAccessConfiguration(ModuleAccessPolicy policy, AuthorizationQuery authorizations) {
    this.policy = policy;
    this.authorizations = authorizations;
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(new HandlerInterceptor() {
      @Override
      public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        // Use the matched server pattern, so encoded path segments cannot evade a namespace check.
        Object matched = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        String pattern = matched == null ? request.getRequestURI() : matched.toString();
        String path = pattern;
        Object variables = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        if (variables instanceof Map<?, ?> values) {
          for (var entry : values.entrySet()) {
            path = path.replace("{" + entry.getKey() + "}", UriUtils.encodePathSegment(String.valueOf(entry.getValue()), StandardCharsets.UTF_8));
          }
        }
        var rules = policy.forApi(path, pattern, request.getMethod());
        // Identity, onboarding and shared shell endpoints keep their existing authorization checks.
        if (rules.isEmpty()) return true;
        MyAccessView access = authorizations.me();
        if (rules.stream().anyMatch(rule -> policy.allows(rule, access.roles(), access.permissions()))) return true;
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"error\":\"Accès refusé à ce module dans la société courante\"}");
        return false;
      }
    }).addPathPatterns("/api/v1/**");
  }
}
