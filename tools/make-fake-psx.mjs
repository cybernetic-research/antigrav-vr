// Writes a small synthetic track in the PSX file formats to exercise the
// loader (src/psx.js) without the real disc data. Usage:
//   node tools/make-fake-psx.mjs <outdir>     e.g. WIPEOUT/TRACK02
// Delete the folder afterwards so it can't be mistaken for real data.
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'WIPEOUT/TRACK02';
fs.mkdirSync(out, { recursive: true });

const N = 72, R = 40000, HW = 1300, WALL = 500;
const be = (size) => { const b = new DataView(new ArrayBuffer(size)); return b; };

// TRV: per ring 5 vertices: wallL top, L, C, R, wallR top (PSX: y down, so up = -y)
const trv = be(N * 5 * 16);
const ring = (i) => {
	const a = (i / N) * Math.PI * 2;
	// wobble the height a bit
	const y = Math.sin(a * 3) * 800;
	const cx = Math.cos(a) * R, cz = Math.sin(a) * R;
	const rx = Math.cos(a), rz = Math.sin(a); // radial = lateral direction
	return [[cx + rx * -HW, y - WALL, cz + rz * -HW], [cx - rx * HW, y, cz - rz * HW], [cx, y, cz], [cx + rx * HW, y, cz + rz * HW], [cx + rx * HW, y - WALL, cz + rz * HW]];
};
for (let i = 0; i < N; i++) ring(i).forEach((v, k) => {
	const o = (i * 5 + k) * 16;
	trv.setInt32(o, Math.round(v[0])); trv.setInt32(o + 4, Math.round(v[1])); trv.setInt32(o + 8, Math.round(v[2]));
});
// TRF: 4 faces per section
const trf = be(N * 4 * 20);
for (let i = 0; i < N; i++) {
	const a = i * 5, b = ((i + 1) % N) * 5;
	const faces = [
		[[a + 1, a + 2, b + 2, b + 1], 1 | (i === 6 ? 32 : 0)],
		[[a + 2, a + 3, b + 3, b + 2], 1],
		[[a + 0, a + 1, b + 1, b + 0], 0],
		[[a + 3, a + 4, b + 4, b + 3], 0]
	];
	faces.forEach(([idx, flags], k) => {
		const o = (i * 4 + k) * 20;
		idx.forEach((v, j) => trf.setUint16(o + j * 2, v));
		trf.setInt16(o + 8, 0); trf.setInt16(o + 10, -4096); trf.setInt16(o + 12, 0);
		trf.setUint8(o + 14, 0); trf.setUint8(o + 15, flags);
		trf.setUint32(o + 16, flags & 1 ? 0x80808000 : 0x60406000);
	});
}
// TRS
const trs = be(N * 156);
for (let i = 0; i < N; i++) {
	const o = i * 156;
	trs.setInt32(o, -1); trs.setInt32(o + 4, (i - 1 + N) % N); trs.setInt32(o + 8, (i + 1) % N);
	trs.setUint32(o + 140, i * 4); trs.setUint16(o + 144, 4); trs.setUint16(o + 150, 0);
}
// TTF: one texture made of tile 0
const ttf = be(42);

// TIM 16bpp 32x32 checker, packed into a CMP with literal-only LZ stream
function tim(colorA, colorB) {
	const w = 32, h = 32, d = new DataView(new ArrayBuffer(20 + 4 + 8 + w * h * 2));
	d.setUint32(0, 0x10, true); d.setUint32(4, 0x02, true); d.setUint32(8, 0, true);
	d.setUint16(28, w, true); d.setUint16(30, h, true);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.setUint16(32 + (y * w + x) * 2, ((x >> 3) + (y >> 3)) % 2 ? colorA : colorB, true);
	return new Uint8Array(d.buffer);
}
function cmp(files) {
	const bits = [];
	const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
	for (const f of files) for (const byte of f) { put(1, 1); put(byte, 8); }
	put(0, 1); put(0, 13); // terminator
	while (bits.length % 8) bits.push(0);
	const packed = new Uint8Array(bits.length / 8);
	for (let i = 0; i < packed.length; i++) for (let j = 0; j < 8; j++) packed[i] |= bits[i * 8 + j] << (7 - j);
	const head = new DataView(new ArrayBuffer((files.length + 1) * 4));
	head.setUint32(0, files.length, true);
	files.forEach((f, i) => head.setUint32((i + 1) * 4, f.length, true));
	return Buffer.concat([Buffer.from(head.buffer), Buffer.from(packed)]);
}
// PRM: one object, 4 vertices, a flat quad, a textured tri and a sprite
function prm(scale, offsetY) {
	const polys = [];
	const q = be(16); q.setUint16(0, 0x03); [0, 1, 2, 3].forEach((v, j) => q.setUint16(4 + j * 2, v)); q.setUint32(12, 0xc0404000); polys.push(q);
	const t = be(28); t.setUint16(0, 0x02); [0, 1, 2].forEach((v, j) => t.setUint16(4 + j * 2, v)); t.setUint16(10, 0);
	[[0, 0], [31, 0], [31, 31]].forEach(([u, v], j) => { t.setUint8(16 + j * 2, u); t.setUint8(17 + j * 2, v); }); t.setUint32(24, 0x80808000); polys.push(t);
	const s = be(16); s.setUint16(0, 0x0b); s.setUint16(4, 0); s.setUint16(6, 600); s.setUint16(8, 900); s.setUint16(10, 0); s.setUint32(12, 0x80808000); polys.push(s);
	const head = be(144); head.setUint16(16, 4); head.setUint16(32, polys.length);
	head.setInt32(116, 0); head.setInt32(120, offsetY); head.setInt32(124, 0);
	const verts = be(4 * 8);
	[[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]].forEach((v, i) => { verts.setInt16(i * 8, v[0] * scale); verts.setInt16(i * 8 + 2, v[1] * scale); verts.setInt16(i * 8 + 4, v[2] * scale); });
	return Buffer.concat([head, verts, ...polys].map((d) => Buffer.from(d.buffer)));
}

const w = (name, data) => fs.writeFileSync(path.join(out, name), Buffer.isBuffer(data) ? data : new Uint8Array(data.buffer));
w('TRACK.TRV', trv); w('TRACK.TRF', trf); w('TRACK.TRS', trs); w('LIBRARY.TTF', ttf);
w('LIBRARY.CMP', cmp([tim(0x7fff, 0x2108)]));
w('SCENE.CMP', cmp([tim(0x001f, 0x7c00)]));
w('SKY.CMP', cmp([tim(0x7c00, 0x0010)]));
w('SCENE.PRM', prm(3000, -2000));
w('SKY.PRM', prm(2000, -3000));
console.log('wrote synthetic PSX track to', out);
