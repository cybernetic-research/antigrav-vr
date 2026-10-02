import * as THREE from 'three';

// All textures are generated at runtime on canvases so the game ships with no
// binary assets of its own.

function canvas(w, h) {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = true, nearest = false, aniso = 4 } = {}) {
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
	if (nearest) t.magFilter = THREE.NearestFilter;
	t.anisotropy = aniso;
	return t;
}

function noise(ctx, w, h, amount) {
	const img = ctx.getImageData(0, 0, w, h);
	for (let i = 0; i < img.data.length; i += 4) {
		const n = (Math.random() - 0.5) * amount;
		img.data[i] += n;
		img.data[i + 1] += n;
		img.data[i + 2] += n;
	}
	ctx.putImageData(img, 0, 0);
}

// Road: dark panels, seams, centre dashes. u across the track (0..1), v along it.
export function roadTexture(accent = '#2ad1ff') {
	const [c, ctx] = canvas(256, 512);
	ctx.fillStyle = '#23262d';
	ctx.fillRect(0, 0, 256, 512);
	noise(ctx, 256, 512, 18);
	// panel seams
	ctx.strokeStyle = 'rgba(0,0,0,0.55)';
	ctx.lineWidth = 3;
	for (let y = 0; y <= 512; y += 128) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(256, y);
		ctx.stroke();
	}
	for (const x of [64, 192]) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, 512);
		ctx.stroke();
	}
	// centre dashes
	ctx.fillStyle = 'rgba(230,230,230,0.55)';
	for (let y = 16; y < 512; y += 128) ctx.fillRect(125, y, 6, 64);
	// edge bands
	ctx.fillStyle = accent;
	ctx.fillRect(0, 0, 7, 512);
	ctx.fillRect(249, 0, 7, 512);
	ctx.fillStyle = '#f2f2f2';
	for (let y = 0; y < 512; y += 64) {
		ctx.fillRect(9, y, 6, 32);
		ctx.fillRect(241, y + 32, 6, 32);
	}
	return toTexture(c);
}

// Wall panels with a glowing stripe; v across wall height, u along track
export function wallTexture(stripe = '#ff3d7f') {
	const [c, ctx] = canvas(512, 128);
	const g = ctx.createLinearGradient(0, 0, 0, 128);
	g.addColorStop(0, '#5b6270');
	g.addColorStop(1, '#2a2e36');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 512, 128);
	noise(ctx, 512, 128, 14);
	ctx.fillStyle = 'rgba(0,0,0,0.5)';
	for (let x = 0; x < 512; x += 128) ctx.fillRect(x, 0, 3, 128);
	ctx.fillStyle = stripe;
	ctx.fillRect(0, 18, 512, 10);
	ctx.fillStyle = 'rgba(255,255,255,0.8)';
	ctx.fillRect(0, 21, 512, 3);
	// hazard chevrons along the bottom
	ctx.fillStyle = '#ffd400';
	for (let x = 0; x < 512; x += 32) {
		ctx.beginPath();
		ctx.moveTo(x, 128);
		ctx.lineTo(x + 16, 104);
		ctx.lineTo(x + 28, 104);
		ctx.lineTo(x + 12, 128);
		ctx.fill();
	}
	return toTexture(c);
}

export function boostTexture() {
	const [c, ctx] = canvas(128, 256);
	ctx.fillStyle = '#0a2a6a';
	ctx.fillRect(0, 0, 128, 256);
	for (let i = 0; i < 3; i++) {
		const y = 20 + i * 80;
		const g = ctx.createLinearGradient(0, y, 0, y + 60);
		g.addColorStop(0, '#9ff4ff');
		g.addColorStop(1, '#1a6cff');
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.moveTo(8, y + 60);
		ctx.lineTo(64, y);
		ctx.lineTo(120, y + 60);
		ctx.lineTo(96, y + 60);
		ctx.lineTo(64, y + 26);
		ctx.lineTo(32, y + 60);
		ctx.closePath();
		ctx.fill();
	}
	ctx.strokeStyle = '#7fe8ff';
	ctx.lineWidth = 6;
	ctx.strokeRect(3, 3, 122, 250);
	return toTexture(c, { repeat: false });
}

export function checkerTexture() {
	const [c, ctx] = canvas(256, 64);
	for (let x = 0; x < 16; x++) {
		for (let y = 0; y < 4; y++) {
			ctx.fillStyle = (x + y) % 2 ? '#111' : '#eee';
			ctx.fillRect(x * 16, y * 16, 16, 16);
		}
	}
	return toTexture(c, { nearest: true });
}

export function gridTexture(line = '#1f6fff', bg = '#05070d') {
	const [c, ctx] = canvas(256, 256);
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, 256, 256);
	ctx.strokeStyle = line;
	ctx.globalAlpha = 0.35;
	ctx.lineWidth = 2;
	for (let i = 0; i <= 256; i += 32) {
		ctx.beginPath();
		ctx.moveTo(i, 0);
		ctx.lineTo(i, 256);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(0, i);
		ctx.lineTo(256, i);
		ctx.stroke();
	}
	ctx.globalAlpha = 0.9;
	ctx.lineWidth = 3;
	ctx.strokeRect(0, 0, 256, 256);
	return toTexture(c);
}

export function terrainTexture(a = '#3b2f2a', b = '#5a4636') {
	const [c, ctx] = canvas(256, 256);
	ctx.fillStyle = a;
	ctx.fillRect(0, 0, 256, 256);
	for (let i = 0; i < 400; i++) {
		ctx.fillStyle = Math.random() < 0.5 ? b : a;
		ctx.globalAlpha = 0.25;
		const r = 4 + Math.random() * 24;
		ctx.beginPath();
		ctx.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.globalAlpha = 1;
	noise(ctx, 256, 256, 20);
	return toTexture(c);
}

export function windowsTexture() {
	const [c, ctx] = canvas(128, 256);
	ctx.fillStyle = '#0b0e16';
	ctx.fillRect(0, 0, 128, 256);
	for (let y = 4; y < 256; y += 8) {
		for (let x = 4; x < 128; x += 8) {
			const r = Math.random();
			if (r < 0.35) {
				ctx.fillStyle = r < 0.05 ? '#ff9a3d' : r < 0.2 ? '#8fd8ff' : '#ffe9a8';
				ctx.globalAlpha = 0.5 + Math.random() * 0.5;
				ctx.fillRect(x, y, 5, 4);
			}
		}
	}
	ctx.globalAlpha = 1;
	return toTexture(c);
}

// Livery for the procedural ships: base colour with a contrasting stripe
export function liveryTexture(base, stripe, number = '') {
	const [c, ctx] = canvas(256, 256);
	ctx.fillStyle = base;
	ctx.fillRect(0, 0, 256, 256);
	ctx.fillStyle = stripe;
	ctx.fillRect(0, 100, 256, 22);
	ctx.fillRect(0, 130, 256, 6);
	if (number) {
		ctx.fillStyle = '#ffffff';
		ctx.font = 'bold 72px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(number, 128, 220);
	}
	noise(ctx, 256, 256, 10);
	return toTexture(c, { repeat: false });
}
