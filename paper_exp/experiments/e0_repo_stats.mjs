// E0: static repository audit (reproducible; reads only tracked files).
import fs from 'fs';
import { execSync } from 'child_process';
const root = new URL('../../', import.meta.url).pathname;
const files = execSync('git ls-files', { cwd: root }).toString().trim().split('\n').filter(f => !f.startsWith('paper/'));
const loc = (f) => fs.readFileSync(root + f, 'utf8').split('\n').length - (fs.readFileSync(root + f, 'utf8').endsWith('\n') ? 1 : 0);
const layer = (f) => {
  if (f.startsWith('ingestion/sources/')) return 'ingestion: source adapters';
  if (f.startsWith('ingestion/normalizers/')) return 'ingestion: normalizers';
  if (f.startsWith('ingestion/')) return 'ingestion: orchestration (orchestrator, dedupe, ranking, ai-pipeline)';
  if (f.startsWith('services/')) return 'services (db, schema, paper, ai, document)';
  if (f.startsWith('main/') || f === 'electron-main.js' || f === 'preload.js') return 'Electron main process / IPC / preload';
  if (f.startsWith('src/') && f.endsWith('.js')) return 'renderer: main window modules';
  if (f.startsWith('renderer/')) return 'renderer: editor modules';
  if (f.startsWith('test/')) return 'tests';
  if (f === 'index.html' || f === 'editor.html') return 'HTML views';
  return null;
};
const byLayer = {};
for (const f of files) { const l = layer(f); if (!l || !/\.(js|html)$/.test(f)) continue; byLayer[l] ||= { files: 0, lines: 0 }; byLayer[l].files++; byLayer[l].lines += loc(f); }
const tests = {};
for (const f of files.filter(f => f.startsWith('test/'))) {
  const s = fs.readFileSync(root + f, 'utf8');
  tests[f] = { lines: loc(f), assertions: (s.match(/\bassert\(/g) || []).length - (s.includes('function assert') ? 1 : 0) + (s.match(/console\.log\(['"`]\s+✓/g) || []).length, needsNetwork: /searchPapers\(|searchAndStore\(/.test(s), needsPostgres: /services\/(schema|paper-service)/.test(s) };
}
const read = (f) => fs.readFileSync(root + f, 'utf8');
const readme = read('README.md'), ai = read('services/ai-service.js'), orch = read('ingestion/search-orchestrator.js'), analysis = read('src/analysis.js');
const drift = {
  readmeSourcesClaimed: /arXiv and OpenAlex APIs/.test(readme) ? ['arxiv', 'openalex'] : null,
  registeredSources: [...orch.matchAll(/^\s{2}(\w+):\s+\{ fetch:/gm)].map(m => m[1]),
  readmeModel: (readme.match(/llama-3\.3-70b-versatile/) || [null])[0],
  codeDefaultModel: (ai.match(/GROQ_MODEL\s*\|\|\s*'([^']+)'/) || [])[1],
  analysisJsHeaderMentions: /Gemini/.test(analysis) ? 'Gemini' : null,
  readmeMentionsOrchestratorJs: /orchestrator\.js/.test(readme) && !/search-orchestrator\.js/.test(readme),
  readmeTablesClaimed: (readme.match(/\(`papers`, `analyses`, `collections`\)/) ? ['papers', 'analyses', 'collections'] : null),
  schemaTablesCreated: [...read('services/schema.js').matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]),
  readmeClaimsFullTextIndexes: /indexed full-text fields/.test(readme),
  schemaHasFullTextIndex: /tsvector|gin|to_tsvector/i.test(read('services/schema.js')),
  readmeSyncScroll: /synchronized scrolling/.test(readme),
};
const out = { commit: execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(), byLayer, totalLines: Object.values(byLayer).reduce((a, v) => a + v.lines, 0), tests, drift };
fs.writeFileSync(new URL('../results/e0_repo_stats.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
