import * as THREE from 'three';
import { newFrame } from './track.js';

// Speed classes. Speeds in m/s. Sport tops out around 290 km/h, Elite ~400 km/h.
export const CLASSES = {
	sport: { name: 'Sport', maxSpeed: 80, accel: 32, turn: 1.75, grip: 2.4 },
	elite: { name: 'Elite', maxSpeed: 110, accel: 40, turn: 2.05, grip: 2.7 }
};

const HOVER = 0.9;
const SHIP_HALF_W = 2.1; // pod tips
const SHIP_LEN = 6.6;

// A craft moving in track space. Heading `psi` is the angle between the ship's
// nose and the track direction (positive = pointing left). Velocity is kept as
// a 2D vector (forward, left) in the local track frame, which turns underneath
// the ship as the track curves. Without steering the ship drifts to the outside.
export class Craft {
	constructor(track, cls, { s = 0, x = 0, skill = 1 } = {}) {
		this.track = track;
		this.cls = cls;
		this.skill = skill; // top-speed multiplier (AI variety / rubber banding)
		this.s = track.wrap(s);
		this.x = x;
		this.h = HOVER;
		this.psi = 0;
		this.omega = 0; // yaw rate (rad/s)
		this.vf = 0; // forward speed (along track)
		this.vl = 0; // leftward speed
		this.boostTime = 0;
		this.lap = 0; // 0 = on the grid; becomes 1 when crossing the line at the start
		this.lapStart = 0;
		this.lapTimes = [];
		this.finished = false;
		this.finishTime = 0;
		this.wallHit = 0; // impact strength this frame (for sound / shake)
		this.boostHit = false;
		this.bank = 0; // visual roll
		this.bob = Math.random() * 10;
		this.frame = newFrame();
		this.position = new THREE.Vector3();
		this.quaternion = new THREE.Quaternion();
		this.input = { steer: 0, thrust: 0, brake: 0, airL: 0, airR: 0 };
		this.wrongWay = 0;
	}

	get speed() {
		return Math.hypot(this.vf, this.vl);
	}

	// Distance covered in the race; used for positions
	get progress() {
		return (this.lap - 1) * this.track.length + this.s;
	}

	step(dt, raceTime) {
		const c = this.cls;
		const inp = this.input;
		const vmax = c.maxSpeed * this.skill;
		const speed = this.speed;
		this.wallHit = 0;
		this.boostHit = false;

		// --- Yaw -------------------------------------------------------------
		// Steering authority drops slightly at very low speed so you can't spin on the spot
		const auth = THREE.MathUtils.clamp(speed / 25, 0.35, 1);
		const air = inp.airR - inp.airL; // right airbrake yaws right
		const targetOmega = (-inp.steer * c.turn - air * 0.9) * auth;
		this.omega += (targetOmega - this.omega) * Math.min(1, dt * 7);
		this.psi += this.omega * dt;

		// --- Thrust, drag, brakes -------------------------------------------
		const hx = Math.cos(this.psi);
		const hy = Math.sin(this.psi);
		const drag = c.accel / vmax; // linear drag so thrust balances at vmax
		let ax = hx * inp.thrust * c.accel;
		let ay = hy * inp.thrust * c.accel;
		const airDrag = (inp.airL + inp.airR) * 0.18;
		const extraDrag = this.boostTime > 0 ? drag * 0.5 : drag;
		ax -= this.vf * (extraDrag + airDrag);
		ay -= this.vl * (extraDrag + airDrag);
		if (inp.brake > 0 && speed > 0.1) {
			const b = Math.min(inp.brake * 38, speed / dt);
			ax -= (this.vf / speed) * b;
			ay -= (this.vl / speed) * b;
		}
		this.vf += ax * dt;
		this.vl += ay * dt;

		// --- Grip: bleed off velocity perpendicular to the nose --------------
		const along = this.vf * hx + this.vl * hy;
		let px = this.vf - along * hx;
		let py = this.vl - along * hy;
		const grip = c.grip + (inp.airL + inp.airR) * 1.6;
		const keep = Math.exp(-grip * dt);
		// Half of the bled-off sideways energy is redirected along the nose, so
		// carving a corner loses less speed than sliding through it.
		const perp2 = px * px + py * py;
		px *= keep;
		py *= keep;
		const recovered = 0.5 * perp2 * (1 - keep * keep);
		const along2 = Math.sign(along || 1) * Math.sqrt(along * along + recovered);
		this.vf = along2 * hx + px;
		this.vl = along2 * hy + py;

		// --- Boost pads -------------------------------------------------------
		if (this.boostTime > 0) this.boostTime -= dt;
		if (this.track.boostAt(this.s, this.x) && this.boostCooldown <= 0) {
			this.boostTime = 1.4;
			this.boostCooldown = 0.6;
			this.boostHit = true;
			const add = 22;
			this.vf += hx * add;
			this.vl += hy * add;
		}
		this.boostCooldown = (this.boostCooldown || 0) - dt;
		const cap = vmax * 1.4;
		const sp = this.speed;
		if (sp > cap) {
			this.vf *= cap / sp;
			this.vl *= cap / sp;
		}

		// --- Integrate in track space ----------------------------------------
		this.track.frameAt(this.s, this.frame);
		const kappa = this.frame.kappa;
		const hw = this.frame.hw;
		// Points left of the centreline travel a shorter arc in a left-hand bend
		const scale = THREE.MathUtils.clamp(1 + kappa * this.x, 0.4, 2.5); // x is right-positive
		const ds = (this.vf * dt) / scale;
		const prevS = this.s;
		this.s = this.track.wrap(this.s + ds);
		this.x -= this.vl * dt;
		// The track frame turned by kappa * ds underneath us: rotate heading and velocity back
		const dTheta = kappa * ds;
		this.psi -= dTheta;
		const cs = Math.cos(-dTheta);
		const sn = Math.sin(-dTheta);
		const vf = this.vf * cs - this.vl * sn;
		this.vl = this.vf * sn + this.vl * cs;
		this.vf = vf;
		this.psi = Math.atan2(Math.sin(this.psi), Math.cos(this.psi));

		// --- Walls -----------------------------------------------------------
		const lim = hw - SHIP_HALF_W;
		if (Math.abs(this.x) > lim) {
			const side = Math.sign(this.x);
			this.x = side * lim;
			// lateral velocity towards the wall (x right-positive, vl left-positive)
			const into = -this.vl * side;
			if (into > 0) {
				this.wallHit = Math.min(1, into / 25);
				this.vl = -this.vl * 0.25;
				// scrub speed proportional to the impact angle
				this.vf *= 1 - Math.min(0.5, into / 60);
				// nudge the nose back towards parallel, but only if it points into
				// the wall (psi > 0 = left, the left wall is side -1)
				if (this.psi * side < 0) this.psi *= 0.6;
				if (this.omega * side < 0) this.omega *= 0.5;
			}
		}

		// --- Laps ------------------------------------------------------------
		const L = this.track.length;
		if (prevS > L * 0.75 && this.s < L * 0.25) {
			this.lap++;
			if (this.lap > 1) this.lapTimes.push(raceTime - this.lapStart);
			this.lapStart = raceTime;
		} else if (prevS < L * 0.25 && this.s > L * 0.75) {
			this.lap--;
		}

		this.wrongWay = Math.cos(this.psi) < -0.2 && this.vf < -5 ? this.wrongWay + dt : 0;

		// --- Visual state ----------------------------------------------------
		const targetBank = THREE.MathUtils.clamp(this.omega * 0.35 + air * 0.15, -0.6, 0.6);
		this.bank += (targetBank - this.bank) * Math.min(1, dt * 5);
		this.bob += dt;
	}

	// Update world position/orientation from track coordinates.
	updatePose(bankScale = 1) {
		const f = this.track.frameAt(this.s, this.frame);
		const hover = this.h + Math.sin(this.bob * 2.3) * 0.04;
		this.position.copy(f.pos).addScaledVector(f.right, this.x).addScaledVector(f.up, hover);
		this.track.quaternionAt(f, this.quaternion);
		_q.setFromEuler(_e.set(0, this.psi, this.bank * bankScale, 'YXZ'));
		this.quaternion.multiply(_q);
	}
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

// Simple separation between crafts in track space
export function collideCrafts(crafts) {
	const L = crafts.length ? crafts[0].track.length : 0;
	for (let i = 0; i < crafts.length; i++) {
		for (let j = i + 1; j < crafts.length; j++) {
			const a = crafts[i];
			const b = crafts[j];
			let ds = b.s - a.s;
			if (ds > L / 2) ds -= L;
			if (ds < -L / 2) ds += L;
			const dx = b.x - a.x;
			if (Math.abs(ds) < SHIP_LEN && Math.abs(dx) < SHIP_HALF_W * 2) {
				const overlapS = SHIP_LEN - Math.abs(ds);
				const overlapX = SHIP_HALF_W * 2 - Math.abs(dx);
				if (overlapX < overlapS) {
					// side by side: push apart sideways, exchange lateral velocity
					const push = (overlapX / 2) * Math.sign(dx || 1);
					a.x -= push;
					b.x += push;
					const t = a.vl;
					a.vl = b.vl * 0.6;
					b.vl = t * 0.6;
					a.wallHit = Math.max(a.wallHit, 0.3);
					b.wallHit = Math.max(b.wallHit, 0.3);
				} else {
					// nose to tail: push apart along the track, rear ship loses speed
					const push = (overlapS / 2) * Math.sign(ds || 1);
					a.s = a.track.wrap(a.s - push);
					b.s = b.track.wrap(b.s + push);
					const rear = ds > 0 ? a : b;
					const front = ds > 0 ? b : a;
					if (rear.vf > front.vf) {
						const avg = (rear.vf + front.vf) / 2;
						rear.vf = avg - 2;
						front.vf = avg + 2;
						rear.wallHit = Math.max(rear.wallHit, 0.4);
						front.wallHit = Math.max(front.wallHit, 0.4);
					}
				}
			}
		}
	}
}

export { HOVER, SHIP_HALF_W, SHIP_LEN };
