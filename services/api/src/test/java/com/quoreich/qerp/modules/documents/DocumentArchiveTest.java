package com.quoreich.qerp.modules.documents;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DocumentArchiveTest {
  private static final UUID TENANT = UUID.fromString("69bea98a-a27d-4252-ac19-a2123e7bfa0d");
  private static final UUID EDITION = UUID.fromString("4007008d-0e68-4c08-8b3c-f21231efcfec");
  private static final String CANONICAL = TENANT + "/issued/" + EDITION + ".pdf";
  private static final byte[] PDF = "%PDF-1.7\nArchived original".getBytes(UTF_8);

  @TempDir private Path temp;

  @Test
  void storesOnceAndReusesTheExistingBytesForRecovery() throws Exception {
    var archive = new DocumentArchive(temp.toString());
    assertThat(archive.orphanHash(TENANT, EDITION, CANONICAL)).isEmpty();
    String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(PDF));

    assertThat(archive.store(TENANT, EDITION, CANONICAL, PDF)).isEqualTo(hash);
    assertThat(archive.store(TENANT, EDITION, CANONICAL, "%PDF-1.7\nReplacement".getBytes(UTF_8))).isEqualTo(hash);
    assertThat(archive.orphanHash(TENANT, EDITION, CANONICAL)).contains(hash);
    assertThat(archive.download(TENANT, EDITION, CANONICAL, hash)).isEqualTo(PDF);
    try (var files = Files.list(temp.resolve(CANONICAL).getParent())) {
      assertThat(files.toList()).containsExactly(temp.resolve(CANONICAL));
    }
  }

  @Test
  void refusesAlteredArchivedBytes() throws Exception {
    var archive = new DocumentArchive(temp.toString());
    String hash = archive.store(TENANT, EDITION, CANONICAL, PDF);
    Files.writeString(temp.resolve(CANONICAL), "%PDF-1.7\nTampered");

    assertThatThrownBy(() -> archive.download(TENANT, EDITION, CANONICAL, hash)).isInstanceOf(IOException.class);
  }

  @Test
  void refusesPathsOutsideTheCanonicalEditionPath() {
    var archive = new DocumentArchive(temp.toString());
    assertThatThrownBy(() -> archive.store(TENANT, EDITION, "../escaped.pdf", PDF)).isInstanceOf(IOException.class);
    assertThatThrownBy(() -> archive.orphanHash(TENANT, EDITION, CANONICAL.replace(TENANT.toString(), EDITION.toString())))
        .isInstanceOf(IOException.class);
  }

  @Test
  void refusesSymlinksInDirectoriesAndAtThePdf() throws Exception {
    var archive = new DocumentArchive(temp.toString());
    Path external = Files.createDirectory(temp.resolve("other"));
    Path tenant = temp.resolve(TENANT.toString());
    symlink(tenant, external);
    assertThatThrownBy(() -> archive.store(TENANT, EDITION, CANONICAL, PDF)).isInstanceOf(IOException.class);
    assertThat(Files.exists(external.resolve("issued"))).isFalse();

    Files.delete(tenant);
    Path path = temp.resolve(CANONICAL);
    Files.createDirectories(path.getParent());
    symlink(path, Files.write(external.resolve("file.pdf"), PDF));
    assertThatThrownBy(() -> archive.orphanHash(TENANT, EDITION, CANONICAL)).isInstanceOf(IOException.class);
  }

  private static void symlink(Path path, Path target) {
    try {
      Files.createSymbolicLink(path, target);
    } catch (IOException | UnsupportedOperationException e) {
      Assumptions.abort("Symlinks unavailable: " + e.getMessage());
    }
  }
}
