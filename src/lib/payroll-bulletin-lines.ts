type BulletinLine = { source_type: string; definition_snapshot: Record<string, unknown> };

export function bulletinLines<T extends BulletinLine>(lines: readonly T[]): T[] {
  const visible = lines.filter(line => line.definition_snapshot.printable !== false);
  if (!visible.every(line => line.source_type === "base_salary"
      || Number.isInteger(line.definition_snapshot.sort_order))) return visible;
  return visible.map((line, index) => ({ line, index }))
    .sort((a, b) => (a.line.source_type === "base_salary" ? -1 : b.line.source_type === "base_salary" ? 1 : 0)
      || Number(a.line.definition_snapshot.sort_order ?? 0) - Number(b.line.definition_snapshot.sort_order ?? 0)
      || a.index - b.index)
    .map(({ line }) => line);
}
