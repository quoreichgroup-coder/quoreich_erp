package com.quoreich.qerp.modules.documents;

import com.quoreich.qerp.platform.ApiRefusal;
import com.quoreich.qerp.platform.Sql;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;

/**
 * Pièces jointes sur site (V138), jumelles du compartiment « documents » du nuage : même chemin
 * {@code <société>/<type>/<pièce>/<fichier>} sous {@code qerp.files.dir}, même contrôle par {@code register_attachment}
 * (droit, pièce de la société, taille, type, catégorie), empreinte SHA-256 calculée par le serveur. Le fichier n'est
 * jamais effacé : une suppression est tracée par {@code delete_attachment} et l'archive reste.
 */
@RestController
@RequestMapping("/api/v1/attachments")
@Tag(name = "Pièces jointes", description = "Fichiers joints aux pièces (achats, ventes, stocks, comptabilité, tiers), catégories et réglages")
public class AttachmentsController {

  private static final Pattern DOC_TYPE = Pattern.compile("^[a-z_]{3,40}$");
  static final Set<String> CATEGORY = Set.of("code", "label", "doc_types", "required_for", "is_active", "sort_order");
  static final Set<String> SETTINGS = Set.of("max_size_mb", "allowed_mime_types", "lock_after_validation", "require_category", "updated_at");

  private final Sql sql;
  private final Path files;

  public AttachmentsController(Sql sql, @Value("${qerp.files.dir:./data/files}") String filesDir) {
    this.sql = sql;
    this.files = Path.of(filesDir).toAbsolutePath().normalize();
  }

  @GetMapping
  @Operation(operationId = "listAttachments", summary = "Pièces jointes d'une pièce (supprimées comprises, marquées)")
  public JsonNode list(@RequestParam String docType, @RequestParam UUID docId) {
    return sql.list("SELECT a.*, c.label AS category_label, c.code AS category_code,"
        + " (SELECT full_name FROM public.profiles p WHERE p.id = a.uploaded_by) AS uploaded_by_name"
        + " FROM public.document_attachments a LEFT JOIN public.attachment_categories c ON c.id = a.category_id"
        + " WHERE a.doc_type = ? AND a.doc_id = ? ORDER BY a.uploaded_at", docType, docId);
  }

  @PostMapping(value = "/{docType}/{docId}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @Operation(operationId = "uploadAttachment", summary = "Joindre un fichier à une pièce (contrôles de la société)")
  public JsonNode upload(@PathVariable String docType, @PathVariable UUID docId, @RequestParam("file") MultipartFile file,
      @RequestParam(value = "categoryId", required = false) UUID categoryId, @RequestParam(value = "note", required = false) String note) throws IOException {
    if (!DOC_TYPE.matcher(docType).matches()) throw new ApiRefusal(400, "Type de pièce invalide");
    if (file.isEmpty()) throw new ApiRefusal(422, "Fichier vide");
    String tenant = sql.value(String.class, "SELECT public.get_user_tenant_id(auth.uid())::text");
    if (tenant == null) throw ApiRefusal.untouched();
    String safe = String.valueOf(file.getOriginalFilename()).replaceAll("[^A-Za-z0-9._-]+", "_");
    safe = safe.substring(Math.max(0, safe.length() - 80));
    String rel = tenant + "/" + docType + "/" + docId + "/" + UUID.randomUUID() + "-" + safe;
    Path target = resolve(rel);
    Files.createDirectories(target.getParent());
    String sha;
    try (InputStream in = new DigestInputStream(file.getInputStream(), MessageDigest.getInstance("SHA-256"))) {
      Files.copy(in, target);
      sha = HexFormat.of().formatHex(((DigestInputStream) in).getMessageDigest().digest());
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
    try {
      return sql.call("register_attachment", Sql.args("_doc_type", docType, "_doc_id", docId, "_storage_path", rel,
          "_file_name", String.valueOf(file.getOriginalFilename()), "_mime_type", String.valueOf(file.getContentType()), "_size_bytes", file.getSize(),
          "_sha256", sha, "_category_id", categoryId, "_note", note));
    } catch (RuntimeException e) {
      Files.deleteIfExists(target);
      throw e;
    }
  }

  @GetMapping("/{id}/file")
  @Operation(operationId = "downloadAttachment", summary = "Télécharger une pièce jointe de la société")
  public ResponseEntity<FileSystemResource> download(@PathVariable UUID id) {
    // Lecture sous RLS : une pièce jointe d'une autre société est introuvable.
    JsonNode a = sql.one("SELECT storage_path, mime_type, file_name FROM public.document_attachments WHERE id = ?", id);
    if (a == null || a.isNull() || a.isMissingNode()) throw new ApiRefusal(404, "Pièce jointe introuvable");
    Path f = resolve(a.get("storage_path").asString());
    if (!Files.isRegularFile(f)) throw new ApiRefusal(404, "Fichier introuvable dans l'archive");
    String name = a.get("file_name").asString().replaceAll("[\"\\r\\n]", "_");
    return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + name + "\"")
        .contentType(MediaType.parseMediaType(a.get("mime_type").asString())).body(new FileSystemResource(f));
  }

  @PostMapping("/{id}/delete")
  @Operation(operationId = "deleteAttachment", summary = "Supprimer une pièce jointe (motif obligatoire ; fichier gardé en archive)")
  public JsonNode delete(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.call("delete_attachment", Sql.args("_id", id, "_reason", body.get("reason")));
  }

  // ─── Catégories et réglages ───

  @GetMapping("/categories")
  @Operation(operationId = "listAttachmentCategories", summary = "Catégories de pièces jointes (créées au premier usage)")
  public JsonNode categories() {
    sql.call("ensure_attachment_categories");
    return sql.list("SELECT * FROM public.attachment_categories ORDER BY sort_order, label");
  }

  @PostMapping("/categories")
  @Operation(operationId = "createAttachmentCategory", summary = "Créer une catégorie (droit documents.settings)")
  public JsonNode createCategory(@RequestBody Map<String, Object> body) {
    return sql.insert("attachment_categories", body, CATEGORY);
  }

  @PatchMapping("/categories/{id}")
  @Operation(operationId = "updateAttachmentCategory", summary = "Modifier une catégorie (droit documents.settings)")
  public JsonNode updateCategory(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
    return sql.update("attachment_categories", id, body, CATEGORY);
  }

  @GetMapping("/settings")
  @Operation(operationId = "getAttachmentSettings", summary = "Réglages des pièces jointes (null = valeurs par défaut)")
  public JsonNode settings() {
    return sql.one("SELECT * FROM public.attachment_settings");
  }

  @PutMapping("/settings")
  @Operation(operationId = "saveAttachmentSettings", summary = "Enregistrer les réglages des pièces jointes (droit documents.settings)")
  public JsonNode saveSettings(@RequestBody Map<String, Object> body) {
    return sql.upsert("attachment_settings", body, SETTINGS, List.of("tenant_id"));
  }

  /** Chemin sous le répertoire des fichiers, jamais au-dessus (pas de « .. »). */
  private Path resolve(String rel) {
    Path p = files.resolve(rel).normalize();
    if (!p.startsWith(files)) throw new ApiRefusal(400, "Chemin de fichier invalide");
    return p;
  }
}
