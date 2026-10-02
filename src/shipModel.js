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

// Loft a hull through cross-section rings. Each ring: [z, halfWidth, height, yBase]
// The section is a flat-bottomed hexagon with a ridge on top.
function loft(rings, { capFront = true, capBack = true, shape = HEX } = {}) {
	const m = shape.length;
	const pos = [];
	const idx = [];
	for (const [z, hw, h, y0] of rings) {
		for (const [sx, sy] of shape) pos.push(sx * hw, y0 + sy * h, z);
	}
	for (let r = 0; r < rings.length - 1; r++) {
		for (let k = 0; k < m; k++) {
			const a = r * m + k;
			const b = r * m + ((k + 1) % m);
			const c = a + m;
			const d = b + m;
			idx.push(a, c, b, b, c, d);
		}
	}
	const addCap = (r, flip) => {
		const centre = pos.length / 3;
		const [z, , h, y0] = rings[r];
		pos.push(0, y0 + h * 0.45, z);
		for (let k = 0; k < m; k++) {
			const a = r * m + k;
			const b = r * m + ((k + 1) % m);
			flip ? idx.push(centre, b, a) : idx.push(centre, a, b);
		}
	};
	if (capFront) addCap(0, false);
	if (capBack) addCap(rings.length - 1, true);
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setIndex(idx);
	const ng = g.toNonIndexed();
	ng.computeVertexNormals();
	return ng;
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
	return { glows: [[-2.55, 0.3, 3.05, 0.9], [2.55, 0.3, 3.05, 0.9], [0, 0.4, 3.0, 1.2]], canopy: [0, 0.62, -0.1] };
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
	return { glows: [[0, 0.34, 3.35, 1.3], [-1.7, 0.2, 3.4, 0.55], [1.7, 0.2, 3.4, 0.55]], canopy: [0, 0.62, -0.2] };
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
	return { glows: [[-1.15, 0.38, 3.45, 1.4], [1.15, 0.38, 3.45, 1.4]], canopy: [0, 0.62, -0.2] };
}

const HULLS = { meridian, kite, bastion };

// Build a ship. With {cockpit: true} the canopy bubble is omitted (the
// interior adds its own frame and glass) and the hull stays open over the seat.
export function buildShip(team = TEAMS[0], liveryIndex = 0, { cockpit = false } = {}) {
	const livery = team.liveries[liveryIndex % team.liveries.length];
	const ship = new THREE.Group();
	const m = {
		// double sided: mirrored (negatively scaled) plates flip their winding
		body: new THREE.MeshLambertMaterial({ color: livery.base, flatShading: true, side: THREE.DoubleSide }),
		trim: new THREE.MeshLambertMaterial({ color: livery.trim, flatShading: true, side: THREE.DoubleSide }),
		accent: new THREE.MeshLambertMaterial({ color: livery.accent, flatShading: true, side: THREE.DoubleSide })
	};
	const info = HULLS[team.hull](ship, m, cockpit);

	// Engine glows
	const glowMat = new THREE.SpriteMaterial({ map: glowTexture(livery.glow), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
	const glows = [];
	for (const [x, y, z, s] of info.glows) {
		const g = new THREE.Sprite(glowMat);
		g.position.set(x, y, z);
		g.scale.setScalar(s);
		g.userData.baseScale = s;
		ship.add(g);
		glows.push(g);
	}
	ship.userData.glows = glows;

	// Belly anti-grav strip
	const belly = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 4.2), new THREE.MeshBasicMaterial({ color: livery.glow, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
	belly.rotation.x = Math.PI / 2;
	belly.position.set(0, -0.01, -0.3);
	ship.add(belly);

	if (!cockpit) {
		const canopy = new THREE.Mesh(
			new THREE.SphereGeometry(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
			new THREE.MeshLambertMaterial({ color: 0x0b1420, emissive: 0x0a2840, flatShading: true })
		);
		canopy.scale.set(1, 0.7, 2.0);
		canopy.position.set(...info.canopy);
		ship.add(canopy);
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
		for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
		if (!g.attributes.normal) g.computeVertexNormals();
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

// --- Cockpit interior -------------------------------------------------------------
// Built relative to the pilot's eye point (origin). Returns {group, yoke, hudMount}.
export const EYE_IN_SHIP = new THREE.Vector3(0, 1.08, 0.15);

export function buildCockpit(livery = TEAMS[0].liveries[0]) {
	const g = new THREE.Group();
	const panel = new THREE.MeshLambertMaterial({ color: 0x2a2e37, flatShading: true });
	const panelDark = new THREE.MeshLambertMaterial({ color: 0x15171c, flatShading: true });
	const frameMat = new THREE.MeshLambertMaterial({ color: livery.base, flatShading: true });
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
	const hudMount = new THREE.Group();
	hudMount.position.set(0, rimY + 0.15, -0.66);
	hudMount.rotation.x = -0.35;
	g.add(hudMount);

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
	yoke.position.set(0, rimY - 0.12, -0.42);
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
	return { group: g, yoke, hudMount };
}

function tube(points, radius, material) {
	const curve = new THREE.CatmullRomCurve3(points);
	return new THREE.Mesh(new THREE.TubeGeometry(curve, 16, radius, 6, false), material);
}
