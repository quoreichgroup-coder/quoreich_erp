package com.quoreich.qerp;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Point d'entrée de l'API QUOREICH.
 *
 * <p>L'application est un monolithe modulaire : un seul déployable, des paquets
 * par domaine métier. Les frontières entre domaines sont tenues par ArchUnit
 * ({@code ArchitectureTest}) et non par la discipline des relecteurs — le code
 * de ce dépôt est écrit par des agents, et une règle exécutable vaut mieux qu'une
 * convention écrite.
 */
@SpringBootApplication
public class QerpApiApplication {

  public static void main(String[] args) {
    SpringApplication.run(QerpApiApplication.class, args);
  }
}
