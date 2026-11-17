// netfold core — pure triangle-mesh unfolding for papercraft nets.
// No renderer, no DOM, no filesystem, no environment access.
//
// A "net" is produced by cutting a closed triangle mesh along a spanning tree of
// its face-adjacency graph and unfolding every face into 2D. Because each face
// keeps its three side lengths, the map is isometric by construction; the hard
// part is finding a tree whose flat layout does not self-overlap.

export const OVERLAP_EPS_REL = 1e-9; // interior overlap tolerance / net diagonal

export function meshArea(mesh) {
  const P = mesh.positions, F = mesh.faces;
  let a = 0;
  for (const f of F) {
    const [i, j, k] = f;
    const ux = P[3 * j] - P[3 * i], uy = P[3 * j + 1] - P[3 * i + 1], uz = P[3 * j + 2] - P[3 * i + 2];
    const vx = P[3 * k] - P[3 * i], vy = P[3 * k + 1] - P[3 * i + 1], vz = P[3 * k + 2] - P[3 * i + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    a += 0.5 * Math.hypot(cx, cy, cz);
  }
  return a;
}

export function buildTopology(mesh) {
  const { faces } = mesh;
  const map = new Map();
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    for (let e = 0; e < 3; e++) {
      const a = f[e], b = f[(e + 1) % 3];
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const key = lo + ',' + hi;
      let rec = map.get(key);
      if (!rec) { rec = { key, a: lo, b: hi, faces: [] }; map.set(key, rec); }
      rec.faces.push(fi);
    }
  }
  const edges = [...map.values()];
  const dual = [];
  const faceEdges = Array.from({ length: faces.length }, () => []);
  for (const e of edges) {
    if (e.faces.length !== 2) continue;
    const idx = dual.length;
    dual.push({ a: e.a, b: e.b, f1: e.faces[0], f2: e.faces[1], key: e.key });
    faceEdges[e.faces[0]].push(idx);
    faceEdges[e.faces[1]].push(idx);
  }
  return { edges, dual, faceEdges, faceCount: faces.length };
}

function dist3(P, a, b) {
  const dx = P[3 * a] - P[3 * b], dy = P[3 * a + 1] - P[3 * b + 1], dz = P[3 * a + 2] - P[3 * b + 2];
  return Math.hypot(dx, dy, dz);
}

function faceThird(face, a, b) {
  for (const v of face) if (v !== a && v !== b) return v;
  throw new Error('degenerate face');
}

// Child triangle hinged on edge (a,b) of an already placed parent.
function placeChild(pa, pb, parentThird, dAC, dBC, L) {
  if (L < 1e-30) throw new Error('zero-length hinge');
  const x = (dAC * dAC - dBC * dBC + L * L) / (2 * L);
  const h2 = dAC * dAC - x * x;
  const h = Math.sqrt(Math.max(0, h2));
  const ux = (pb[0] - pa[0]) / L, uy = (pb[1] - pa[1]) / L;
  const nx = -uy, ny = ux;
  const bx = pa[0] + ux * x, by = pa[1] + uy * x;
  const c1 = [bx + nx * h, by + ny * h];
  const crossParent = (pb[0] - pa[0]) * (parentThird[1] - pa[1]) - (pb[1] - pa[1]) * (parentThird[0] - pa[0]);
  // Unfold away from the parent: choose the side opposite the parent apex.
  return crossParent >= 0 ? [bx - nx * h, by - ny * h] : c1;
}

export function unfoldTree(mesh, topo, tree, opts = {}) {
  const F = mesh.faces.length;
  if (!F) throw new Error('mesh has no faces');
  if (tree.length !== F - 1) throw new Error('tree must have F-1 edges');
  const adj = Array.from({ length: F }, () => []);
  for (const ei of tree) {
    const d = topo.dual[ei];
    adj[d.f1].push({ to: d.f2, edge: d });
    adj[d.f2].push({ to: d.f1, edge: d });
  }
  const P = mesh.positions;
  const coords = new Array(F);
  const f0 = mesh.faces[0];
  const L01 = dist3(P, f0[0], f0[1]);
  const L02 = dist3(P, f0[0], f0[2]);
  const L12 = dist3(P, f0[1], f0[2]);
  const x2 = (L01 * L01 + L02 * L02 - L12 * L12) / (2 * L01);
  const y2 = Math.sqrt(Math.max(0, L02 * L02 - x2 * x2));
  coords[0] = [[0, 0], [L01, 0], [x2, y2]];

  const stack = [0];
  const seen = new Uint8Array(F);
  seen[0] = 1;
  while (stack.length) {
    const pf = stack.pop();
    const pface = mesh.faces[pf];
    for (const { to, edge } of adj[pf]) {
      if (seen[to]) continue;
      seen[to] = 1;
      const a = edge.a, b = edge.b;
      const ia = pface.indexOf(a), ib = pface.indexOf(b);
      if (ia < 0 || ib < 0) throw new Error('hinge edge not on parent');
      const pa = coords[pf][ia], pb = coords[pf][ib];
      const cThird = faceThird(mesh.faces[to], a, b);
      const parentThird = faceThird(pface, a, b);
      const dAC = dist3(P, a, cThird), dBC = dist3(P, b, cThird);
      const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      const pc = placeChild(pa, pb, coords[pf][pface.indexOf(parentThird)], dAC, dBC, L);
      const child = mesh.faces[to];
      const cc = new Array(3);
      for (let k = 0; k < 3; k++) {
        const v = child[k];
        cc[k] = v === a ? [pa[0], pa[1]] : v === b ? [pb[0], pb[1]] : [pc[0], pc[1]];
      }
      coords[to] = cc;
      stack.push(to);
    }
  }
  const placed = coords.reduce((n, c) => n + (c ? 1 : 0), 0);
  if (placed !== F) throw new Error('dual graph is disconnected: ' + placed + '/' + F + ' faces');
  return finishNet(mesh, coords, opts);
}

export function finishNet(mesh, coords, opts = {}) {
  const P = mesh.positions;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let area2 = 0, maxEdgeErr = 0, maxAbsEdgeErr = 0;
  for (let fi = 0; fi < coords.length; fi++) {
    const c = coords[fi], f = mesh.faces[fi];
    for (const p of c) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const ax = c[1][0] - c[0][0], ay = c[1][1] - c[0][1];
    const bx = c[2][0] - c[0][0], by = c[2][1] - c[0][1];
    area2 += 0.5 * Math.abs(ax * by - ay * bx);
    for (let e = 0; e < 3; e++) {
      const i = f[e], j = f[(e + 1) % 3];
      const d2 = Math.hypot(c[e][0] - c[(e + 1) % 3][0], c[e][1] - c[(e + 1) % 3][1]);
      const d3 = dist3(P, i, j);
      const err = Math.abs(d2 - d3);
      if (err > maxAbsEdgeErr) maxAbsEdgeErr = err;
      if (d3 > 0) maxEdgeErr = Math.max(maxEdgeErr, err / d3);
    }
  }
  const width = maxX - minX, height = maxY - minY;
  const diag = Math.hypot(width, height);
  const eps = Math.max(diag, 1e-12) * (opts.overlapEpsRel ?? OVERLAP_EPS_REL);
  const overlaps = countOverlaps(coords, eps);
  const area3 = meshArea(mesh);
  return {
    coords, width, height, bboxArea: width * height, diagonal: diag,
    area2, area3, areaRelErr: area3 > 0 ? Math.abs(area2 - area3) / area3 : 0,
    maxEdgeRelErr: maxEdgeErr, maxEdgeAbsErr: maxAbsEdgeErr,
    overlapCount: overlaps.length, overlaps, eps,
  };
}

function proj(P, nx, ny) {
  let lo = Infinity, hi = -Infinity;
  for (const p of P) {
    const d = p[0] * nx + p[1] * ny;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

// Separating-axis test for two triangles. Returns true only for positive-area
// overlap; edge/vertex touching yields an overlap depth of ~0 and is allowed.
export function trianglesOverlap(A, B, eps) {
  for (const P of [A, B]) {
    for (let e = 0; e < 3; e++) {
      const p = P[e], q = P[(e + 1) % 3];
      const nx = -(q[1] - p[1]), ny = q[0] - p[0];
      const len = Math.hypot(nx, ny);
      if (len === 0) continue;
      const [a0, a1] = proj(A, nx / len, ny / len);
      const [b0, b1] = proj(B, nx / len, ny / len);
      const depth = Math.min(a1, b1) - Math.max(a0, b0);
      if (depth <= eps) return false;
    }
  }
  return true;
}

export function countOverlaps(coords, eps) {
  const out = [];
  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      if (trianglesOverlap(coords[i], coords[j], eps)) out.push([i, j]);
    }
  }
  return out;
}

function combCount(n, k, cap = 1e7) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let v = 1;
  for (let i = 0; i < k; i++) {
    v = (v * (n - i)) / (i + 1);
    if (v > cap) return Infinity;
  }
  return Math.round(v);
}

function isTreeEdges(dual, combo, F) {
  const parent = new Int32Array(F);
  for (let i = 0; i < F; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const ei of combo) {
    const d = dual[ei];
    const a = find(d.f1), b = find(d.f2);
    if (a === b) return false;
    parent[a] = b;
  }
  return true;
}

export function enumerateSpanningTrees(topo, opts = {}) {
  const F = topo.faceCount, m = topo.dual.length, k = F - 1;
  if (F <= 1) return { trees: [[]], examined: 1, exhaustive: true, totalCombos: 1 };
  if (k > m) return { trees: [], examined: 0, exhaustive: true, totalCombos: 0 };
  const total = combCount(m, k);
  const maxCombos = opts.maxCombos ?? 60000;
  const trees = [];
  if (total <= maxCombos) {
    const combo = new Array(k).fill(0);
    const rec = (start, depth) => {
      if (depth === k) {
        if (isTreeEdges(topo.dual, combo, F)) trees.push(combo.slice());
        return;
      }
      for (let i = start; i <= m - (k - depth); i++) {
        combo[depth] = i;
        rec(i + 1, depth + 1);
      }
    };
    rec(0, 0);
    return { trees, examined: trees.length, exhaustive: true, totalCombos: total };
  }
  // Deterministic LCG sample when exhaustive enumeration is too large.
  let s = opts.seed ?? 0x9e3779b9;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const target = opts.sampleCount ?? maxCombos;
  const seen = new Set();
  let guard = 0;
  while (trees.length < target && guard < target * 20) {
    guard++;
    const pool = Array.from({ length: m }, (_, i) => i);
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(rnd() * (m - i));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const combo = pool.slice(0, k).sort((a, b) => a - b);
    const sig = combo.join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    if (isTreeEdges(topo.dual, combo, F)) trees.push(combo);
  }
  return { trees, examined: trees.length, exhaustive: false, totalCombos: total };
}

export function bfsTree(topo) {
  const F = topo.faceCount;
  const seen = new Uint8Array(F);
  const out = [];
  const q = [0];
  seen[0] = 1;
  while (q.length) {
    const f = q.shift();
    for (const ei of topo.faceEdges[f]) {
      const d = topo.dual[ei];
      const to = d.f1 === f ? d.f2 : d.f1;
      if (seen[to]) continue;
      seen[to] = 1;
      out.push(ei);
      q.push(to);
    }
  }
  return out.length === F - 1 ? out : null;
}

function treeKey(topo, tree) {
  return tree.map((i) => topo.dual[i].key).join('|');
}

function better(a, b, topo) {
  if (!b) return true;
  // Purely relative tie tolerance: the ranking must survive uniform rescaling.
  // An absolute floor here would make 1e-6-scale nets tie on key order instead.
  const tol = 1e-12 * b.bboxArea;
  if (a.bboxArea < b.bboxArea - tol) return true;
  if (a.bboxArea > b.bboxArea + tol) return false;
  return treeKey(topo, a.tree) < treeKey(topo, b.tree);
}

export function analyzeMesh(mesh, opts = {}) {
  const topo = opts.topo ?? buildTopology(mesh);
  const enumRes = enumerateSpanningTrees(topo, opts);
  const topN = opts.topN ?? 8;
  let best = null;
  const top = [];
  let overlapFreeCount = 0;
  let firstOverlap = null;
  for (const tree of enumRes.trees) {
    const net = unfoldTree(mesh, topo, tree, opts);
    if (net.overlapCount === 0) {
      overlapFreeCount++;
      const cand = {
        tree, treeKey: treeKey(topo, tree), coords: net.coords,
        bboxArea: net.bboxArea, width: net.width, height: net.height,
        area2: net.area2, maxEdgeRelErr: net.maxEdgeRelErr, maxEdgeAbsErr: net.maxEdgeAbsErr,
        overlapCount: 0,
      };
      if (better(cand, best, topo)) best = cand;
      let pos = top.length;
      for (let i = 0; i < top.length; i++) {
        if (better(cand, top[i], topo)) { pos = i; break; }
      }
      if (pos < topN) { top.splice(pos, 0, cand); if (top.length > topN) top.pop(); }
    } else if (!firstOverlap) {
      firstOverlap = { tree, treeKey: treeKey(topo, tree), overlapCount: net.overlapCount, overlaps: net.overlaps };
    }
  }
  let bfs = null;
  const bt = bfsTree(topo);
  if (bt) {
    const net = unfoldTree(mesh, topo, bt, opts);
    bfs = {
      tree: bt, treeKey: treeKey(topo, bt), coords: net.coords,
      bboxArea: net.bboxArea, width: net.width, height: net.height,
      overlapCount: net.overlapCount, maxEdgeRelErr: net.maxEdgeRelErr,
    };
  }
  const area3 = meshArea(mesh);
  const res = {
    mesh: mesh.name ?? 'mesh', faceCount: mesh.faces.length, dualEdges: topo.dual.length,
    examined: enumRes.examined, exhaustive: enumRes.exhaustive, totalCombos: enumRes.totalCombos,
    overlapFreeCount, best, top, bfs, area3,
    bfsOverlapCount: bfs ? bfs.overlapCount : null,
    bestOverlapCount: best ? 0 : null,
    areaRelErr: best ? Math.abs(best.area2 - area3) / area3 : null,
    firstOverlap,
  };
  res.fingerprint = fingerprint(res);
  return res;
}

// Deterministic 64-bit-ish fingerprint (two FNV-1a 32 lanes) so the same core
// running in node and in a browser can be compared without any crypto API.
export function fingerprint(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + i; h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function scaleMesh(mesh, s) {
  return {
    ...mesh,
    positions: mesh.positions.map((v) => v * s),
    faces: mesh.faces.map((f) => f.slice()),
  };
}
