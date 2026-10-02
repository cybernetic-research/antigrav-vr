import * as THREE from 'three';
import { newFrame } from './track.js';

// Weapons picked up from pads on the track, fired by the player or the AI.
// Projectiles live in track coordinates (s along, x across) like the ships,
// so they follow the track through bends and hit-testing is cheap.

export const WEAPONS = {
	rockets: { id: 'rockets', label: 'ROCKETS', color: '#ff9a3d', ammo: 1 },
	missile: { id: 'missile', label: 'MISSILE', color: '#ff4d6d', ammo: 1 },
	mines: { id: 'mines', label: 'MINES', color: '#ffd21f', ammo: 1 },
	autopilot: { id: 'autopilot', label: 'AUTOPILOT', color: '#40ff80', ammo: 1 }
};
const PICK = [
	['rockets', 0.32],
	['missile', 0.26],
	['mines', 0.24],
	['autopilot', 0.18]
];
const DAMAGE = { rocket: 9, missile: 24, mine: 14 }; // per projectile kind
export const AUTOPILOT_TIME = 6;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class WeaponSystem {
	// events: {pickup(craft, w), fired(craft, w, target), hit(target, by, kind), eliminated(target, by), autopilot(craft, on)}
	constructor(path, group, crafts, events) {
		this.path = path;
		this.group = group;
		this.crafts = crafts;
		this.events = events;
		this.projectiles = [];
		this.fx = [];
		this.frame = newFrame();
		this._makeAssets();
	}

	_makeAssets() {
		const glow = (color) => {
			const c = document.createElement('canvas');
			c.width = c.height = 64;
			const ctx = c.getContext('2d');
			const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
			g.addColorStop(0, 'rgba(255,255,255,1)');
			g.addColorStop(0.3, color);
			g.addColorStop(1, 'rgba(0,0,0,0)');
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, 64, 64);
			const t = new THREE.CanvasTexture(c);
			t.colorSpace = THREE.SRGBColorSpace;
			return new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
		};
		this.mats = {
			rocket: glow('rgba(255,150,60,0.9)'),
			missile: glow('rgba(255,70,100,0.9)'),
			mine: glow('rgba(255,210,30,0.9)'),
			blast: glow('rgba(255,120,30,0.85)')
		};
		this.bodyGeo = {
			rocket: new THREE.CylinderGeometry(0.09, 0.12, 0.9, 8).rotateX(Math.PI / 2),
			missile: new THREE.CylinderGeometry(0.14, 0.18, 1.4, 8).rotateX(Math.PI / 2),
			mine: new THREE.IcosahedronGeometry(0.45, 0)
		};
		this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.8, roughness: 0.3 });
		this.mineMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.4, emissive: 0x332200 });
	}

	// --- Pickups -------------------------------------------------------------------
	tryPickup(craft, now) {
		if (craft.weapon || craft.eliminated || !this.path.weaponAt(craft.s, craft.x)) return;
		if (craft.padCooldown > now) return;
		craft.padCooldown = now + 0.8;
		let id;
		do id = roll();
		while (id === 'autopilot' && !craft.isPlayer); // AI pilots don't need it
		craft.weapon = { ...WEAPONS[id] };
		this.events.pickup?.(craft, craft.weapon);
	}

	// --- Firing --------------------------------------------------------------------
	fire(craft) {
		const w = craft.weapon;
		if (!w || craft.eliminated) return;
		craft.weapon = null;
		const fwd = Math.cos(craft.psi);
		const side = -Math.sin(craft.psi); // lateral (right) component of the nose
		if (w.id === 'rockets') {
			for (const off of [-1.3, 0, 1.3]) {
				const v = Math.max(craft.vf, 0) + 95;
				this._spawn('rocket', craft, craft.s + 4, craft.x + off, v * fwd, v * side, 3.0);
			}
		} else if (w.id === 'missile') {
			const target = this._targetAhead(craft, 450);
			const v = Math.max(craft.vf, 0) + 60;
			const p = this._spawn('missile', craft, craft.s + 4, craft.x, v * fwd, v * side, 7.0);
			p.target = target;
			this.events.fired?.(craft, w, target);
			return;
		} else if (w.id === 'mines') {
			for (let i = 0; i < 3; i++) this._spawn('mine', craft, craft.s - 7 - i * 5, craft.x + (i - 1) * 1.6, 0, 0, 40);
		} else if (w.id === 'autopilot') {
			craft.autopilotTime = AUTOPILOT_TIME;
			this.events.autopilot?.(craft, true);
		}
		this.events.fired?.(craft, w, null);
	}

	_targetAhead(craft, range) {
		const L = this.path.length;
		let best = null;
		let bestD = range;
		for (const c of this.crafts) {
			if (c === craft || c.eliminated) continue;
			let ds = c.s - craft.s;
			if (ds < 0) ds += L;
			if (ds > 2 && ds < bestD) {
				bestD = ds;
				best = c;
			}
		}
		return best;
	}

	_spawn(kind, owner, s, x, vs, vx, life) {
		const mesh = new THREE.Group();
		const body = new THREE.Mesh(this.bodyGeo[kind], kind === 'mine' ? this.mineMat : this.bodyMat);
		mesh.add(body);
		const g = new THREE.Sprite(this.mats[kind]);
		g.scale.setScalar(kind === 'mine' ? 1.6 : kind === 'missile' ? 2.4 : 1.6);
		if (kind !== 'mine') g.position.z = 0.7;
		mesh.add(g);
		this.group.add(mesh);
		const p = { kind, owner, s: this.path.wrap(s), x, vs, vx, h: kind === 'mine' ? 0.5 : 1.0, life, age: 0, mesh, glow: g, color: kind === 'mine' ? '#ffd21f' : kind === 'missile' ? '#ff4d6d' : '#ff9a3d' };
		this.projectiles.push(p);
		return p;
	}

	// --- Simulation ------------------------------------------------------------------
	step(dt, now) {
		const L = this.path.length;
		for (let i = this.projectiles.length - 1; i >= 0; i--) {
			const p = this.projectiles[i];
			p.age += dt;
			if (p.kind === 'missile' && p.target && !p.target.eliminated) {
				// home in: match the target's lane and close in along the track
				const want = (p.target.x - p.x) * 2.5;
				p.vx += THREE.MathUtils.clamp(want - p.vx, -60 * dt, 60 * dt);
				p.vs = Math.max(p.vs, p.target.vf + 45);
			}
			p.s = this.path.wrap(p.s + p.vs * dt);
			p.x += p.vx * dt;
			let dead = p.age > p.life;
			if (p.kind !== 'mine' && Math.abs(p.x) > this.path.halfWidthAt(p.s) + 0.5) {
				dead = true;
				this._blast(p.s, p.x, 0.8);
			}
			if (!dead) {
				for (const c of this.crafts) {
					if (c.eliminated) continue;
					if (c === p.owner && (p.kind !== 'mine' || p.age < 1.5)) continue;
					let ds = c.s - p.s;
					if (ds > L / 2) ds -= L;
					if (ds < -L / 2) ds += L;
					if (Math.abs(ds) < 3.6 && Math.abs(c.x - p.x) < 2.3) {
						this._hit(c, p, now);
						dead = true;
						break;
					}
				}
			}
			if (dead) {
				this.group.remove(p.mesh);
				this.projectiles.splice(i, 1);
			}
		}
		// effects
		for (let i = this.fx.length - 1; i >= 0; i--) {
			const f = this.fx[i];
			f.age += dt;
			const k = f.age / f.dur;
			f.sprite.scale.setScalar(f.size * (0.4 + k * 1.6));
			f.sprite.material.opacity = Math.max(0, 1 - k);
			if (k >= 1) {
				this.group.remove(f.sprite);
				f.sprite.material.dispose();
				this.fx.splice(i, 1);
			}
		}
	}

	_hit(c, p, now) {
		const dmg = DAMAGE[p.kind];
		c.energy -= dmg;
		c.vf *= p.kind === 'missile' ? 0.35 : 0.5;
		c.vl += (Math.random() - 0.5) * 14;
		c.omega += (Math.random() < 0.5 ? -1 : 1) * (p.kind === 'missile' ? 4 : 2.5);
		c.hitShake = 1;
		c.lastHit = now;
		this._blast(c.s, c.x, p.kind === 'missile' ? 2.2 : 1.4);
		this.events.hit?.(c, p.owner, p.kind);
		if (c.energy <= 0 && !c.eliminated) this.eliminate(c, p.owner);
	}

	eliminate(c, by) {
		c.eliminated = true;
		c.energy = 0;
		c.vf = c.vl = 0;
		this._blast(c.s, c.x, 4);
		this._blast(c.s + 2, c.x + 1, 3);
		this.events.eliminated?.(c, by);
	}

	_blast(s, x, size) {
		const sprite = new THREE.Sprite(this.mats.blast.clone());
		this.path.toWorld(s, x, 1.2, sprite.position, this.frame);
		sprite.scale.setScalar(size);
		this.group.add(sprite);
		this.fx.push({ sprite, age: 0, dur: 0.6 + size * 0.1, size: size * 3 });
	}

	// Update projectile meshes (call once per rendered frame)
	updateVisuals(now) {
		for (const p of this.projectiles) {
			this.path.frameAt(p.s, this.frame);
			p.mesh.position.copy(this.frame.pos).addScaledVector(this.frame.right, p.x).addScaledVector(this.frame.up, p.h + (p.kind === 'mine' ? Math.sin(now * 3 + p.s) * 0.1 : 0));
			this.path.quaternionAt(this.frame, p.mesh.quaternion);
			if (p.kind !== 'mine') {
				_q.setFromAxisAngle(_v.set(0, 1, 0), Math.atan2(-p.vx, p.vs));
				p.mesh.quaternion.multiply(_q);
			} else {
				p.mesh.rotation.y += 0.02;
				p.glow.visible = Math.floor(now * 3) % 2 === 0;
			}
		}
	}

	dispose() {
		for (const p of this.projectiles) this.group.remove(p.mesh);
		for (const f of this.fx) this.group.remove(f.sprite);
		this.projectiles = [];
		this.fx = [];
	}
}

function roll() {
	let r = Math.random();
	for (const [id, w] of PICK) {
		if ((r -= w) <= 0) return id;
	}
	return 'rockets';
}

// AI weapon use: call each physics step for AI crafts holding a weapon
export function aiUseWeapon(craft, crafts, weapons, now) {
	const w = craft.weapon;
	if (!w || craft.eliminated || now < 8) return; // no weapons in the opening scramble
	if (!craft.aiFireAt) craft.aiFireAt = now + 0.5 + Math.random() * 2;
	if (now < craft.aiFireAt) return;
	const L = craft.track.length;
	let ahead = null;
	let behind = null;
	for (const c of crafts) {
		if (c === craft || c.eliminated) continue;
		let ds = c.s - craft.s;
		if (ds > L / 2) ds -= L;
		if (ds < -L / 2) ds += L;
		if (ds > 0 && ds < (w.id === 'missile' ? 300 : 110) && (w.id === 'missile' || Math.abs(c.x - craft.x) < 3.5)) ahead = c;
		if (ds < 0 && ds > -70 && Math.abs(c.x - craft.x) < 4) behind = c;
	}
	const go = (w.id === 'mines' && behind) || ((w.id === 'rockets' || w.id === 'missile') && ahead) || now - craft.aiFireAt > 15;
	if (go) {
		craft.aiFireAt = 0;
		weapons.fire(craft);
	}
}
