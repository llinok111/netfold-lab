// Baseline: one deterministic breadth-first cut tree per mesh. No search, no
// overlap check, no area optimisation — this is what a conventional exporter
// emits. Run: node baseline/bfs-net.mjs
import { readFileSync } from 'node:fs';
import { buildTopology, unfoldTree, meshArea } from '../src/core.mjs';

const data = JSON.parse(readFileSync(new URL('../data/meshes.json', import.meta.url), 'utf8'));
const rows = [];

for (const mesh of data.meshes) {
  const topo = buildTopology(mesh);
  const F = mesh.faces.length;
  const seen = new Uint8Array(F);
  const tree = [];
  const q = [0];
  seen[0] = 1;
  while (q.length) {
    const f = q.shift();
    for (const ei of topo.faceEdges[f]) {
      const d = topo.dual[ei];
      const to = d.f1 === f ? d.f2 : d.f1;
      if (seen[to]) continue;
      seen[to] = 1;
      tree.push(ei);
      q.push(to);
    }
  }
  if (tree.length !== F - 1) throw new Error(`${mesh.name}: open dual graph`);
  const net = unfoldTree(mesh, topo, tree);
  rows.push({
    mesh: mesh.name,
    bboxArea: net.bboxArea,
    overlapCount: net.overlapCount,
    maxEdgeRelErr: net.maxEdgeRelErr,
    areaRatio: net.area2 / meshArea(mesh),
    treeKey: tree.map((i) => topo.dual[i].key).join('|'),
  });
}

console.log(JSON.stringify(rows, null, 2));
