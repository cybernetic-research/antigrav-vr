import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural anti-grav craft for three fictional teams, each with its own
// silhouette, liveries and handling. Units are metres; -Z is forward, the
// origin sits on the hull's belly (the hover height is applied by the owner).
// All hulls keep the cockpit opening between z = -0.9 and 0.9 with the hull
// top below ~0.7 m so the shared cockpit interior fits every ship.

export const TEAMS = [
	{
		id: 'halden',
		name: 'Halden Aero',
		ship: 'Meridian',
		blurb: 'Balanced all-rounder',
		hull: 'meridian',
		stats: { speed: 1.0, accel: 1.0, turn: 1.0, grip: 1.0 },
		liveries: [
			{ base: 0xeef1f4, trim: 0x12b5b0, accent: 0xff8a1f, glow: 0xffb060 },
			{ base: 0x12b5b0, trim: 0xeef1f4, accent: 0xff8a1f, glow: 0xffb060 },
			{ base: 0x2a2f38, trim: 0x12b5b0, accent: 0xeef1f4, glow: 0x6ff5e8 }
		]
	},
	{
		id: 'corvid',
		name: 'Corvid Motorworks',
		ship: 'Kite',
		blurb: 'Light and nimble, lower top speed',
		hull: 'kite',
		stats: { speed: 0.97, accel: 1.08, turn: 1.12, grip: 1.12 },
		liveries: [
			{ base: 0x16181c, trim: 0xb6ff1f, accent: 0xf2f2f2, glow: 0xd0ff60 },
			{ base: 0xb6ff1f, trim: 0x16181c, accent: 0x16181c, glow: 0xd0ff60 },
			{ base: 0x6b3fd6, trim: 0xb6ff1f, accent: 0x16181c, glow: 0xc8a0ff }
		]
	},
	{
		id: 'mamut',
		name: 'Mamut Heavy Industries',
		ship: 'Bastion',
		blurb: 'Heavy and fast, slow to turn',
		hull: 'bastion',
		stats: { speed: 1.04, accel: 0.92, turn: 0.88, grip: 0.92 },
		liveries: [
			{ base: 0x8e1b1b, trim: 0xb8bec8, accent: 0x1c1d20, glow: 0xff6a3a },
			{ base: 0xb8bec8, trim: 0x8e1b1b, accent: 0x1c1d20, glow: 0xff6a3a },
			{ base: 0xd88a12, trim: 0x2a2a2a, accent: 0xf2f2f2, glow: 0xffc060 }
		]
	}
];

// Combine a speed class with a team's handling multipliers
export function shipClass(cls, team) {
	const t = team.stats;
	return { name: cls.name, maxSpeed: cls.maxSpeed * t.speed, accel: cls.accel * t.accel, turn: cls.turn * t.turn, grip: cls.grip * t.grip };
}

// Loft a hull through cross-section rings. Each ring: [z, halfWidth, height, yBase].
// Rings are resampled with a smooth curve and the profile is subdivided, so the
// hull reads as a smooth body rather than a few facets. UVs: u around the
// profile (0..1), v along the length (0 = nose).
function loft(rings, { capFront = true, capBack = true, shape = HEX, samples = 28, profileSub = 3 } = {}) {
	// resample ring parameters along z with Catmull-Rom
	const curve = (k) => new THREE.CatmullRomCurve3(rings.map((r) => new THREE.Vector3(r[0], r[k], 0)), false, 'centripetal');
	const cw = curve(1), ch = curve(2), cy = curve(3);
	const rs = [];
	for (let i = 0; i <= samples; i++) {
		const t = i / samples;
		rs.push([cw.getPoint(t).x, Math.max(0.001, cw.getPoint(t).y), Math.max(0.001, ch.getPoint(t).y), cy.getPoint(t).y]);
	}
	// subdivide the closed profile with a smooth closed curve
	const prof = new THREE.CatmullRomCurve3(shape.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'catmullrom', 0.3);
	const m = shape.length * profileSub;
	const pts = [];
	for (let k = 0; k < m; k++) {
		const p = prof.getPoint(k / m);
		pts.push([p.x, p.y]);
	}
	const z0 = rs[0][0];
	const z1 = rs[rs.length - 1][0];
	const pos = [];
	const uv = [];
	const idx = [];
	const cols = m + 1; // seam column duplicated for continuous UVs
	for (const [z, hw, h, y0] of rs) {
		for (let k = 0; k <= m; k++) {
			const [sx, sy] = pts[k % m];
			pos.push(sx * hw, y0 + sy * h, z);
			uv.push(k / m, (z - z0) / (z1 - z0));
		}
	}
	for (let r = 0; r < rs.length - 1; r++) {
		for (let k = 0; k < m; k++) {
			const a = r * cols + k;
			const b = a + 1;
			const c = a + cols;
			const d = b + cols;
			idx.push(a, c, b, b, c, d);
		}
	}
	const addCap = (r, flip) => {
		const centre = pos.length / 3;
		const [z, , h, y0] = rs[r];
		pos.push(0, y0 + h * 0.45, z);
		uv.push(0.5, r === 0 ? 0 : 1);
		for (let k = 0; k < m; k++) {
			const a = r * cols + k;
			flip ? idx.push(centre, a + 1, a) : idx.push(centre, a, a + 1);
		}
	};
	if (capFront) addCap(0, false);
	if (capBack) addCap(rs.length - 1, true);
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setIndex(idx);
	g.computeVertexNormals();
	return g;
}

const HEX = [[-1.0, 0.0], [-1.0, 0.45], [-0.55, 0.95], [0.0, 1.0], [0.55, 0.95], [1.0, 0.45], [1.0, 0.0], [0.4, -0.12], [-0.4, -0.12]];
// Low, wide wedge section for the heavy hull
const WEDGE = [[-1.0, 0.0], [-1.0, 0.3], [-0.7, 0.8], [0.0, 1.0], [0.7, 0.8], [1.0, 0.3], [1.0, 0.0], [0.6, -0.1], [-0.6, -0.1]];
// Round-ish section for booms and nacelles
const ROUND = [[-1, 0], [-0.7, 0.7], [0, 1], [0.7, 0.7], [1, 0], [0.7, -0.7], [0, -1], [-0.7, -0.7]];

function glowTexture(color) {
	const c = document.createElement('canvas');
	c.width = c.height = 64;
	const ctx = c.getContext('2d');
	const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
	const col = new THREE.Color(color);
	g.addColorStop(0, 'rgba(255,255,255,1)');
	g.addColorStop(0.25, `rgba(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0},0.9)`);
	g.addColorStop(1, 'rgba(0,0,0,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 64, 64);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

function box(w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
	const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
	m.position.set(x, y, z);
	m.rotation.set(rx, ry, rz);
	return m;
}

function plate(shapePts, depth, mat) {
	const s = new THREE.Shape();
	s.moveTo(shapePts[0][0], shapePts[0][1]);
	for (const [x, y] of shapePts.slice(1)) s.lineTo(x, y);
	s.closePath();
	const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
	g.translate(0, 0, -depth / 2);
	return new THREE.Mesh(g, mat);
}

// Lower the hull top over the seat (cockpit version) so the tub is open
function openCockpit(rings, cockpit, top = 0.36) {
	return cockpit ? rings.map(([z, hw, h, y0]) => [z, hw, z > -1 && z < 1 ? top : h, y0]) : rings;
}

// --- Halden "Meridian": central fuselage, swept delta wings ending in short
// wingtip nacelles, one central tail fin and small nose canards.
function meridian(ship, m, cockpit) {
	const rings = [
		[-3.6, 0.05, 0.08, 0.3], [-3.0, 0.34, 0.28, 0.18], [-2.1, 0.6, 0.46, 0.1], [-1.0, 0.78, 0.6, 0.06],
		[0.0, 0.82, 0.62, 0.05], [1.0, 0.82, 0.64, 0.05], [2.0, 0.7, 0.56, 0.08], [2.9, 0.5, 0.42, 0.12]
	];
	ship.add(new THREE.Mesh(loft(openCockpit(rings, cockpit)), m.body));
	ship.add(box(0.12, 0.02, 2.2, m.trim, 0, 0.7, -2.0, -0.1));
	for (const side of [-1, 1]) {
		// delta wing as a thin extruded plate in the XZ plane
		const wing = plate([[0, -0.6], [2.1, 1.6], [2.1, 2.5], [0, 2.4]], 0.09, m.trim);
		wing.rotation.x = Math.PI / 2;
		wing.scale.x = side;
		wing.position.set(side * 0.6, 0.3, 0);
		ship.add(wing);
		const nac = new THREE.Mesh(loft([[0.4, 0.05, 0.05, 0.3], [0.9, 0.32, 0.32, 0.0], [2.6, 0.32, 0.32, 0.0], [3.0, 0.26, 0.26, 0.02]], { shape: ROUND }), m.body);
		nac.position.set(side * 2.55, 0.3, 0);
		ship.add(nac);
		ship.add(box(0.66, 0.08, 0.4, m.accent, side * 2.55, 0.62, 1.2));
		const canard = plate([[0, 0], [0.7, 0.35], [0.7, 0.6], [0, 0.6]], 0.05, m.accent);
		canard.rotation.x = Math.PI / 2;
		canard.scale.x = side;
		canard.position.set(side * 0.45, 0.32, -2.4);
		ship.add(canard);
	}
	const fin = plate([[-0.9, 0], [0.6, 0], [0.75, 1.15], [0.25, 1.2]], 0.07, m.body);
	fin.rotation.y = -Math.PI / 2;
	fin.position.set(0, 0.6, 2.3);
	ship.add(fin);
	ship.add(box(0.08, 0.1, 0.6, m.accent, 0, 1.78, 2.7));
	return { glows: [[-2.55, 0.3, 3.05, 0.9], [2.55, 0.3, 3.05, 0.9], [0, 0.4, 3.0, 1.2]], canopy: [0, 0.62, -0.1], span: 2.7, navZ: 2.2 };
}

// --- Corvid "Kite": slim needle fuselage, twin tail booms joined by a high rear
// wing, forward canard wing and fins on the boom ends.
function kite(ship, m, cockpit) {
	const rings = [
		[-3.9, 0.04, 0.06, 0.34], [-3.2, 0.26, 0.24, 0.2], [-2.0, 0.5, 0.42, 0.1], [-1.0, 0.68, 0.58, 0.06],
		[0.0, 0.72, 0.62, 0.05], [1.0, 0.7, 0.62, 0.05], [2.2, 0.55, 0.5, 0.1], [3.2, 0.36, 0.36, 0.16]
	];
	ship.add(new THREE.Mesh(loft(openCockpit(rings, cockpit)), m.body));
	ship.add(box(0.5, 0.02, 0.06, m.trim, 0, 0.66, -1.4));
	ship.add(box(0.36, 0.02, 0.06, m.trim, 0, 0.6, -1.9));
	ship.add(box(0.22, 0.02, 0.06, m.trim, 0, 0.52, -2.4));
	// forward wing
	ship.add(box(3.4, 0.07, 0.7, m.trim, 0, 0.26, -1.6, 0, 0, 0));
	for (const side of [-1, 1]) {
		const boom = new THREE.Mesh(loft([[-1.7, 0.03, 0.03, 0.26], [-1.2, 0.2, 0.2, 0.2], [2.6, 0.2, 0.2, 0.2], [3.3, 0.14, 0.14, 0.22]], { shape: ROUND }), m.body);
		boom.position.x = side * 1.7;
		ship.add(boom);
		ship.add(box(0.06, 0.06, 1.2, m.accent, side * 1.7, 0.42, 0.6));
		const fin = plate([[-0.5, 0], [0.4, 0], [0.55, 0.95], [0.2, 0.95]], 0.05, m.trim);
		fin.rotation.y = -Math.PI / 2;
		fin.position.set(side * 1.7, 0.36, 2.8);
		ship.add(fin);
	}
	// high rear wing between the boom fins
	ship.add(box(3.5, 0.06, 0.5, m.trim, 0, 1.28, 3.05));
	return { glows: [[0, 0.34, 3.35, 1.3], [-1.7, 0.2, 3.4, 0.55], [1.7, 0.2, 3.4, 0.55]], canopy: [0, 0.62, -0.2], span: 1.72, navZ: -1.6 };
}

// --- Mamut "Bastion": wide, low wedge with two big integrated engine blocks,
// side skirts and short fins canted outwards.
function bastion(ship, m, cockpit) {
	const rings = [
		[-3.3, 0.5, 0.12, 0.22], [-2.6, 0.9, 0.34, 0.12], [-1.6, 1.15, 0.52, 0.06], [-0.6, 1.3, 0.6, 0.04],
		[0.6, 1.45, 0.62, 0.04], [1.8, 1.55, 0.62, 0.05], [2.8, 1.55, 0.58, 0.06], [3.2, 1.45, 0.5, 0.08]
	];
	ship.add(new THREE.Mesh(loft(openCockpit(rings, cockpit, 0.4), { shape: WEDGE }), m.body));
	ship.add(box(2.4, 0.03, 0.18, m.trim, 0, 0.42, -2.3, -0.2));
	for (const side of [-1, 1]) {
		ship.add(box(0.9, 0.7, 2.4, m.trim, side * 1.15, 0.38, 2.1));
		ship.add(box(0.7, 0.5, 0.06, m.accent, side * 1.15, 0.38, 3.33));
		ship.add(box(0.12, 0.25, 4.6, m.accent, side * 1.62, 0.12, 0.4));
		const fin = plate([[-0.4, 0], [0.5, 0], [0.55, 0.6], [0.1, 0.6]], 0.08, m.body);
		fin.rotation.set(0, -Math.PI / 2, side * -0.5);
		fin.position.set(side * 1.3, 0.72, 2.6);
		ship.add(fin);
	}
	return { glows: [[-1.15, 0.38, 3.45, 1.4], [1.15, 0.38, 3.45, 1.4]], canopy: [0, 0.62, -0.2], span: 1.68, navZ: 0.0 };
}

const HULLS = { meridian, kite, bastion };

const NAV_RED = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const NAV_GREEN = new THREE.MeshBasicMaterial({ color: 0x2aff6a });

// Painted livery: base colour, panel lines, a trim stripe over the top and the
// race number on both flanks. Mapped with the loft UVs (u around, v along).
const liveryCache = new Map();
function liveryTexture(livery, number) {
	const key = `${livery.base}-${livery.trim}-${livery.accent}-${number}`;
	if (liveryCache.has(key)) return liveryCache.get(key);
	const c = document.createElement('canvas');
	c.width = 512;
	c.height = 512;
	const ctx = c.getContext('2d');
	const hex = (v) => '#' + v.toString(16).padStart(6, '0');
	ctx.fillStyle = hex(livery.base);
	ctx.fillRect(0, 0, 512, 512);
	// subtle paint variation
	const g = ctx.createLinearGradient(0, 0, 0, 512);
	g.addColorStop(0, 'rgba(255,255,255,0.06)');
	g.addColorStop(1, 'rgba(0,0,0,0.12)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 512, 512);
	// trim stripe over the top (profile top sits around u = 0.33)
	ctx.fillStyle = hex(livery.trim);
	ctx.fillRect(150, 0, 40, 512);
	ctx.fillStyle = hex(livery.accent);
	ctx.fillRect(142, 0, 6, 512);
	ctx.fillRect(192, 0, 6, 512);
	// panel lines
	ctx.strokeStyle = 'rgba(0,0,0,0.35)';
	ctx.lineWidth = 2;
	for (const v of [70, 150, 260, 330, 420]) {
		ctx.beginPath();
		ctx.moveTo(0, v);
		ctx.lineTo(512, v);
		ctx.stroke();
	}
	for (const u of [60, 120, 230, 290, 400, 460]) {
		ctx.beginPath();
		ctx.moveTo(u, 0);
		ctx.lineTo(u, 512);
		ctx.stroke();
	}
	// small hatch / vent details
	ctx.fillStyle = 'rgba(0,0,0,0.3)';
	for (const [x, y] of [[70, 280], [400, 280], [250, 90], [250, 440]]) {
		for (let i = 0; i < 5; i++) ctx.fillRect(x + i * 8, y, 4, 26);
	}
	// race number on the flanks (u ~ 0.08 and ~ 0.6)
	if (number) {
		ctx.save();
		ctx.font = 'italic bold 64px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		for (const u of [40, 310]) {
			ctx.save();
			ctx.translate(u, 300);
			ctx.rotate(Math.PI / 2);
			ctx.fillStyle = hex(livery.trim);
			ctx.fillText(String(number), 0, 0);
			ctx.restore();
		}
		ctx.restore();
	}
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 4;
	liveryCache.set(key, t);
	return t;
}

// Build a ship. With {cockpit: true} the canopy bubble is omitted (the
// interior adds its own frame and glass) and the hull stays open over the seat.
export function buildShip(team = TEAMS[0], liveryIndex = 0, { cockpit = false, number = 0 } = {}) {
	// Add-on teams bring their own models (must set userData.glows, may be empty)
	if (team.buildModel) return team.buildModel(liveryIndex, { cockpit, number });
	const livery = team.liveries[liveryIndex % team.liveries.length];
	const ship = new THREE.Group();
	// double sided: mirrored (negatively scaled) plates flip their winding
	const paint = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.32, side: THREE.DoubleSide, ...opts });
	const m = {
		body: paint(0xffffff, { map: liveryTexture(livery, number) }),
		trim: paint(livery.trim),
		accent: paint(livery.accent, { metalness: 0.5, roughness: 0.4 }),
		metal: new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.85, roughness: 0.35 }),
		dark: new THREE.MeshStandardMaterial({ color: 0x0c0d10, metalness: 0.4, roughness: 0.6, side: THREE.DoubleSide })
	};
	const info = HULLS[team.hull](ship, m, cockpit);

	// Engine nozzles (dark rings) and glows
	const glowMat = new THREE.SpriteMaterial({ map: glowTexture(livery.glow), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
	const glows = [];
	for (const [x, y, z, s] of info.glows) {
		const r = s * 0.32;
		const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, 0.35, 16, 1, true), m.metal);
		nozzle.rotation.x = Math.PI / 2;
		nozzle.position.set(x, y, z - 0.1);
		ship.add(nozzle);
		const g = new THREE.Sprite(glowMat);
		g.position.set(x, y, z + 0.1);
		g.scale.setScalar(s);
		g.userData.baseScale = s;
		ship.add(g);
		glows.push(g);
	}
	ship.userData.glows = glows;

	// Navigation lights on the widest points, an antenna and belly emitters
	const navY = 0.45;
	const navX = info.span || 1.8;
	for (const [x, mat] of [[-navX, NAV_RED], [navX, NAV_GREEN]]) {
		const l = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat);
		l.position.set(x, navY, info.navZ ?? 0.6);
		ship.add(l);
	}
	ship.add(box(0.02, 0.35, 0.02, m.metal, 0.25, 0.85, 1.4, -0.4));
	const belly = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 4.2), new THREE.MeshBasicMaterial({ color: livery.glow, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
	belly.rotation.x = Math.PI / 2;
	belly.position.set(0, -0.01, -0.3);
	ship.add(belly);

	if (!cockpit) {
		const canopy = new THREE.Mesh(
			new THREE.SphereGeometry(0.55, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
			new THREE.MeshStandardMaterial({ color: 0x0a1018, metalness: 0.9, roughness: 0.08, emissive: 0x05121c })
		);
		canopy.scale.set(1, 0.7, 2.0);
		canopy.position.set(...info.canopy);
		ship.add(canopy);
		const rim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 6, 24), m.metal);
		rim.rotation.x = Math.PI / 2;
		rim.scale.set(1, 2.0, 1);
		rim.position.set(...info.canopy);
		ship.add(rim);
	}

	return mergeStatic(ship);
}

// Merge every plain opaque Mesh directly under `group` into one mesh per
// material (keeps draw calls low on standalone headsets). Sprites, groups and
// anything flagged userData.keep are left alone.
export function mergeStatic(group) {
	const byMat = new Map();
	for (const child of [...group.children]) {
		if (!child.isMesh || child.userData.keep || child.material.transparent || Array.isArray(child.material)) continue;
		child.updateMatrix();
		let g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
		for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
		if (!g.attributes.normal) g.computeVertexNormals();
		if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
		g.applyMatrix4(child.matrix);
		if (!byMat.has(child.material)) byMat.set(child.material, []);
		byMat.get(child.material).push(g);
		group.remove(child);
		child.geometry.dispose();
	}
	for (const [mat, geos] of byMat) {
		const merged = mergeGeometries(geos, false);
		for (const g of geos) g.dispose();
		group.add(new THREE.Mesh(merged, mat));
	}
	return group;
}

export const EYE_IN_SHIP = new THREE.Vector3(0, 1.08, 0.15);

export function buildCockpit(livery = TEAMS[0].liveries[0]) {
	const g = new THREE.Group();
	const panel = new THREE.MeshStandardMaterial({ color: 0x1c1f25, metalness: 0.3, roughness: 0.75 });
	const panelDark = new THREE.MeshStandardMaterial({ color: 0x0d0e11, metalness: 0.2, roughness: 0.9 });
	const frameMat = new THREE.MeshStandardMaterial({ color: 0x2c3038, metalness: 0.8, roughness: 0.35 });
	const trimMat = new THREE.MeshBasicMaterial({ color: livery.trim });
	const glowMat = new THREE.MeshBasicMaterial({ color: livery.glow });
	const lightRed = new THREE.MeshBasicMaterial({ color: 0xff4040 });
	const lightAmber = new THREE.MeshBasicMaterial({ color: 0xffc040 });
	const lightGreen = new THREE.MeshBasicMaterial({ color: 0x40ff80 });

	// Eye is at the origin; hull rim height in ship space is ~0.7, i.e. y = -0.38 here.
	const rimY = -0.36;

	// Dashboard cowl: a slanted box in front of the pilot
	const dash = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.42), panel);
	dash.position.set(0, rimY - 0.04, -0.74);
	dash.rotation.x = 0.28;
	g.add(dash);
	const dashLip = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.012, 0.012), glowMat);
	dashLip.position.set(0, rimY - 0.06, -0.5);
	g.add(dashLip);

	// HUD screen mount, sits on top of the cowl and faces the pilot
	// Three screens kept out of the main line of sight: one low on each side
	// console angled towards the pilot, and a map/radar screen low on the dash.
	const mount = (x, y, z, yaw, pitch) => {
		const m = new THREE.Group();
		m.position.set(x, y, z);
		m.rotation.set(pitch, yaw, 0, 'YXZ');
		g.add(m);
		return m;
	};
	const hudMounts = {
		left: mount(-0.46, rimY + 0.02, -0.36, 0.7, -0.5),
		right: mount(0.46, rimY + 0.02, -0.36, -0.7, -0.5),
		center: mount(0, rimY + 0.04, -0.47, 0, -0.95)
	};
	// bezels behind the screens
	for (const [k, w, h] of [['left', 0.27, 0.15], ['right', 0.27, 0.15], ['center', 0.33, 0.17]]) {
		const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), panelDark);
		b.position.z = -0.012;
		b.userData.keep = true;
		hudMounts[k].add(b);
	}

	// Side consoles / tub walls
	for (const side of [-1, 1]) {
		const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 1.7), panel);
		wall.position.set(side * 0.62, rimY - 0.16, -0.05);
		g.add(wall);
		const sill = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 1.7), frameMat);
		sill.position.set(side * 0.62, rimY + 0.04, -0.05);
		g.add(sill);
		const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 1.4), trimMat);
		stripe.position.set(side * 0.565, rimY - 0.02, -0.05);
		g.add(stripe);
		// little indicator lights on the side console
		for (let i = 0; i < 4; i++) {
			const l = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.025, 0.05), i === 0 ? lightRed : i === 3 ? lightGreen : lightAmber);
			l.position.set(side * 0.565, rimY - 0.1, -0.5 + i * 0.09);
			g.add(l);
		}
	}

	// Seat back and headrest behind the pilot
	const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.12), panelDark);
	seat.position.set(0, -0.45, 0.32);
	seat.rotation.x = -0.15;
	g.add(seat);
	const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.12), panelDark);
	head.position.set(0, 0.08, 0.36);
	g.add(head);

	// Floor of the tub
	const floor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 1.8), panelDark);
	floor.position.set(0, rimY - 0.3, -0.1);
	g.add(floor);

	// Canopy frame: arch over the pilot plus two front pillars
	const frameRadius = 0.02;
	const pillarL = tube([new THREE.Vector3(-0.6, rimY + 0.05, -1.0), new THREE.Vector3(-0.5, 0.1, -0.55), new THREE.Vector3(-0.2, 0.32, 0.0)], frameRadius, frameMat);
	const pillarR = tube([new THREE.Vector3(0.6, rimY + 0.05, -1.0), new THREE.Vector3(0.5, 0.1, -0.55), new THREE.Vector3(0.2, 0.32, 0.0)], frameRadius, frameMat);
	const arch = tube(
		[new THREE.Vector3(-0.62, rimY + 0.05, 0.3), new THREE.Vector3(-0.42, 0.2, 0.25), new THREE.Vector3(0, 0.33, 0.22), new THREE.Vector3(0.42, 0.2, 0.25), new THREE.Vector3(0.62, rimY + 0.05, 0.3)],
		frameRadius * 1.3,
		frameMat
	);
	const spine = tube([new THREE.Vector3(-0.2, 0.32, 0.0), new THREE.Vector3(0, 0.34, 0.2), new THREE.Vector3(0.2, 0.32, 0.0)], frameRadius, frameMat);
	g.add(pillarL, pillarR, arch, spine);

	// Canopy glass: a stretched half-ellipsoid, faint tint so it reads as glass
	const glass = new THREE.Mesh(
		new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
		new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
	);
	glass.scale.set(0.64, 0.7, 1.25);
	glass.position.set(0, rimY + 0.04, -0.3);
	glass.renderOrder = 5;
	g.add(glass);

	// Steering yoke that turns with the input (purely visual)
	const yoke = new THREE.Group();
	yoke.position.set(0, rimY - 0.24, -0.4);
	yoke.rotation.x = -0.9;
	const yokeBar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.035), panelDark);
	yoke.add(yokeBar);
	for (const side of [-1, 1]) {
		const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), frameMat);
		grip.position.set(side * 0.17, 0.05, 0);
		yoke.add(grip);
	}
	const column = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), panelDark);
	column.rotation.x = Math.PI / 2;
	column.position.z = 0.0;
	column.position.y = -0.1;
	yoke.add(column);
	g.add(yoke);

	mergeStatic(g);
	return { group: g, yoke, hudMounts };
}

function tube(points, radius, material) {
	const curve = new THREE.CatmullRomCurve3(points);
	return new THREE.Mesh(new THREE.TubeGeometry(curve, 16, radius, 6, false), material);
}
