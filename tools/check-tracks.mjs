// Sanity checks for built-in layouts: length, tightest corner, self-overlap.
import * as THREE from 'three';
import { TrackPath } from '../src/track.js';
import { BUILTIN_TRACKS } from '../src/tracks.js';

for (const def of BUILTIN_TRACKS) {
	const pts = def.points.map(([x, z, y]) => new THREE.Vector3(x, y, z));
	const path = new TrackPath({ points: pts, halfWidths: def.halfWidth, autoBank: def.bank });
	let kmax = 0;
	for (const k of path.kappa) kmax = Math.max(kmax, Math.abs(k));
	// closest approach between parts of the track more than 80 m apart along it
	let minGap = Infinity, minGap3 = Infinity, at = 0;
	const P = path.pos, n = path.count, st = 4;
	for (let i = 0; i < n; i += st) for (let j = i + st; j < n; j += st) {
		const ds = Math.min(j - i, n - (j - i)) * path.step;
		if (ds < 120) continue;
		const dx = P[i*3]-P[j*3], dy = P[i*3+1]-P[j*3+1], dz = P[i*3+2]-P[j*3+2];
		const h = Math.hypot(dx, dz);
		if (h < minGap) { minGap = h; minGap3 = Math.abs(dy); at = i * path.step; }
	}
	console.log(`${def.name.padEnd(16)} len ${path.length.toFixed(0)} m  min radius ${(1/kmax).toFixed(0)} m  closest other part ${minGap.toFixed(0)} m horiz (dy ${minGap3.toFixed(0)} m) at s=${at.toFixed(0)}`);
}
