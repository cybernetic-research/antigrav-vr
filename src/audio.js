// Fully synthesized sound: engine drone, wind, wall scrapes, boost whoosh,
// countdown beeps and a passing-rival engine. No audio files needed.
// Music: a built-in generative synth soundtrack (synthMusic.js), or songs the
// player supplies (their own files, a music/ folder, or a disc rip) streamed
// through an <audio> element.

import { SynthMusic } from './synthMusic.js';
import { LoadingMusic } from './loadingMusic.js';

export class Audio {
	constructor() {
		this.ctx = null;
		this.enabled = true;
		this.music = { list: [], el: null, index: -1, mode: 'off', wanted: false };
		// Add-ons can replace announcer lines and effects with their own AudioBuffers:
		// voiceOverrides[id], samples.{launch, explosion, pickup, click, boost, engine, scrape}
		this.voiceOverrides = {};
		this.samples = {};
		this.loops = {};
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
		this.loadingTheme = new LoadingMusic(ctx, this.musicGain, this.noiseBuf);
		if (this.loadingWanted) this.loadingMusic(true);
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
			for (const l of Object.values(this.loops)) l.gain.gain.setTargetAtTime(0, t, 0.1);
			this.setRecharging(false);
		}
	}

	// speed in m/s, thrust 0..1, wall 0..1, rival {distance, pan, speed} or null
	update(speed, thrust, wall, rival) {
		if (!this.ctx) return;
		const t = this.ctx.currentTime;
		const base = 45 + speed * 1.3 + thrust * 12;
		for (const { o, mul } of this.osc) o.frequency.setTargetAtTime(base * mul, t, 0.05);
		this.engFilter.frequency.setTargetAtTime(250 + speed * 18 + thrust * 900, t, 0.05);
		const engineLevel = 0.12 + thrust * 0.1 + Math.min(speed / 110, 1) * 0.08;
		const engineLoop = this._loop('engine');
		if (engineLoop) {
			// sampled engine replaces the synth: pitch follows speed
			engineLoop.src.playbackRate.setTargetAtTime(0.55 + speed / 90 + thrust * 0.12, t, 0.05);
			engineLoop.gain.gain.setTargetAtTime(engineLevel * 3, t, 0.08);
			this.engGain.gain.setTargetAtTime(0, t, 0.08);
		} else {
			this.engGain.gain.setTargetAtTime(engineLevel, t, 0.08);
		}
		this.wind.g.gain.setTargetAtTime(Math.min(1, (speed / 100) ** 2) * 0.25, t, 0.1);
		this.wind.f.frequency.setTargetAtTime(400 + speed * 12, t, 0.1);
		const scrapeLoop = this._loop('scrape');
		if (scrapeLoop) scrapeLoop.gain.gain.setTargetAtTime(wall * 0.9, t, 0.02);
		else this.scrape.g.gain.setTargetAtTime(wall * 0.5, t, 0.02);
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
		if (!this.ctx || this._sample('boost', 0.8)) return;
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

	// The loading-screen theme takes over from whatever music was playing
	loadingMusic(on) {
		this.loadingWanted = on;
		if (!this.ctx) return; // starts on unlock()
		if (on) {
			if (this.music.el) this.music.el.pause();
			this.synth?.stop();
			this.loadingTheme.start();
		} else {
			this.loadingTheme.stop();
		}
	}

	loadingProgress(f) {
		this.loadingTheme?.setProgress(f);
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
			'final_lap', 'lap_two', 'lap_three', 'lap_four', 'race_complete', 'wrong_way', 'recharging'];
		this.voices = {};
		this.voiceQueue = [];
		this.voiceBusyUntil = 0;
		for (const id of ids) {
			fetch(new URL(`../assets/voice/${id}.m4a`, import.meta.url))
				.then((r) => r.arrayBuffer())
				.then((b) => this.ctx.decodeAudioData(b))
				.then((buf) => (this.voices[id] = buf))
				.catch(() => {});
		}
	}

	// Queue an announcer line; urgent lines jump the queue. Music ducks under the voice.
	say(id, urgent = false) {
		if (!this.ctx || !this._voice(id)) return;
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
		const buf = this._voice(this.voiceQueue.shift());
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

	_voice(id) {
		return this.voiceOverrides[id] || this.voices?.[id];
	}

	// Plays an add-on sample if one is registered; returns false otherwise
	_sample(name, gain = 1, pan = 0, rate = 1) {
		const buf = this.samples[name];
		if (!this.ctx || !buf) return false;
		const src = this.ctx.createBufferSource();
		src.buffer = buf;
		src.playbackRate.value = rate;
		const g = this.ctx.createGain();
		g.gain.value = gain;
		const p = this.ctx.createStereoPanner();
		p.pan.value = Math.max(-1, Math.min(1, pan));
		src.connect(g).connect(p).connect(this.master);
		src.start();
		return true;
	}

	// Looping add-on sample (engine, scrape), created on first use
	_loop(name) {
		if (!this.ctx || !this.samples[name]) return null;
		if (!this.loops[name] || this.loops[name].buffer !== this.samples[name]) {
			if (this.loops[name]) this.loops[name].src.stop();
			const src = this.ctx.createBufferSource();
			src.buffer = this.samples[name];
			src.loop = true;
			const gain = this.ctx.createGain();
			gain.gain.value = 0;
			src.connect(gain).connect(this.master);
			src.start();
			this.loops[name] = { src, gain, buffer: this.samples[name] };
		}
		return this.loops[name];
	}

	// --- Weapon sounds -----------------------------------------------------------------
	launch() {
		if (!this.ctx || this._sample('launch', 0.8)) return;
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
		if (!this.ctx || this._sample('explosion', strength, pan)) return;
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

	// one gatling round: a short crack with a low thump
	gunShot(strength = 1, pan = 0) {
		if (!this.ctx) return;
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const p = ctx.createStereoPanner();
		p.pan.value = Math.max(-1, Math.min(1, pan));
		p.connect(this.master);
		const src = ctx.createBufferSource();
		src.buffer = this.noiseBuf;
		const f = ctx.createBiquadFilter();
		f.type = 'bandpass';
		f.frequency.value = 2200 + Math.random() * 600;
		f.Q.value = 1.2;
		const g = ctx.createGain();
		g.gain.setValueAtTime(1.0 * strength, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
		src.connect(f).connect(g).connect(p);
		src.start(t, Math.random());
		src.stop(t + 0.08);
		// heavy low thump under each crack
		const o = ctx.createOscillator();
		o.type = 'triangle';
		o.frequency.setValueAtTime(170, t);
		o.frequency.exponentialRampToValueAtTime(45, t + 0.06);
		const og = ctx.createGain();
		og.gain.setValueAtTime(0.9 * strength, t);
		og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
		o.connect(og).connect(p);
		o.start(t);
		o.stop(t + 0.09);
	}

	// a round striking a hull
	tick(strength = 1, pan = 0) {
		if (!this.ctx) return;
		const o = this.ctx.createOscillator();
		o.type = 'square';
		o.frequency.value = 1800 + Math.random() * 800;
		const g = this.ctx.createGain();
		const t = this.ctx.currentTime;
		g.gain.setValueAtTime(0.12 * strength, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
		const p = this.ctx.createStereoPanner();
		p.pan.value = Math.max(-1, Math.min(1, pan));
		o.connect(g).connect(p).connect(this.master);
		o.start(t);
		o.stop(t + 0.04);
	}

	recharge() {
		this._sample('recharge', 0.8);
	}

	// Looping charging sound while in a pit lane: an add-on 'recharge' sample if
	// there is one, otherwise a synthesized crackle over a mains hum
	setRecharging(on) {
		if (!this.ctx || on === !!this._charging) return;
		this._charging = on;
		const t = this.ctx.currentTime;
		if (this.samples.recharge) {
			const l = this._loop('recharge');
			l.gain.gain.setTargetAtTime(on ? 0.6 : 0, t, 0.1);
			return;
		}
		if (!this.chargeVoice) {
			const ctx = this.ctx;
			const out = ctx.createGain();
			out.gain.value = 0;
			out.connect(this.master);
			const hum = ctx.createOscillator();
			hum.type = 'sawtooth';
			hum.frequency.value = 100;
			const humF = ctx.createBiquadFilter();
			humF.type = 'lowpass';
			humF.frequency.value = 500;
			const humG = ctx.createGain();
			humG.gain.value = 0.25;
			hum.connect(humF).connect(humG).connect(out);
			hum.start();
			const crackle = ctx.createBufferSource();
			crackle.buffer = this.noiseBuf;
			crackle.loop = true;
			const cf = ctx.createBiquadFilter();
			cf.type = 'bandpass';
			cf.frequency.value = 3200;
			cf.Q.value = 0.8;
			const cg = ctx.createGain();
			cg.gain.value = 0;
			crackle.connect(cf).connect(cg).connect(out);
			crackle.start();
			// random crackle bursts
			const timer = setInterval(() => {
				const now = ctx.currentTime;
				cg.gain.cancelScheduledValues(now);
				cg.gain.setValueAtTime(Math.random() < 0.4 ? 0.5 + Math.random() * 0.6 : 0.05, now);
				cg.gain.setTargetAtTime(0.05, now + 0.02, 0.03);
			}, 45);
			this.chargeVoice = { out, timer };
		}
		this.chargeVoice.out.gain.setTargetAtTime(on ? 0.35 : 0, t, 0.12);
	}

	pickup() {
		if (this._sample('pickup', 0.8)) return;
		this.beep(880, 0.08, 0.2);
		setTimeout(() => this.beep(1320, 0.12, 0.2), 70);
	}

	click() {
		if (this._sample('click', 0.7)) return;
		this.beep(1200, 0.05, 0.15);
	}
}
