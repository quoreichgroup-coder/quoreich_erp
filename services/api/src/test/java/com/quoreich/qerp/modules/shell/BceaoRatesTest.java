package com.quoreich.qerp.modules.shell;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** Lecture de la page des cours BCEAO (extrait réel du 2 novembre 2026, structure de bceao.int). */
class BceaoRatesTest {

  private static final String PAGE = """
        <h2>Cours des devises du lundi 2 novembre 2026</h2>
            <table>
                <tbody>
                <tr>
                    <th>Devise</th>
                    <th>Achat</th>
                    <th>Vente</th>
                </tr>
                                    <tr>
                        <td>Euro</td>
                        <td>655,957</td>
                        <td>655,957</td>
                    </tr>
                                        <tr>
                        <td>Dollar us</td>
                        <td>582,500</td>
                        <td>589,500</td>
                    </tr>
                                        <tr>
                        <td>Yen japonais</td>
                        <td>3,685</td>
                        <td>3,745</td>
                    </tr>
                                        <tr>
                        <td>Dirham Emirats Arabes Unis</td>
                        <td>1 161,250</td>
                        <td>164,250</td>
                    </tr>
                </tbody>
            </table>
      """;

  @Test
  void litLaDateEtLesCours() {
    BceaoRates.Published p = BceaoRates.parse(PAGE);
    assertThat(p.date()).isEqualTo(LocalDate.of(2026, 11, 2));
    assertThat(p.rates()).extracting(BceaoRates.Rate::currency).containsExactly("EUR", "USD", "JPY", "AED");
    assertThat(p.rates().get(1).buy()).isEqualByComparingTo(new BigDecimal("582.500"));
    assertThat(p.rates().get(1).sell()).isEqualByComparingTo(new BigDecimal("589.500"));
    assertThat(p.rates().get(3).buy()).as("séparateur de milliers").isEqualByComparingTo(new BigDecimal("1161.250"));
  }

  @Test
  void dateAccentueeEtPageSansTableau() {
    assertThat(BceaoRates.parse("<h2>Cours des devises du mardi 3 février 2026</h2>").date()).isEqualTo(LocalDate.of(2026, 2, 3));
    assertThat(BceaoRates.parse("<html>maintenance</html>").rates()).isEmpty();
  }
}
