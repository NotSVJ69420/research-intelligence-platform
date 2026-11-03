// Synthetic ground-truth scholarly corpus.
//
// Every "work" has a known identity, so duplicate-detection outcomes can be scored
// against ground truth. The corpus is synthetic: it contains NO real bibliographic
// records and makes no claim about real-world overlap rates between providers.
import { makeRng } from './rng.mjs';

const GIVEN = ['Ashish', 'Noam', 'Niki', 'Jakob', 'Llion', 'Aidan', 'Lukasz', 'Illia', 'María', 'José', 'Zoë', 'Søren',
  'Wei', 'Li', 'Yuki', 'Hiroshi', 'Priya', 'Anil', 'Fatima', 'Omar', 'Elena', 'Ivan', 'Sofia', 'Lars', 'Chloé', 'Mateo'];
const FAMILY = ['Vaswani', 'Shazeer', 'Parmar', 'Uszkoreit', 'Jones', 'Gomez', 'Kaiser', 'Polosukhin', 'Muñoz', 'García',
  'Müller', 'Nøgaard', 'Zhang', 'Wang', 'Tanaka', 'Sato', 'Patel', 'Kumar', 'Haddad', 'Rahman', 'Petrova', 'Ivanov', 'Rossi', 'Berg', 'Dupont', 'Silva'];
const WORDS = ['adaptive', 'scalable', 'robust', 'neural', 'graph', 'sparse', 'probabilistic', 'federated', 'causal', 'temporal',
  'semantic', 'distributed', 'optimal', 'stochastic', 'hierarchical', 'contrastive', 'bayesian', 'latent', 'dynamic', 'incremental',
  'retrieval', 'inference', 'clustering', 'embedding', 'alignment', 'estimation', 'verification', 'compression', 'scheduling', 'attention',
  'networks', 'systems', 'models', 'algorithms', 'frameworks', 'benchmarks', 'representations', 'protocols', 'ontologies', 'pipelines'];
const VENUES = ['Journal of Synthetic Studies', 'Proc. Synthetic Conf.', 'Transactions on Synthetic Systems', 'Synthetic Letters'];

function titleCase(s) { return s.replace(/\b[a-z]/g, c => c.toUpperCase()); }

/** Generate `n` distinct ground-truth works (unique titles by construction via a numeric token). */
export function makeCorpus(n, seed = 1, { pArxiv = 0.5, pPreprintEarlier = 0.4, withSubtitle = 0.5 } = {}) {
  const rng = makeRng(seed);
  const works = [];
  for (let i = 0; i < n; i++) {
    const k = rng.int(3, 6);
    const tw = [];
    for (let j = 0; j < k; j++) tw.push(rng.pick(WORDS));
    // numeric token guarantees title uniqueness => no accidental true collisions
    let title = titleCase(`${tw.join(' ')} ${i + 1}`);
    if (rng.chance(withSubtitle)) title += `: ${titleCase(rng.pick(WORDS) + ' ' + rng.pick(WORDS))} approach`;
    const na = rng.int(2, 6);
    const authors = [];
    for (let j = 0; j < na; j++) authors.push({ given: rng.pick(GIVEN), family: rng.pick(FAMILY) });
    const year = rng.int(2015, 2024);
    const hasArxiv = rng.chance(pArxiv);
    works.push({
      wid: i,
      title,
      authors,
      year,
      preprintYear: hasArxiv ? (rng.chance(pPreprintEarlier) ? year - 1 : year) : null,
      doi: `10.5555/rie.${100000 + i}`,
      pmid: String(30000000 + i),
      arxivId: hasArxiv ? `${String(year % 100).padStart(2, '0')}${String(rng.int(1, 12)).padStart(2, '0')}.${String(10000 + i).slice(-5)}` : null,
      s2Id: (0x1000000 + i * 7919).toString(16).padStart(40, 'a'),
      venue: rng.pick(VENUES),
      abstract: `This synthetic abstract ${i + 1} describes ${tw.join(' ')} in a controlled setting. `.repeat(rng.int(2, 5)).trim(),
      citations: Math.floor(Math.exp(rng.int(0, 70) / 10)),
    });
  }
  return works;
}

export const foldDiacritics = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/Ø/g, 'O');
