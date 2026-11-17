// Deterministic sample generator: five closed triangle meshes and the node-side
// analysis summary used by the browser for fingerprint comparison.
// Run: node tools/gen-sample.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { analyzeMesh, meshArea } from '../src/core.mjs';

const R3 = Math.sqrt(3) / 2;

const cubePositions = [
  0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
  0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
];
const cubeFaces = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
  [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
];
const dentPositions = cubePositions.slice();
dentPositions[3 * 7] = 0.4;
dentPositions[3 * 7 + 1] = 0.6;
dentPositions[3 * 7 + 2] = 0.5;

const meshes = [
  {
    name: 'tetrahedron',
    positions: [0, 0, 0, 1, 0, 0, 0.5, R3, 0, 0.5, R3 / 3, 0.8],
    faces: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]],
  },
  {
    name: 'square-pyramid',
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0.5, 0.5, 1],
    faces: [[0, 1, 2], [0, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
  },
  {
    name: 'triangular-prism',
    positions: [0, 0, 0, 1, 0, 0, 0.5, R3, 0, 0, 0, 1, 1, 0, 1, 0.5, R3, 1],
    faces: [[0, 2, 1], [3, 4, 5], [0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4], [2, 0, 3], [2, 3, 5]],
  },
  {
    name: 'dimpled-octahedron',
    positions: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -0.2],
    faces: [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]],
  },
  {
    name: 'corner-dent-cube',
    positions: dentPositions,
    faces: cubeFaces,
  },
];

const out = {
  generator: 'tools/gen-sample.mjs',
  version: 1,
  convention: 'faces are counter-clockwise from outside; positions are x,y,z triples',
  meshes: meshes.map((m) => {
    const analysis = analyzeMesh(m, { topN: 6 });
    return {
      name: m.name,
      positions: m.positions,
      faces: m.faces,
      surfaceArea: meshArea(m),
      nodeFingerprint: analysis.fingerprint,
      node: {
        examined: analysis.examined,
        exhaustive: analysis.exhaustive,
        totalCombos: analysis.totalCombos,
        overlapFreeCount: analysis.overlapFreeCount,
        bestBboxArea: analysis.best.bboxArea,
        bestTreeKey: analysis.best.treeKey,
        bestIsoRel: analysis.best.maxEdgeRelErr,
        bfsBboxArea: analysis.bfs.bboxArea,
        bfsOverlapCount: analysis.bfs.overlapCount,
      },
    };
  }),
};

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const file = new URL('../data/meshes.json', import.meta.url);
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log('wrote data/meshes.json');
for (const m of out.meshes) {
  const n = m.node;
  console.log(
    `${m.name.padEnd(20)} F=${String(m.faces.length).padStart(2)} trees=${String(n.examined).padStart(5)}` +
    ` free=${String(n.overlapFreeCount).padStart(5)} bbox=${n.bestBboxArea.toFixed(4)}` +
    ` bfs=${n.bfsBboxArea.toFixed(4)} bfsOverlap=${n.bfsOverlapCount} fp=${m.nodeFingerprint}`
  );
}
