/** Keep complete raw measurements reviewable: one trial per JSON line. */
import { writeFileSync } from 'node:fs';
export function writeReport(path, report) {
  const fields = Object.entries(report).map(([key, value]) => {
    const encoded = Array.isArray(value)
      ? `[\n${value.map((row) => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]`
      : JSON.stringify(value);
    return `  ${JSON.stringify(key)}: ${encoded}`;
  });
  writeFileSync(path, `{\n${fields.join(',\n')}\n}\n`);
}
