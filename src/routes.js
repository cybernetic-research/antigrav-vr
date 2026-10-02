import * as THREE from 'three';
import { newFrame } from './track.js';

// Side routes (pit lanes and alternative routes) on tracks that have them.
// A route is an open TrackPath that forks off the main loop at `forkS` and
// rejoins it at `rejoinS`. A craft switches onto a route when, around the
// fork, it is clearly closer to the route's centreline than to the main one,
// and back again near the end. The player picks a route just by keeping to
// that side; AI pilots only head for a pit lane when their shield is low.

const PIT_WANT = 50; // AI shield level below which it heads for the pit lane
const fMain = newFrame();
const fRoute = newFrame();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _c = new THREE.Vector3();

// events: {enter(craft, route), leave(craft, route)}
export function updateRoutes(crafts, track, raceTime, events = {}) {
	const branches = track.branches;
	if (!branches?.length) return;
	const main = track.path;
	const L = main.length;
	for (const b of branches) b.side ??= routeSide(main, b);

	for (const c of crafts) {
		if (c.eliminated) continue;
		if (!c.route) {
			c.routeTargetX = undefined;
			for (const b of branches) {
				const ds = signedGap(c.s - b.forkS, L);
				const wants = c.isPlayer || (b.pit && c.energy < PIT_WANT);
				// AI that want the pit lane line up on its side before the fork
				if (!c.isPlayer && wants && ds > -160 && ds < 60) c.routeTargetX = b.side * main.halfWidthAt(c.s) * 0.75;
				if (!wants || ds < -2 || ds > 80) continue;
				// only once clearly over on the route's side
				if (Math.sign(c.x) !== b.side || Math.abs(c.x) < main.halfWidthAt(c.s) * 0.45) continue;
				main.toWorld(c.s, c.x, 0, _p, fMain);
				const hit = nearestOn(b.path, _p, 0, 100);
				if (!hit) continue;
				if (Math.abs(hit.x) < Math.abs(c.x) - 2 && Math.abs(hit.x) < b.path.halfWidthAt(hit.s) - 1.5) {
					switchTo(c, main, c.s, b.path, hit.s, hit.x);
					c.route = b;
					c.routeTargetX = undefined;
					events.enter?.(c, b);
				}
			}
		} else {
			const b = c.route;
			const end = b.path.length;
			if (c.s < end - 90) continue;
			b.path.toWorld(c.s, c.x, 0, _p, fRoute);
			const hit = nearestOn(main, _p, b.rejoinS - 120, b.rejoinS + 60);
			const atEnd = c.s >= end - 1.5;
			if (hit && (atEnd || Math.abs(hit.x) < Math.abs(c.x) - 1)) {
				switchTo(c, b.path, c.s, main, hit.s, THREE.MathUtils.clamp(hit.x, -main.halfWidthAt(hit.s) + 2.2, main.halfWidthAt(hit.s) - 2.2));
				// the route crossed the start/finish line if it rejoins "before" it forked
				if (b.rejoinS < b.forkS) c.completeLap(raceTime);
				c.route = null;
				events.leave?.(c, b);
			}
		}
	}
}

// Which side of the main track the route leaves on (+1 right, -1 left)
function routeSide(main, b) {
	const i = Math.min(b.path.count - 1, Math.round(40 / b.path.step));
	_p.fromArray(b.path.pos, i * 3);
	const hit = nearestOn(main, _p, b.forkS - 20, b.forkS + 120);
	return hit && hit.x < 0 ? -1 : 1;
}

function signedGap(ds, L) {
	if (ds > L / 2) ds -= L;
	if (ds < -L / 2) ds += L;
	return ds;
}

// Closest point of `path` to world point p, searching s in [s0, s1]: {s, x}
function nearestOn(path, p, s0, s1) {
	const n = path.count;
	const i0 = Math.floor(s0 / path.step);
	const i1 = Math.ceil(s1 / path.step);
	let best = -1;
	let bestD = Infinity;
	for (let i = i0; i <= i1; i++) {
		const j = path.closed ? ((i % n) + n) % n : i;
		if (j < 0 || j >= n) continue;
		const d = (path.pos[j * 3] - p.x) ** 2 + (path.pos[j * 3 + 1] - p.y) ** 2 + (path.pos[j * 3 + 2] - p.z) ** 2;
		if (d < bestD) {
			bestD = d;
			best = j;
		}
	}
	if (best < 0) return null;
	_c.fromArray(path.pos, best * 3);
	_d.subVectors(p, _c);
	const fwd = new THREE.Vector3().fromArray(path.fwd, best * 3);
	const right = new THREE.Vector3().fromArray(path.right, best * 3);
	return { s: path.wrap(best * path.step + _d.dot(fwd)), x: _d.dot(right) };
}

// Move a craft from one path to another, keeping its heading and velocity in world space
function switchTo(c, fromPath, fromS, toPath, toS, toX) {
	fromPath.frameAt(fromS, fMain);
	toPath.frameAt(toS, fRoute);
	// angle (left positive) from the old track direction to the new one
	_d.crossVectors(fMain.fwd, fRoute.fwd);
	const delta = Math.atan2(_d.dot(fRoute.up), fMain.fwd.dot(fRoute.fwd));
	c.psi -= delta;
	const cs = Math.cos(-delta);
	const sn = Math.sin(-delta);
	const vf = c.vf * cs - c.vl * sn;
	c.vl = c.vf * sn + c.vl * cs;
	c.vf = vf;
	c.track = toPath;
	c.s = toS;
	c.x = toX;
}
