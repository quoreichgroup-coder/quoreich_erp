package com.quoreich.qerp.platform;

/** Refus métier rédigé par l'API (statut HTTP + message français affiché tel quel par l'écran). */
public class ApiRefusal extends RuntimeException {

  private final int status;

  public ApiRefusal(int status, String message) {
    super(message);
    this.status = status;
  }

  public int status() {
    return status;
  }

  /** Zéro ligne touchée : la RLS filtre sans erreur, d'où un refus explicite (même règle que le chemin Supabase). */
  public static ApiRefusal untouched() {
    return new ApiRefusal(403, "Opération refusée : élément introuvable dans la société courante, ou droit insuffisant");
  }
}
