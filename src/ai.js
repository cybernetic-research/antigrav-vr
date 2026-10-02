import * as THREE from 'three';

// AI pilot: pure-pursuit steering in track space towards a racing line that
// hugs the inside of upcoming bends, with corner-speed management and simple
// avoidance of the ship ahead. Writes into craft.input like a player would.

export class AIPilot {
	constructor(craft, { lane = 0, aggression = 1 } = {}) {
		this.craft = craft;
		this.lane = lane; // preferred offset from the racing line
		this.aggression = aggression;
		this.wander = Math.random() * 100;
	}

	update(dt, crafts) {
		const c = this.craft;
		const t = c.track;
		const inp = c.input;
		const speed = Math.max(c.speed, 1);
		const hw = t.halfWidthAt(c.s);

		// Net turn of the track over the lookahead distance
		const look = THREE.MathUtils.clamp(speed * 0.55, 18, 70);
		let theta = 0;
		let kAhead = 0;
		const n = 8;
		for (let i = 0; i < n; i++) {
			const k = t.kappaAt(c.s + ((i + 0.5) / n) * look);
			theta += (k * look) / n;
		}
		// Look further for the racing line (set up before the corner)
		for (let i = 0; i < n; i++) kAhead += t.kappaAt(c.s + look * 0.5 + (i / n) * look * 1.5) / n;

		// Racing line: inside of the bend (left turn -> negative x)
		this.wander += dt * 0.2;
		const laneDrift = Math.sin(this.wander) * 2;
		let targetX = -Math.sign(kAhead) * Math.min(hw * 0.55, Math.abs(kAhead) * 600) + this.lane + laneDrift;

		// Avoid the ship directly ahead
		const L = t.length;
		for (const o of crafts) {
			if (o === c || o.track !== c.track || o.eliminated) continue;
			let ds = o.s - c.s;
			if (ds < -L / 2) ds += L;
			if (ds > L / 2) ds -= L;
			if (ds > 0 && ds < 28 && Math.abs(o.x - targetX) < 4.5) {
				targetX = o.x + (o.x > 0 ? -5.5 : 5.5);
			} else if (Math.abs(ds) < 8 && Math.abs(o.x - c.x) < 5.5) {
				// alongside: hold a gap instead of leaning on them
				targetX = c.x + (c.x >= o.x ? 3 : -3);
			}
		}
		// heading for a side route (pit lane): routes.js sets where to be
		if (c.routeTargetX !== undefined) targetX = c.routeTargetX;
		const margin = 3;
		targetX = THREE.MathUtils.clamp(targetX, -hw + margin, hw - margin);

		// Pure pursuit: target point in the local (forward, left) frame
		const left = -(targetX - c.x) + (look * theta) / 2;
		const psiDes = Math.atan2(left, look);
		const err = psiDes - c.psi;
		let steer = -err * 3.2 + c.omega * 0.18;
		inp.steer = THREE.MathUtils.clamp(steer, -1, 1);

		inp.airL = 0;
		inp.airR = 0;
		if (Math.abs(err) > 0.12 && speed > 40) {
			if (err > 0) inp.airL = Math.min(1, (Math.abs(err) - 0.12) * 5);
			else inp.airR = Math.min(1, (Math.abs(err) - 0.12) * 5);
		}

		// Corner speed: yaw rate needed (v * kappa) must stay under what the ship can do
		let kMax = 0;
		const brakeLook = speed * 1.4;
		for (let i = 0; i < 10; i++) kMax = Math.max(kMax, Math.abs(t.kappaAt(c.s + (i / 10) * brakeLook)));
		const yawCap = (c.cls.turn + 0.6) * 0.9 * this.aggression;
		const vLimit = kMax > 1e-4 ? yawCap / kMax : Infinity;
		if (speed > vLimit * 1.05) {
			inp.thrust = 0;
			inp.brake = THREE.MathUtils.clamp((speed - vLimit) / 20, 0, 1);
		} else {
			inp.thrust = speed > vLimit * 0.97 ? 0.6 : 1;
			inp.brake = 0;
		}
	}
}
