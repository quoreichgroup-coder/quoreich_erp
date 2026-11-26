package com.quoreich.qerp.modules.documents;

import static java.nio.file.LinkOption.NOFOLLOW_LINKS;
import static java.nio.file.StandardOpenOption.READ;
import static java.nio.file.StandardOpenOption.WRITE;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class DocumentArchive {
  static final int MAX_PDF_BYTES = 25 * 1024 * 1024;

  private final Path root;

  DocumentArchive(@Value("${qerp.files.dir:./data/files}") String filesDir) {
    root = Path.of(filesDir).toAbsolutePath().normalize();
  }

  Optional<String> orphanHash(UUID tenant, UUID id, String path) throws IOException {
    Path target = resolve(tenant, id, path);
    try {
      return Optional.of(sha256(read(target)));
    } catch (NoSuchFileException e) {
      return Optional.empty();
    }
  }

  String store(UUID tenant, UUID id, String path, byte[] pdf) throws IOException {
    validatePdf(pdf);
    Path target = resolve(tenant, id, path);
    checkDirectories(target.getParent(), true);
    Path temporary = Files.createTempFile(target.getParent(), ".edition-", ".part");
    try {
      try (FileChannel out = FileChannel.open(temporary, WRITE, NOFOLLOW_LINKS)) {
        ByteBuffer content = ByteBuffer.wrap(pdf);
        while (content.hasRemaining()) out.write(content);
        out.force(true);
      }
      // A hard link publishes the complete file in one operation and fails if the name exists.
      // ATOMIC_MOVE is allowed to replace the existing target on some filesystems.
      try {
        Files.createLink(target, temporary);
      } catch (FileAlreadyExistsException e) {
        return sha256(read(target));
      }
      return sha256(pdf);
    } finally {
      Files.deleteIfExists(temporary);
    }
  }

  byte[] download(UUID tenant, UUID id, String path, String expectedSha256) throws IOException {
    byte[] pdf = read(resolve(tenant, id, path));
    if (!sha256(pdf).equals(expectedSha256)) {
      throw new IOException("L’empreinte SHA-256 de l’archive ne correspond pas");
    }
    return pdf;
  }

  static void validatePdf(byte[] pdf) throws IOException {
    if (pdf.length > MAX_PDF_BYTES || pdf.length < 5
        || pdf[0] != '%' || pdf[1] != 'P' || pdf[2] != 'D' || pdf[3] != 'F' || pdf[4] != '-') {
      throw new IOException("Le PDF est invalide ou dépasse 25 Mio");
    }
  }

  private Path resolve(UUID tenant, UUID id, String path) throws IOException {
    if (!(tenant + "/issued/" + id + ".pdf").equals(path)) {
      throw new IOException("Chemin d’archive invalide");
    }
    return root.resolve(tenant.toString()).resolve("issued").resolve(id + ".pdf");
  }

  private static byte[] read(Path path) throws IOException {
    checkDirectories(path.getParent(), false);
    if (!Files.readAttributes(path, BasicFileAttributes.class, NOFOLLOW_LINKS).isRegularFile()) {
      throw new IOException("Le chemin d’archive ne désigne pas un fichier régulier");
    }
    try (var input = Files.newInputStream(path, READ, NOFOLLOW_LINKS)) {
      byte[] pdf = input.readNBytes(MAX_PDF_BYTES + 1);
      validatePdf(pdf);
      return pdf;
    }
  }

  private static void checkDirectories(Path directory, boolean create) throws IOException {
    Path current = directory.getRoot();
    for (Path segment : directory) {
      current = current.resolve(segment);
      if (create && !Files.exists(current, NOFOLLOW_LINKS)) {
        try {
          Files.createDirectory(current);
        } catch (FileAlreadyExistsException e) {
          // Another worker may have created the same directory. Check its type below.
        }
      }
      BasicFileAttributes attributes = Files.readAttributes(current, BasicFileAttributes.class, NOFOLLOW_LINKS);
      if (!attributes.isDirectory() || attributes.isSymbolicLink() || attributes.isOther()) {
        throw new IOException("Répertoire d’archive invalide");
      }
    }
  }

  private static String sha256(byte[] pdf) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(pdf));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
