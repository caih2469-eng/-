import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.json', '.jsonc', '.md', '.html', '.css',
  '.sql', '.yml', '.yaml', '.cmd', '.txt', '.py', '.ts', '.tsx', '.jsx',
  '.ps1', '.bat', '.sh', '.csv', '.tsv', '.toml', '.xml', '.svg', '.ini',
  '.conf', '.properties'
]);
const EXCLUDED_DIRECTORIES = new Set([
  '.git', 'node_modules', '.wrangler', 'uploads', 'material-files'
]);

const forbiddenSequences = [
  { label: 'Unicode replacement character', value: String.fromCodePoint(0xfffd) },
  {
    label: 'common mojibake sequence 1',
    value: String.fromCodePoint(0x951f, 0x65a4, 0x62f7)
  },
  {
    label: 'common mojibake sequence 2',
    value: String.fromCodePoint(0x70eb, 0x70eb, 0x70eb)
  }
];
const questionReplacementRun = /(?<!\?)\?{4,}(?!\?)/g;

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(target);
    }
  }
  return files;
};

export const auditTextFiles = async (rootDirectory) => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = await walk(rootDirectory);
  const violations = [];
  for (const file of files) {
    const relativeFile = path.relative(rootDirectory, file);
    let text;
    try {
      text = decoder.decode(await readFile(file));
    } catch (error) {
      violations.push({
        file: relativeFile,
        line: 1,
        type: 'invalid-utf8',
        currentText: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const sequence of forbiddenSequences) {
        if (line.includes(sequence.value)) {
          violations.push({
            file: relativeFile,
            line: index + 1,
            type: sequence.label,
            currentText: line.trim()
          });
        }
      }
      questionReplacementRun.lastIndex = 0;
      if (questionReplacementRun.test(line)) {
        violations.push({
          file: relativeFile,
          line: index + 1,
          type: 'question-mark replacement run',
          currentText: line.trim()
        });
      }
    }
  }
  return { filesScanned: files.length, violations };
};

const main = async () => {
  const root = path.resolve(process.argv[2] || '.');
  const report = await auditTextFiles(root);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.violations.length) process.exitCode = 1;
};

if (process.argv[1] && path.basename(process.argv[1]) === 'audit-text-encoding.mjs') {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
