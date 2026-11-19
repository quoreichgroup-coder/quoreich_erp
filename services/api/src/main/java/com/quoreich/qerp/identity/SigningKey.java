package com.quoreich.qerp.identity;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.text.ParseException;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Clé de signature des jetons (ECDSA P-256, ES256 comme le projet Supabase). Lue depuis le fichier configuré ; créée
 * au premier démarrage s'il n'existe pas, avec des droits réservés au propriétaire quand le système le permet. La
 * perdre ferme toutes les sessions (chacun se reconnecte) ; la divulguer permet de fabriquer des jetons : le fichier
 * se sauvegarde et se protège comme un secret.
 */
public final class SigningKey {

  private static final Logger log = LoggerFactory.getLogger(SigningKey.class);

  private SigningKey() {}

  public static ECKey loadOrCreate(String file) {
    Path path = Path.of(file).toAbsolutePath().normalize();
    try {
      if (Files.exists(path)) {
        ECKey key = ECKey.parse(Files.readString(path, StandardCharsets.UTF_8));
        if (!key.isPrivate()) throw new IllegalStateException("La clé de signature " + path + " ne contient pas de partie privée");
        return key;
      }
      ECKey key = new ECKeyGenerator(Curve.P_256).keyUse(KeyUse.SIGNATURE).keyID(UUID.randomUUID().toString()).generate();
      Files.createDirectories(path.getParent());
      Files.writeString(path, key.toJSONString(), StandardCharsets.UTF_8);
      try {
        Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
      } catch (UnsupportedOperationException e) {
        log.warn("Droits du fichier de clé non restreints (système sans permissions POSIX) : protégez {} manuellement.", path);
      }
      log.info("Clé de signature des jetons créée : {}", path);
      return key;
    } catch (IOException e) {
      throw new UncheckedIOException("Clé de signature illisible ou non enregistrable : " + path, e);
    } catch (ParseException e) {
      throw new IllegalStateException("Fichier de clé de signature invalide : " + path, e);
    } catch (JOSEException e) {
      throw new IllegalStateException("Génération de la clé de signature impossible", e);
    }
  }
}
