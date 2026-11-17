// Timing harness: cold start plus 7 repeated runs per mesh, median/p95/stddev.
// Run: node bench/bench.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeMesh, buildTopology, bfsTree, unfoldTree } from '../src/core.mjs';

const data = JSON.parse(readFileSync(new URL('../data/meshes.json', import.meta.url), 'utf8'));
const SAMPLES = 7;

function stats(xs) {
  const sorted = xs.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    minMs: sorted[0],
    medianMs: median,
    p95Ms: sorted[Math.min(n - 1, Math.ceil(0.95 * n) - 1)],
    maxMs: sorted[n - 1],
    stddevMs: Math.sqrt(variance),
    rsdPct: mean ? (100 * Math.sqrt(variance)) / mean : 0,
  };
}

function baselineOnce(mesh) {
  const topo = buildTopology(mesh);
  const tree = bfsTree(topo);
  return unfoldTree(mesh, topo, tree);
}

const out = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  samplesPerMesh: SAMPLES,
  method: 'cold start = first call after module load; warm samples = 7 runs, <=8-face meshes amortise 50 analyses per run; p95 = nearest-rank',
  meshes: [],
};

const suiteTimes = [];
for (const mesh of data.meshes) {
  const t0 = performance.now();
  const first = analyzeMesh(mesh, { topN: 6 });
  const coldStartMs = performance.now() - t0;
  const times = [];
  // Sub-millisecond meshes: amortise 50 analyses per sample so the timer and GC
  // noise do not dominate the reported per-analysis cost.
  const reps = mesh.faces.length <= 6 ? 200 : mesh.faces.length <= 8 ? 50 : 1;
  for (let i = 0; i < SAMPLES; i++) {
    const t = performance.now();
    let r = null;
    for (let k = 0; k < reps; k++) r = analyzeMesh(mesh, { topN: 6 });
    times.push((performance.now() - t) / reps);
    if (r.fingerprint !== first.fingerprint) throw new Error('non-deterministic fingerprint for ' + mesh.name);
  }
  const st = stats(times);
  suiteTimes.push(st.medianMs);
  const bt = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = performance.now();
    for (let k = 0; k < reps; k++) baselineOnce(mesh);
    bt.push((performance.now() - t) / reps);
  }
  out.meshes.push({
    name: mesh.name,
    faceCount: mesh.faces.length,
    examined: first.examined,
    totalCombos: first.totalCombos,
    exhaustive: first.exhaustive,
    overlapFreeCount: first.overlapFreeCount,
    bestBboxArea: first.best.bboxArea,
    bfsBboxArea: first.bfs.bboxArea,
    bboxReductionPct: 100 * (1 - first.best.bboxArea / first.bfs.bboxArea),
    bestIsoRel: first.best.maxEdgeRelErr,
    areaRelErr: first.areaRelErr,
    bfsOverlapCount: first.bfs.overlapCount,
    fingerprint: first.fingerprint,
    coldStartMs,
    ...st,
    baselineMedianMs: stats(bt).medianMs,
  });
  console.log(
    `${mesh.name.padEnd(20)} cold=${coldStartMs.toFixed(2)}ms median=${st.medianMs.toFixed(2)}ms` +
    ` p95=${st.p95Ms.toFixed(2)}ms RSD=${st.rsdPct.toFixed(1)}% bbox=${first.best.bboxArea.toFixed(4)}` +
    ` vs BFS ${first.bfs.bboxArea.toFixed(4)} (${(100 * (1 - first.best.bboxArea / first.bfs.bboxArea)).toFixed(2)}% smaller)`
  );
}
out.suiteMedianMs = suiteTimes.reduce((a, b) => a + b, 0);
console.log(`all five meshes, median sum: ${out.suiteMedianMs.toFixed(2)} ms`);

writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log('wrote bench/result.json');
