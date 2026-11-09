package com.quoreich.qerp.tenant;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quoreich.qerp.tenant.DatabaseSecurityGuard.ConnectionAudit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Le garde-fou doit refuser chacune des façons de contourner la RLS.
 *
 * <p>Sans ce test, {@code DatabaseSecurityGuard} pourrait ne jamais rien refuser
 * — un garde-fou qui ne déclenche pas est indistinguable d'un garde-fou absent,
 * et c'est précisément le défaut qu'il est censé fermer.
 */
class DatabaseSecurityGuardTest {

  private static final ConnectionAudit CONFORME = new ConnectionAudit("qerp_api", false, false, true, 0);

  @Test
  @DisplayName("accepte la connexion applicative prévue : non propriétaire, sans BYPASSRLS, dans authenticated")
  void accepteLaConnexionConforme() {
    assertThatCode(CONFORME::requireRlsEffective).doesNotThrowAnyException();
  }

  @Test
  @DisplayName("refuse un superutilisateur — il contourne la RLS même sans l'attribut BYPASSRLS")
  void refuseUnSuperutilisateur() {
    assertThatThrownBy(
            () -> new ConnectionAudit("postgres", true, false, true, 0).requireRlsEffective())
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("BYPASSRLS");
  }

  @Test
  @DisplayName("refuse un rôle porteur de BYPASSRLS")
  void refuseUnRoleQuiPorteBypassRls() {
    assertThatThrownBy(
            () -> new ConnectionAudit("service_role", false, true, true, 0).requireRlsEffective())
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("BYPASSRLS");
  }

  @Test
  @DisplayName("refuse le propriétaire des tables — les tables ne sont pas en FORCE ROW LEVEL SECURITY")
  void refuseUnProprietaireDeTables() {
    assertThatThrownBy(
            () -> new ConnectionAudit("qerp_migrate", false, false, true, 105).requireRlsEffective())
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("propriétaire")
        .hasMessageContaining("FORCE ROW LEVEL SECURITY");
  }

  @Test
  @DisplayName("refuse un rôle qui n'est pas membre de authenticated : les 152 politiques ne s'appliqueraient pas")
  void refuseUnRoleHorsAuthenticated() {
    assertThatThrownBy(
            () -> new ConnectionAudit("qerp_api", false, false, false, 0).requireRlsEffective())
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("authenticated");
  }
}
