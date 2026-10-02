// Headless race simulation: AI ships only. Checks lap times, wall hits and stalls.
import * as THREE from 'three';
import { TrackPath } from '../src/track.js';
import { BUILTIN_TRACKS } from '../src/tracks.js';
import { Craft, CLASSES, collideCrafts } from '../src/craft.js';
import { AIPilot } from '../src/ai.js';

const clsName = process.argv[2] || 'sport';
for (const def of BUILTIN_TRACKS) {
	const pts = def.points.map(([x, z, y]) => new THREE.Vector3(x, y, z));
	const path = new TrackPath({ points: pts, halfWidths: def.halfWidth, autoBank: def.bank });
	for (const b of def.boosts) path.boosts.push({ s0: b.at * path.length, s1: b.at * path.length + 8, x0: b.x - 2, x1: b.x + 2 });
	const crafts = [], pilots = [];
	for (let i = 0; i < 8; i++) {
		const c = new Craft(path, CLASSES[clsName], { s: -12 - Math.floor(i / 2) * 12, x: i % 2 ? 4 : -4, skill: 0.9 + i * 0.012 });
		crafts.push(c); pilots.push(new AIPilot(c, { lane: (i % 3) - 1 }));
	}
	const dt = 1 / 120; let t = 0; const walls = new Array(8).fill(0); let minSpeed = Infinity; const wallT = new Array(8).fill(0); let vsum = 0, vn = 0;
	while (t < 400 && crafts.some((c) => c.lap <= 3)) {
		pilots.forEach((p) => p.update(dt, crafts));
		crafts.forEach((c) => c.step(dt, t));
		collideCrafts(crafts);
		crafts.forEach((c, i) => { if (c.wallHit > 0.2) walls[i]++; if (t > 5) { minSpeed = Math.min(minSpeed, c.speed); vsum += c.speed; vn++; } if (Math.abs(c.x) >= path.halfWidthAt(c.s) - 2.11) wallT[i] += dt; });
		t += dt;
	}
	const laps = crafts.map((c) => c.lapTimes.map((x) => x.toFixed(1)).join('/'));
	console.log(`${def.name} [${clsName}] t=${t.toFixed(0)}s  minSpeed ${(minSpeed*3.6).toFixed(0)} km/h avg ${(vsum/vn*3.6).toFixed(0)} km/h`);
	crafts.forEach((c, i) => console.log(`   #${i} skill ${c.skill.toFixed(2)} laps ${laps[i]}  wall hits ${walls[i]} on-wall ${wallT[i].toFixed(1)}s`));
}
