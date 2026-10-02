// Merges keyboard, standard gamepads and WebXR controllers into one control state.
//
// VR (Quest Touch / any xr-standard controller):
//   left stick (or right stick) = steer, right trigger = thrust, left trigger = brake
//   left/right grip = left/right airbrake, A or X = fire weapon, hold right B = pause
// Keyboard: arrows/WASD steer + thrust/brake, Q/E airbrakes, F/Enter/Ctrl fire, Esc/P pause
// Gamepad: left stick steer, RT thrust, LT brake, LB/RB airbrakes, X/B fire, Start pause

const DEADZONE = 0.12;

function dz(v) {
	return Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
}

export class Input {
	constructor(renderer) {
		this.renderer = renderer;
		this.keys = new Set();
		this.state = { steer: 0, thrust: 0, brake: 0, airL: 0, airR: 0 };
		this.pausePressed = false; // edge-triggered, true for one frame
		this._pauseHeld = false;
		this.firePressed = false; // edge-triggered
		this._fireHeld = false;
		this.usingXR = false;

		addEventListener('keydown', (e) => {
			if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
			this.keys.add(e.code);
		});
		addEventListener('keyup', (e) => this.keys.delete(e.code));
		addEventListener('blur', () => this.keys.clear());
	}

	key(...codes) {
		return codes.some((c) => this.keys.has(c)) ? 1 : 0;
	}

	update() {
		const s = { steer: 0, thrust: 0, brake: 0, airL: 0, airR: 0 };
		let pause = false;
		let fire = false;

		// Keyboard
		s.steer += this.key('ArrowRight', 'KeyD') - this.key('ArrowLeft', 'KeyA');
		s.thrust = Math.max(s.thrust, this.key('ArrowUp', 'KeyW', 'Space'));
		s.brake = Math.max(s.brake, this.key('ArrowDown', 'KeyS'));
		s.airL = Math.max(s.airL, this.key('KeyQ', 'ShiftLeft'));
		s.airR = Math.max(s.airR, this.key('KeyE', 'ShiftRight'));
		pause ||= !!this.key('Escape', 'KeyP');
		fire ||= !!this.key('KeyF', 'Enter', 'ControlLeft', 'ControlRight');

		// Standard gamepads (desktop)
		if (navigator.getGamepads) {
			for (const gp of navigator.getGamepads()) {
				if (!gp || gp.mapping !== 'standard') continue;
				s.steer += dz(gp.axes[0] || 0);
				s.thrust = Math.max(s.thrust, gp.buttons[7]?.value || 0, gp.buttons[0]?.pressed ? 1 : 0);
				s.brake = Math.max(s.brake, gp.buttons[6]?.value || 0);
				s.airL = Math.max(s.airL, gp.buttons[4]?.value || 0);
				s.airR = Math.max(s.airR, gp.buttons[5]?.value || 0);
				pause ||= !!gp.buttons[9]?.pressed;
				fire ||= !!(gp.buttons[2]?.pressed || gp.buttons[1]?.pressed);
			}
		}

		// WebXR controllers
		const session = this.renderer.xr.getSession?.();
		this.usingXR = !!session;
		if (session) {
			for (const src of session.inputSources) {
				const gp = src.gamepad;
				if (!gp) continue;
				const trigger = gp.buttons[0]?.value || 0;
				const grip = gp.buttons[1]?.value || 0;
				const stickX = dz(gp.axes[2] ?? gp.axes[0] ?? 0);
				if (src.handedness === 'right') {
					s.thrust = Math.max(s.thrust, trigger);
					s.airR = Math.max(s.airR, grip);
				} else {
					s.brake = Math.max(s.brake, trigger);
					s.airL = Math.max(s.airL, grip);
				}
				s.steer += stickX;
				// Pause: right B only, held briefly so a stray thumb doesn't pause the race.
				// (The Meta/Oculus button is reserved by the system and never reaches web apps.)
				if (src.handedness === 'right') {
					if (gp.buttons[5]?.pressed) {
						this._bHeldSince ??= performance.now();
						if (performance.now() - this._bHeldSince > 350) pause = true;
					} else {
						this._bHeldSince = null;
					}
				}
				fire ||= !!gp.buttons[4]?.pressed; // A (right) or X (left)
			}
		}

		s.steer = Math.max(-1, Math.min(1, s.steer));
		this.state = s;
		this.pausePressed = pause && !this._pauseHeld;
		this._pauseHeld = pause;
		this.firePressed = fire && !this._fireHeld;
		this._fireHeld = fire;
		return s;
	}
}
