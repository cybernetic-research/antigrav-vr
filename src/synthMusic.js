// Generative breakbeat/techno soundtrack, synthesized live with WebAudio so the
// game has original music without shipping any audio files.
// Song structure repeats every 64 bars and re-rolls key and patterns each time.

const BPM = 138;
const STEP = 60 / BPM / 4; // 16th note
const SCALES = [
	[0, 2, 3, 5, 7, 8, 10], // natural minor
	[0, 2, 3, 5, 7, 9, 10], // dorian
	[0, 1, 3, 5, 7, 8, 10] // phrygian
];
// Sections of 8 bars: which parts play
const ARRANGEMENT = [
	{ kick: 1, hats: 1, bass: 0, arp: 0, pad: 1, clap: 0 },
	{ kick: 1, hats: 1, bass: 1, arp: 0, pad: 0, clap: 1 },
	{ kick: 1, hats: 2, bass: 1, arp: 1, pad: 1, clap: 1 },
	{ kick: 1, hats: 2, bass: 1, arp: 1, pad: 1, clap: 1 },
	{ kick: 0, hats: 0, bass: 0, arp: 1, pad: 1, clap: 0 }, // breakdown
	{ kick: 0, hats: 1, bass: 1, arp: 1, pad: 1, clap: 0, riser: 1 },
	{ kick: 1, hats: 2, bass: 1, arp: 1, pad: 1, clap: 1 },
	{ kick: 1, hats: 2, bass: 1, arp: 2, pad: 1, clap: 1 }
];

export class SynthMusic {
	constructor(ctx, output, noise) {
		this.ctx = ctx;
		this.noise = noise;
		this.bus = ctx.createGain();
		this.bus.gain.value = 0.9;
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = -14;
		comp.ratio.value = 4;
		this.bus.connect(comp).connect(output);
		this.timer = null;
		this.title = 'Built-in synth';
	}

	start() {
		if (this.timer) return;
		this.step = 0;
		this.next = this.ctx.currentTime + 0.1;
		this._newSong();
		this.timer = setInterval(() => this._schedule(), 25);
	}

	stop() {
		clearInterval(this.timer);
		this.timer = null;
	}

	get playing() {
		return !!this.timer;
	}

	_newSong() {
		const r = Math.random;
		this.root = 33 + Math.floor(r() * 7); // MIDI A1..D#2 region
		this.scale = SCALES[Math.floor(r() * SCALES.length)];
		// bass: 16 steps, null = rest, numbers = scale degrees
		this.bassPat = Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? 0 : r() < 0.55 ? [0, 0, 4, 7, 2, 5][Math.floor(r() * 6)] : null));
		this.bassPat[0] = 0;
		this.hatPat = Array.from({ length: 16 }, (_, i) => (i % 4 === 2 ? 1 : r() < 0.35 ? 0.4 : 0));
		this.kickPat = Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? 1 : r() < 0.08 ? 0.7 : 0));
		// chord progression (scale degrees of chord roots), 2 bars each
		const progs = [[0, 5, 3, 4], [0, 3, 5, 4], [0, 6, 5, 6], [0, 2, 5, 4]];
		this.prog = progs[Math.floor(r() * progs.length)];
		this.arpPat = Array.from({ length: 16 }, () => Math.floor(r() * 4));
	}

	_note(degree, octave = 0) {
		const n = this.scale.length;
		const d = ((degree % n) + n) % n;
		const o = Math.floor(degree / n) + octave;
		return 440 * Math.pow(2, (this.root + this.scale[d] + 12 * o - 69) / 12);
	}

	_schedule() {
		while (this.next < this.ctx.currentTime + 0.12) {
			this._playStep(this.step, this.next);
			this.step++;
			this.next += STEP;
			if (this.step % (16 * 64) === 0) this._newSong();
		}
	}

	_playStep(step, t) {
		const s16 = step % 16;
		const bar = Math.floor(step / 16);
		const sec = ARRANGEMENT[Math.floor(bar / 8) % ARRANGEMENT.length];
		const chordRoot = this.prog[Math.floor(bar / 2) % this.prog.length];

		if (sec.kick && this.kickPat[s16]) this._kick(t, this.kickPat[s16]);
		if (sec.clap && (s16 === 4 || s16 === 12)) this._clap(t);
		if (sec.hats && (this.hatPat[s16] || (sec.hats > 1 && s16 % 2 === 1))) this._hat(t, this.hatPat[s16] || 0.3);
		if (sec.bass) {
			const b = this.bassPat[s16];
			if (b !== null) this._bass(t, this._note(chordRoot + b, 0));
		}
		if (sec.arp && (sec.arp > 1 || s16 % 2 === 0)) {
			const chord = [0, 2, 4, 7];
			this._arp(t, this._note(chordRoot + chord[this.arpPat[s16]], 2), bar);
		}
		if (sec.pad && s16 === 0 && bar % 2 === 0) this._pad(t, chordRoot);
		if (sec.riser && s16 === 0 && bar % 8 === 4) this._riser(t);
	}

	_env(gain, t, a, peak, d) {
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(peak, t + a);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
	}

	_kick(t, vel) {
		const o = this.ctx.createOscillator();
		const g = this.ctx.createGain();
		o.frequency.setValueAtTime(150, t);
		o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
		this._env(g, t, 0.002, 0.9 * vel, 0.32);
		o.connect(g).connect(this.bus);
		o.start(t);
		o.stop(t + 0.4);
	}

	_noiseHit(t, type, freq, q, peak, dur) {
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

	_clap(t) {
		for (const dt of [0, 0.012, 0.024]) this._noiseHit(t + dt, 'bandpass', 1600, 1.2, 0.35, 0.12);
	}

	_hat(t, vel) {
		this._noiseHit(t, 'highpass', 8000, 0.7, 0.18 * vel, 0.045);
	}

	_bass(t, freq) {
		const o = this.ctx.createOscillator();
		o.type = 'sawtooth';
		o.frequency.value = freq;
		const f = this.ctx.createBiquadFilter();
		f.type = 'lowpass';
		f.Q.value = 8;
		f.frequency.setValueAtTime(1400, t);
		f.frequency.exponentialRampToValueAtTime(180, t + 0.14);
		const g = this.ctx.createGain();
		this._env(g, t, 0.004, 0.32, 0.16);
		o.connect(f).connect(g).connect(this.bus);
		o.start(t);
		o.stop(t + 0.22);
	}

	_arp(t, freq, bar) {
		const o = this.ctx.createOscillator();
		o.type = 'square';
		o.frequency.value = freq;
		const f = this.ctx.createBiquadFilter();
		f.type = 'lowpass';
		f.frequency.value = 900 + 2200 * (0.5 + 0.5 * Math.sin(bar * 0.4));
		f.Q.value = 4;
		const g = this.ctx.createGain();
		this._env(g, t, 0.003, 0.07, 0.11);
		o.connect(f).connect(g).connect(this.bus);
		o.start(t);
		o.stop(t + 0.16);
		// cheap echo
		const d = this.ctx.createDelay();
		d.delayTime.value = STEP * 3;
		const dg = this.ctx.createGain();
		dg.gain.value = 0.35;
		g.connect(d).connect(dg).connect(this.bus);
	}

	_pad(t, chordRoot) {
		const dur = STEP * 32;
		for (const deg of [0, 2, 4]) {
			for (const detune of [-8, 8]) {
				const o = this.ctx.createOscillator();
				o.type = 'sawtooth';
				o.frequency.value = this._note(chordRoot + deg, 1);
				o.detune.value = detune;
				const f = this.ctx.createBiquadFilter();
				f.type = 'lowpass';
				f.frequency.value = 1100;
				const g = this.ctx.createGain();
				g.gain.setValueAtTime(0.0001, t);
				g.gain.exponentialRampToValueAtTime(0.035, t + 0.8);
				g.gain.setValueAtTime(0.035, t + dur - 0.6);
				g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
				o.connect(f).connect(g).connect(this.bus);
				o.start(t);
				o.stop(t + dur + 0.05);
			}
		}
	}

	_riser(t) {
		const dur = STEP * 64;
		const src = this.ctx.createBufferSource();
		src.buffer = this.noise;
		src.loop = true;
		const f = this.ctx.createBiquadFilter();
		f.type = 'bandpass';
		f.Q.value = 3;
		f.frequency.setValueAtTime(300, t);
		f.frequency.exponentialRampToValueAtTime(6000, t + dur);
		const g = this.ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(0.25, t + dur);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
		src.connect(f).connect(g).connect(this.bus);
		src.start(t);
		src.stop(t + dur + 0.1);
	}
}
