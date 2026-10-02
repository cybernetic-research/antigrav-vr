// Fully synthesized sound: engine drone, wind, wall scrapes, boost whoosh,
// countdown beeps and a passing-rival engine. No audio files needed.
// Music: a built-in generative synth soundtrack (synthMusic.js), or songs the
// player supplies (their own files, a music/ folder, or a disc rip) streamed
// through an <audio> element.

import { SynthMusic } from './synthMusic.js';

export class Audio {
	constructor() {
		this.ctx = null;
		this.enabled = true;
		this.music = { list: [], el: null, index: -1, mode: 'off', wanted: false };
	}

	// Must be called from a user gesture (click / entering VR)
	unlock() {
		if (this.ctx) {
			if (this.ctx.state === 'suspended') this.ctx.resume();
			return;
		}
		const AC = window.AudioContext || window.webkitAudioContext;
		if (!AC) return;
		const ctx = (this.ctx = new AC());
		this.master = ctx.createGain();
		this.master.gain.value = 0.6;
		this.master.connect(ctx.destination);
		this.musicGain = ctx.createGain();
		this.musicGain.gain.value = 0.55;
		this.musicGain.connect(ctx.destination);
		if (this.music.el) ctx.createMediaElementSource(this.music.el).connect(this.musicGain);
		this.synth = new SynthMusic(ctx, this.musicGain, this.noiseBuf);
		if (this.music.wanted) this.playMusic(this.music.mode, false);

		this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
		const d = this.noiseBuf.getChannelData(0);
		for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

		// Engine: detuned saw + square through a lowpass
		this.engGain = ctx.createGain();
		this.engGain.gain.value = 0;
		this.engFilter = ctx.createBiquadFilter();
		this.engFilter.type = 'lowpass';
		this.engFilter.Q.value = 6;
		this.engFilter.connect(this.engGain).connect(this.master);
		this.osc = [];
		for (const [type, mul, g] of [['sawtooth', 1, 0.35], ['square', 0.5, 0.2], ['sawtooth', 2.01, 0.15]]) {
			const o = ctx.createOscillator();
			o.type = type;
			const gg = ctx.createGain();
			gg.gain.value = g;
			o.connect(gg).connect(this.engFilter);
			o.start();
			this.osc.push({ o, mul });
		}

		// Wind
		this.wind = this._noiseLoop('bandpass', 800, 0.7);
		// Wall scrape
		this.scrape = this._noiseLoop('highpass', 2500, 1.5);
		// Rival engine (panned)
		this.rivalPan = ctx.createStereoPanner();
		this.rivalGain = ctx.createGain();
		this.rivalGain.gain.value = 0;
		this.rivalFilter = ctx.createBiquadFilter();
		this.rivalFilter.type = 'lowpass';
		this.rivalFilter.frequency.value = 1200;
		this.rivalOsc = ctx.createOscillator();
		this.rivalOsc.type = 'sawtooth';
		this.rivalOsc.connect(this.rivalFilter).connect(this.rivalGain).connect(this.rivalPan).connect(this.master);
		this.rivalOsc.start();
	}

	_noiseLoop(type, freq, q) {
		const ctx = this.ctx;
		const src = ctx.createBufferSource();
		src.buffer = this.noiseBuf;
		src.loop = true;
		const f = ctx.createBiquadFilter();
		f.type = type;
		f.frequency.value = freq;
		f.Q.value = q;
		const g = ctx.createGain();
		g.gain.value = 0;
		src.connect(f).connect(g).connect(this.master);
		src.start();
		return { src, f, g };
	}

	setRacing(on) {
		if (!this.ctx) return;
		const t = this.ctx.currentTime;
		if (!on) {
			for (const g of [this.engGain.gain, this.wind.g.gain, this.scrape.g.gain, this.rivalGain.gain]) g.setTargetAtTime(0, t, 0.1);
		}
	}

	// speed in m/s, thrust 0..1, wall 0..1, rival {distance, pan, speed} or null
	update(speed, thrust, wall, rival) {
		if (!this.ctx) return;
		const t = this.ctx.currentTime;
		const base = 45 + speed * 1.3 + thrust * 12;
		for (const { o, mul } of this.osc) o.frequency.setTargetAtTime(base * mul, t, 0.05);
		this.engFilter.frequency.setTargetAtTime(250 + speed * 18 + thrust * 900, t, 0.05);
		this.engGain.gain.setTargetAtTime(0.12 + thrust * 0.1 + Math.min(speed / 110, 1) * 0.08, t, 0.08);
		this.wind.g.gain.setTargetAtTime(Math.min(1, (speed / 100) ** 2) * 0.25, t, 0.1);
		this.wind.f.frequency.setTargetAtTime(400 + speed * 12, t, 0.1);
		this.scrape.g.gain.setTargetAtTime(wall * 0.5, t, 0.02);
		if (rival) {
			const g = Math.max(0, 1 - rival.distance / 45) ** 2 * 0.25;
			this.rivalGain.gain.setTargetAtTime(g, t, 0.05);
			this.rivalPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, rival.pan)), t, 0.05);
			this.rivalOsc.frequency.setTargetAtTime(55 + rival.speed * 1.2, t, 0.05);
		} else {
			this.rivalGain.gain.setTargetAtTime(0, t, 0.1);
		}
	}

	beep(freq = 660, dur = 0.18, vol = 0.35) {
		if (!this.ctx) return;
		const ctx = this.ctx;
		const o = ctx.createOscillator();
		o.type = 'square';
		o.frequency.value = freq;
		const g = ctx.createGain();
		g.gain.setValueAtTime(vol, ctx.currentTime);
		g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
		o.connect(g).connect(this.master);
		o.start();
		o.stop(ctx.currentTime + dur);
	}

	whoosh() {
		if (!this.ctx) return;
		const ctx = this.ctx;
		const src = ctx.createBufferSource();
		src.buffer = this.noiseBuf;
		const f = ctx.createBiquadFilter();
		f.type = 'bandpass';
		f.Q.value = 2;
		f.frequency.setValueAtTime(300, ctx.currentTime);
		f.frequency.exponentialRampToValueAtTime(4000, ctx.currentTime + 0.6);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.5, ctx.currentTime);
		g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
		src.connect(f).connect(g).connect(this.master);
		src.start();
		src.stop(ctx.currentTime + 0.8);
	}

	// --- Music ---------------------------------------------------------------------
	// list: [{url, title}]
	setMusicList(list) {
		const m = this.music;
		m.list = list;
		if (!list.length || m.el) return;
		m.el = new window.Audio();
		m.el.preload = 'auto';
		m.el.addEventListener('ended', () => this._nextSong());
		if (this.ctx) this.ctx.createMediaElementSource(m.el).connect(this.musicGain);
	}

	get songTitle() {
		const m = this.music;
		if (this.synth?.playing) return this.synth.title;
		return m.index >= 0 && m.list[m.index] ? m.list[m.index].title : '';
	}

	// mode: 'off' | 'synth' | 'shuffle' | index into the list. Without any songs,
	// 'shuffle' and indices fall back to the synth. restart=false keeps whatever
	// is already playing in a compatible mode.
	playMusic(mode, restart = true) {
		const m = this.music;
		m.mode = mode;
		if (mode === 'off') {
			this.stopMusic();
			return;
		}
		m.wanted = true;
		if (!this.ctx) return; // starts on unlock()
		const useSynth = mode === 'synth' || !m.list.length || !m.el;
		if (useSynth) {
			if (m.el) m.el.pause();
			if (restart) this.synth.stop();
			this.synth.start();
			return;
		}
		this.synth.stop();
		if (!restart && m.index >= 0 && !m.el.paused && (mode === 'shuffle' || mode === m.index)) return;
		this._load(mode === 'shuffle' ? this._randomIndex() : mode);
	}

	stopMusic() {
		const m = this.music;
		m.wanted = false;
		if (m.el) m.el.pause();
		this.synth?.stop();
	}

	pauseMusic(paused) {
		const m = this.music;
		if (!m.wanted || !this.ctx) return;
		if (m.mode === 'synth' || !m.list.length) {
			paused ? this.synth.stop() : this.synth.start();
			return;
		}
		if (paused) m.el.pause();
		else m.el.play().catch(() => {});
	}

	_randomIndex() {
		const m = this.music;
		if (m.list.length < 2) return 0;
		let i;
		do i = Math.floor(Math.random() * m.list.length);
		while (i === m.index);
		return i;
	}

	_nextSong() {
		const m = this.music;
		if (!m.wanted) return;
		this._load(m.mode === 'shuffle' ? this._randomIndex() : (m.index + 1) % m.list.length);
	}

	_load(i) {
		const m = this.music;
		m.index = i;
		m.el.src = m.list[i].url;
		m.el.play().catch((e) => console.warn('music:', e.message));
	}

	click() {
		this.beep(1200, 0.05, 0.15);
	}
}
