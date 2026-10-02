import * as THREE from 'three';
import { TrackPath, newFrame } from './track.js';

// Optional loader for track data from PlayStation discs the player owns
// (WipEout, 1995: WIPEOUT/ folder; WipEout 2097, 1996: WIPEOUT2/ folder). The
// folder is copied next to index.html; nothing from the discs is included here.
// File format knowledge comes from phoboslab's MIT-licensed PSX model viewer
// (https://github.com/phoboslab/wipeout); this is a port to modern three.js
// BufferGeometry plus a racing-line extraction from the .TRS sections.
//
// Tracks are listed by folder (e.g. "WIPEOUT2 · TRACK01"). Players can give
// them names locally with <folder>/names.json: {"TRACK01": "My name", ...}.

const DISC_TRACKS = {
	WIPEOUT: { tex: false, tracks: ['02', '03', '04', '05', '01', '06', '12', '07', '08', '11', '09', '13', '10', '14'] },
	WIPEOUT2: { tex: true, tracks: ['01', '08', '13', '20', '02', '17', '06', '07'] }
};

export const PSX_TRACKS = Object.entries(DISC_TRACKS).flatMap(([folder, g]) =>
	g.tracks.map((n) => ({ path: `${folder}/TRACK${n}`, folder, id: `TRACK${n}`, name: `${folder} \u00b7 TRACK${n}`, tex: g.tex }))
);

// Track half width in metres after scaling the PSX units
const TARGET_HALF_WIDTH = 12.5;

const FACE_FLAGS = { TRACK: 1, WEAPON: 2, FLIP: 4, WEAPON_2: 8, BOOST: 32 }; // WEAPON / WEAPON_2 = pickup pads (left / right)
const SECTION_FLAGS = { JUMP: 1 };

// Which PSX tracks are present? (HEAD request for each TRACK.TRS)
export async function findPsxTracks() {
	const exists = async (url) => {
		try {
			return (await fetch(url, { method: 'HEAD' })).ok;
		} catch {
			return false;
		}
	};
	// Probe one track per game first so a missing folder costs a single request
	const games = [];
	if (await exists('WIPEOUT/TRACK02/TRACK.TRS')) games.push('WIPEOUT/');
	if (await exists('WIPEOUT2/TRACK01/TRACK.TRS')) games.push('WIPEOUT2/');
	const candidates = PSX_TRACKS.filter((t) => games.some((g) => t.path.startsWith(g)));
	// optional local display names
	for (const g of games) {
		try {
			const r = await fetch(`${g}names.json`);
			if (!r.ok) continue;
			const names = await r.json();
			for (const t of candidates) if (t.path.startsWith(g) && names[t.id]) t.name = names[t.id];
		} catch {
			/* no names file */
		}
	}
	const found = await Promise.all(
		candidates.map(async (t) => {
			try {
				const r = await fetch(`${t.path}/TRACK.TRS`, { method: 'HEAD' });
				return r.ok ? t : null;
			} catch {
				return null;
			}
		})
	);
	return found.filter(Boolean);
}

async function fetchBin(url) {
	const r = await fetch(url);
	if (!r.ok) throw new Error(`Missing ${url}`);
	return r.arrayBuffer();
}

// read(path) -> Promise<ArrayBuffer>; defaults to fetching from the server.
// Add-ons pass a reader backed by a disc image the player picked.
// onProgress(fraction, detail) reports stages; the awaits let a loading screen animate
export async function loadPsxTrack(def, read = fetchBin, onProgress = () => {}) {
	const p = def.path;
	const breathe = () => new Promise((r) => setTimeout(r, 0));
	onProgress(0.05, 'Reading circuit data');
	const [sceneCmp, scenePrm, skyCmp, skyPrm, libCmp, libTtf, trv, trf, trs, tex] = await Promise.all([
		read(`${p}/SCENE.CMP`),
		read(`${p}/SCENE.PRM`),
		read(`${p}/SKY.CMP`),
		read(`${p}/SKY.PRM`),
		read(`${p}/LIBRARY.CMP`),
		read(`${p}/LIBRARY.TTF`),
		read(`${p}/TRACK.TRV`),
		read(`${p}/TRACK.TRF`),
		read(`${p}/TRACK.TRS`),
		def.tex ? read(`${p}/TRACK.TEX`) : Promise.resolve(null)
	]);

	onProgress(0.2, 'Building the racing line');
	await breathe();
	// Track geometry and racing line (in raw PSX units, converted axes)
	const vertices = readTrackVertices(trv);
	const faces = readTrackFaces(trf);
	if (tex) applyTex(faces, tex);
	const sections = readSections(trs);
	const line = extractLine(sections, faces, vertices);

	const k = TARGET_HALF_WIDTH / line.medianHalfWidth;

	const group = new THREE.Group();
	group.name = def.name;
	const world = new THREE.Group();
	world.scale.setScalar(k);
	group.add(world);

	onProgress(0.3, 'Decoding track textures');
	await breathe();
	world.add(buildTrackMesh(vertices, faces, libCmp, libTtf));
	onProgress(0.55, 'Building scenery');
	await breathe();
	for (const m of buildPrmScene(scenePrm, sceneCmp)) world.add(m);
	onProgress(0.8, 'Painting the sky');
	await breathe();

	const sky = new THREE.Group();
	const skyInner = new THREE.Group();
	skyInner.scale.setScalar(48 * k);
	for (const m of buildPrmScene(skyPrm, skyCmp, { sky: true })) skyInner.add(m);
	sky.add(skyInner);
	sky.renderOrder = -10;

	// Racing path in metres
	const points = line.centers.map((c) => c.clone().multiplyScalar(k));
	const path = new TrackPath({
		points,
		ups: line.ups,
		halfWidths: line.halfWidths.map((w) => w * k),
		step: 1.0,
		kappaSmooth: 10
	});
	addBoosts(path, faces, vertices, k);
	onProgress(1, 'Ready');

	return {
		name: def.name,
		path,
		group,
		sky,
		fog: new THREE.Fog(0x000000, 600, 4000),
		background: new THREE.Color(0x000000)
	};
}

// --- Binary readers (PSX data is big endian, TIM images little endian) ---------------

function readTrackVertices(buf) {
	const v = new DataView(buf);
	const n = buf.byteLength / 16;
	const out = new Array(n);
	for (let i = 0; i < n; i++) {
		const o = i * 16;
		out[i] = new THREE.Vector3(v.getInt32(o), -v.getInt32(o + 4), -v.getInt32(o + 8));
	}
	return out;
}

function readTrackFaces(buf) {
	const v = new DataView(buf);
	const n = buf.byteLength / 20;
	const out = new Array(n);
	for (let i = 0; i < n; i++) {
		const o = i * 20;
		out[i] = {
			indices: [v.getUint16(o), v.getUint16(o + 2), v.getUint16(o + 4), v.getUint16(o + 6)],
			normal: new THREE.Vector3(v.getInt16(o + 8), -v.getInt16(o + 10), -v.getInt16(o + 12)).normalize(),
			tile: v.getUint8(o + 14),
			flags: v.getUint8(o + 15),
			color: v.getUint32(o + 16)
		};
	}
	return out;
}

function applyTex(faces, buf) {
	const v = new DataView(buf);
	const n = Math.min(faces.length, buf.byteLength / 2);
	for (let i = 0; i < n; i++) {
		faces[i].tile = v.getUint8(i * 2);
		faces[i].flags = v.getUint8(i * 2 + 1);
	}
}

function readSections(buf) {
	const v = new DataView(buf);
	const n = buf.byteLength / 156;
	const out = new Array(n);
	for (let i = 0; i < n; i++) {
		const o = i * 156;
		out[i] = {
			nextJunction: v.getInt32(o),
			previous: v.getInt32(o + 4),
			next: v.getInt32(o + 8),
			firstFace: v.getUint32(o + 140),
			numFaces: v.getUint16(o + 144),
			flags: v.getUint16(o + 150)
		};
	}
	return out;
}

function int32ToColor(c, out = new THREE.Color()) {
	// PSX colours: 0x80 = 1.0 (values above brighten the texture)
	return out.setRGB(((c >>> 24) & 0xff) / 0x80, ((c >>> 16) & 0xff) / 0x80, ((c >>> 8) & 0xff) / 0x80, THREE.SRGBColorSpace);
}

// --- Racing line -------------------------------------------------------------------

function extractLine(sections, faces, vertices) {
	const order = [];
	const seen = new Set();
	let i = 0;
	do {
		order.push(i);
		seen.add(i);
		i = sections[i].next;
	} while (i > 0 && i < sections.length && !seen.has(i));

	const centers = [];
	const ups = [];
	for (const si of order) {
		const s = sections[si];
		const c = new THREE.Vector3();
		const u = new THREE.Vector3();
		let n = 0;
		for (let f = s.firstFace; f < s.firstFace + s.numFaces; f++) {
			const face = faces[f];
			if (!face || !(face.flags & FACE_FLAGS.TRACK)) continue;
			for (const vi of face.indices) c.add(vertices[vi]);
			u.add(face.normal);
			n++;
		}
		if (!n) continue;
		c.divideScalar(n * 4);
		if (u.lengthSq() < 1e-6) u.set(0, 1, 0);
		centers.push(c);
		ups.push(u.normalize());
	}

	// If the stored normals point down (winding convention), flip them all
	const avgUp = ups.reduce((a, u) => a + u.y, 0);
	if (avgUp < 0) for (const u of ups) u.negate();

	// Width from the TRACK faces' extent across the direction of travel
	const halfWidths = [];
	const fwd = new THREE.Vector3();
	const right = new THREE.Vector3();
	let ci = 0;
	for (const si of order) {
		const s = sections[si];
		let hasTrack = false;
		for (let f = s.firstFace; f < s.firstFace + s.numFaces; f++) if (faces[f] && faces[f].flags & FACE_FLAGS.TRACK) hasTrack = true;
		if (!hasTrack) continue;
		const n = centers.length;
		fwd.subVectors(centers[(ci + 1) % n], centers[(ci - 1 + n) % n]).normalize();
		right.crossVectors(fwd, ups[ci]).normalize();
		let lo = 0;
		let hi = 0;
		for (let f = s.firstFace; f < s.firstFace + s.numFaces; f++) {
			const face = faces[f];
			if (!face || !(face.flags & FACE_FLAGS.TRACK)) continue;
			for (const vi of face.indices) {
				const d = _t.subVectors(vertices[vi], centers[ci]).dot(right);
				lo = Math.min(lo, d);
				hi = Math.max(hi, d);
			}
		}
		halfWidths.push(Math.max(1, Math.min(-lo, hi)));
		ci++;
	}

	const sorted = [...halfWidths].sort((a, b) => a - b);
	return { centers, ups, halfWidths, medianHalfWidth: sorted[sorted.length >> 1] || 1 };
}

const _t = new THREE.Vector3();

function addBoosts(path, faces, vertices, k) {
	addZones(path, faces, vertices, k, FACE_FLAGS.BOOST, path.boosts);
	addZones(path, faces, vertices, k, FACE_FLAGS.WEAPON | FACE_FLAGS.WEAPON_2, path.weaponPads);
}

function addZones(path, faces, vertices, k, flag, zones) {
	const f = newFrame();
	const p = new THREE.Vector3();
	for (const face of faces) {
		if (!(face.flags & flag)) continue;
		p.set(0, 0, 0);
		for (const vi of face.indices) p.add(vertices[vi]);
		p.multiplyScalar(k / 4);
		// nearest sample on the path
		let best = 0;
		let bestD = Infinity;
		for (let i = 0; i < path.count; i++) {
			const dx = path.pos[i * 3] - p.x;
			const dy = path.pos[i * 3 + 1] - p.y;
			const dz = path.pos[i * 3 + 2] - p.z;
			const d = dx * dx + dy * dy + dz * dz;
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		}
		const s = best * path.step;
		path.frameAt(s, f);
		let s0 = Infinity, s1 = -Infinity, x0 = Infinity, x1 = -Infinity;
		for (const vi of face.indices) {
			_t.copy(vertices[vi]).multiplyScalar(k).sub(f.pos);
			const a = _t.dot(f.fwd);
			const x = _t.dot(f.right);
			s0 = Math.min(s0, s + a);
			s1 = Math.max(s1, s + a);
			x0 = Math.min(x0, x);
			x1 = Math.max(x1, x);
		}
		zones.push({ s0: path.wrap(s0), s1: path.wrap(s0) + (s1 - s0), x0, x1 });
	}
}

// --- Track mesh ----------------------------------------------------------------------

function buildTrackMesh(vertices, faces, libCmp, libTtf) {
	const images = unpackImages(libCmp).map(readImage);

	// Compose the 4x4 "near" tiles of each texture into one 128x128 image
	const ttf = new DataView(libTtf);
	const entries = libTtf.byteLength / 42;
	const materials = [];
	for (let i = 0; i < entries; i++) {
		const c = document.createElement('canvas');
		c.width = c.height = 128;
		const ctx = c.getContext('2d');
		for (let x = 0; x < 4; x++) {
			for (let y = 0; y < 4; y++) {
				const img = images[ttf.getUint16(i * 42 + (y * 4 + x) * 2)];
				if (img) ctx.drawImage(img, x * 32, y * 32);
			}
		}
		materials.push(texturedMaterial(c, THREE.DoubleSide));
	}
	materials.push(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
	const flatIndex = materials.length - 1;

	const byMat = new Map();
	const color = new THREE.Color();
	for (const f of faces) {
		const mi = f.tile < flatIndex ? f.tile : flatIndex;
		if (!byMat.has(mi)) byMat.set(mi, { pos: [], col: [], uv: [] });
		const b = byMat.get(mi);
		if (f.flags & FACE_FLAGS.BOOST) color.setRGB(0.25, 0.25, 2);
		else int32ToColor(f.color, color);
		const flip = f.flags & FACE_FLAGS.FLIP ? 1 : 0;
		const tri = [
			[0, 1 - flip, 1], [1, 0 + flip, 1], [2, 0 + flip, 0],
			[2, 0 + flip, 0], [3, 1 - flip, 0], [0, 1 - flip, 1]
		];
		for (const [k, u, v] of tri) {
			const p = vertices[f.indices[k]];
			b.pos.push(p.x, p.y, p.z);
			b.col.push(color.r, color.g, color.b);
			b.uv.push(u, v);
		}
	}
	return mergeGroups(byMat, materials);
}

function mergeGroups(byMat, materials) {
	let total = 0;
	for (const b of byMat.values()) total += b.pos.length / 3;
	const pos = new Float32Array(total * 3);
	const col = new Float32Array(total * 3);
	const uv = new Float32Array(total * 2);
	const g = new THREE.BufferGeometry();
	let start = 0;
	for (const [mi, b] of byMat) {
		const count = b.pos.length / 3;
		pos.set(b.pos, start * 3);
		col.set(b.col, start * 3);
		uv.set(b.uv, start * 2);
		g.addGroup(start, count, mi);
		start += count;
	}
	g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	g.setAttribute('color', new THREE.BufferAttribute(col, 3));
	g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	return new THREE.Mesh(g, materials);
}

function texturedMaterial(canvas, side) {
	const t = new THREE.CanvasTexture(canvas);
	t.colorSpace = THREE.SRGBColorSpace;
	t.magFilter = THREE.NearestFilter;
	t.minFilter = THREE.NearestMipmapLinearFilter;
	return new THREE.MeshBasicMaterial({ map: t, vertexColors: true, alphaTest: 0.5, side });
}

// --- PRM objects -----------------------------------------------------------------------

const POLY = {
	0x00: { size: 18 },
	0x01: { size: 16, n: 3, idx: 4, color: 12 },
	0x02: { size: 28, n: 3, idx: 4, tex: 10, uv: 16, color: 24 },
	0x03: { size: 16, n: 4, idx: 4, color: 12 },
	0x04: { size: 32, n: 4, idx: 4, tex: 12, uv: 18, color: 28 },
	0x05: { size: 24, n: 3, idx: 4, colors: 12 },
	0x06: { size: 36, n: 3, idx: 4, tex: 10, uv: 16, colors: 24 },
	0x07: { size: 28, n: 4, idx: 4, colors: 12 },
	0x08: { size: 44, n: 4, idx: 4, tex: 12, uv: 18, colors: 28 },
	0x0a: { size: 16, sprite: -1 },
	0x0b: { size: 16, sprite: 1 }
};

function readObjects(buf) {
	const v = new DataView(buf);
	const objects = [];
	let o = 0;
	while (o + 144 <= buf.byteLength) {
		const name = new TextDecoder().decode(new Uint8Array(buf, o, 15)).replace(/\0.*$/s, '');
		const vertexCount = v.getUint16(o + 16);
		const polygonCount = v.getUint16(o + 32);
		const position = new THREE.Vector3(v.getInt32(o + 116), -v.getInt32(o + 120), -v.getInt32(o + 124));
		o += 144;
		const verts = [];
		for (let i = 0; i < vertexCount; i++, o += 8) verts.push(new THREE.Vector3(v.getInt16(o), -v.getInt16(o + 2), -v.getInt16(o + 4)));
		const polys = [];
		for (let i = 0; i < polygonCount; i++) {
			const type = v.getUint16(o);
			const def = POLY[type];
			if (!def) {
				console.warn('Unknown PRM polygon type', type, '- stopping');
				return objects;
			}
			const p = { type, def, o };
			polys.push(p);
			o += def.size;
		}
		objects.push({ name, position, verts, polys, view: v });
	}
	return objects;
}

// Each object of a PRM file as its own mesh (ships, weapon models): [{name, mesh}]
export function prmObjectMeshes(prmBuf, cmpBuf) {
	return buildPrmScene(prmBuf, cmpBuf, { perObject: true });
}

function buildPrmScene(prmBuf, cmpBuf, { sky = false, perObject = false } = {}) {
	const images = cmpBuf ? unpackImages(cmpBuf).map(readImage) : [];
	const side = THREE.DoubleSide;
	const materials = images.map((img) => (img ? texturedMaterial(img, side) : null));
	const flat = new THREE.MeshBasicMaterial({ vertexColors: true, side });
	materials.push(flat);
	const flatIndex = materials.length - 1;
	for (let i = 0; i < materials.length; i++) {
		if (!materials[i]) materials[i] = flat;
		if (sky) {
			materials[i].fog = false;
			materials[i].depthWrite = false;
		}
	}

	// Every object is baked into one mesh (one draw call per material), which
	// matters on standalone headsets: a scene has hundreds of small objects.
	const color = new THREE.Color();
	let byMat = new Map();
	const perObjectOut = [];
	for (const obj of readObjects(prmBuf)) {
		const v = obj.view;
		const o = perObject ? new THREE.Vector3() : obj.position;
		if (perObject) byMat = new Map();
		const push = (mi, p, c, u, vv) => {
			if (!byMat.has(mi)) byMat.set(mi, { pos: [], col: [], uv: [] });
			const b = byMat.get(mi);
			b.pos.push(p.x + o.x, p.y + o.y, p.z + o.z);
			b.col.push(c.r, c.g, c.b);
			b.uv.push(u, vv);
		};
		for (const p of obj.polys) {
			const d = p.def;
			if (d.sprite) {
				const vi = v.getUint16(p.o + 4);
				const w = v.getUint16(p.o + 6);
				const h = v.getUint16(p.o + 8);
				const texI = v.getUint16(p.o + 10);
				int32ToColor(v.getUint32(p.o + 12), color);
				const base = obj.verts[vi];
				if (!base) continue;
				const cy = base.y + (d.sprite > 0 ? h / 2 : -h / 2);
				const mi = texI < flatIndex ? texI : flatIndex;
				// Two crossed quads instead of camera-facing sprites
				for (const [ax, az] of [[1, 0], [0, 1]]) {
					const q = [
						[-w / 2, -h / 2, 0, 0], [w / 2, -h / 2, 1, 0], [w / 2, h / 2, 1, 1],
						[w / 2, h / 2, 1, 1], [-w / 2, h / 2, 0, 1], [-w / 2, -h / 2, 0, 0]
					];
					for (const [dx, dy, u, vv] of q) push(mi, _t.set(base.x + dx * ax, cy + dy, base.z + dx * az), color, u, vv);
				}
				continue;
			}
			if (!d.n) continue;
			const idx = [];
			for (let k = 0; k < d.n; k++) idx.push(v.getUint16(p.o + d.idx + k * 2));
			let mi = flatIndex;
			let uvs = null;
			if (d.tex !== undefined) {
				const texI = v.getUint16(p.o + d.tex);
				const img = images[texI];
				if (img) {
					mi = texI;
					uvs = [];
					for (let k = 0; k < d.n; k++) {
						uvs.push([v.getUint8(p.o + d.uv + k * 2) / img.width, 1 - v.getUint8(p.o + d.uv + k * 2 + 1) / img.height]);
					}
				}
			}
			const cols = [];
			for (let k = 0; k < d.n; k++) {
				const c = new THREE.Color(1, 1, 1);
				if (d.color !== undefined) int32ToColor(v.getUint32(p.o + d.color), c);
				else if (d.colors !== undefined) int32ToColor(v.getUint32(p.o + d.colors + k * 4), c);
				cols.push(c);
			}
			const tris = d.n === 4 ? [[2, 1, 0], [2, 3, 1]] : [[2, 1, 0]];
			for (const tri of tris) {
				if (tri.some((k) => !obj.verts[idx[k]])) continue;
				for (const k of tri) push(mi, obj.verts[idx[k]], cols[k], uvs ? uvs[k][0] : 0, uvs ? uvs[k][1] : 0);
			}
		}
		if (perObject && byMat.size) perObjectOut.push({ name: obj.name, mesh: mergeGroups(byMat, materials) });
	}
	if (perObject) return perObjectOut;
	if (!byMat.size) return [];
	const mesh = mergeGroups(byMat, materials);
	if (sky) mesh.renderOrder = -10;
	return [mesh];
}

// --- CMP (LZ77 packed TIM images) ----------------------------------------------------

function unpackImages(buffer) {
	const data = new DataView(buffer);
	const numberOfFiles = data.getUint32(0, true);
	const packedDataOffset = (numberOfFiles + 1) * 4;
	let unpackedLength = 0;
	for (let i = 0; i < numberOfFiles; i++) unpackedLength += data.getUint32((i + 1) * 4, true);

	const src = new Uint8Array(buffer, packedDataOffset);
	const dst = new Uint8Array(unpackedLength);
	const wnd = new Uint8Array(0x2000);
	let srcPos = 0, dstPos = 0, wndPos = 1, curByte = 0, bitMask = 0x80;

	const readBitfield = (size) => {
		let value = 0;
		while (size > 0) {
			if (bitMask === 0x80) curByte = src[srcPos++];
			if (curByte & bitMask) value |= size;
			size >>= 1;
			bitMask >>= 1;
			if (bitMask === 0) bitMask = 0x80;
		}
		return value;
	};

	while (srcPos <= src.byteLength && dstPos <= unpackedLength) {
		if (bitMask === 0x80) curByte = src[srcPos++];
		const curBit = curByte & bitMask;
		bitMask >>= 1;
		if (bitMask === 0) bitMask = 0x80;
		if (curBit) {
			wnd[wndPos & 0x1fff] = dst[dstPos] = readBitfield(0x80);
			wndPos++;
			dstPos++;
		} else {
			const position = readBitfield(0x1000);
			if (position === 0) break;
			const length = readBitfield(0x08) + 2;
			for (let i = 0; i <= length; i++) {
				wnd[wndPos & 0x1fff] = dst[dstPos] = wnd[(i + position) & 0x1fff];
				wndPos++;
				dstPos++;
			}
		}
	}

	const files = [];
	let off = 0;
	for (let i = 0; i < numberOfFiles; i++) {
		const len = data.getUint32((i + 1) * 4, true);
		files.push(dst.buffer.slice(off, off + len));
		off += len;
	}
	return files;
}

function readImage(buffer) {
	if (!buffer.byteLength) return null;
	const data = new DataView(buffer);
	const type = data.getUint32(4, true);
	let offset = 20;
	let palette = null;
	if (type === 0x08 || type === 0x09) {
		const paletteColors = data.getUint16(16, true);
		palette = new Uint16Array(buffer.slice(offset, offset + paletteColors * 2));
		offset += paletteColors * 2;
	}
	offset += 4; // data size
	const pixelsPerShort = type === 0x09 ? 2 : type === 0x08 ? 4 : 1;
	const dimW = data.getUint16(offset + 4, true);
	const dimH = data.getUint16(offset + 6, true);
	offset += 8;
	const width = dimW * pixelsPerShort;
	const height = dimH;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	const pixels = ctx.createImageData(width, height);
	const put = (o, c) => {
		pixels.data[o] = (c & 0x1f) << 3;
		pixels.data[o + 1] = ((c >> 5) & 0x1f) << 3;
		pixels.data[o + 2] = ((c >> 10) & 0x1f) << 3;
		pixels.data[o + 3] = c === 0 ? 0 : 0xff;
	};
	const entries = dimW * dimH;
	for (let i = 0; i < entries; i++) {
		const p = data.getUint16(offset + i * 2, true);
		if (type === 0x02) put(i * 4, p);
		else if (type === 0x09) {
			put(i * 8, palette[p & 0xff]);
			put(i * 8 + 4, palette[(p >> 8) & 0xff]);
		} else if (type === 0x08) {
			put(i * 16, palette[p & 0xf]);
			put(i * 16 + 4, palette[(p >> 4) & 0xf]);
			put(i * 16 + 8, palette[(p >> 8) & 0xf]);
			put(i * 16 + 12, palette[(p >> 12) & 0xf]);
		}
	}
	ctx.putImageData(pixels, 0, 0);
	return canvas;
}
