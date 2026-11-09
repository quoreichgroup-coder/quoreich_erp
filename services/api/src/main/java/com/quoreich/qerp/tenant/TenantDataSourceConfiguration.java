package com.quoreich.qerp.tenant;

import javax.sql.DataSource;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Enveloppe la source de données applicative.
 *
 * <p>On enveloppe plutôt que de redéclarer un {@code DataSource} : redéclarer
 * reviendrait à réimplémenter la configuration Hikari de Spring Boot et à la
 * laisser diverger à chaque montée de version.
 *
 * <h2>Une seule source est enveloppée, et c'est délibéré</h2>
 * Spring Boot fabrique une seconde source de données pour Flyway dès que
 * {@code spring.flyway.url} est renseigné — ce qui est le cas, puisque les
 * migrations tournent sous un rôle propriétaire distinct du rôle applicatif. Cette
 * source-là est construite avec les réglages par défaut du pool, donc
 * <strong>autocommit actif</strong> : l'envelopper ferait lever
 * {@link TenantAwareDataSource} à chaque connexion de migration et empêcherait
 * l'application de démarrer.
 *
 * <p>Le filtre porte donc sur le nom du bean. Spring Boot nomme toujours la source
 * principale {@code dataSource} ; celle de Flyway s'appelle {@code flywayDataSource}.
 * Ce couplage au nom serait fragile s'il était silencieux : il ne l'est pas, car
 * {@link DatabaseSecurityGuard} vérifie au démarrage que la source injectée dans
 * l'application est bien enveloppée. Si Spring Boot renommait un jour ce bean, le
 * démarrage échouerait avec un message explicite plutôt que de perdre
 * discrètement le contexte société.
 */
@Configuration(proxyBeanMethods = false)
public class TenantDataSourceConfiguration {

  private static final String APPLICATION_DATASOURCE_BEAN = "dataSource";

  /**
   * {@code static} n'est pas une coquetterie : un {@link BeanPostProcessor}
   * déclaré par une méthode d'instance oblige Spring à instancier la classe de
   * configuration — et toutes ses dépendances — avant les autres
   * post-processeurs.
   */
  @Bean
  static BeanPostProcessor tenantAwareDataSourcePostProcessor() {
    return new BeanPostProcessor() {
      @Override
      public Object postProcessAfterInitialization(Object bean, String beanName) {
        if (APPLICATION_DATASOURCE_BEAN.equals(beanName)
            && bean instanceof DataSource dataSource
            && !(dataSource instanceof TenantAwareDataSource)) {
          return new TenantAwareDataSource(dataSource);
        }
        return bean;
      }
    };
  }
}
