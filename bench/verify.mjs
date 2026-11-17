// Claims check for netfold. Every number printed here comes from a live run.
// Run: node bench/verify.mjs
import { readFileSync } from 'node:fs';
import {
  analyzeMesh, buildTopology, unfoldTree, bfsTree, scaleMesh, meshArea,
} from '../src/core.mjs';

const data = JSON.parse(readFileSync(new URL('../data/meshes.json', import.meta.url), 'utf8'));
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS ${name}: ${detail}`); }
  else { fail++; console.log(`FAIL ${name}: ${detail}`); }
}
function rel(a, b) { return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300); }

// --- independent geometry oracle (different formulas, no shared constants) ---
function d3(P, i, j) {
  return Math.hypot(P[3 * i] - P[3 * j], P[3 * i + 1] - P[3 * j + 1], P[3 * i + 2] - P[3 * j + 2]);
}
function heron(a, b, c) {
  const s = (a + b + c) / 2;
  return Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
}
function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
function properCross(a, b, c, d) {
  const o1 = cross(a, b, c), o2 = cross(a, b, d), o3 = cross(c, d, a), o4 = cross(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}
function insideStrict(p, t) {
  const s1 = cross(t[0], t[1], p), s2 = cross(t[1], t[2], p), s3 = cross(t[2], t[0], p);
  return (s1 > 0 && s2 > 0 && s3 > 0) || (s1 < 0 && s2 < 0 && s3 < 0);
}
function oracleOverlapCount(coords) {
  let n = 0;
  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      const A = coords[i], B = coords[j];
      let hit = false;
      for (let a = 0; a < 3 && !hit; a++) {
        for (let b = 0; b < 3 && !hit; b++) {
          if (properCross(A[a], A[(a + 1) % 3], B[b], B[(b + 1) % 3])) hit = true;
        }
      }
      if (!hit) for (const p of A) if (insideStrict(p, B)) hit = true;
      if (!hit) for (const p of B) if (insideStrict(p, A)) hit = true;
      if (hit) n++;
    }
  }
  return n;
}
function oracleIsometry(mesh, coords) {
  let maxRel = 0;
  for (let f = 0; f < mesh.faces.length; f++) {
    const face = mesh.faces[f], c = coords[f];
    for (let e = 0; e < 3; e++) {
      const d2 = Math.hypot(c[e][0] - c[(e + 1) % 3][0], c[e][1] - c[(e + 1) % 3][1]);
      const d3v = d3(mesh.positions, face[e], face[(e + 1) % 3]);
      maxRel = Math.max(maxRel, Math.abs(d2 - d3v) / d3v);
    }
  }
  return maxRel;
}

console.log('--- per-mesh exhaustive net search ---');
const results = [];
for (const mesh of data.meshes) {
  const a = analyzeMesh(mesh, { topN: 6 });
  results.push(a);
  ok(`${mesh.name} exhaustive`, a.exhaustive === true, `examined ${a.examined}/${a.totalCombos} combinations`);
  ok(`${mesh.name} has an overlap-free net`, a.best !== null && a.best.overlapCount === 0, `best overlaps ${a.best ? a.best.overlapCount : 'n/a'}`);
  ok(`${mesh.name} SAT says zero interior overlap`, a.best && a.best.overlapCount === 0, `pairs ${a.best ? a.best.overlapCount : 'n/a'}`);
  ok(`${mesh.name} independent overlap oracle agrees`, oracleOverlapCount(a.best.coords) === 0, `oracle pairs ${oracleOverlapCount(a.best.coords)}`);
  const iso = oracleIsometry(mesh, a.best.coords);
  ok(`${mesh.name} isometry`, iso <= 1e-12, `max independent edge rel err ${iso.toExponential(3)}`);
  const area3 = meshArea(mesh);
  const areaFromEdges = mesh.faces.reduce((s, f, fi) => {
    const c = a.best.coords[fi];
    const ab = Math.hypot(c[0][0] - c[1][0], c[0][1] - c[1][1]);
    const bc = Math.hypot(c[1][0] - c[2][0], c[1][1] - c[2][1]);
    const ca = Math.hypot(c[2][0] - c[0][0], c[2][1] - c[0][1]);
    return s + heron(ab, bc, ca);
  }, 0);
  ok(`${mesh.name} peeled area = 3D area`, rel(areaFromEdges, area3) <= 1e-12, `rel ${rel(areaFromEdges, area3).toExponential(3)}`);
  ok(`${mesh.name} fingerprint stable`, a.fingerprint === mesh.nodeFingerprint, `node ${mesh.nodeFingerprint} / rerun ${a.fingerprint}`);
  ok(`${mesh.name} best no wider than BFS`, a.best.bboxArea <= a.bfs.bboxArea + 1e-12, `${a.best.bboxArea.toFixed(4)} <= ${a.bfs.bboxArea.toFixed(4)}`);
  if (a.bfs.overlapCount > 0) {
    const oo = oracleOverlapCount(a.bfs.coords);
    ok(`${mesh.name} independent oracle confirms BFS overlap`, oo === a.bfs.overlapCount, `SAT ${a.bfs.overlapCount} / oracle ${oo}`);
  }
}

const free = results.filter((r) => r.best && r.best.overlapCount === 0).length;
ok('all five meshes have an overlap-free net', free === 5, `${free}/5`);
const bfsBad = results.filter((r) => r.bfsOverlapCount > 0).length;
ok('baseline BFS net overlaps on at least one mesh', bfsBad >= 1, `${bfsBad}/5 meshes`);
const reductions = results.map((r) => 100 * (1 - r.best.bboxArea / r.bfs.bboxArea));
ok('best net never larger than baseline', reductions.every((v) => v >= -1e-9), `reductions ${reductions.map((v) => v.toFixed(2) + '%').join(', ')}`);

console.log('--- scale invariance (relative tolerance, same core) ---');
const scales = [1e-6, 1e-3, 1, 1e3, 1e6];
for (const name of ['triangular-prism', 'corner-dent-cube']) {
  const mesh = data.meshes.find((m) => m.name === name);
  const base = results.find((r) => r.mesh === name);
  for (const s of scales) {
    const a = analyzeMesh(scaleMesh(mesh, s), { topN: 2 });
    const areaRel = Math.abs(a.best.area2 - s * s * meshArea(mesh)) / (s * s * meshArea(mesh));
    const iso = oracleIsometry({ ...mesh, positions: mesh.positions.map((v) => v * s) }, a.best.coords);
    const sameTree = a.best.treeKey === base.best.treeKey;
    const bboxRel = Math.abs(a.best.bboxArea - s * s * base.best.bboxArea) / (s * s * base.best.bboxArea);
    ok(
      `${name} @${s} overlap-free + scale invariant`,
      a.best.overlapCount === 0 && iso <= 1e-12 && areaRel <= 1e-12 && bboxRel <= 1e-9 && sameTree,
      `free=1 treeStable=${sameTree} iso=${iso.toExponential(2)} areaRel=${areaRel.toExponential(2)} bboxRel=${bboxRel.toExponential(2)}`
    );
  }
}

console.log('--- library contract ---');
const topo = buildTopology(data.meshes[0]);
ok('topology closed', topo.edges.every((e) => e.faces.length === 2), `${topo.edges.length} edges, all manifold`);
const badTree = bfsTree(topo).slice(0, 2);
let threw = false;
try { unfoldTree(data.meshes[0], topo, badTree); } catch { threw = true; }
ok('unfold rejects a non-tree cut', threw, 'threw on F-2 edges');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
