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
		this.voiceGain = ctx.createGain();
		this.voiceGain.gain.value = 1.0;
		this.voiceGain.connect(ctx.destination);
		this._loadVoices();
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

	// --- Announcer ---------------------------------------------------------------------
	_loadVoices() {
		const ids = ['three', 'two', 'one', 'go', 'rockets', 'missile', 'mines', 'autopilot', 'autopilot_on', 'autopilot_off',
			'contender_eliminated', 'opponent_destroyed', 'player_eliminated', 'shield_critical', 'missile_incoming',
			'final_lap', 'lap_two', 'lap_three', 'lap_four', 'race_complete', 'wrong_way'];
		this.voices = {};
		this.voiceQueue = [];
		this.voiceBusyUntil = 0;
		for (const id of ids) {
			fetch(`assets/voice/${id}.m4a`)
				.then((r) => r.arrayBuffer())
				.then((b) => this.ctx.decodeAudioData(b))
				.then((buf) => (this.voices[id] = buf))
				.catch(() => {});
		}
	}

	// Queue an announcer line; urgent lines jump the queue. Music ducks under the voice.
	say(id, urgent = false) {
		if (!this.ctx || !this.voices?.[id]) return;
		if (urgent) this.voiceQueue.unshift(id);
		else if (this.voiceQueue.length < 2) this.voiceQueue.push(id);
		this._pumpVoice();
	}

	_pumpVoice() {
		const t = this.ctx.currentTime;
		if (t < this.voiceBusyUntil || !this.voiceQueue.length) {
			if (this.voiceQueue.length && !this._voiceTimer) {
				this._voiceTimer = setTimeout(() => {
					this._voiceTimer = null;
					this._pumpVoice();
				}, (this.voiceBusyUntil - t) * 1000 + 20);
			}
			return;
		}
		const buf = this.voices[this.voiceQueue.shift()];
		const src = this.ctx.createBufferSource();
		src.buffer = buf;
		src.connect(this.voiceGain);
		src.start();
		this.voiceBusyUntil = t + buf.duration;
		const g = this.musicGain.gain;
		g.cancelScheduledValues(t);
		g.setTargetAtTime(0.22, t, 0.05);
		g.setTargetAtTime(0.55, t + buf.duration, 0.3);
		if (this.voiceQueue.length) this._pumpVoice();
	}

	// --- Weapon sounds -----------------------------------------------------------------
	launch() {
		if (!this.ctx) return;
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const src = ctx.createBufferSource();
		src.buffer = this.noiseBuf;
		const f = ctx.createBiquadFilter();
		f.type = 'bandpass';
		f.Q.value = 1.5;
		f.frequency.setValueAtTime(2500, t);
		f.frequency.exponentialRampToValueAtTime(400, t + 0.5);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.6, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
		src.connect(f).connect(g).connect(this.master);
		src.start(t, Math.random());
		src.stop(t + 0.65);
	}

	// strength 0..1, pan -1..1
	explosion(strength = 1, pan = 0) {
		if (!this.ctx) return;
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const p = ctx.createStereoPanner();
		p.pan.value = Math.max(-1, Math.min(1, pan));
		p.connect(this.master);
		const src = ctx.createBufferSource();
		src.buffer = this.noiseBuf;
		const f = ctx.createBiquadFilter();
		f.type = 'lowpass';
		f.frequency.setValueAtTime(1800, t);
		f.frequency.exponentialRampToValueAtTime(120, t + 0.9);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.9 * strength, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
		src.connect(f).connect(g).connect(p);
		src.start(t, Math.random());
		src.stop(t + 1.2);
		const o = ctx.createOscillator();
		o.frequency.setValueAtTime(90, t);
		o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
		const og = ctx.createGain();
		og.gain.setValueAtTime(0.8 * strength, t);
		og.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
		o.connect(og).connect(p);
		o.start(t);
		o.stop(t + 0.65);
	}

	pickup() {
		this.beep(880, 0.08, 0.2);
		setTimeout(() => this.beep(1320, 0.12, 0.2), 70);
	}

	click() {
		this.beep(1200, 0.05, 0.15);
	}
}
