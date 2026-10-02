import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { BUILTIN_TRACKS } from './tracks.js';
import { buildBuiltinTrack, buildSky } from './trackBuilder.js';
import { findPsxTracks, loadPsxTrack } from './psx.js';
import { Craft, CLASSES, collideCrafts } from './craft.js';
import { AIPilot } from './ai.js';
import { buildShip, buildCockpit, TEAMS, shipClass, EYE_IN_SHIP } from './shipModel.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { CanvasPanel, Pointers, COLORS, FONT_DISPLAY } from './ui.js';
import { CockpitHUD, Banner, formatTime } from './hud.js';
import { WeaponSystem, aiUseWeapon, aiGatlingTrigger } from './weapons.js';
import { LoadingScreen } from './loading.js';
import { updateRoutes } from './routes.js';

// Working title. Deliberately not the name of the game that inspired it.
const TITLE = 'ANTIGRAV';
const SUBTITLE = 'VR ANTI-GRAVITY LEAGUE';
const AI_NAMES = ['K. Voss', 'M. Sato', 'J. Reyes', 'T. Halvard', 'A. Petrov', 'D. Okoro', 'L. Marchetti'];
const PHYS_DT = 1 / 120;
// AI aggression levels: top-speed range, how readily they fire, cornering commitment
const AI_LEVELS = [
	{ name: 'Rookie', skill: [0.86, 0.93], fire: 0.25, corner: 0.92 },
	{ name: 'Racer', skill: [0.92, 0.99], fire: 0.55, corner: 0.97 },
	{ name: 'Elite', skill: [0.97, 1.03], fire: 0.8, corner: 1.0 },
	{ name: 'Brutal', skill: [1.0, 1.07], fire: 1.0, corner: 1.04 }
];
const MAX_DT = Number(new URLSearchParams(location.search).get('maxdt')) || 0.05;

const params = new URLSearchParams(location.search);

// --- Renderer, camera rig -----------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Filmic tone mapping tames the brights and gives a less "toy" look
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local'); // seated: origin = head position at session start
renderer.xr.setFoveation?.(1);
document.getElementById('app').appendChild(renderer.domElement);

const vrButton = VRButton.createButton(renderer);
document.getElementById('vr-slot').appendChild(vrButton);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 20000);
const rig = new THREE.Group(); // the pilot's eye point; camera + controllers live here
rig.add(camera);
scene.add(rig);

scene.add(new THREE.HemisphereLight(0xb8c8ff, 0x201828, 1.1));
const sun = new THREE.DirectionalLight(0xfff2e0, 1.8);
sun.position.set(0.4, 1, 0.3);
scene.add(sun);
scene.environment = buildEnvironmentMap(renderer);

// A dark "studio" with a few soft light panels, prefiltered for reflections on
// ship paint, metal and canopies.
function buildEnvironmentMap(renderer) {
	const env = new THREE.Scene();
	const sphere = new THREE.Mesh(
		new THREE.SphereGeometry(10, 32, 16),
		new THREE.ShaderMaterial({
			side: THREE.BackSide,
			vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
			fragmentShader: 'varying vec3 p; void main(){ float h = normalize(p).y; vec3 c = mix(vec3(0.02,0.02,0.03), vec3(0.10,0.13,0.22), smoothstep(-0.2,0.8,h)); gl_FragColor = vec4(c,1.0); }'
		})
	);
	env.add(sphere);
	const panelMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
	for (const [x, y, z, w, h, k] of [[0, 8, 0, 10, 2, 3], [7, 3, -4, 3, 5, 1.2], [-7, 3, 4, 3, 5, 1.0], [0, 2, 9, 6, 1, 0.8]]) {
		const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), panelMat.clone());
		p.material.color.setScalar(k);
		p.position.set(x, y, z);
		p.lookAt(0, 0, 0);
		env.add(p);
	}
	const pmrem = new THREE.PMREMGenerator(renderer);
	const rt = pmrem.fromScene(env, 0.02);
	pmrem.dispose();
	return rt.texture;
}

addEventListener('resize', () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
});

const input = new Input(renderer);
const audio = new Audio();
// Audio needs a user gesture; the first one also starts the title music
function firstGesture() {
	audio.unlock();
	if (state === 'title' && !audio.music.wanted && settings.music !== 'off') audio.playMusic(settings.music, false);
}
addEventListener('pointerdown', firstGesture);
addEventListener('keydown', firstGesture);

const pointers = new Pointers(renderer, camera, onPanelClick);
pointers.attachTo(rig);

// --- Settings -----------------------------------------------------------------------------

const settings = loadSettings();
function loadSettings() {
	const d = { track: 0, team: 0, cls: 'sport', laps: 3, opponents: 7, ai: 1, horizonLock: false, music: 'shuffle' };
	try {
		const s = { ...d, ...JSON.parse(localStorage.getItem('antigrav-settings') || '{}') };
		if (!CLASSES[s.cls]) s.cls = d.cls;
		return s;
	} catch {
		return d;
	}
}
function saveSettings() {
	try {
		localStorage.setItem('antigrav-settings', JSON.stringify(settings));
	} catch {
		/* storage unavailable */
	}
}

// Songs the player supplies: a music/ folder with index.json
// (tools/make-music-index.mjs), a rip from their own disc
// (tools/extract-psx-music.py), or files picked with the "Your music" button.
let musicList = [];
function addMusic(tracks) {
	musicList = musicList.concat(tracks);
	audio.setMusicList(musicList);
	if (typeof settings.music === 'number' && settings.music >= musicList.length) settings.music = 'shuffle';
	menuPanel.redraw();
}
for (const dir of ['music/', 'WIPEOUT2/MUSIC/', 'WIPEOUT/MUSIC/']) {
	fetch(dir + 'index.json')
		.then((r) => (r.ok ? r.json() : null))
		.then((j) => j && addMusic(j.tracks.map((t) => ({ url: dir + t.file, title: t.title || t.file }))))
		.catch(() => {});
}
document.getElementById('music-files').addEventListener('change', (e) => {
	const files = [...e.target.files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|ogg|opus|wav|flac)$/i.test(f.name));
	addMusic(files.map((f) => ({ url: URL.createObjectURL(f), title: f.name.replace(/\.[^.]+$/, '') })));
	settings.music = 'shuffle';
	audio.unlock();
	audio.playMusic('shuffle');
	menuPanel.redraw();
});

let trackList = BUILTIN_TRACKS.map((def) => ({ kind: 'builtin', name: def.name, blurb: def.blurb, def }));
let psxStatus = 'Looking for original PSX track data...';
findPsxTracks().then((found) => {
	trackList = trackList.concat(found.map((def) => ({ kind: 'psx', name: def.name, blurb: 'Track data from your own disc', def })));
	psxStatus = found.length
		? `${found.length} track(s) loaded from your disc data`
		: 'Own a supported PS1 disc? See the README to race its tracks';
	if (settings.track >= trackList.length) settings.track = 0;
	menuPanel.redraw();
	maybeAutostart();
});

// --- Title screen -------------------------------------------------------------------------

const titleGroup = new THREE.Group();
const titleTheme = { skyTop: 0x02040f, skyBottom: 0x1a0f3a };
titleGroup.add(buildSky(titleTheme));
{
	const grid = new THREE.GridHelper(400, 200, 0x2ad1ff, 0x1a3a7a);
	grid.position.y = -1.25;
	grid.material.transparent = true;
	grid.material.opacity = 0.5;
	titleGroup.add(grid);
}
let titleShip = null;
function updateTitleShip() {
	const rot = titleShip ? titleShip.rotation.y : 0;
	if (titleShip) {
		titleGroup.remove(titleShip);
		// add-on models share geometry/materials between builds: leave those alone
		if (!titleShip.userData.shared) disposeObject(titleShip);
	}
	const team = TEAMS[settings.team] || TEAMS[0];
	titleShip = buildShip(team);
	titleShip.userData.shared = !!team.buildModel;
	titleShip.scale.setScalar(0.4);
	titleShip.position.set(0, -0.78, -3.7);
	titleShip.rotation.y = rot;
	titleGroup.add(titleShip);
}
updateTitleShip();
const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 0.25, 32), new THREE.MeshLambertMaterial({ color: 0x1a2236 }));
podium.position.set(0, -1.08, -3.7);
titleGroup.add(podium);
const podiumRing = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.03, 6, 48), new THREE.MeshBasicMaterial({ color: 0x2ad1ff }));
podiumRing.rotation.x = Math.PI / 2;
podiumRing.position.set(0, -0.95, -3.7);
titleGroup.add(podiumRing);

const logoPanel = new CanvasPanel(1024, 300, 2.6);
logoPanel.interactive = false;
logoPanel.mesh.position.set(0, 0.95, -3.2);
titleGroup.add(logoPanel.mesh);
logoPanel.setDraw((ctx, p) => {
	const g = ctx.createLinearGradient(0, 40, 0, 220);
	g.addColorStop(0, '#ffffff');
	g.addColorStop(0.5, '#2ad1ff');
	g.addColorStop(1, '#1f4fd8');
	ctx.font = `900 170px ${FONT_DISPLAY}`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.lineWidth = 12;
	ctx.strokeStyle = 'rgba(0,0,0,0.6)';
	ctx.strokeText(TITLE, 512, 130);
	ctx.fillStyle = g;
	ctx.fillText(TITLE, 512, 130);
	ctx.fillStyle = COLORS.accent2;
	ctx.fillRect(170, 236, 684, 6);
	p.text(SUBTITLE, 512, 272, { size: 38, align: 'center', color: COLORS.accent2, italic: true });
});

const menuPanel = new CanvasPanel(1024, 1300, 1.2);
menuPanel.mesh.position.set(1.22, -0.22, -1.85);
menuPanel.mesh.rotation.y = -0.5;
titleGroup.add(menuPanel.mesh);

let loadingMessage = '';
menuPanel.setDraw((ctx, p) => {
	p.background();
	p.text('RACE SETUP', 512, 70, { size: 56, align: 'center', italic: true, color: COLORS.accent });
	const t = trackList[settings.track] || trackList[0];
	const team = TEAMS[settings.team] || TEAMS[0];
	const rows = [
		['TRACK', t.name, 'track'],
		['SHIP', `${team.ship} (${team.name})`, 'team'],
		['CLASS', CLASSES[settings.cls].name, 'cls'],
		['LAPS', String(settings.laps), 'laps'],
		['RIVALS', String(settings.opponents), 'opp'],
		['AI', null, 'ai'],
		['VIEW', settings.horizonLock ? 'Horizon locked' : 'Cockpit locked', 'view']
	];
	rows.push(['MUSIC', musicLabel(), 'music']);
	let y = 150;
	for (const [label, value, id] of rows) {
		p.text(label, 60, y + 45, { size: 32, color: COLORS.dim });
		p.button(id + '-', 250, y + 10, 80, 72, '<', { size: 44 });
		if (id === 'ai') {
			// aggression slider: segments plus the level name
			const lvl = settings.ai ?? 1;
			p.text(AI_LEVELS[lvl].name.toUpperCase(), 622, y + 30, { size: 30, align: 'center', color: ['#40ff80', '#2ad1ff', '#ffd21f', '#ff4040'][lvl] });
			for (let k = 0; k < AI_LEVELS.length; k++) {
				ctx.fillStyle = k <= lvl ? ['#40ff80', '#2ad1ff', '#ffd21f', '#ff4040'][lvl] : 'rgba(255,255,255,0.12)';
				ctx.fillRect(400 + k * 112, y + 56, 102, 14);
			}
		} else {
			p.text(value, 622, y + 46, { size: 40, align: 'center', maxWidth: 540 });
		}
		p.button(id + '+', 914, y + 10, 80, 72, '>', { size: 44 });
		y += 84;
		if (id === 'track' || id === 'team') {
			p.text(id === 'track' ? t.blurb : team.blurb, 622, y + 6, { size: 24, align: 'center', color: COLORS.dim, weight: 'normal', maxWidth: 620 });
			y += 36;
		}
		if (id === 'team') {
			// handling bars relative to the field
			const st = team.stats;
			const bars = [['SPEED', st.speed, 0.94, 1.07], ['THRUST', st.accel, 0.9, 1.1], ['HANDLING', (st.turn + st.grip) / 2, 0.86, 1.14]];
			bars.forEach(([name, v, lo, hi], k) => {
				const x = 330 + k * 200;
				p.text(name, x, y + 4, { size: 18, color: COLORS.dim, weight: 'normal' });
				ctx.fillStyle = 'rgba(255,255,255,0.12)';
				ctx.fillRect(x, y + 18, 170, 8);
				ctx.fillStyle = COLORS.accent;
				ctx.fillRect(x, y + 18, 170 * Math.max(0.08, Math.min(1, (v - lo) / (hi - lo))), 8);
			});
			y += 40;
		}
	}
	p.button('start', 212, y + 40, 600, 120, loadingMessage || 'START RACE', { size: 56, primary: true });
	p.text(psxStatus, 512, y + 210, { size: 24, align: 'center', color: COLORS.dim, weight: 'normal' });
	if (!renderer.xr.isPresenting) {
		p.text('Click "ENTER VR" below the view to race in your headset,', 512, y + 260, { size: 24, align: 'center', color: COLORS.dim, weight: 'normal' });
		p.text('or race right here with the keyboard / a gamepad.', 512, y + 292, { size: 24, align: 'center', color: COLORS.dim, weight: 'normal' });
	}
});

const helpPanel = new CanvasPanel(1024, 1100, 1.2);
helpPanel.interactive = false;
helpPanel.mesh.position.set(-1.22, -0.22, -1.85);
helpPanel.mesh.rotation.y = 0.5;
titleGroup.add(helpPanel.mesh);
helpPanel.setDraw((ctx, p) => {
	p.background();
	p.text('HOW TO FLY', 512, 70, { size: 56, align: 'center', italic: true, color: COLORS.accent });
	const lines = [
		['VR CONTROLLERS', null],
		['Thrust', 'Right trigger'],
		['Brake', 'Left trigger'],
		['Steer', 'Thumbstick'],
		['Airbrakes', 'Grip buttons (L / R)'],
		['Fire weapon', 'A or X'],
		['Pause', 'Hold B (right)'],
		['', null],
		['KEYBOARD / GAMEPAD', null],
		['Thrust', 'W / Up / Space  -  RT'],
		['Brake', 'S / Down  -  LT'],
		['Steer', 'A D / Left Right  -  stick'],
		['Airbrakes', 'Q / E  -  LB / RB'],
		['Fire weapon', 'F / Enter  -  X / B'],
		['Pause', 'Esc / P  -  Start']
	];
	let y = 150;
	for (const [a, b] of lines) {
		if (b === null) {
			p.text(a, 60, y, { size: 32, color: COLORS.accent2, italic: true });
		} else {
			p.text(a, 80, y, { size: 32, color: COLORS.dim });
			p.text(b, 400, y, { size: 32 });
		}
		y += 56;
	}
	p.text('Airbrakes tighten your line through fast corners.', 512, y + 30, { size: 26, align: 'center', color: COLORS.dim, weight: 'normal' });
	p.text('Blue chevrons boost you; target tiles give you a weapon.', 512, y + 66, { size: 26, align: 'center', color: COLORS.dim, weight: 'normal' });
	p.text('Seated play recommended. Recenter: hold the Oculus button.', 512, y + 102, { size: 26, align: 'center', color: COLORS.dim, weight: 'normal' });
});

renderer.xr.addEventListener('sessionstart', () => menuPanel.redraw());
// Canvas text only uses web fonts once they've loaded: redraw the panels then
document.fonts?.load(`700 40px ${FONT_DISPLAY}`).then(() => document.fonts.ready).then(() => {
	for (const p of [logoPanel, menuPanel, helpPanel]) p.redraw();
});
renderer.xr.addEventListener('sessionend', () => menuPanel.redraw());

// --- Race state -----------------------------------------------------------------------------

let state = 'title';
let race = null; // everything about the current race
let elapsed = 0;

function showTitle() {
	state = 'title';
	disposeRace();
	scene.remove(loading.group);
	scene.add(titleGroup);
	scene.fog = null;
	scene.background = new THREE.Color(0x02040f);
	scene.add(rig);
	rig.position.set(0, 0, 0);
	rig.quaternion.identity();
	camera.rotation.set(0, 0, 0);
	pointers.setPanels([menuPanel]);
	audio.setRacing(false);
	loadingMessage = '';
	menuPanel.redraw();
}

function musicLabel() {
	if (settings.music === 'off') return 'Off';
	if (settings.music === 'synth' || !musicList.length) return 'Built-in synth';
	if (settings.music === 'shuffle') return 'Shuffle my songs';
	return musicList[settings.music]?.title || 'Shuffle my songs';
}

// --- Loading screen -------------------------------------------------------------------------

const loading = new LoadingScreen();

function showLoading(title) {
	disposeRace();
	scene.remove(titleGroup);
	scene.add(loading.group, rig);
	scene.fog = new THREE.FogExp2(0x02040f, 0.012);
	scene.background = new THREE.Color(0x02040f);
	rig.position.set(0, 0, 0);
	rig.quaternion.identity();
	camera.rotation.set(0, 0, 0);
	pointers.setPanels([]);
	loading.reset(title);
	const team = TEAMS[settings.team] || TEAMS[0];
	const ship = buildShip(team);
	ship.userData.shared = !!team.buildModel;
	loading.setShip(ship);
	state = 'loading';
	audio.setRacing(false);
	if (settings.music !== 'off') audio.loadingMusic(true);
}

function hideLoading() {
	scene.remove(loading.group);
	const ship = loading.ship;
	loading.setShip(null);
	if (ship && !ship.userData.shared) disposeObject(ship);
	audio.loadingMusic(false);
}

function cycle(id, dir) {
	switch (id) {
		case 'track':
			settings.track = (settings.track + dir + trackList.length) % trackList.length;
			break;
		case 'team':
			settings.team = (settings.team + dir + TEAMS.length) % TEAMS.length;
			updateTitleShip();
			break;
		case 'cls': {
			const keys = Object.keys(CLASSES);
			settings.cls = keys[(keys.indexOf(settings.cls) + dir + keys.length) % keys.length];
			break;
		}
		case 'laps':
			settings.laps = ((settings.laps - 1 + dir + 5) % 5) + 1;
			break;
		case 'opp':
			settings.opponents = (settings.opponents + dir + 8) % 8;
			break;
		case 'ai':
			settings.ai = Math.max(0, Math.min(AI_LEVELS.length - 1, (settings.ai ?? 1) + dir));
			break;
		case 'view':
			settings.horizonLock = !settings.horizonLock;
			break;
		case 'music': {
			// off, shuffle, then each song
			const opts = musicList.length ? ['off', 'synth', 'shuffle', ...musicList.map((_, i) => i)] : ['off', 'synth'];
			if (!musicList.length && settings.music === 'shuffle') settings.music = 'synth';
			settings.music = opts[(opts.indexOf(settings.music) + dir + opts.length) % opts.length];
			audio.playMusic(settings.music);
			break;
		}
	}
	saveSettings();
}

function onPanelClick(panel, id) {
	audio.unlock();
	audio.click();
	if (state === 'title' && !audio.music.wanted && settings.music !== 'off') audio.playMusic(settings.music, false);
	if (panel === menuPanel && state === 'title') {
		if (id === 'start') startRace();
		else cycle(id.slice(0, -1), id.endsWith('+') ? 1 : -1);
		menuPanel.redraw();
	} else if (race && panel === race.pausePanel) {
		if (id === 'resume') resume();
		if (id === 'restart') startRace();
		if (id === 'quit') showTitle();
	} else if (race && panel === race.resultsPanel) {
		if (id === 'again') startRace();
		if (id === 'menu') showTitle();
	}
}

// The last loaded track is kept so "race again" doesn't rebuild it (disc
// tracks take a while to decode on a standalone headset).
let trackCache = null;

async function startRace() {
	if (state === 'loading') return;
	const entry = trackList[settings.track] || trackList[0];
	showLoading(entry.name.toUpperCase());
	const progress = (f, detail) => {
		loading.set(f, detail);
		audio.loadingProgress(f);
	};
	try {
		// Let the loading screen render before the build work
		await new Promise((r) => setTimeout(r, 60));
		let track;
		if (trackCache && trackCache.entry === entry) {
			track = trackCache.track;
		} else {
			if (trackCache) disposeObject(trackCache.track.group, trackCache.track.sky);
			trackCache = null;
			progress(0.1, 'Building circuit');
			await new Promise((r) => setTimeout(r, 30));
			track =
				entry.kind === 'psx' ? await loadPsxTrack(entry.def, undefined, progress) : entry.kind === 'mod' ? await entry.load(progress) : buildBuiltinTrack(entry.def);
			trackCache = { entry, track };
		}
		progress(1, 'Ready');
		hideLoading();
		setupRace(track);
	} catch (e) {
		console.error(e);
		hideLoading();
		showTitle();
		loadingMessage = 'LOAD FAILED';
		menuPanel.redraw();
	}
}

function disposeObject(...objects) {
	for (const root of objects) {
		root?.traverse((o) => {
			if (o.geometry) o.geometry.dispose();
			const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
			for (const m of mats) {
				if (m.map) m.map.dispose();
				m.dispose();
			}
		});
	}
}

function setupRace(track) {
	const group = new THREE.Group();
	group.add(track.group);
	if (track.sky) group.add(track.sky);
	scene.add(group);
	scene.fog = track.fog;
	scene.background = track.background;

	const cls = CLASSES[settings.cls];
	const playerTeam = TEAMS[settings.team] || TEAMS[0];
	const path = track.path;
	const total = settings.opponents + 1;
	const crafts = [];
	const pilots = [];
	const meshes = [];
	const hw = path.halfWidthAt(0);
	for (let i = 0; i < total; i++) {
		const row = Math.floor(i / 2);
		const s = -14 - row * 13;
		const x = (i % 2 ? 1 : -1) * Math.min(hw * 0.38, 5);
		const isPlayer = i === total - 1; // start from the back, like the classics
		const level = AI_LEVELS[settings.ai ?? 1];
		const skill = isPlayer ? 1 : level.skill[0] + (level.skill[1] - level.skill[0]) * (i / Math.max(1, total - 2));
		// AI pilots are spread over the teams of the same group as the player's
		// (built-in teams, or e.g. an add-on's teams), using each team's spare liveries
		const pool = TEAMS.filter((t) => (t.group || 'builtin') === (playerTeam.group || 'builtin'));
		const team = isPlayer ? playerTeam : pool[i % pool.length];
		const spare = team.liveries.length - 1;
		const liveryIndex = isPlayer || spare < 1 ? 0 : 1 + (Math.floor(i / pool.length) % spare);
		const craft = new Craft(path, shipClass(cls, team), { s, x, skill });
		craft.baseSkill = skill;
		craft.isPlayer = isPlayer;
		craft.team = team;
		craft.name = isPlayer ? 'YOU' : AI_NAMES[i % AI_NAMES.length];
		craft.colorCss = '#' + team.liveries[liveryIndex % team.liveries.length].glow.toString(16).padStart(6, '0');
		crafts.push(craft);
		pilots.push(isPlayer ? null : new AIPilot(craft, { lane: ((i % 3) - 1) * 1.5, aggression: level.corner * (0.97 + Math.random() * 0.06) }));
		craft.fireWill = isPlayer ? 1 : level.fire;
		const mesh = buildShip(team, liveryIndex, { cockpit: isPlayer, number: i + 1 });
		group.add(mesh);
		meshes.push(mesh);
	}
	const player = crafts[total - 1];
	const playerMesh = meshes[total - 1];

	// Cockpit + pilot rig
	const cockpit = buildCockpit(playerTeam.liveries[0]);
	const cockpitMount = new THREE.Group();
	cockpitMount.position.copy(EYE_IN_SHIP);
	cockpitMount.add(cockpit.group);
	playerMesh.add(cockpitMount);
	const rigMount = new THREE.Group();
	rigMount.position.copy(EYE_IN_SHIP);
	playerMesh.add(rigMount);
	rigMount.add(rig);
	rig.position.set(0, 0, 0);
	rig.quaternion.identity();
	if (params.get('view') === 'chase') {
		rig.position.set(0, 2.2, 11);
		rig.rotation.x = -0.12;
	}
	// On a flat screen, look slightly down so the cockpit screens are in view
	// (in VR the headset pose replaces this)
	camera.rotation.set(params.get('view') === 'chase' ? 0 : -0.2, 0, 0);

	const hud = new CockpitHUD(cockpit.hudMounts, path);
	const banner = new Banner(rigMount);

	const pausePanel = makeOverlayPanel(rigMount, 1024, 640, 1.0);
	pausePanel.setDraw((ctx, p) => {
		p.background();
		p.text('PAUSED', 512, 90, { size: 72, align: 'center', italic: true, color: COLORS.accent });
		p.button('resume', 262, 170, 500, 110, 'RESUME', { size: 50, primary: true });
		p.button('restart', 262, 310, 500, 110, 'RESTART', { size: 50 });
		p.button('quit', 262, 450, 500, 110, 'QUIT TO MENU', { size: 50 });
	});
	const resultsPanel = makeOverlayPanel(rigMount, 1024, 1024, 1.15);

	race = {
		track,
		group,
		crafts,
		pilots,
		meshes,
		player,
		playerMesh,
		cockpit,
		cockpitMount,
		rigMount,
		hud,
		banner,
		pausePanel,
		resultsPanel,
		laps: settings.laps,
		time: -3.999, // countdown runs from -4 to 0
		acc: 0,
		finishOrder: [],
		lastCount: 4,
		playerLap: 0,
		shake: 0,
		resultsAt: 0,
		lights: track.group.getObjectByName('startLights'),
		autopilot: params.get('autopilot') === '1' ? new AIPilot(player, { lane: 0 }) : null,
		assist: new AIPilot(player, { lane: 0 }), // drives during the autopilot pickup
		shieldWarned: false,
		lastWrongWay: 0
	};
	race.weapons = new WeaponSystem(path, group, crafts, weaponEvents(race));
	race.routeEvents = {
		enter(c, b) {
			if (!c.isPlayer) return;
			if (b.pit) {
				audio.say('recharging', true);
				audio.recharge();
				race.banner.show('RECHARGING', elapsed, 1.6, '#40ff80');
			} else {
				race.banner.show('ALTERNATIVE ROUTE', elapsed, 1.2, COLORS.accent);
			}
		}
	};
	// team specials: built-in gatling
	crafts.forEach((c, i) => c.team.special === 'gatling' && race.weapons.attachGun(meshes[i], c));
	state = 'countdown';
	pointers.setPanels([]);
	audio.setRacing(true);
	audio.playMusic(settings.music, true);
	for (let i = 0; i < crafts.length; i++) {
		crafts[i].updatePose();
		meshes[i].position.copy(crafts[i].position);
		meshes[i].quaternion.copy(crafts[i].quaternion);
	}
}

function makeOverlayPanel(parent, w, h, worldW) {
	const p = new CanvasPanel(w, h, worldW, { overlay: true });
	p.mesh.position.set(0, -0.1, -1.3);
	p.mesh.visible = false;
	parent.add(p.mesh);
	return p;
}

function pause() {
	state = 'paused';
	race.pausePanel.mesh.visible = true;
	pointers.setPanels([race.pausePanel]);
	audio.setRacing(false);
	audio.pauseMusic(true);
}

function resume() {
	state = race.time < 0 ? 'countdown' : 'race';
	race.pausePanel.mesh.visible = false;
	pointers.setPanels([]);
	audio.setRacing(true);
	audio.pauseMusic(false);
}

function disposeRace() {
	if (!race) return;
	scene.add(rig);
	scene.remove(race.group);
	// the track itself stays cached for the next race
	race.group.remove(race.track.group);
	if (race.track.sky) race.group.remove(race.track.sky);
	disposeObject(race.group);
	race = null;
}

// --- Race loop --------------------------------------------------------------------------------

function standings(r = race) {
	const done = r.finishOrder;
	const rest = r.crafts.filter((c) => !c.finished).sort((a, b) => a.eliminated - b.eliminated || b.progress - a.progress);
	return done.concat(rest);
}

function weaponEvents(r) {
	const nearPlayer = (c) => {
		const d = c.position.distanceTo(r.player.position);
		return { strength: Math.max(0.15, 1 - d / 150), pan: _v.subVectors(c.position, r.player.position).dot(r.player.frame.right) / Math.max(d, 1) };
	};
	return {
		pickup(c, w) {
			if (!c.isPlayer) return;
			audio.pickup();
			audio.say(w.id);
		},
		fired(c, w, target) {
			if (c.isPlayer || c.position.distanceTo(r.player.position) < 80) audio.launch();
			if (w.id === 'missile' && target === r.player) audio.say('missile_incoming', true);
		},
		hit(target, by, kind) {
			const n = nearPlayer(target);
			if (kind === 'round') {
				if (n.strength > 0.3) audio.tick(n.strength, n.pan);
				if (target.isPlayer) {
					r.shake = Math.max(r.shake, 0.25);
					haptic(0.3);
				}
				return;
			}
			audio.explosion(n.strength * 0.8, n.pan);
			if (target.isPlayer) {
				r.shake = 1;
				haptic(1);
			}
		},
		gunShot(c) {
			const n = nearPlayer(c);
			if (c.isPlayer || n.strength > 0.25) audio.gunShot(c.isPlayer ? 0.8 : n.strength * 0.7, c.isPlayer ? 0 : n.pan);
		},
		overheat(c) {
			if (!c.isPlayer) return;
			audio.beep(220, 0.25, 0.2);
			r.banner.show('OVERHEAT', elapsed, 0.9, '#ff4040');
		},
		eliminated(target, by) {
			const n = nearPlayer(target);
			audio.explosion(n.strength, n.pan);
			const i = r.crafts.indexOf(target);
			r.meshes[i].visible = target.isPlayer; // keep your own cockpit
			if (target.isPlayer) {
				audio.say('player_eliminated', true);
				r.banner.show('ELIMINATED', elapsed, 3, '#ff4040');
				r.resultsAt = elapsed + 4;
			} else {
				audio.say(by === r.player ? 'opponent_destroyed' : 'contender_eliminated');
				if (by === r.player) r.banner.show('OPPONENT DESTROYED', elapsed, 1.6, '#ff9a3d');
			}
		},
		autopilot(c, on) {
			if (c.isPlayer && on) {
				audio.say('autopilot_on');
				r.banner.show('AUTOPILOT', elapsed, 1.2, '#40ff80');
			}
		}
	};
}

function stepRace(dt) {
	const r = race;
	const now = elapsed;
	const counting = r.time < 0;

	// Countdown lights and beeps
	if (counting) {
		const count = Math.ceil(-r.time);
		if (count !== r.lastCount && count <= 3) {
			r.banner.show(String(count), now, 0.9, COLORS.text);
			audio.beep(520, 0.12, 0.15);
			audio.say(['', 'one', 'two', 'three'][count], true);
			setLight(3 - count, 0xff2020);
		}
		r.lastCount = count;
	}

	// Player input
	const inp = input.state;
	const pc = r.player;
	if (r.autopilot || pc.finished) {
		(r.autopilot || (r.autopilot = new AIPilot(pc, { lane: 0 }))).update(dt, r.crafts);
	} else if (pc.autopilotTime > 0) {
		r.assist.update(dt, r.crafts);
		pc.autopilotTime -= dt;
		if (pc.autopilotTime <= 0) {
			audio.say('autopilot_off');
			r.banner.show('MANUAL', now, 1.0, COLORS.accent2);
		}
	} else {
		Object.assign(pc.input, inp);
	}
	if (input.firePressed && state === 'race' && !pc.finished) r.weapons.fire(pc);
	if (pc.eliminated) Object.assign(pc.input, { steer: 0, thrust: 0, brake: 0, airL: 0, airR: 0 });

	// Fixed-step physics
	r.acc += dt;
	while (r.acc >= PHYS_DT) {
		r.acc -= PHYS_DT;
		const wasCounting = r.time < 0;
		r.time += PHYS_DT;
		if (wasCounting && r.time >= 0) {
			r.banner.show('GO!', now, 1.0, '#40ff80');
			if (audio.songTitle) r.songAt = now + 1.3;
			audio.beep(1040, 0.3, 0.15);
			audio.say('go', true);
			setLight(-1, 0x20ff40);
			state = 'race';
		}
		if (r.time < 0) continue; // ships hold on the grid
		for (let i = 0; i < r.crafts.length; i++) {
			const c = r.crafts[i];
			const pilot = r.pilots[i];
			if (c.eliminated) continue;
			r.weapons.tryPickup(c, r.time);
			if (r.time - c.lastHit > 3) c.energy = Math.min(100, c.energy + 4 * PHYS_DT);
			if (pilot) aiUseWeapon(c, r.crafts, r.weapons, r.time);
			if (c.team.special === 'gatling') {
				const trigger = c.isPlayer ? input.fireHeld && !c.weapon && state === 'race' : r.time > 6 && aiGatlingTrigger(c, r.crafts);
				r.weapons.gatling(c, trigger, PHYS_DT, r.time);
			}
			if (pilot) {
				// gentle rubber banding around the player
				const d = c.progress - pc.progress;
				c.skill = c.baseSkill * (1 - THREE.MathUtils.clamp(d / 500, -1, 1) * 0.05);
				pilot.update(PHYS_DT, r.crafts);
			}
			const lapBefore = c.lap;
			c.step(PHYS_DT, r.time);
			if (c.lap > lapBefore && c.lap > r.laps && !c.finished) {
				c.finished = true;
				c.finishTime = r.time;
				r.finishOrder.push(c);
			}
			if (c.energy <= 0 && !c.eliminated) r.weapons.eliminate(c, null);
			// pit lanes recharge the shield
			if (c.route?.pit) c.energy = Math.min(100, c.energy + 25 * PHYS_DT);
		}
		collideCrafts(r.crafts);
		updateRoutes(r.crafts, r.track, r.time, r.routeEvents);
		for (const c of r.crafts) {
			// a lap can also complete when a pit lane rejoins past the line
			if (c.lap > r.laps && !c.finished && !c.eliminated) {
				c.finished = true;
				c.finishTime = r.time;
				r.finishOrder.push(c);
			}
		}
		r.weapons.step(PHYS_DT, r.time);
		if (pc.wallHit > 0.05) r.shake = Math.max(r.shake, pc.wallHit);
		if (pc.boostHit) audio.whoosh();
	}

	if (r.songAt && now >= r.songAt) {
		r.songAt = 0;
		r.banner.show(`♪ ${audio.songTitle}`, now, 2.5, COLORS.accent);
	}

	// Lap messages
	if (pc.lap !== r.playerLap) {
		if (pc.lap > r.playerLap && pc.lap > 1 && pc.lap <= r.laps) {
			r.banner.show(pc.lap === r.laps ? 'FINAL LAP' : `LAP ${pc.lap}`, now, 1.6);
			audio.beep(880, 0.15, 0.15);
			audio.say(pc.lap === r.laps ? 'final_lap' : ['', '', 'lap_two', 'lap_three', 'lap_four'][pc.lap] || 'final_lap');
		}
		r.playerLap = pc.lap;
	}
	if (pc.finished && !r.resultsAt) {
		const pos = r.finishOrder.indexOf(pc) + 1;
		r.banner.show(pos === 1 ? 'WINNER!' : `FINISHED ${ordinal(pos)}`, now, 3.5, pos === 1 ? '#40ff80' : COLORS.accent2);
		r.resultsAt = now + 3.5;
		audio.beep(1320, 0.3, 0.15);
		audio.say('race_complete');
	}
	if (pc.wrongWay > 1.2 && !pc.finished && now - r.lastWrongWay > 3) {
		r.lastWrongWay = now;
		r.banner.show('WRONG WAY', now, 0.8, '#ff4040');
		audio.say('wrong_way');
	}
	if (pc.energy < 25 && !pc.eliminated && !r.shieldWarned) {
		r.shieldWarned = true;
		audio.say('shield_critical', true);
	} else if (pc.energy > 40) r.shieldWarned = false;
	if (r.resultsAt && now >= r.resultsAt && state === 'race') showResults();
	if (pc.eliminated && !r.resultsAt) r.resultsAt = now + 3;

	updateVisuals(dt, now);
}

function setLight(index, color) {
	const L = race.lights;
	if (!L) return;
	L.children.forEach((m, i) => {
		if (index === -1) m.material.color.set(color);
		else if (i === index) m.material.color.set(color);
	});
}

function ordinal(n) {
	return n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0] || 'th');
}

const _fwd = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

function updateVisuals(dt, now) {
	const r = race;
	for (let i = 0; i < r.crafts.length; i++) {
		const c = r.crafts[i];
		c.updatePose(c.isPlayer ? 0.3 : 1);
		const m = r.meshes[i];
		m.position.copy(c.position);
		m.quaternion.copy(c.quaternion);
		const glow = 0.6 + c.input.thrust * 0.6 + (c.boostTime > 0 ? 0.6 : 0);
		for (const g of m.userData.glows) g.scale.setScalar(g.userData.baseScale * glow * (0.9 + Math.random() * 0.2));
	}

	// Cockpit shake on impacts (the cockpit moves, not your head)
	r.shake = Math.max(0, r.shake - dt * 3);
	const sh = r.shake * 0.02;
	r.cockpitMount.position.set(EYE_IN_SHIP.x + (Math.random() - 0.5) * sh, EYE_IN_SHIP.y + (Math.random() - 0.5) * sh, EYE_IN_SHIP.z);
	if (r.shake > 0.1) haptic(r.shake);

	// Yoke follows steering
	r.cockpit.yoke.rotation.z = THREE.MathUtils.lerp(r.cockpit.yoke.rotation.z, -r.player.input.steer * 0.6, Math.min(1, dt * 10));

	// Optional horizon lock: strip roll from the pilot's view
	if (settings.horizonLock && params.get('view') !== 'chase') {
		r.playerMesh.updateMatrixWorld();
		const shipQ = r.playerMesh.getWorldQuaternion(_q);
		_fwd.set(0, 0, -1).applyQuaternion(shipQ);
		_m4.lookAt(_v.set(0, 0, 0), _fwd, THREE.Object3D.DEFAULT_UP);
		const desired = new THREE.Quaternion().setFromRotationMatrix(_m4);
		r.rigMount.quaternion.copy(shipQ.invert().multiply(desired));
	}

	r.weapons.updateVisuals(now, dt);

	// ionising field around ships recharging in a pit lane
	for (let i = 0; i < r.crafts.length; i++) {
		const c = r.crafts[i];
		const on = !!c.route?.pit && !c.eliminated;
		if (on && !c.aura) c.aura = makeAura(r.meshes[i]);
		if (c.aura) {
			c.aura.visible = on;
			if (on) {
				const flick = 0.55 + 0.45 * Math.random();
				c.aura.children[0].material.opacity = 0.22 * flick;
				c.aura.children[1].material.opacity = 0.3 * flick;
				c.aura.children[1].rotation.z += dt * 3.1;
				c.aura.children[1].rotation.x += dt * 1.7;
				c.aura.scale.setScalar(1 + Math.sin(now * 31) * 0.02);
			}
		}
	}
	audio.setRecharging(!!r.player.route?.pit && !r.player.eliminated);

	// Sky follows the camera
	if (r.track.sky) r.track.sky.position.copy(camera.getWorldPosition(_v));

	// HUD
	const st = standings();
	const pc = r.player;
	const best = pc.lapTimes.length ? Math.min(...pc.lapTimes) : 0;
	r.hud.update(now, {
		speed: pc.speed,
		maxSpeed: pc.cls.maxSpeed,
		lap: pc.lap,
		laps: r.laps,
		position: st.indexOf(pc) + 1,
		total: r.crafts.length,
		lapTime: r.time > 0 && pc.lap >= 1 ? r.time - pc.lapStart : 0,
		bestLap: best,
		boosting: pc.boostTime > 0,
		energy: pc.energy,
		weapon: pc.weapon,
		gun: pc.team?.special === 'gatling' ? pc.gun || { heat: 0, overheated: false } : null,
		player: pc,
		crafts: r.crafts,
		projectiles: r.weapons.projectiles
	});
	r.banner.update(now);

	// Audio: engine + nearest rival
	let rival = null;
	const pr = pc.frame.right;
	for (const c of r.crafts) {
		if (c === pc) continue;
		const d = c.position.distanceTo(pc.position);
		if (!rival || d < rival.distance) rival = { distance: d, pan: _v.subVectors(c.position, pc.position).dot(pr) / Math.max(d, 1), speed: c.speed };
	}
	audio.update(pc.speed, pc.input.thrust, Math.max(pc.wallHit, r.shake * 0.5), rival);
}

// Translucent electric shell plus turning arc lines, wrapped round a ship
function makeAura(shipMesh) {
	const aura = new THREE.Group();
	const shell = new THREE.Mesh(
		new THREE.SphereGeometry(1, 24, 16),
		new THREE.MeshBasicMaterial({ color: 0x8ff0ff, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
	);
	const arcs = new THREE.Mesh(
		new THREE.IcosahedronGeometry(1.04, 2),
		new THREE.MeshBasicMaterial({ color: 0x58d8ff, wireframe: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
	);
	aura.add(shell, arcs);
	aura.children.forEach((m) => m.scale.set(2.9, 0.95, 4.5));
	aura.position.set(0, 0.55, 0);
	aura.visible = false;
	shipMesh.add(aura);
	return aura;
}

let lastHaptic = 0;
function haptic(strength) {
	const session = renderer.xr.getSession();
	if (!session || elapsed - lastHaptic < 0.08) return;
	lastHaptic = elapsed;
	for (const src of session.inputSources) {
		const h = src.gamepad?.hapticActuators?.[0];
		h?.pulse?.(Math.min(1, strength), 60);
	}
}

function showResults() {
	const r = race;
	state = 'results';
	audio.setRacing(false);
	r.resultsPanel.mesh.visible = true;
	r.resultsPanel.setDraw((ctx, p) => {
		p.background();
		p.text('RESULTS', 512, 70, { size: 64, align: 'center', italic: true, color: COLORS.accent });
		p.text(r.track.name, 512, 130, { size: 32, align: 'center', color: COLORS.dim });
		// use the captured race: this panel can redraw (hover change) after the race is gone
		const st = standings(r);
		let y = 200;
		p.text('POS', 70, y, { size: 26, color: COLORS.dim });
		p.text('PILOT', 180, y, { size: 26, color: COLORS.dim });
		p.text('TIME', 640, y, { size: 26, color: COLORS.dim });
		p.text('BEST LAP', 800, y, { size: 26, color: COLORS.dim });
		y += 50;
		st.forEach((c, i) => {
			const col = c.isPlayer ? COLORS.accent2 : COLORS.text;
			p.text(String(i + 1), 80, y, { size: 34, color: col });
			p.text(c.name, 180, y, { size: 34, color: col });
			p.text(c.finished ? formatTime(c.finishTime) : c.eliminated ? 'OUT' : 'racing', 640, y, { size: 30, color: c.eliminated ? '#ff4040' : col, weight: 'normal' });
			p.text(c.lapTimes.length ? formatTime(Math.min(...c.lapTimes)) : '--', 800, y, { size: 30, color: col, weight: 'normal' });
			y += 54;
		});
		p.button('again', 120, 880, 360, 100, 'RACE AGAIN', { size: 44, primary: true });
		p.button('menu', 544, 880, 360, 100, 'MAIN MENU', { size: 44 });
	});
	pointers.setPanels([r.resultsPanel]);
}

// --- Main loop -----------------------------------------------------------------------------------

const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
	timer.update();
	const dt = Math.min(MAX_DT, timer.getDelta());
	elapsed += dt;
	input.update();

	if (state === 'loading') {
		loading.bpm = audio.loadingTheme?.dnb ? 172 : 134;
		loading.update(dt, elapsed);
	} else if (state === 'title') {
		titleShip.rotation.y += dt * 0.4;
		titleShip.position.y = -0.78 + Math.sin(elapsed * 1.5) * 0.04;
	} else if (race) {
		if (input.pausePressed && (state === 'race' || state === 'countdown')) pause();
		else if (input.pausePressed && state === 'paused') resume();
		if (state === 'race' || state === 'countdown') stepRace(dt);
		else if (state === 'results') {
			// keep the field racing behind the results panel
			stepRace(dt);
		}
	}

	pointers.update();
	renderer.render(scene, camera);
});

showTitle();

// Debug / testing helpers: ?autostart=1&track=N&autopilot=1&view=chase
let autostarted = false;
function maybeAutostart() {
	if (autostarted || params.get('autostart') !== '1') return;
	autostarted = true;
	if (params.has('track')) settings.track = Number(params.get('track')) % trackList.length;
	if (params.has('opponents')) settings.opponents = Number(params.get('opponents'));
	startRace();
}
// Errors show up in the menu's status line, so problems are visible on a headset too
addEventListener('error', (e) => window.antigrav?.setStatus(`Error: ${e.message}`));
addEventListener('unhandledrejection', (e) => window.antigrav?.setStatus(`Error: ${e.reason?.message || e.reason}`));

// --- Add-on API ------------------------------------------------------------------------------
// Add-ons (e.g. a mode that reads data from the player's own disc image) load
// after this module and extend the game through window.antigrav.
window.antigrav = {
	THREE,
	settings,
	audio,
	// [{name, blurb, load: async () => track}] where track = {name, path, group, sky, fog, background}
	// {replace: true} makes these the only tracks in the menu
	addTracks(list, { replace = false } = {}) {
		const entries = list.map((t) => ({ kind: 'mod', ...t }));
		trackList = replace ? entries : trackList.concat(entries);
		if (settings.track >= trackList.length) settings.track = 0;
		menuPanel.redraw();
	},
	// teams with {id, name, ship, blurb, stats, liveries, buildModel(liveryIndex, {cockpit, number})}
	// {replace: true} makes these the only teams in the menu
	addTeams(list, { replace = false } = {}) {
		if (replace) TEAMS.splice(0, TEAMS.length);
		TEAMS.push(...list);
		if (settings.team >= TEAMS.length) settings.team = 0;
		updateTitleShip();
		menuPanel.redraw();
	},
	// select menu entries by index
	select({ track, team } = {}) {
		if (track !== undefined) settings.track = Math.max(0, Math.min(trackList.length - 1, track));
		if (team !== undefined) settings.team = Math.max(0, Math.min(TEAMS.length - 1, team));
		updateTitleShip();
		menuPanel.redraw();
	},
	addMusic(list) {
		addMusic(list);
	},
	// {id: AudioBuffer} replacing announcer lines (three, two, one, go, rockets, ...)
	setVoices(map) {
		Object.assign(audio.voiceOverrides, map);
	},
	// {launch, explosion, pickup, click, boost, engine, scrape}: AudioBuffers
	setSamples(map) {
		Object.assign(audio.samples, map);
	},
	// {rocket, missile, mine}: () => Object3D
	setWeaponModels(map) {
		WeaponSystem.models = { ...(WeaponSystem.models || {}), ...map };
	},
	setStatus(text) {
		psxStatus = text;
		menuPanel.redraw();
	},
	// the title scene, for add-ons that want to show their own panels there
	titleGroup,
	// the loading screen (with its music) for add-ons' own long jobs
	loading: {
		show(title) {
			showLoading(title);
		},
		progress(fraction, detail) {
			loading.set(fraction, detail);
			audio.loadingProgress(fraction);
		},
		hide() {
			hideLoading();
			showTitle();
			if (audio.music.wanted) audio.playMusic(settings.music, false);
		}
	}
};
window.dispatchEvent(new Event('antigrav-ready'));

window.__game = { get state() { return state; }, get race() { return race; }, settings, startRace, showTitle, renderer, audio, updateTitleShip,
	// press menu buttons the way a player would (tests)
	menuClick: (id) => onPanelClick(menuPanel, id),
	resultsClick: (id) => race && onPanelClick(race.resultsPanel, id),
	get status() { return psxStatus; },
	get loadingMessage() { return loadingMessage; },
	// Lines up every team's ship in front of the title camera (for screenshots)
	debugShips() {
		titleGroup.remove(menuPanel.mesh, helpPanel.mesh, logoPanel.mesh, titleShip);
		TEAMS.forEach((team, i) => {
			const ship = buildShip(team);
			ship.position.set((i - 1) * 7.5, -3.2, -10);
			ship.rotation.y = 0.75;
			titleGroup.add(ship);
		});
	}
};
