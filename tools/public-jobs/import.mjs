/** Explicit, separate output directory; never modifies the ALIO CLI or schedule. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { collect } from '../../apps/collector/dist/collect.js';
import { publicJobs } from '../../apps/collector/dist/providers/public-jobs.js';
import { mergePreviewSnapshots } from '../../apps/web/lib/preview.js';

const { values } = parseArgs({ options: { input: { type: 'string' }, out: { type: 'string' }, base: { type: 'string' } } });
if (!values.input || !values.out) throw new Error('Usage: node tools/public-jobs/import.mjs --input batch.json --out NEW_DIRECTORY');
const input = JSON.parse(await readFile(values.input, 'utf8'));
let snapshot = await collect([publicJobs(input)], () => { throw new Error('Offline import must not fetch'); }, new Date());
if (values.base) snapshot = mergePreviewSnapshots(JSON.parse(await readFile(values.base, 'utf8')), snapshot);
await mkdir(values.out, { recursive: true });
// Exclusive creation prevents accidental replacement of an existing production snapshot.
await writeFile(path.join(values.out, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ jobs: snapshot.jobs.length, sources: snapshot.sources }));
