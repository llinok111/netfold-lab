# netfold — certified papercraft net search

**Promise:** for five closed triangle meshes, exhaustive search over **all** dual spanning trees (16–8,100 trees each) finds an **overlap-free**
papercraft net whose bounding-box area is **23.08 %–39.57 % smaller** than the single breadth-first net a conventional exporter emits
(baseline: `baseline/bfs-net.mjs`), while every face stays **isometric to 3.8e-16** relative edge error and the peeled area equals the 3D
surface area to **3.5e-16**. The checker is one command: `node bench/verify.mjs` → **56 passed, 0 failed**.

Upstream: none

## What it is

A papercraft tool needs a *net*: cut a closed triangle mesh along a spanning tree of its face-adjacency graph and lay every face flat.
Any tree gives an isometric layout, but a single-pass exporter emits just one tree; our baseline does exactly that
(`baseline/bfs-net.mjs`, deterministic BFS). On the concave `corner-dent-cube` that baseline net overlaps itself (1 SAT pair,
confirmed by an independent edge-crossing/containment oracle). `netfold` instead enumerates every spanning tree (up to `maxCombos`),
unfolds each one, rejects any layout with positive-area triangle overlap, and keeps the one with the smallest bounding-box area —
less paper for the same model.

The browser page shows the 3D solid (three.js, pinned 0.160.0 via importmap) and the chosen 2D net side by side. Drag to rotate; switch
mesh, switch to the baseline BFS net, or cycle the eight best nets. The numbers on the right are recomputed **in the browser by the same
`src/core.mjs`**, and the page compares its fingerprint with the node-baked one.

## Run it

```bash
node tools/gen-sample.mjs          # deterministic: writes data/meshes.json
node bench/verify.mjs              # 56 assertions, exits 0
node bench/bench.mjs               # writes bench/result.json
python3 -m http.server 4173         # then open http://localhost:4173
```

No dependencies, no `npm install`, no bundler. Node 24 (uses only standard library). The page loads three.js from
`cdn.jsdelivr.net` at the version pinned in the importmap.

## Evidence (bench/result.json, 7 samples per mesh, cold start recorded)

| mesh | faces | trees examined | overlap-free | best bbox | BFS bbox | paper saved | median |
|---|---|---|---|---|---|---|---|
| tetrahedron | 4 | 16 / 20 | 16 | 2.1533 | 3.3868 | **36.42 %** | 0.15 ms |
| square-pyramid | 6 | 75 / 126 | 75 | 5.5315 | 7.7546 | **28.67 %** | 0.70 ms |
| triangular-prism | 8 | 384 / 792 | 384 | 5.5981 | 9.2631 | **39.57 %** | 4.53 ms |
| dimpled-octahedron | 8 | 384 / 792 | 384 | 8.6405 | 11.2327 | **23.08 %** | 4.22 ms |
| corner-dent-cube | 12 | 8,100 / 31,824 | 3,920 | 8.5509 | 11.3653 | **24.76 %** | 165.87 ms |

- Cold start: 5.57 / 2.55 / 4.47 / 7.96 / 200.15 ms in the same order.
- Isometry: max independent edge-length relative error **3.80e-16** (verify recomputes lengths from the 2D polygons; core's own value agrees).
- Area: peeled area / 3D area within **3.45e-16** (verify recomputes with Heron's formula, not core's shoelace).
- Overlap: 0 SAT pairs on all five best nets; verify's independent edge-crossing + point-containment oracle also returns 0. On the
  baseline `corner-dent-cube` net both oracles return the same 1 overlapping pair.
- Scale: prism and dent-cube at scales **1e-6, 1e-3, 1, 1e3, 1e6** choose the same tree, stay overlap-free, and keep bbox area scaling
  to ≤1.89e-16 relative. The tie tolerance is purely relative; it has no absolute floor (the earlier absolute floor broke 1e-6 and is
  documented as a fixed bug in the assertion history).
- Timing RSD: 4.1 %–5.3 % on the two 8-face meshes and 4.4 % on the 12-face cube. The 4- and 6-face medians are 0.15 ms and 0.70 ms per
  analysis, so a 7-sample run is dominated by timer/scheduler noise (RSD 47.9 % and 20.8 %); the median is the reported number and the
  raw p95 is in `result.json`. This is disclosed rather than smoothed.

## 本轮创新

**B 档：把“纸模型展开”从一次性 BFS 切割做成可审计的全枚举搜索。** 单遍导出（本仓库基线 `baseline/bfs-net.mjs`）只产生一棵
生成树，既不检查重叠也不比较用纸面积；这里对 face-dual 图做**全枚举**（`16→8,100` 棵，组合数写在页面上），每棵都做精确等距展开
和 SAT 重叠拒绝，再取 bbox 面积最小者，并在 node 与浏览器用同一 core 复算出同一个指纹。新在“可复算的搜索 + 双 oracle 复核”，
不是换配色或换模型；把同一套代码换到任意三角网格仍然成立。没有做外部文献检索，因此这里只声称与本仓库基线/单遍导出的差异，
不声称业界首创。

## Known limitations

- **Relative tolerance, not absolute:** overlap is `depth <= 1e-9 × net diagonal`. Units are arbitrary; verified at 1e-6…1e6. Meshes
  smaller than ~1e-12 diagonal (double underflow territory) are outside the tested range.
- Faces must be **triangles** and the dual graph must be **connected** (a closed, manifold mesh); open/non-manifold input throws rather
  than silently producing a partial net.
- Exhaustive enumeration is capped at `maxCombos = 60,000` combinations; larger dual graphs switch to a seeded sample and the UI/JSON
  say `exhaustive: false`. All five samples are exhaustive.
- Touching at a vertex or along an edge is allowed (paper can share a cut point); only positive-area overlaps are rejected.
- The score is the net's **bounding-box area**, not strip packing / sheet nesting. It is a reproducible proxy, not an optimal use of paper.
- No glue tabs, no fold-angle or cut-path optimisation, no SVG export yet.
- Browser evidence is HTTP 200 + importmap + same core recompute; no headless pixel test is run (environment forbids it), so the SVG
  layout is verified by coordinates, not by screenshot.