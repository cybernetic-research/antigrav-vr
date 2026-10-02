import * as THREE from 'three';

// A closed racing line resampled at a fixed step. Everything that moves on the
// track (player physics, AI, camera) works in track coordinates:
//   s = distance along the centreline (metres, wraps at `length`)
//   x = lateral offset from the centreline, positive = right (metres)
//   h = height above the road surface (metres)
// Each sample stores a full orthonormal frame plus half width and the signed
// yaw curvature (rad/m, positive = track turns left).

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class TrackPath {
	// points: Vector3[] control points (closed loop, do not repeat the first)
	// ups:    Vector3[] per-point up vectors, or null for automatic banking
	// halfWidths: number[] per point, or a single number
	// closed: a lap; open (closed = false): a side route with a start and an end
	constructor({ points, ups = null, halfWidths = 12, step = 1.0, autoBank = 0, kappaSmooth = 12, closed = true }) {
		this.closed = closed;
		const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
		curve.arcLengthDivisions = Math.max(2000, points.length * 40);
		this.curve = curve;
		this.length = curve.getLength();
		const n = Math.max(16, Math.round(this.length / step));
		this.count = n;
		this.step = this.length / n;

		this.pos = new Float32Array(n * 3);
		this.fwd = new Float32Array(n * 3);
		this.up = new Float32Array(n * 3);
		this.right = new Float32Array(n * 3);
		this.hw = new Float32Array(n);
		this.kappa = new Float32Array(n);
		this.boosts = []; // {s0, s1, x0, x1}
		this.weaponPads = []; // same shape

		const np = points.length;
		const p = new THREE.Vector3();
		const t = new THREE.Vector3();
		const u = new THREE.Vector3();
		const r = new THREE.Vector3();
		const worldUp = new THREE.Vector3(0, 1, 0);

		for (let i = 0; i < n; i++) {
			const uu = i / n;
			curve.getPointAt(uu, p);
			curve.getTangentAt(uu, t).normalize();
			// Map arc-length parameter back to control-point index for per-point data
			const ct = curve.getUtoTmapping(uu) * (closed ? np : np - 1);
			const i0 = Math.min(Math.floor(ct) % np, np - 1);
			const i1 = closed ? (i0 + 1) % np : Math.min(i0 + 1, np - 1);
			const a = ct - Math.floor(ct);

			if (ups) {
				u.copy(ups[i0]).lerp(ups[i1], a);
			} else {
				u.copy(worldUp);
			}
			const w = Array.isArray(halfWidths) ? halfWidths[i0] * (1 - a) + halfWidths[i1] * a : halfWidths;

			r.crossVectors(t, u).normalize();
			u.crossVectors(r, t).normalize();
			this._set(i, p, t, u, r, w);
		}

		this._computeKappa(kappaSmooth);

		if (autoBank) {
			// Bank into corners: tilt the up vector towards the inside of the turn.
			for (let i = 0; i < n; i++) {
				const bank = THREE.MathUtils.clamp(this.kappa[i] * autoBank, -0.55, 0.55);
				t.fromArray(this.fwd, i * 3);
				u.fromArray(this.up, i * 3);
				u.applyAxisAngle(t, -bank); // rotating about forward by -bank tilts up to the left for bank>0
				r.crossVectors(t, u).normalize();
				u.crossVectors(r, t).normalize();
				u.toArray(this.up, i * 3);
				r.toArray(this.right, i * 3);
			}
			this._computeKappa(kappaSmooth);
		}
	}

	_set(i, p, t, u, r, w) {
		p.toArray(this.pos, i * 3);
		t.toArray(this.fwd, i * 3);
		u.toArray(this.up, i * 3);
		r.toArray(this.right, i * 3);
		this.hw[i] = w;
	}

	_computeKappa(smooth) {
		const n = this.count;
		const raw = new Float32Array(n);
		const t0 = new THREE.Vector3();
		const t1 = new THREE.Vector3();
		const u = new THREE.Vector3();
		for (let i = 0; i < n; i++) {
			t0.fromArray(this.fwd, i * 3);
			t1.fromArray(this.fwd, ((i + 1) % n) * 3);
			u.fromArray(this.up, i * 3);
			raw[i] = _v.crossVectors(t0, t1).dot(u) / this.step;
		}
		// Box filter over +-smooth metres so noisy source data gives a stable curvature
		const k = Math.max(0, Math.round(smooth / this.step));
		let acc = 0;
		for (let j = -k; j <= k; j++) acc += raw[(j + n) % n];
		for (let i = 0; i < n; i++) {
			this.kappa[i] = acc / (2 * k + 1);
			acc += raw[(i + k + 1) % n] - raw[(i - k + n) % n];
		}
	}

	wrap(s) {
		const L = this.length;
		if (!this.closed) return Math.max(0, Math.min(L - 1e-3, s));
		return ((s % L) + L) % L;
	}

	// Fills `out` = {pos, fwd, up, right: Vector3, hw, kappa} for distance s.
	frameAt(s, out) {
		s = this.wrap(s);
		const f = s / this.step;
		const i0 = Math.floor(f) % this.count;
		const i1 = this.closed ? (i0 + 1) % this.count : Math.min(i0 + 1, this.count - 1);
		const a = f - Math.floor(f);
		lerp3(this.pos, i0, i1, a, out.pos);
		lerp3(this.fwd, i0, i1, a, out.fwd).normalize();
		lerp3(this.up, i0, i1, a, out.up);
		out.right.crossVectors(out.fwd, out.up).normalize();
		out.up.crossVectors(out.right, out.fwd).normalize();
		out.hw = this.hw[i0] * (1 - a) + this.hw[i1] * a;
		out.kappa = this.kappa[i0] * (1 - a) + this.kappa[i1] * a;
		return out;
	}

	kappaAt(s) {
		const f = this.wrap(s) / this.step;
		const i0 = Math.floor(f) % this.count;
		const i1 = (i0 + 1) % this.count;
		const a = f - Math.floor(f);
		return this.kappa[i0] * (1 - a) + this.kappa[i1] * a;
	}

	halfWidthAt(s) {
		const f = this.wrap(s) / this.step;
		const i0 = Math.floor(f) % this.count;
		return this.hw[i0];
	}

	// World position of track coordinate (s, x, h)
	toWorld(s, x, h, out, frame = newFrame()) {
		this.frameAt(s, frame);
		return out.copy(frame.pos).addScaledVector(frame.right, x).addScaledVector(frame.up, h);
	}

	// Quaternion of the track frame at s (object -Z = forward, +Y = up)
	quaternionAt(frame, out) {
		_v.copy(frame.fwd).negate();
		_m.makeBasis(frame.right, frame.up, _v);
		return out.setFromRotationMatrix(_m);
	}

	boostAt(s, x) {
		return inZone(this.boosts, this.wrap(s), x);
	}

	weaponAt(s, x) {
		return inZone(this.weaponPads, this.wrap(s), x);
	}

	// Long, gentle stretches of track: [{s0, s1}] where |curvature| stays low
	straights(maxKappa = 0.006, minLen = 110) {
		const out = [];
		let start = -1;
		for (let i = 0; i <= this.count; i++) {
			const ok = i < this.count && Math.abs(this.kappa[i]) < maxKappa;
			if (ok && start < 0) start = i;
			if (!ok && start >= 0) {
				if ((i - start) * this.step >= minLen) out.push({ s0: start * this.step, s1: i * this.step });
				start = -1;
			}
		}
		return out;
	}
}

function inZone(zones, s, x) {
	for (const b of zones) {
		if (s >= b.s0 && s <= b.s1 && x >= b.x0 && x <= b.x1) return true;
	}
	return false;
}

export function newFrame() {
	return {
		pos: new THREE.Vector3(),
		fwd: new THREE.Vector3(),
		up: new THREE.Vector3(),
		right: new THREE.Vector3(),
		hw: 0,
		kappa: 0
	};
}

function lerp3(arr, i0, i1, a, out) {
	const b = 1 - a;
	out.set(
		arr[i0 * 3] * b + arr[i1 * 3] * a,
		arr[i0 * 3 + 1] * b + arr[i1 * 3 + 1] * a,
		arr[i0 * 3 + 2] * b + arr[i1 * 3 + 2] * a
	);
	return out;
}
