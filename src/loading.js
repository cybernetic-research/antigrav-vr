import * as THREE from 'three';
import { CanvasPanel, COLORS, FONT_DISPLAY, FONT } from './ui.js';

// Late-90s style loading screen: a twisting tunnel of neon wireframe frames
// rushing past, light streaks, your ship flying ahead, and a panel with a
// chrome title, a chunky segmented progress bar, rotating tips and scanlines.
// It changes as loading goes on (by progress, or by time on a slow step):
//   from 50%: frames morph into hexagons/triangles and a vector grid floor and
//             ceiling fade in;  from 80%: warp speed.
// Frames pulse on the beat of the loading music (`bpm` is set by the game).

const TIPS = [
	'Tap an airbrake to tighten your line through fast corners',
	'Blue chevrons boost you. Chain them on the straights',
	'Target tiles give you a weapon. Press A or X to fire',
	'Mines go out behind you. Use them when someone is on your tail',
	'Missiles lock onto the ship ahead of you',
	'Your shield recharges when you keep out of trouble',
	'Scraping the walls costs speed. Hitting them hard costs shield',
	'Hold B on the right controller to pause',
	'Glance down for the track map and the radar'
];
const FRAME_COLORS = [0xff2bd6, 0x2ad1ff, 0xffd21f, 0x40ff80];

export class LoadingScreen {
	constructor() {
		this.group = new THREE.Group();
		this.group.name = 'loading';
		this.progress = 0;
		this.shown = 0;
		this.title = 'LOADING';
		this.detail = '';
		this.tip = 0;
		this.tipAt = 0;
		this.ship = null;

		// tunnel: wireframe frames, each a little more twisted
		this.frames = [];
		const polygon = (n, rot = 0) => {
			const pts = [];
			for (let k = 0; k <= n; k++) {
				const a = rot + (k / n) * Math.PI * 2;
				pts.push(new THREE.Vector3(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0));
			}
			return new THREE.BufferGeometry().setFromPoints(pts);
		};
		this.shapes = { square: polygon(4, Math.PI / 4), hex: polygon(6), tri: polygon(3, Math.PI / 2) };
		const sq = this.shapes.square;
		for (let i = 0; i < 36; i++) {
			const line = new THREE.Line(sq, new THREE.LineBasicMaterial({ color: FRAME_COLORS[i % FRAME_COLORS.length], transparent: true, fog: true }));
			line.scale.setScalar(5.5);
			line.position.z = -i * 4;
			this.group.add(line);
			this.frames.push(line);
		}
		// light streaks: short lines flying past
		const n = 260;
		const pos = new Float32Array(n * 6);
		for (let i = 0; i < n; i++) {
			const a = Math.random() * Math.PI * 2;
			const r = 2.5 + Math.random() * 6;
			const z = -Math.random() * 140;
			pos.set([Math.cos(a) * r, Math.sin(a) * r, z, Math.cos(a) * r, Math.sin(a) * r, z - 2.5 - Math.random() * 3], i * 6);
		}
		const sg = new THREE.BufferGeometry();
		sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		this.streaks = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.7 }));
		this.group.add(this.streaks);

		// floor glow under the ship
		const glow = new THREE.Mesh(new THREE.PlaneGeometry(14, 140), new THREE.MeshBasicMaterial({ color: 0x1a3a7a, transparent: true, opacity: 0.25, depthWrite: false }));
		glow.rotation.x = -Math.PI / 2;
		glow.position.set(0, -2.6, -60);
		this.group.add(glow);

		// vector grid floor and ceiling (fade in from 50%)
		const grid = [];
		for (let x = -10; x <= 10; x += 2) grid.push(x, 0, 4, x, 0, -140);
		for (let z = 4; z >= -140; z -= 4) grid.push(-10, 0, z, 10, 0, z);
		const gridGeo = new THREE.BufferGeometry();
		gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
		this.grids = [-3.2, 3.6].map((y, i) => {
			const g = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: i ? 0xff2bd6 : 0x2ad1ff, transparent: true, opacity: 0 }));
			g.position.y = y;
			this.group.add(g);
			return g;
		});
		this.gridScroll = 0;
		this.bpm = 134;

		this.shipMount = new THREE.Group();
		this.shipMount.position.set(0, -1.9, -8);
		this.group.add(this.shipMount);

		this.panel = new CanvasPanel(1024, 360, 2.3, { overlay: false });
		this.panel.interactive = false;
		this.panel.mesh.position.set(0, 0.55, -2.6);
		this.group.add(this.panel.mesh);
		this.panel.setDraw((ctx, p) => this._draw(ctx, p));
	}

	setShip(model) {
		if (this.ship) this.shipMount.remove(this.ship);
		this.ship = model;
		if (model) {
			model.rotation.y = 0;
			this.shipMount.add(model);
		}
	}

	set(fraction, detail) {
		if (fraction !== undefined) this.progress = Math.max(this.progress, Math.min(1, fraction));
		if (detail !== undefined) this.detail = detail;
	}

	reset(title = 'LOADING') {
		this.title = title;
		this.startedAt = null;
		this.morphed = false;
		for (const f of this.frames) f.geometry = this.shapes.square;
		for (const g of this.grids) g.material.opacity = 0;
		this.detail = '';
		this.progress = 0;
		this.shown = 0;
		this.tip = Math.floor(Math.random() * TIPS.length);
		this.tipAt = 0;
	}

	update(dt, now) {
		this.startedAt ??= now;
		const age = now - this.startedAt;
		// stage 0..2 from progress, or from time if a step is slow
		const stage = this.shown > 0.8 || age > 90 ? 2 : this.shown > 0.5 || age > 45 ? 1 : 0;
		if (stage >= 1 && !this.morphed) {
			this.morphed = true;
			this.frames.forEach((f, i) => (f.geometry = i % 2 ? this.shapes.tri : this.shapes.hex));
		}
		const warp = stage === 2 ? 2.4 : 1;
		this.warpEase = (this.warpEase ?? 1) + (warp - (this.warpEase ?? 1)) * Math.min(1, dt * 1.5);
		const speed = 38 * this.warpEase;
		const twist = stage >= 1 ? 0.06 : 0.02;
		const spin = stage >= 1 ? 0.6 : 0.25;
		// pulse on the beat of the loading music
		const beat = (age * this.bpm) / 60;
		const pulse = 1 + 0.12 * Math.exp(-(beat % 1) * 7);
		for (const [i, f] of this.frames.entries()) {
			f.position.z += speed * dt;
			if (f.position.z > 4) f.position.z -= this.frames.length * 4;
			f.rotation.z = f.position.z * twist + now * spin * (i % 2 ? -1 : 1) * (stage >= 1 ? 1 : 0) + now * 0.25;
			f.scale.setScalar(4.3 * pulse * (stage === 2 ? 1 + 0.15 * Math.sin(f.position.z * 0.08 + now * 3) : 1));
			f.material.opacity = THREE.MathUtils.clamp(1 - -f.position.z / 140, 0, 1);
			if (stage === 2) f.material.color.setHSL((now * 0.2 + i * 0.03) % 1, 1, 0.6);
		}
		const gridTarget = stage >= 1 ? 0.55 : 0;
		this.gridScroll = (this.gridScroll + speed * dt) % 4;
		for (const g of this.grids) {
			g.material.opacity += (gridTarget - g.material.opacity) * Math.min(1, dt * 1.2);
			g.position.z = this.gridScroll;
		}
		const p = this.streaks.geometry.attributes.position;
		for (let i = 0; i < p.count; i += 2) {
			const len = p.getZ(i) - p.getZ(i + 1);
			let z = p.getZ(i) + speed * (stage === 2 ? 3 : 1.8) * dt;
			if (z > 4) z -= 144;
			p.setZ(i, z);
			p.setZ(i + 1, z - len);
		}
		p.needsUpdate = true;
		if (this.ship) {
			const weave = stage === 2 ? 1.8 : stage === 1 ? 1.1 : 0.6;
			this.ship.position.y = Math.sin(now * 2.1) * 0.12;
			this.ship.position.x = Math.sin(now * 0.7 * (stage === 2 ? 1.8 : 1)) * weave;
			this.ship.rotation.z = -Math.cos(now * 0.7 * (stage === 2 ? 1.8 : 1)) * 0.25 * weave;
			const flare = stage === 2 ? 2.1 : 1.3;
			for (const g of this.ship.userData.glows || []) g.scale.setScalar(g.userData.baseScale * (flare + Math.random() * 0.4));
		}
		// ease the shown bar towards the real progress; redraw ~20 fps
		this.shown += (this.progress - this.shown) * Math.min(1, dt * 6);
		if (now - this.tipAt > 4.5) {
			this.tipAt = now;
			this.tip = (this.tip + 1) % TIPS.length;
		}
		if (!this.lastDraw || now - this.lastDraw > 0.05) {
			this.lastDraw = now;
			this.now = now;
			this.panel.redraw();
		}
	}

	_draw(ctx, p) {
		const W = 1024;
		const H = 360;
		ctx.fillStyle = 'rgba(4, 6, 16, 0.82)';
		ctx.fillRect(0, 0, W, H);
		// angular 90s frame
		ctx.strokeStyle = COLORS.accent2;
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.moveTo(24, 8);
		ctx.lineTo(W - 8, 8);
		ctx.lineTo(W - 8, H - 24);
		ctx.lineTo(W - 24, H - 8);
		ctx.lineTo(8, H - 8);
		ctx.lineTo(8, 24);
		ctx.closePath();
		ctx.stroke();
		ctx.fillStyle = COLORS.accent2;
		ctx.fillRect(8, 8, 120, 10);
		ctx.fillRect(W - 128, H - 18, 120, 10);

		// chrome title
		const g = ctx.createLinearGradient(0, 40, 0, 120);
		g.addColorStop(0, '#ffffff');
		g.addColorStop(0.45, '#9fb7d8');
		g.addColorStop(0.5, '#2a3550');
		g.addColorStop(1, '#d8e8ff');
		ctx.font = `900 76px ${FONT_DISPLAY}`;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = g;
		ctx.fillText(this.title, 48, 84, 760);
		ctx.font = `700 26px ${FONT_DISPLAY}`;
		ctx.fillStyle = COLORS.accent;
		ctx.textAlign = 'right';
		ctx.fillText(`${Math.round(this.shown * 100)}%`, W - 48, 84);

		// segmented progress bar
		const segs = 32;
		const bx = 48;
		const bw = W - 96;
		const sw = bw / segs;
		const lit = this.shown * segs;
		for (let i = 0; i < segs; i++) {
			const on = i < lit;
			const flash = on && i === Math.floor(lit) - 1 && Math.floor((this.now || 0) * 8) % 2;
			ctx.fillStyle = on ? (flash ? '#ffffff' : i < segs * 0.7 ? COLORS.accent : COLORS.accent2) : 'rgba(255,255,255,0.08)';
			ctx.fillRect(bx + i * sw + 2, 140, sw - 4, 38);
		}
		ctx.font = `600 24px ${FONT}`;
		ctx.fillStyle = COLORS.text;
		ctx.textAlign = 'left';
		ctx.fillText(this.detail || ' ', 48, 214, bw);
		// tip
		ctx.font = `700 18px ${FONT_DISPLAY}`;
		ctx.fillStyle = COLORS.accent2;
		ctx.fillText('TIP', 48, 280);
		ctx.font = `600 24px ${FONT}`;
		ctx.fillStyle = '#b9c7dd';
		ctx.fillText(TIPS[this.tip], 110, 280, W - 160);
		// scanlines
		ctx.fillStyle = 'rgba(0,0,0,0.18)';
		for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
	}
}
