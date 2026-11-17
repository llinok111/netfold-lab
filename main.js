// Browser shell: three.js renders the solid; src/core.mjs computes the net.
// No geometry logic lives here — only scene setup, SVG projection and DOM text.
import * as THREE from 'three';
import { analyzeMesh } from './src/core.mjs';

const data = await fetch('./data/meshes.json').then((r) => r.json());
const state = { meshIndex: 0, mode: 'best', topPos: 0, analysis: null, mesh: null };

const el = (id) => document.getElementById(id);
const view = el('view3d');
const svg = el('net');

// ---------- three.js scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
view.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 1.15));
const key = new THREE.DirectionalLight(0xffe3b0, 1.6);
key.position.set(3, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x7fb7ff, 0.8);
rim.position.set(-4, -2, -3);
scene.add(rim);

const solidMat = new THREE.MeshStandardMaterial({ color: 0x93a7bd, metalness: 0.12, roughness: 0.55, flatShading: true });
const wireMat = new THREE.LineBasicMaterial({ color: 0x10151c });
let group = null;
let center = new THREE.Vector3();
let radius = 1;
let theta = 0.7, phi = 1.05, dragging = false, lastX = 0, lastY = 0;

function rebuild3D(mesh) {
  if (group) { scene.remove(group); group.traverse((o) => { o.geometry?.dispose(); }); }
  group = new THREE.Group();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geo.setIndex(mesh.faces.flat());
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, solidMat));
  const edgeGeo = new THREE.EdgesGeometry(geo, 1);
  group.add(new THREE.LineSegments(edgeGeo, wireMat));
  scene.add(group);
  geo.computeBoundingSphere();
  center = geo.boundingSphere.center.clone();
  radius = Math.max(1e-6, geo.boundingSphere.radius);
  updateCamera();
}

function updateCamera() {
  const d = radius * 3.4;
  camera.position.set(
    center.x + d * Math.sin(phi) * Math.cos(theta),
    center.y + d * Math.cos(phi),
    center.z + d * Math.sin(phi) * Math.sin(theta)
  );
  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
  camera.lookAt(center);
}

renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  theta += (e.clientX - lastX) * 0.008;
  phi = Math.max(0.12, Math.min(Math.PI - 0.12, phi - (e.clientY - lastY) * 0.008));
  lastX = e.clientX; lastY = e.clientY;
  updateCamera();
});

function resize() {
  const w = view.clientWidth || 400, h = view.clientHeight || 400;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

let dirty = true;
renderer.setAnimationLoop(() => {
  if (!dirty) return;
  renderer.render(scene, camera);
  dirty = false;
});
renderer.domElement.addEventListener('pointermove', () => { dirty = true; });
window.addEventListener('resize', () => { dirty = true; });

// ---------- SVG net ----------
const palette = ['#ffb454', '#5ddba0', '#7fb7ff', '#ff8fa3', '#c9a0ff', '#8fe3e8', '#e8d48f', '#9fb3c8'];
function drawNet(coords) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const tri of coords) for (const p of tri) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const pad = Math.max(0.02 * Math.max(maxX - minX, maxY - minY), 1e-9);
  const w = maxX - minX + 2 * pad, h = maxY - minY + 2 * pad;
  svg.setAttribute('viewBox', `${minX - pad} ${-maxY - pad} ${w} ${h}`);
  svg.innerHTML = '';
  coords.forEach((tri, i) => {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', tri.map((p) => `${p[0]},${-p[1]}`).join(' '));
    poly.setAttribute('fill', palette[i % palette.length]);
    poly.setAttribute('fill-opacity', '0.82');
    poly.setAttribute('stroke', '#0b0e13');
    poly.setAttribute('stroke-width', String(Math.max(w, h) * 0.0018));
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);
  });
}

// ---------- state / DOM ----------
function currentNet() {
  const a = state.analysis;
  if (state.mode === 'bfs') return a.bfs;
  const top = a.top;
  return top[Math.min(state.topPos, top.length - 1)] || a.best;
}

function paint() {
  const a = state.analysis, m = state.mesh;
  const net = currentNet();
  drawNet(net.coords);
  el('meshName').textContent = m.name;
  el('faceTag').textContent = `${a.faceCount} triangles`;
  el('examined').textContent = `${a.examined}${a.exhaustive ? ' (all)' : ' (seeded sample)'} / ${a.totalCombos} combinations`;
  el('free').textContent = `${a.overlapFreeCount} / ${a.examined}`;
  el('area').textContent = net.bboxArea.toFixed(4);
  el('bfsArea').textContent = a.bfs.bboxArea.toFixed(4);
  el('gain').textContent = `${(100 * (1 - net.bboxArea / a.bfs.bboxArea)).toFixed(2)}%`;
  el('ov').textContent = String(net.overlapCount);
  el('iso').textContent = net.maxEdgeRelErr.toExponential(2);
  el('ratio').textContent = (net.area2 / a.area3).toFixed(15);
  el('nodeFp').textContent = m.nodeFingerprint;
  el('liveFp').textContent = a.fingerprint;
  const match = a.fingerprint === m.nodeFingerprint;
  const st = el('status');
  st.className = match ? 'ok' : 'bad';
  st.textContent = match ? '✓ browser fingerprint equals the node-baked fingerprint' : '✗ fingerprint mismatch';
  el('modeBest').classList.toggle('on', state.mode === 'best');
  el('modeBfs').classList.toggle('on', state.mode === 'bfs');
  el('nextNet').style.opacity = state.mode === 'best' && a.top.length > 1 ? '1' : '0.4';
}

function selectMesh(i, compute = true) {
  state.meshIndex = (i + data.meshes.length) % data.meshes.length;
  state.mesh = data.meshes[state.meshIndex];
  state.topPos = 0;
  if (compute) {
    el('status').textContent = 'searching spanning trees…';
    // Yield one frame so the status paints before the synchronous search.
    requestAnimationFrame(() => {
      state.analysis = analyzeMesh(state.mesh, { topN: 8 });
      rebuild3D(state.mesh);
      paint();
    });
  } else {
    paint();
  }
}

el('prevMesh').onclick = () => selectMesh(state.meshIndex - 1);
el('nextMesh').onclick = () => selectMesh(state.meshIndex + 1);
el('modeBest').onclick = () => { state.mode = 'best'; paint(); };
el('modeBfs').onclick = () => { state.mode = 'bfs'; paint(); };
el('nextNet').onclick = () => {
  if (state.mode !== 'best' || !state.analysis) return;
  state.topPos = (state.topPos + 1) % state.analysis.top.length;
  paint();
};

resize();
selectMesh(0);