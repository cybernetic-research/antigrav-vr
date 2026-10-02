// Loading-screen theme: an original late-90s style big-beat / acid breakbeat,
// synthesized live. Syncopated break, a squelchy 303-style acid line with
// accents and slides, rave chord stabs and a pad wash. It starts as an
// ambient intro and builds into the full break; once loading passes ~70% (or
// after 90 s) it switches up into drum & bass at 172 BPM with a rolling reese
// bassline, so a long wait keeps building.

const BPM = 134;
const DNB_BPM = 172;
let STEP = 60 / BPM / 4;
// Drum & bass bar: two-step kick/snare, ghost notes, 16th hats
const DNB = {
	kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
	kickAlt: [1, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 1, 0, 0, 0, 0, 0],
	snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
	ghost: [0, 0, 0, 0, 0, 0, 0, 0.3, 0, 0.22, 0, 0, 0, 0, 0, 0.3],
	hat: [0.9, 0.3, 0.6, 0.3, 0.9, 0.3, 0.6, 0.4, 0.9, 0.3, 0.6, 0.3, 0.9, 0.3, 0.6, 0.5]
};
const REESE = [0, 0, 8, 7]; // semitones, two bars each
const ROOT = 45; // A2
const MINOR_PENT = [0, 3, 5, 7, 10, 12, 15];

// 16-step break: kick, snare, ghost snare, closed hat, open hat
const BREAK = {
	kick: [1, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 1, 0, 0, 0, 0, 0],
	snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
	ghost: [0, 0, 0, 0, 0, 0, 0, 0.35, 0, 0.25, 0, 0, 0, 0, 0, 0.3],
	hat: [1, 0, 0.5, 0, 1, 0, 0.5, 0, 1, 0, 0.5, 0, 1, 0, 0.5, 0],
	open: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]
};
// Acid line: [scale index or null, accent, slide]
const ACID = [
	[0, 1, 0], [0, 0, 0], [6, 0, 1], [0, 0, 0], [3, 1, 0], [0, 0, 0], [0, 0, 1], [5, 0, 0],
	[0, 1, 0], [null, 0, 0], [2, 0, 1], [3, 0, 0], [0, 1, 0], [4, 0, 1], [3, 0, 0], [1, 0, 0]
];
// 8-bar sections (the whole thing loops every 32 bars)
const SECTIONS = [
	{ pad: 1, acid: 0.3, hats: 0, beat: 0, stabs: 0 }, // intro: pad + filtered acid
	{ pad: 1, acid: 0.6, hats: 1, beat: 0, stabs: 0, riser: 1 },
	{ pad: 1, acid: 1, hats: 1, beat: 1, stabs: 1 }, // the break drops
	{ pad: 0, acid: 1, hats: 1, beat: 1, stabs: 1 }
];

export class LoadingMusic {
	constructor(ctx, output, noise) {
		this.ctx = ctx;
		this.noise = noise;
		this.bus = ctx.createGain();
		this.bus.gain.value = 0;
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = -16;
		comp.ratio.value = 5;
		this.bus.connect(comp).connect(output);
		// shared acid voice so slides glide between notes
		this.acidOsc = null;
		this.timer = null;
	}

	get playing() {
		return !!this.timer;
	}

	// Loading progress 0..1: past ~70% the theme switches up into drum & bass
	setProgress(f) {
		if (f >= 0.7) this.wantDnb = true;
	}

	start() {
		if (this.timer) return;
		STEP = 60 / BPM / 4;
		this.dnb = false;
		this.wantDnb = false;
		this.startedAt = this.ctx.currentTime;
		const t = this.ctx.currentTime;
		this.bus.gain.cancelScheduledValues(t);
		this.bus.gain.setValueAtTime(0, t);
		this.bus.gain.linearRampToValueAtTime(0.9, t + 1.5);
		this.step = 0;
		this.next = t + 0.1;
		this._acidVoice();
		this.timer = setInterval(() => this._schedule(), 25);
	}

	stop(fade = 0.6) {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
		const t = this.ctx.currentTime;
		this.bus.gain.cancelScheduledValues(t);
		this.bus.gain.setValueAtTime(this.bus.gain.value, t);
		this.bus.gain.linearRampToValueAtTime(0, t + fade);
		const oscs = [this.acidOsc, ...(this.reese?.oscs || [])];
		setTimeout(() => oscs.forEach((o) => o?.stop()), (fade + 0.1) * 1000);
		this.acidOsc = null;
		this.reese = null;
	}

	// Reese bass: detuned saws plus a sub, through a slowly moving lowpass
	_reeseVoice() {
		const ctx = this.ctx;
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.Q.value = 3;
		filter.frequency.value = 400;
		const amp = ctx.createGain();
		amp.gain.value = 0;
		filter.connect(amp).connect(this.bus);
		const oscs = [];
		for (const [type, detune, level] of [['sawtooth', -14, 0.5], ['sawtooth', 14, 0.5], ['sine', 0, 0.9]]) {
			const o = ctx.createOscillator();
			o.type = type;
			o.detune.value = detune;
			const g = ctx.createGain();
			g.gain.value = level;
			o.connect(g).connect(filter);
			o.start();
			oscs.push(o);
		}
		this.reese = { oscs, filter, amp };
	}

	_acidVoice() {
		const ctx = this.ctx;
		this.acidOsc = ctx.createOscillator();
		this.acidOsc.type = 'sawtooth';
		this.acidFilter = ctx.createBiquadFilter();
		this.acidFilter.type = 'lowpass';
		this.acidFilter.Q.value = 14;
		this.acidAmp = ctx.createGain();
		this.acidAmp.gain.value = 0;
		const drive = ctx.createWaveShaper();
		const curve = new Float32Array(256);
		for (let i = 0; i < 256; i++) {
			const x = (i / 128 - 1) * 2.5;
			curve[i] = Math.tanh(x);
		}
		drive.curve = curve;
		this.acidOsc.connect(this.acidFilter).connect(drive).connect(this.acidAmp).connect(this.bus);
		this.acidOsc.start();
	}

	_freq(semis) {
		return 440 * Math.pow(2, (ROOT + semis - 69) / 12);
	}

	_schedule() {
		while (this.next < this.ctx.currentTime + 0.12) {
			this._play(this.step, this.next);
			this.step++;
			this.next += STEP;
		}
	}

	_play(step, t) {
		const s = step % 16;
		const bar = Math.floor(step / 16);
		// switch up at the next bar line once loading is far enough along
		if (s === 0 && !this.dnb && (this.wantDnb || t - this.startedAt > 90)) {
			this.dnb = true;
			this.dnbBar = bar;
			STEP = 60 / DNB_BPM / 4;
			this._reeseVoice();
			this._riser(t, 0.6);
			this._kick(t, 1);
			this._snare(t, 1);
		}
		if (this.dnb) {
			this._playDnb(s, bar - this.dnbBar, t);
			return;
		}
		const sec = SECTIONS[Math.floor(bar / 8) % SECTIONS.length];
		const barInSec = bar % 8;

		if (sec.beat) {
			if (BREAK.kick[s]) this._kick(t, BREAK.kick[s]);
			if (BREAK.snare[s]) this._snare(t, 1);
			if (BREAK.ghost[s]) this._snare(t, BREAK.ghost[s]);
		} else if (sec.riser && barInSec >= 6 && s % 2 === 0) {
			// snare roll into the drop
			this._snare(t, 0.25 + ((barInSec - 6) * 16 + s) / 64);
		}
		if (sec.hats) {
			if (BREAK.hat[s]) this._hat(t, BREAK.hat[s] * 0.8, 0.04);
			if (BREAK.open[s]) this._hat(t, 0.6, 0.22);
		}
		if (sec.acid) this._acid(t, s, bar, sec.acid);
		if (sec.stabs && (s === 6 || s === 14) && bar % 2 === 1) this._stab(t);
		if (sec.pad && s === 0 && bar % 4 === 0) this._pad(t);
		if (sec.riser && barInSec === 4 && s === 0) this._riser(t, STEP * 64);
	}

	_playDnb(s, bar, t) {
		const fill = bar % 8 === 7 && s >= 12;
		const kick = bar % 4 === 3 ? DNB.kickAlt : DNB.kick;
		if (kick[s]) this._kick(t, kick[s]);
		if (fill) this._snare(t, 0.4 + (s - 12) * 0.15);
		else {
			if (DNB.snare[s]) this._snare(t, 1);
			if (DNB.ghost[s]) this._snare(t, DNB.ghost[s]);
		}
		this._hat(t, DNB.hat[s] * (0.7 + Math.random() * 0.3), s % 4 === 2 && bar % 2 ? 0.12 : 0.03);
		// rolling reese: a new note every two bars, filter breathing over 8 bars
		const r = this.reese;
		if (r && s === 0) {
			const semis = REESE[Math.floor(bar / 2) % REESE.length];
			const f = this._freq(semis - 12);
			for (const o of r.oscs) o.frequency.setTargetAtTime(f, t, 0.02);
			r.amp.gain.setTargetAtTime(0.32, t, 0.05);
			r.filter.frequency.setTargetAtTime(260 + 520 * (0.5 - 0.5 * Math.cos((bar % 8) / 8 * Math.PI * 2)), t, 0.4);
		}
		// acid and stabs carry on over the top, a little quieter
		this._acid(t, s, bar, 0.55);
		if ((s === 3 || s === 11) && bar % 4 === 2) this._stab(t);
		if (s === 0 && bar % 8 === 0) this._pad(t);
	}

	_env(g, t, a, peak, d) {
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(peak, t + a);
		g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
	}

	_kick(t, v) {
		const o = this.ctx.createOscillator();
		const g = this.ctx.createGain();
		o.frequency.setValueAtTime(160, t);
		o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
		this._env(g, t, 0.002, 0.9 * v, 0.28);
		o.connect(g).connect(this.bus);
		o.start(t);
		o.stop(t + 0.35);
	}

	_noise(t, type, freq, q, peak, dur) {
		const src = this.ctx.createBufferSource();
		src.buffer = this.noise;
		const f = this.ctx.createBiquadFilter();
		f.type = type;
		f.frequency.value = freq;
		f.Q.value = q;
		const g = this.ctx.createGain();
		this._env(g, t, 0.001, peak, dur);
		src.connect(f).connect(g).connect(this.bus);
		src.start(t, Math.random() * 1.5);
		src.stop(t + dur + 0.05);
	}

	_snare(t, v) {
		this._noise(t, 'bandpass', 1900, 0.8, 0.5 * v, 0.16);
		const o = this.ctx.createOscillator();
		const g = this.ctx.createGain();
		o.frequency.setValueAtTime(220, t);
		o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
		this._env(g, t, 0.001, 0.25 * v, 0.1);
		o.connect(g).connect(this.bus);
		o.start(t);
		o.stop(t + 0.15);
	}

	_hat(t, v, dur) {
		this._noise(t, 'highpass', 8500, 0.7, 0.16 * v, dur);
	}

	_acid(t, s, bar, level) {
		const [deg, accent, slide] = ACID[s];
		const amp = this.acidAmp.gain;
		const f = this.acidFilter.frequency;
		if (deg === null) {
			amp.setTargetAtTime(0, t, 0.01);
			return;
		}
		const freq = this._freq(MINOR_PENT[deg] + (bar % 4 === 3 && s >= 8 ? 12 : 0));
		if (slide) this.acidOsc.frequency.setTargetAtTime(freq, t, 0.03);
		else this.acidOsc.frequency.setValueAtTime(freq, t);
		// the filter opens slowly over 16 bars: the classic acid "tweak"
		const sweep = 0.5 - 0.5 * Math.cos(((bar % 16) + s / 16) / 16 * Math.PI * 2);
		const base = 180 + 1400 * sweep * level;
		const peak = base * (accent ? 4.5 : 2.4);
		f.cancelScheduledValues(t);
		f.setValueAtTime(peak, t);
		f.exponentialRampToValueAtTime(base, t + STEP * 0.9);
		amp.cancelScheduledValues(t);
		amp.setValueAtTime((accent ? 0.22 : 0.14) * level, t);
		if (!slide) amp.setTargetAtTime(0.02, t + STEP * 0.6, 0.02);
	}

	_stab(t) {
		// minor 7th rave stab
		for (const semis of [12, 15, 19, 22]) {
			for (const detune of [-10, 10]) {
				const o = this.ctx.createOscillator();
				o.type = 'square';
				o.frequency.value = this._freq(semis);
				o.detune.value = detune;
				const f = this.ctx.createBiquadFilter();
				f.type = 'lowpass';
				f.frequency.setValueAtTime(4000, t);
				f.frequency.exponentialRampToValueAtTime(500, t + 0.25);
				const g = this.ctx.createGain();
				this._env(g, t, 0.003, 0.035, 0.28);
				o.connect(f).connect(g).connect(this.bus);
				o.start(t);
				o.stop(t + 0.35);
			}
		}
	}

	_pad(t) {
		const dur = STEP * 64;
		for (const semis of [0, 7, 15, 19]) {
			for (const detune of [-7, 7]) {
				const o = this.ctx.createOscillator();
				o.type = 'sawtooth';
				o.frequency.value = this._freq(semis + 12);
				o.detune.value = detune;
				const f = this.ctx.createBiquadFilter();
				f.type = 'lowpass';
				f.frequency.value = 900;
				const g = this.ctx.createGain();
				g.gain.setValueAtTime(0.0001, t);
				g.gain.exponentialRampToValueAtTime(0.025, t + 1.5);
				g.gain.setValueAtTime(0.025, t + dur - 1);
				g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
				o.connect(f).connect(g).connect(this.bus);
				o.start(t);
				o.stop(t + dur + 0.05);
			}
		}
	}

	_riser(t, dur) {
		const src = this.ctx.createBufferSource();
		src.buffer = this.noise;
		src.loop = true;
		const f = this.ctx.createBiquadFilter();
		f.type = 'bandpass';
		f.Q.value = 4;
		f.frequency.setValueAtTime(400, t);
		f.frequency.exponentialRampToValueAtTime(7000, t + dur);
		const g = this.ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(0.22, t + dur);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
		src.connect(f).connect(g).connect(this.bus);
		src.start(t);
		src.stop(t + dur + 0.1);
	}
}
