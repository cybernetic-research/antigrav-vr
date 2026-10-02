import * as THREE from 'three';
import { TrackPath, newFrame } from './track.js';
import * as T from './textures.js';
import { mergeStatic } from './shipModel.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WALL_H = 1.8;
const DECK = 1.4; // thickness of the track deck below the road

// Build a playable track (path + scene graph) from a built-in definition.
export function buildBuiltinTrack(def) {
	const points = def.points.map(([x, z, y]) => new THREE.Vector3(x, y, z));
	const path = new TrackPath({ points, halfWidths: def.halfWidth, autoBank: def.bank });
	const theme = def.theme;
	const group = new THREE.Group();
	group.name = def.name;

	group.add(buildRoad(path, theme));
	group.add(buildWalls(path, theme));
	group.add(buildDeck(path));
	const pylons = buildPylons(path);
	if (pylons) group.add(pylons);
	const boosts = boostDefs(path, def.boosts || []);
	group.add(buildPads(path, boosts, path.boosts, T.boostTexture()));
	group.add(buildPads(path, weaponDefs(path, boosts), path.weaponPads, T.weaponPadTexture()));
	group.add(buildGantry(path, theme));

	const env = buildEnvironment(path, theme);
	group.add(env.world);

	return {
		name: def.name,
		path,
		group,
		sky: env.sky,
		fog: new THREE.FogExp2(theme.fog, theme.fogDensity),
		background: new THREE.Color(theme.fog)
	};
}

// --- Road surface ------------------------------------------------------------

function forEachSample(path, step, fn) {
	const n = Math.ceil(path.length / step);
	const f = newFrame();
	for (let i = 0; i <= n; i++) {
		const s = (i / n) * path.length;
		path.frameAt(s, f);
		fn(i, s, f, n);
	}
	return n;
}

function stripGeometry(path, step, columns) {
	// columns: [(frame, s) => {p: Vector3, u: number}] across the strip
	const pos = [];
	const uv = [];
	const idx = [];
	const c = columns.length;
	const tmp = new THREE.Vector3();
	const n = forEachSample(path, step, (i, s, f) => {
		for (let k = 0; k < c; k++) {
			const col = columns[k](f, s, tmp);
			pos.push(col.p.x, col.p.y, col.p.z);
			uv.push(col.u, col.v);
		}
	});
	for (let i = 0; i < n; i++) {
		for (let k = 0; k < c - 1; k++) {
			const a = i * c + k;
			const b = a + c;
			idx.push(a, b, a + 1, a + 1, b, b + 1);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setIndex(idx);
	g.computeVertexNormals();
	return g;
}

function buildRoad(path, theme) {
	const texLen = 24;
	const geo = stripGeometry(path, 2, [
		(f, s) => ({ p: f.pos.clone().addScaledVector(f.right, -f.hw), u: 0, v: s / texLen }),
		(f, s) => ({ p: f.pos.clone(), u: 0.5, v: s / texLen }),
		(f, s) => ({ p: f.pos.clone().addScaledVector(f.right, f.hw), u: 1, v: s / texLen })
	]);
	const mat = new THREE.MeshLambertMaterial({ map: T.roadTexture(theme.accent), side: THREE.DoubleSide });
	const mesh = new THREE.Mesh(geo, mat);
	mesh.name = 'road';
	return mesh;
}

function buildWalls(path, theme) {
	const group = new THREE.Group();
	const wallMat = new THREE.MeshLambertMaterial({ map: T.wallTexture(theme.stripe), side: THREE.DoubleSide });
	const railMat = new THREE.MeshBasicMaterial({ color: theme.rail, side: THREE.DoubleSide });
	const texLen = WALL_H * 4;
	for (const side of [-1, 1]) {
		const wall = stripGeometry(path, 2, [
			(f, s) => ({ p: f.pos.clone().addScaledVector(f.right, side * f.hw), u: s / texLen, v: 0 }),
			(f, s) => ({
				p: f.pos.clone().addScaledVector(f.right, side * (f.hw + 0.35)).addScaledVector(f.up, WALL_H),
				u: s / texLen,
				v: 1
			})
		]);
		group.add(new THREE.Mesh(wall, wallMat));
		const rail = stripGeometry(path, 2, [
			(f) => ({ p: f.pos.clone().addScaledVector(f.right, side * (f.hw + 0.35)).addScaledVector(f.up, WALL_H), u: 0, v: 0 }),
			(f) => ({ p: f.pos.clone().addScaledVector(f.right, side * (f.hw + 0.75)).addScaledVector(f.up, WALL_H), u: 1, v: 0 })
		]);
		group.add(new THREE.Mesh(rail, railMat));
	}
	return group;
}

function buildDeck(path) {
	const mat = new THREE.MeshLambertMaterial({ color: 0x15171c, side: THREE.DoubleSide });
	const edge = (side) => (f) => ({ p: f.pos.clone().addScaledVector(f.right, side * (f.hw + 0.75)).addScaledVector(f.up, WALL_H), u: 0, v: 0 });
	const below = (side) => (f) => ({ p: f.pos.clone().addScaledVector(f.right, side * (f.hw + 0.75)).addScaledVector(f.up, -DECK), u: 0, v: 0 });
	const geo = stripGeometry(path, 4, [edge(-1), below(-1), below(1), edge(1)]);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.name = 'deck';
	return mesh;
}

function buildPylons(path) {
	const ground = groundLevel(path);
	const spots = [];
	const f = newFrame();
	const spacing = 48;
	const n = Math.floor(path.length / spacing);
	for (let i = 0; i < n; i++) {
		const s = i * spacing;
		path.frameAt(s, f);
		const height = f.pos.y - DECK - ground;
		if (height < 3) continue;
		if (passesOverTrack(path, s, f.pos, f.hw + 8)) continue;
		spots.push({ p: f.pos.clone(), h: height });
	}
	if (!spots.length) return null;
	const geo = new THREE.CylinderGeometry(1.4, 2.2, 1, 8);
	geo.translate(0, 0.5, 0);
	const mat = new THREE.MeshLambertMaterial({ color: 0x22262e });
	const inst = new THREE.InstancedMesh(geo, mat, spots.length);
	const m = new THREE.Matrix4();
	spots.forEach((sp, i) => {
		m.makeScale(1, sp.h, 1).setPosition(sp.p.x, ground, sp.p.z);
		inst.setMatrixAt(i, m);
	});
	return inst;
}

function passesOverTrack(path, s, p, radius) {
	const P = path.pos;
	for (let j = 0; j < path.count; j += 3) {
		const sj = j * path.step;
		let ds = Math.abs(sj - s);
		ds = Math.min(ds, path.length - ds);
		if (ds < 60) continue;
		if (P[j * 3 + 1] > p.y) continue;
		if (Math.hypot(P[j * 3] - p.x, P[j * 3 + 2] - p.z) < radius) return true;
	}
	return false;
}

function groundLevel(path) {
	let min = Infinity;
	for (let i = 1; i < path.pos.length; i += 3) min = Math.min(min, path.pos[i]);
	return min - 6;
}

// --- Boost and weapon pads ----------------------------------------------------------

// defs: [{s, x, len, w}] in metres. Registers zones on the path and builds one
// merged mesh lying on the road.
function buildPads(path, defs, zones, texture) {
	const group = new THREE.Group();
	const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
	const f = newFrame();
	const geos = [];
	for (const d of defs) {
		const s0 = path.wrap(d.s);
		const len = d.len || 8;
		const w = d.w || 4;
		zones.push({ s0, s1: s0 + len, x0: d.x - w / 2, x1: d.x + w / 2 });
		const pos = [];
		const uv = [];
		const steps = 4;
		for (let i = 0; i <= steps; i++) {
			const s = s0 + (i / steps) * len;
			path.frameAt(s, f);
			for (const [k, x] of [[0, d.x - w / 2], [1, d.x + w / 2]]) {
				const p = f.pos.clone().addScaledVector(f.right, x).addScaledVector(f.up, 0.04);
				pos.push(p.x, p.y, p.z);
				uv.push(k, 1 - i / steps);
			}
		}
		const idx = [];
		for (let i = 0; i < steps; i++) {
			const a = i * 2;
			idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
		g.setIndex(idx);
		geos.push(g);
	}
	if (geos.length) group.add(new THREE.Mesh(mergeGeometries(geos, false), mat));
	return group;
}

// Hand-placed boosts plus extra ones on every long straight, so the fast
// sections really are fast.
function boostDefs(path, defs) {
	const out = defs.map((d) => ({ s: d.at * path.length, x: d.x, len: d.len || 8 }));
	const near = (s) => out.some((d) => Math.abs(path.wrap(d.s - s + path.length / 2) - path.length / 2) < 70);
	let flip = 1;
	for (const st of path.straights()) {
		for (let s = st.s0 + 30; s < st.s1 - 40; s += 200) {
			if (near(s)) continue;
			const hw = path.halfWidthAt(s);
			out.push({ s, x: flip * hw * 0.35, len: 8 });
			flip = -flip;
		}
	}
	return out;
}

// Rows of weapon pads spread around the lap, kept clear of boost pads
function weaponDefs(path, boosts) {
	const out = [];
	for (const at of [0.12, 0.37, 0.62, 0.87]) {
		let s = at * path.length;
		for (let tries = 0; tries < 10 && boosts.some((b) => Math.abs(b.s - s) < 30); tries++) s += 25;
		const hw = path.halfWidthAt(s);
		for (const x of [-hw * 0.45, hw * 0.45]) out.push({ s, x, len: 5, w: 4 });
	}
	return out;
}

// --- Start / finish gantry -----------------------------------------------------

function buildGantry(path, theme) {
	const f = newFrame();
	path.frameAt(0, f);
	const g = new THREE.Group();
	const q = path.quaternionAt(f, new THREE.Quaternion());
	g.position.copy(f.pos);
	g.quaternion.copy(q);

	const pillarMat = new THREE.MeshBasicMaterial({ color: 0x3a404c });
	const span = f.hw + 1.5;
	for (const side of [-1, 1]) {
		const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 10, 1.2), pillarMat);
		p.position.set(side * span, 5, 0);
		g.add(p);
	}
	const checker = new THREE.MeshBasicMaterial({ map: T.checkerTexture() });
	const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1.2, 2.2, 1), [pillarMat, pillarMat, pillarMat, pillarMat, checker, checker]);
	beam.position.set(0, 9, 0);
	g.add(beam);
	const strip = new THREE.Mesh(new THREE.BoxGeometry(span * 2, 0.25, 1.05), new THREE.MeshBasicMaterial({ color: theme.rail }));
	strip.position.set(0, 7.8, 0);
	g.add(strip);

	// painted line across the road
	const line = new THREE.Mesh(new THREE.PlaneGeometry(f.hw * 2, 1.2), new THREE.MeshBasicMaterial({ map: T.checkerTexture(), polygonOffset: true, polygonOffsetFactor: -2 }));
	line.rotation.x = -Math.PI / 2;
	line.position.y = 0.03;
	g.add(line);

	// countdown lights, driven by the race (named so they can be found)
	const lights = new THREE.Group();
	lights.name = 'startLights';
	for (let i = 0; i < 3; i++) {
		const l = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16), new THREE.MeshBasicMaterial({ color: 0x220000 }));
		l.position.set((i - 1) * 1.6, 9, 0.52);
		lights.add(l);
	}
	g.add(lights);
	return mergeStatic(g);
}

// --- Environment ----------------------------------------------------------------

function buildEnvironment(path, theme) {
	const world = new THREE.Group();
	const ground = groundLevel(path);

	// Ground
	const size = 8000;
	let groundTex;
	if (theme.ground === 'terrain') {
		groundTex = T.terrainTexture();
		groundTex.repeat.set(size / 60, size / 60);
	} else {
		groundTex = T.gridTexture(theme.gridColor);
		groundTex.repeat.set(size / 40, size / 40);
	}
	const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: groundTex }));
	plane.rotation.x = -Math.PI / 2;
	plane.position.y = ground;
	world.add(plane);

	// Bounds of the track, for placing scenery
	const box = new THREE.Box3();
	for (let i = 0; i < path.count; i++) box.expandByPoint(new THREE.Vector3().fromArray(path.pos, i * 3));
	const center = box.getCenter(new THREE.Vector3());
	const radius = box.getSize(new THREE.Vector3()).length() / 2;

	if (theme.towers) world.add(buildTowers(path, theme.towers, center, radius, ground));
	if (theme.mesas) world.add(buildMesas(path, theme.mesas, center, radius, ground));
	world.add(buildMountains(center, radius, ground, theme));

	const sky = buildSky(theme);
	return { world, sky };
}

function farFromTrack(path, x, z, minDist) {
	const P = path.pos;
	for (let i = 0; i < path.count; i += 6) {
		if (Math.hypot(P[i * 3] - x, P[i * 3 + 2] - z) < minDist) return false;
	}
	return true;
}

function buildTowers(path, count, center, radius, ground) {
	const geo = new THREE.BoxGeometry(1, 1, 1);
	geo.translate(0, 0.5, 0);
	const tex = T.windowsTexture();
	const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff });
	const inst = new THREE.InstancedMesh(geo, mat, count);
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const color = new THREE.Color();
	let placed = 0;
	for (let tries = 0; placed < count && tries < count * 30; tries++) {
		const a = Math.random() * Math.PI * 2;
		const r = Math.sqrt(Math.random()) * (radius + 500);
		const x = center.x + Math.cos(a) * r;
		const z = center.z + Math.sin(a) * r;
		if (!farFromTrack(path, x, z, 45)) continue;
		const w = 18 + Math.random() * 30;
		const h = 30 + Math.random() * Math.random() * 220;
		q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
		m.compose(new THREE.Vector3(x, ground, z), q, new THREE.Vector3(w, h, w * (0.6 + Math.random() * 0.8)));
		inst.setMatrixAt(placed, m);
		inst.setColorAt(placed, color.setHSL(0.6 + Math.random() * 0.1, 0.2, 0.3 + Math.random() * 0.3));
		placed++;
	}
	inst.count = placed;
	return inst;
}

function buildMesas(path, count, center, radius, ground) {
	const geo = new THREE.CylinderGeometry(0.8, 1, 1, 7);
	geo.translate(0, 0.5, 0);
	const mat = new THREE.MeshBasicMaterial({ map: T.terrainTexture('#7a3b22', '#a65a32') });
	const inst = new THREE.InstancedMesh(geo, mat, count);
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	let placed = 0;
	for (let tries = 0; placed < count && tries < count * 40; tries++) {
		const a = Math.random() * Math.PI * 2;
		const r = Math.sqrt(Math.random()) * (radius + 600);
		const x = center.x + Math.cos(a) * r;
		const z = center.z + Math.sin(a) * r;
		const w = 30 + Math.random() * 70;
		if (!farFromTrack(path, x, z, w + 30)) continue;
		const h = 25 + Math.random() * 90;
		q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
		m.compose(new THREE.Vector3(x, ground, z), q, new THREE.Vector3(w, h, w));
		inst.setMatrixAt(placed++, m);
	}
	inst.count = placed;
	return inst;
}

function buildMountains(center, radius, ground, theme) {
	const g = new THREE.Group();
	const col = new THREE.Color(theme.fog).lerp(new THREE.Color(0x000000), 0.45);
	const mat = new THREE.MeshBasicMaterial({ color: col, fog: false });
	const n = 28;
	const geo = new THREE.ConeGeometry(1, 1, 5);
	geo.translate(0, 0.5, 0);
	const inst = new THREE.InstancedMesh(geo, mat, n);
	const m = new THREE.Matrix4();
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
		const r = radius + 2200 + Math.random() * 600;
		const w = 400 + Math.random() * 600;
		m.makeScale(w, 150 + Math.random() * 350, w).setPosition(center.x + Math.cos(a) * r, ground - 10, center.z + Math.sin(a) * r);
		inst.setMatrixAt(i, m);
	}
	g.add(inst);
	return g;
}

export function buildSky(theme) {
	const geo = new THREE.SphereGeometry(9000, 24, 12);
	const top = new THREE.Color(theme.skyTop);
	const bottom = new THREE.Color(theme.skyBottom);
	const colors = [];
	const p = geo.attributes.position;
	const c = new THREE.Color();
	for (let i = 0; i < p.count; i++) {
		const y = p.getY(i) / 9000;
		const t = Math.pow(THREE.MathUtils.clamp(y * 1.4 + 0.15, 0, 1), 0.7);
		c.copy(bottom).lerp(top, t);
		colors.push(c.r, c.g, c.b);
	}
	geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
	sky.renderOrder = -10;

	// stars
	const starGeo = new THREE.BufferGeometry();
	const sp = [];
	for (let i = 0; i < 1500; i++) {
		const v = new THREE.Vector3().randomDirection();
		if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
		v.normalize().multiplyScalar(8500);
		sp.push(v.x, v.y, v.z);
	}
	starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
	const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
	stars.renderOrder = -9;
	sky.add(stars);
	return sky;
}
