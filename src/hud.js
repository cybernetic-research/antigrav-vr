import * as THREE from 'three';
import { CanvasPanel, COLORS, FONT_DISPLAY as FONT, roundRect } from './ui.js';

export function formatTime(t) {
	if (!isFinite(t) || t <= 0) return '--:--.--';
	const m = Math.floor(t / 60);
	const s = t - m * 60;
	return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// Cockpit screens: left = speed / shield / weapon, right = lap / position /
// times, centre = track map plus a close-range radar of nearby ships.
export class CockpitHUD {
	constructor(mounts, path) {
		this.left = screen(mounts.left, 512, 288, 0.25);
		this.right = screen(mounts.right, 512, 288, 0.25);
		this.center = screen(mounts.center, 640, 320, 0.31);
		this.path = path;
		this.last = 0;
		this.mapBg = this._drawMapBackground();
	}

	_drawMapBackground() {
		const c = document.createElement('canvas');
		c.width = 300;
		c.height = 300;
		const ctx = c.getContext('2d');
		const P = this.path.pos;
		let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
		for (let i = 0; i < this.path.count; i++) {
			minX = Math.min(minX, P[i * 3]);
			maxX = Math.max(maxX, P[i * 3]);
			minZ = Math.min(minZ, P[i * 3 + 2]);
			maxZ = Math.max(maxZ, P[i * 3 + 2]);
		}
		const scale = 260 / Math.max(maxX - minX, maxZ - minZ);
		const ox = 150 - ((minX + maxX) / 2) * scale;
		const oz = 150 - ((minZ + maxZ) / 2) * scale;
		this.toMap = (x, z) => [ox + x * scale, oz + z * scale];
		const stroke = (w, col) => {
			ctx.beginPath();
			for (let i = 0; i <= this.path.count; i += 4) {
				const j = i % this.path.count;
				const [x, y] = this.toMap(P[j * 3], P[j * 3 + 2]);
				i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
			}
			ctx.closePath();
			ctx.lineWidth = w;
			ctx.strokeStyle = col;
			ctx.lineJoin = 'round';
			ctx.stroke();
		};
		stroke(12, 'rgba(42,209,255,0.18)');
		stroke(4, 'rgba(200,230,255,0.8)');
		// start line marker
		const [sx, sy] = this.toMap(P[0], P[2]);
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(sx - 5, sy - 5, 10, 10);
		return c;
	}

	// d = {speed, maxSpeed, lap, laps, position, total, lapTime, bestLap, boosting,
	//      energy, weapon, player, crafts, projectiles}
	update(now, d) {
		if (now - this.last < 1 / 15) return;
		this.last = now;
		this._left(d);
		this._right(d);
		this._center(d);
	}

	_left(d) {
		const { ctx, canvas: c } = this.left;
		frame(ctx, c);
		const kmh = Math.round(d.speed * 3.6);
		const frac = Math.min(1, d.speed / (d.maxSpeed * 1.35));
		bar(ctx, 24, 22, 464, 16, frac, ['#2ad1ff', '#ffd21f', '#ff3d3d']);
		text(ctx, `${kmh}`, 24, 92, 84, COLORS.text, 'left', true);
		text(ctx, d.boosting ? 'KM/H  BOOST' : 'KM/H', 28, 146, 22, d.boosting ? '#9ff4ff' : COLORS.dim, 'left');
		text(ctx, 'SHIELD', 300, 70, 22, COLORS.dim, 'left');
		const e = Math.max(0, d.energy) / 100;
		const ecol = e > 0.5 ? '#40ff80' : e > 0.25 ? '#ffd21f' : '#ff3d3d';
		bar(ctx, 300, 88, 188, 22, e, [ecol, ecol]);
		text(ctx, `${Math.ceil(e * 100)}%`, 488, 70, 22, ecol, 'right');
		text(ctx, 'WEAPON', 24, 196, 22, COLORS.dim, 'left');
		if (!d.weapon && d.gun) {
			// built-in gatling: name and heat bar
			const hot = d.gun.overheated;
			text(ctx, hot ? 'OVERHEAT' : 'GATLING', 24, 238, 36, hot ? '#ff4040' : '#ffe08a', 'left', true);
			bar(ctx, 280, 226, 208, 22, d.gun.heat, ['#ffe08a', '#ff9a3d', '#ff3d3d']);
		} else {
			text(ctx, d.weapon ? d.weapon.label : '\u2014', 24, 238, 40, d.weapon ? d.weapon.color : COLORS.dim, 'left', true);
		}
		if (d.weapon && d.weapon.ammo > 1) text(ctx, `x${d.weapon.ammo}`, 488, 238, 36, COLORS.text, 'right', true);
		this.left.texture.needsUpdate = true;
	}

	_right(d) {
		const { ctx, canvas: c } = this.right;
		frame(ctx, c);
		text(ctx, 'LAP', 28, 50, 22, COLORS.dim, 'left');
		text(ctx, `${Math.max(1, Math.min(d.lap, d.laps))}/${d.laps}`, 28, 98, 52, COLORS.accent2, 'left', true);
		text(ctx, 'POS', 270, 50, 22, COLORS.dim, 'left');
		text(ctx, `${d.position}/${d.total}`, 270, 98, 52, COLORS.accent2, 'left', true);
		text(ctx, 'TIME', 28, 170, 22, COLORS.dim, 'left');
		text(ctx, formatTime(d.lapTime), 28, 214, 38, COLORS.text, 'left');
		text(ctx, 'BEST', 270, 170, 22, COLORS.dim, 'left');
		text(ctx, formatTime(d.bestLap), 270, 214, 38, COLORS.text, 'left');
		this.right.texture.needsUpdate = true;
	}

	_center(d) {
		const { ctx, canvas: c } = this.center;
		frame(ctx, c);
		// map
		ctx.drawImage(this.mapBg, 10, 10);
		for (const k of d.crafts) {
			if (k.eliminated) continue;
			const [x, y] = this.toMap(k.position.x, k.position.z);
			ctx.fillStyle = k === d.player ? '#ffffff' : k.colorCss || '#ff8040';
			ctx.beginPath();
			ctx.arc(10 + x, 10 + y, k === d.player ? 9 : 6, 0, Math.PI * 2);
			ctx.fill();
			if (k === d.player) {
				ctx.strokeStyle = '#000';
				ctx.lineWidth = 2;
				ctx.stroke();
			}
		}
		// radar: lane view, ahead is up. 90 m ahead, 40 m behind, +-18 m across
		const rx = 330, rw = 290, ry = 14, rh = 292;
		const cx = rx + rw / 2;
		const py = ry + rh * (90 / 130);
		const ppm = rh / 130;
		ctx.save();
		ctx.beginPath();
		ctx.rect(rx, ry, rw, rh);
		ctx.clip();
		ctx.fillStyle = 'rgba(42,209,255,0.06)';
		ctx.fillRect(rx, ry, rw, rh);
		const P = d.player;
		const path = P.track; // main loop or the side route being flown
		const hw = path.halfWidthAt(P.s);
		const lx = rw / 2 / 18;
		ctx.fillStyle = 'rgba(200,230,255,0.10)';
		ctx.fillRect(cx - (hw + P.x) * lx, ry, hw * 2 * lx, rh);
		ctx.strokeStyle = 'rgba(200,230,255,0.6)';
		ctx.lineWidth = 2;
		for (const e of [-hw, hw]) {
			ctx.beginPath();
			ctx.moveTo(cx + (e - P.x) * lx, ry);
			ctx.lineTo(cx + (e - P.x) * lx, ry + rh);
			ctx.stroke();
		}
		const L = path.length;
		const rel = (s) => {
			let ds = s - P.s;
			if (ds > L / 2) ds -= L;
			if (ds < -L / 2) ds += L;
			return ds;
		};
		for (const p of path === this.path ? d.projectiles || [] : []) {
			const ds = rel(p.s);
			if (ds < -40 || ds > 90) continue;
			ctx.fillStyle = p.color;
			ctx.fillRect(cx + (p.x - P.x) * lx - 4, py - ds * ppm - 4, 8, 8);
		}
		for (const k of d.crafts) {
			if (k.eliminated || k.track !== path) continue;
			const ds = rel(k.s);
			if (ds < -45 || ds > 95) continue;
			const w = 4.2 * lx;
			const h = 6.6 * ppm;
			ctx.fillStyle = k === P ? '#ffffff' : k.colorCss || '#ff8040';
			ctx.fillRect(cx + (k.x - P.x) * lx - w / 2, py - ds * ppm - h / 2, w, h);
		}
		ctx.restore();
		ctx.strokeStyle = 'rgba(42,209,255,0.5)';
		ctx.strokeRect(rx, ry, rw, rh);
		this.center.texture.needsUpdate = true;
	}
}

function screen(parent, w, h, worldW) {
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, (worldW * h) / w), new THREE.MeshBasicMaterial({ map: texture, transparent: true, fog: false, toneMapped: false }));
	parent.add(mesh);
	return { canvas, ctx, texture, mesh };
}

function frame(ctx, c) {
	ctx.clearRect(0, 0, c.width, c.height);
	roundRect(ctx, 3, 3, c.width - 6, c.height - 6, 18);
	ctx.fillStyle = 'rgba(3, 8, 18, 0.96)';
	ctx.fill();
	ctx.strokeStyle = 'rgba(42, 209, 255, 0.55)';
	ctx.lineWidth = 3;
	ctx.stroke();
}

function bar(ctx, x, y, w, h, frac, stops) {
	ctx.fillStyle = 'rgba(255,255,255,0.08)';
	ctx.fillRect(x, y, w, h);
	const g = ctx.createLinearGradient(x, 0, x + w, 0);
	stops.forEach((c, i) => g.addColorStop(i / Math.max(1, stops.length - 1), c));
	ctx.fillStyle = g;
	ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
}

function text(ctx, s, x, y, size, color, align, italic = false) {
	ctx.font = `${italic ? 'italic ' : ''}bold ${size}px ${FONT}`;
	ctx.fillStyle = color;
	ctx.textAlign = align;
	ctx.textBaseline = 'middle';
	ctx.fillText(s, x, y);
}

// Big floating message ("3", "GO!", "FINAL LAP") a few metres ahead of the pilot.
export class Banner {
	constructor(parent) {
		this.panel = new CanvasPanel(1024, 256, 3.2, { overlay: true });
		this.panel.interactive = false;
		this.panel.mesh.position.set(0, 0.35, -4);
		this.panel.mesh.visible = false;
		parent.add(this.panel.mesh);
		this.until = 0;
	}

	show(str, now, duration = 1.2, color = COLORS.accent2) {
		const { ctx } = this.panel;
		const c = this.panel.canvas;
		ctx.clearRect(0, 0, c.width, c.height);
		let size = 150;
		ctx.font = `italic 900 ${size}px ${FONT}`;
		while (size > 50 && ctx.measureText(str).width > c.width - 60) {
			size -= 10;
			ctx.font = `italic 900 ${size}px ${FONT}`;
		}
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.lineWidth = 10;
		ctx.strokeStyle = 'rgba(0,0,0,0.75)';
		ctx.strokeText(str, 512, 134);
		ctx.fillStyle = color;
		ctx.fillText(str, 512, 134);
		this.panel.texture.needsUpdate = true;
		this.panel.mesh.visible = true;
		this.until = now + duration;
		this.start = now;
	}

	update(now) {
		if (!this.panel.mesh.visible) return;
		const left = this.until - now;
		if (left <= 0) {
			this.panel.mesh.visible = false;
			return;
		}
		this.panel.material.opacity = Math.min(1, left / 0.3);
		const age = now - this.start;
		this.panel.mesh.scale.setScalar(1 + Math.max(0, 0.25 - age) * 0.8);
	}
}

