export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}


export const CURSOR_COLUMNS = ['Date', 'Model', 'Input (w/ Cache Write)', 'Input (w/o Cache Write)',
  'Cache Read', 'Output Tokens', 'Cost'] as const;

export function parseCursorHeader(line: string): Map<string, number> | null {
  const columns = parseCsvLine(line.replace(/^\uFEFF/, '').trim()).map((name) => name.trim());
  if (CURSOR_COLUMNS.some((name) => columns.filter((column) => column === name).length !== 1)) return null;
  return new Map(columns.map((name, index) => [name, index]));
}
