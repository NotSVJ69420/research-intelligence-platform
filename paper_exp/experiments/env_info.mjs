// Records software/hardware versions used for a run (written to results/environment.json).
import fs from 'fs'; import os from 'os'; import { execSync } from 'child_process'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url).pathname;
const v = (p) => { try { return require(root + 'node_modules/' + p + '/package.json').version; } catch { return null; } };
const sh = (c) => { try { return execSync(c, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
const out = {
  recordedAt: new Date().toISOString(), node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model, vcpus: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30),
  packages: { pg: v('pg'), xml2js: v('xml2js'), dotenv: v('dotenv') },
  postgres: sh(`PGPASSWORD=postgres psql -h localhost -U postgres -d rie_bench -Atc "show server_version"`),
  repoCommit: sh('git rev-parse --short HEAD'), os: sh('. /etc/os-release && echo $PRETTY_NAME'),
};
fs.writeFileSync(new URL('../results/environment.json', import.meta.url), JSON.stringify(out, null, 2)); console.log(out);
