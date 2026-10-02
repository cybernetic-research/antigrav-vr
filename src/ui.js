import * as THREE from 'three';

export const FONT = '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
export const COLORS = {
	text: '#e8f1ff',
	dim: '#8aa0bf',
	accent: '#2ad1ff',
	accent2: '#ffd21f',
	panel: 'rgba(8, 14, 30, 0.86)',
	button: 'rgba(30, 60, 110, 0.9)',
	buttonHover: 'rgba(42, 209, 255, 0.95)'
};

// A flat panel in the world whose content is drawn on a canvas. Buttons are
// registered while drawing and hit-tested through the panel's UV coordinates.
export class CanvasPanel {
	constructor(pxW, pxH, worldW, { overlay = false } = {}) {
		this.canvas = document.createElement('canvas');
		this.canvas.width = pxW;
		this.canvas.height = pxH;
		this.ctx = this.canvas.getContext('2d');
		this.texture = new THREE.CanvasTexture(this.canvas);
		this.texture.colorSpace = THREE.SRGBColorSpace;
		this.texture.anisotropy = 4;
		const worldH = (worldW * pxH) / pxW;
		this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, fog: false, depthTest: !overlay, depthWrite: !overlay });
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), this.material);
		if (overlay) this.mesh.renderOrder = 1000;
		this.mesh.userData.panel = this;
		this.buttons = [];
		this.hover = null;
		this.drawFn = null;
		this.interactive = true;
	}

	setDraw(fn) {
		this.drawFn = fn;
		this.redraw();
	}

	redraw() {
		if (!this.drawFn) return;
		this.buttons = [];
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.drawFn(this.ctx, this);
		this.texture.needsUpdate = true;
	}

	setHover(id) {
		if (id !== this.hover) {
			this.hover = id;
			this.redraw();
		}
	}

	hitTest(uv) {
		const x = uv.x * this.canvas.width;
		const y = (1 - uv.y) * this.canvas.height;
		for (const b of this.buttons) {
			if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
		}
		return null;
	}

	// Drawing helpers -----------------------------------------------------------
	background(radius = 28, fill = COLORS.panel) {
		const { ctx } = this;
		roundRect(ctx, 4, 4, this.canvas.width - 8, this.canvas.height - 8, radius);
		ctx.fillStyle = fill;
		ctx.fill();
		ctx.lineWidth = 4;
		ctx.strokeStyle = 'rgba(42, 209, 255, 0.55)';
		ctx.stroke();
	}

	text(str, x, y, { size = 40, color = COLORS.text, align = 'left', weight = 'bold', italic = false, baseline = 'middle' } = {}) {
		const { ctx } = this;
		ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;
		ctx.fillStyle = color;
		ctx.textAlign = align;
		ctx.textBaseline = baseline;
		ctx.fillText(str, x, y);
	}

	button(id, x, y, w, h, label, { size = 40, primary = false } = {}) {
		const { ctx } = this;
		const hover = this.hover === id;
		roundRect(ctx, x, y, w, h, Math.min(18, h / 2));
		ctx.fillStyle = hover ? COLORS.buttonHover : primary ? 'rgba(255, 210, 31, 0.9)' : COLORS.button;
		ctx.fill();
		ctx.lineWidth = 3;
		ctx.strokeStyle = hover ? '#ffffff' : 'rgba(255,255,255,0.25)';
		ctx.stroke();
		this.text(label, x + w / 2, y + h / 2 + 2, { size, align: 'center', color: hover || primary ? '#06101e' : COLORS.text });
		this.buttons.push({ id, x, y, w, h });
	}
}

export function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

// Laser pointers (XR controllers) and the mouse, hit-testing CanvasPanels.
export class Pointers {
	constructor(renderer, camera, onClick) {
		this.renderer = renderer;
		this.camera = camera;
		this.onClick = onClick;
		this.panels = [];
		this.raycaster = new THREE.Raycaster();
		this.mouse = new THREE.Vector2();
		this.mouseActive = false;
		this.visible = true;
		this.controllers = [];

		const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
		for (let i = 0; i < 2; i++) {
			const c = renderer.xr.getController(i);
			const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x2ad1ff, transparent: true, opacity: 0.8, depthTest: false }));
			line.renderOrder = 1001;
			line.scale.z = 5;
			c.add(line);
			const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
			dot.renderOrder = 1002;
			dot.visible = false;
			c.userData = { line, dot, hit: null };
			c.add(dot);
			c.addEventListener('select', () => this._click(c.userData.hit));
			c.addEventListener('connected', (e) => {
				c.userData.connected = e.data && e.data.targetRayMode === 'tracked-pointer';
			});
			c.addEventListener('disconnected', () => (c.userData.connected = false));
			this.controllers.push(c);
		}

		const canvas = renderer.domElement;
		canvas.addEventListener('pointermove', (e) => {
			const r = canvas.getBoundingClientRect();
			this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
			this.mouseActive = true;
		});
		canvas.addEventListener('click', () => {
			if (!renderer.xr.isPresenting) this._click(this.mouseHit);
		});
	}

	// Controllers must live under the same parent as the camera so rays line up
	attachTo(parent) {
		for (const c of this.controllers) parent.add(c);
	}

	setPanels(panels) {
		for (const p of this.panels) p.setHover(null);
		this.panels = panels.filter(Boolean);
	}

	_click(hit) {
		if (hit && hit.id) this.onClick(hit.panel, hit.id);
	}

	_cast(origin, dir) {
		this.raycaster.set(origin, dir);
		const meshes = this.panels.filter((p) => p.mesh.visible && p.interactive).map((p) => p.mesh);
		const hits = this.raycaster.intersectObjects(meshes, false);
		if (!hits.length) return null;
		const h = hits[0];
		const panel = h.object.userData.panel;
		return { panel, id: panel.hitTest(h.uv), point: h.point, distance: h.distance };
	}

	update() {
		const hovered = new Map();
		const xr = this.renderer.xr.isPresenting;
		const active = this.panels.length > 0;
		const o = new THREE.Vector3();
		const d = new THREE.Vector3();
		const q = new THREE.Quaternion();

		for (const c of this.controllers) {
			const ud = c.userData;
			const show = xr && active && ud.connected;
			ud.line.visible = show;
			ud.dot.visible = false;
			ud.hit = null;
			if (!show) continue;
			c.getWorldPosition(o);
			c.getWorldQuaternion(q);
			d.set(0, 0, -1).applyQuaternion(q);
			const hit = this._cast(o, d);
			ud.hit = hit;
			if (hit) {
				const scale = c.getWorldScale(new THREE.Vector3()).z;
				ud.line.scale.z = hit.distance / scale;
				ud.dot.visible = true;
				ud.dot.position.set(0, 0, -hit.distance / scale);
				if (hit.id) hovered.set(hit.panel, hit.id);
			} else {
				ud.line.scale.z = 5;
			}
		}

		this.mouseHit = null;
		if (!xr && active && this.mouseActive) {
			this.raycaster.setFromCamera(this.mouse, this.camera);
			const hit = this._cast(this.raycaster.ray.origin, this.raycaster.ray.direction);
			this.mouseHit = hit;
			if (hit && hit.id) hovered.set(hit.panel, hit.id);
			this.renderer.domElement.style.cursor = hit && hit.id ? 'pointer' : 'default';
		}

		for (const p of this.panels) p.setHover(hovered.get(p) || null);
	}
}
