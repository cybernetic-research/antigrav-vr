import { CanvasPanel, COLORS, FONT, roundRect } from './ui.js';

export function formatTime(t) {
	if (!isFinite(t) || t <= 0) return '--:--.--';
	const m = Math.floor(t / 60);
	const s = t - m * 60;
	return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// Screen on the dashboard: speed, lap, position, times.
export class DashHUD {
	constructor(mount) {
		this.panel = new CanvasPanel(512, 256, 0.42);
		this.panel.interactive = false;
		this.panel.material.depthTest = true;
		mount.add(this.panel.mesh);
		this.last = 0;
		this.data = null;
	}

	update(now, data) {
		if (now - this.last < 1 / 15) return;
		this.last = now;
		const { ctx } = this.panel;
		const c = this.panel.canvas;
		ctx.clearRect(0, 0, c.width, c.height);
		roundRect(ctx, 4, 4, c.width - 8, c.height - 8, 20);
		ctx.fillStyle = 'rgba(4, 10, 22, 0.94)';
		ctx.fill();
		ctx.strokeStyle = 'rgba(42, 209, 255, 0.6)';
		ctx.lineWidth = 3;
		ctx.stroke();

		const kmh = Math.round(data.speed * 3.6);
		// speed bar across the top
		const frac = Math.min(1, data.speed / (data.maxSpeed * 1.35));
		const barW = 464;
		ctx.fillStyle = 'rgba(255,255,255,0.08)';
		ctx.fillRect(24, 20, barW, 18);
		const grad = ctx.createLinearGradient(24, 0, 24 + barW, 0);
		grad.addColorStop(0, '#2ad1ff');
		grad.addColorStop(0.75, '#ffd21f');
		grad.addColorStop(1, '#ff3d3d');
		ctx.fillStyle = grad;
		ctx.fillRect(24, 20, barW * frac, 18);

		// left: speed
		text(ctx, `${kmh}`, 24, 100, 96, COLORS.text, 'left', true);
		text(ctx, data.boosting ? 'KM/H  BOOST' : 'KM/H', 28, 158, 24, data.boosting ? '#9ff4ff' : COLORS.dim, 'left');

		// right: lap and position
		text(ctx, 'LAP', 340, 62, 22, COLORS.dim, 'left');
		text(ctx, `${Math.max(1, Math.min(data.lap, data.laps))}/${data.laps}`, 410, 62, 38, COLORS.accent2, 'left', true);
		text(ctx, 'POS', 340, 118, 22, COLORS.dim, 'left');
		text(ctx, `${data.position}/${data.total}`, 410, 118, 38, COLORS.accent2, 'left', true);

		// bottom: times
		text(ctx, 'TIME', 24, 196, 22, COLORS.dim, 'left');
		text(ctx, formatTime(data.lapTime), 24, 228, 34, COLORS.text, 'left');
		text(ctx, 'BEST', 280, 196, 22, COLORS.dim, 'left');
		text(ctx, formatTime(data.bestLap), 280, 228, 34, COLORS.text, 'left');
		this.panel.texture.needsUpdate = true;
	}
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

