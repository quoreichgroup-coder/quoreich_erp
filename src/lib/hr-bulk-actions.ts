export type HrBulkActionOption = { value: string; label: string };
export type HrBulkActionReference = {
  id: string;
  kind: string;
  code: string;
  label: string;
  active: boolean;
  bulk_action_field: string | null;
  bulk_action_options: HrBulkActionOption[];
};

export function parseBulkActionOptions(text: string) {
  const options: HrBulkActionOption[] = [];
  const errors: string[] = [];
  const values = new Set<string>();
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    if (!rawLine.trim()) continue;
    const separator = rawLine.indexOf("|");
    const value = separator < 0 ? "" : rawLine.slice(0, separator).trim();
    const label = separator < 0 ? "" : rawLine.slice(separator + 1).trim();
    if (!value || !label) {
      errors.push(`Ligne ${index + 1} : valeur et libellé sont obligatoires`);
      continue;
    }
    const key = value.toLocaleLowerCase();
    if (values.has(key)) {
      errors.push(`Ligne ${index + 1} : valeur déjà utilisée`);
      continue;
    }
    if (value.length > 120 || label.length > 120) {
      errors.push(`Ligne ${index + 1} : valeur ou libellé supérieur à 120 caractères`);
      continue;
    }
    values.add(key);
    options.push({ value, label });
  }
  if (options.length > 200) errors.push("La limite de 200 valeurs est dépassée");
  return { options: options.length > 200 ? [] : options, errors };
}

export function formatBulkActionOptions(options: HrBulkActionOption[]) {
  return options.map(({ value, label }) => `${value} | ${label}`).join("\n");
}

export function getConfiguredBulkActions(references: HrBulkActionReference[]) {
  return references
    .filter((reference) => reference.active && reference.kind === "movement_type"
      && !!reference.bulk_action_field && reference.bulk_action_options.length > 0)
    .map((reference) => ({
      id: reference.id,
      code: reference.code,
      label: reference.label,
      field: reference.bulk_action_field!,
      options: reference.bulk_action_options,
    }));
}
