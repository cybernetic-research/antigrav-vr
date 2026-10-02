# ANTIGRAV VR

An anti-gravity racer for VR headsets (Meta Quest and other WebXR browsers) and desktop
browsers. You fly from inside the cockpit and race against up to 7 AI pilots on futuristic
tracks at up to 400 km/h, with no install needed.

Everything is generated in code: tracks, ships, textures, sound effects and the built-in
synth soundtrack. The only dependency is three.js, loaded from a CDN.

## Play

**Hosted:** open the GitHub Pages link for this repository in the Quest Browser (or any desktop
browser) and press **ENTER VR**.

**Locally:**

```sh
npm run serve          # http://localhost:8080  (desktop, or a PC VR headset)
npm run serve:https    # https://<your-lan-ip>:8443  (a Quest on your network; accept the certificate warning)
```

Alternatively, plug in a Quest and run `adb reverse tcp:8080 tcp:8080`, then open
`http://localhost:8080` in the headset.

Play seated. To recenter, hold the Meta button.

## Controls

| | VR controllers | Keyboard | Gamepad |
|---|---|---|---|
| Thrust | Right trigger | W / Up / Space | RT (or A) |
| Brake | Left trigger | S / Down | LT |
| Steer | Thumbstick | A D / Left Right | Left stick |
| Airbrakes | Left / right grip | Q / E | LB / RB |
| Fire weapon | A or X | F / Enter / Ctrl | X or B |
| Pause | B or Y | Esc / P | Start |

In VR you point at menus with the controller rays and pull the trigger to select. On the desktop you click them.

## Features

- **Three teams with their own ships and handling:**
  - Halden Aero *Meridian*: balanced.
  - Corvid Motorworks *Kite*: light and nimble.
  - Mamut Heavy Industries *Bastion*: heavy and fast.
- **Two speed classes:** Sport (about 290 km/h) and Elite (about 400 km/h). Races are 1 to 5 laps against 0 to 7 rivals.
- **Three tracks:**
  - **Aurora Ring:** flowing night circuit.
  - **Kessler Canyon:** elevation changes through red mesas.
  - **Halcyon Skyway:** a figure-eight among skyscrapers that crosses over itself.
- **Cockpit view:** three screens sit low in your peripheral vision, so the road ahead stays clear:
  - left: speed, shield and the weapon you're holding
  - right: lap, position and times
  - centre, on the dash: a live track map and a radar of the nearest ships
- **Weapons:** drive over the target tiles to pick up a random weapon:
  - rocket salvo
  - homing missile
  - mines dropped behind you
  - autopilot, which flies the ship for a few seconds

  Hits drain your shield, which recharges slowly. A ship at zero shield is eliminated. AI pilots use weapons too.
- **Announcer voice:** calls the countdown, pickups, autopilot, eliminations ("opponent destroyed",
  "contender eliminated"), missile warnings, shield warnings and laps.
- **Hover physics:** drift, airbrakes, wall bounces and ship-to-ship contact. Boost pads are placed by hand
  and also automatically along every long straight.
- **AI pilots:** each takes a racing line, brakes for corners and avoids the ship ahead and alongside, with mild rubber-banding.
- **Race flow:** start lights, lap callouts, wrong-way warning, results and pause menu.
- **Sound:** synthesized engine, wind, scrape and boost effects, plus a panned engine sound for the nearest rival.
- **Music:** a built-in generative synth soundtrack. You can also add your own: the **Your music**
  button at the top of the page picks files from your device, or for a local copy, drop files into
  [`music/`](music/README.md).
- **Comfort options:** "Cockpit locked" (the view banks with the track) or "Horizon locked" (the
  horizon stays level). Impacts shake the cockpit, not your head, and pulse the controller haptics.

## Bring your own disc data (optional)

If you own the original PlayStation discs of **WipEout** (1995) or **WipEout 2097** (1996), the
game can load their tracks and soundtrack from your own copy. Nothing from those games is included
in this repository or the hosted version, and it never will be.

1. Make a raw image of your disc (`.bin`/`.img`) and extract the game folder:
   ```sh
   python3 tools/extract-psx-disc.py your-disc.img --list /
   python3 tools/extract-psx-disc.py your-disc.img WIPEOUT2 WIPEOUT2     # or WIPEOUT for the 1995 disc
   ```
2. Optional, the soundtrack (CD audio, needs `ffmpeg`):
   ```sh
   python3 tools/extract-psx-music.py your-disc.img WIPEOUT2/MUSIC
   ```
3. Run the game locally (`npm run serve`). The tracks appear in the track list as
   `WIPEOUT2 · TRACK01` and so on. To give them names, add `WIPEOUT2/names.json`:
   `{"TRACK01": "Some name", ...}`.

These folders are gitignored. **Don't commit, upload or host them.**

Status: all 8 WipEout 2097 tracks have been tested and race well. The 1995 tracks use the same
loader but are untested. Jumps are glided over, and only the main route is used where a track
splits.

## Code map

| File | What |
|---|---|
| `src/main.js` | Renderer and WebXR setup, title screen, race setup, game states, pause and results |
| `src/track.js` | `TrackPath`: a resampled racing line with per-metre frames, width, curvature and boost zones. All physics runs in track coordinates (s, x, h) |
| `src/tracks.js`, `src/trackBuilder.js` | Built-in track layouts, and their meshes and scenery |
| `src/craft.js` | Ship physics, laps and collisions |
| `src/ai.js` | AI pilot |
| `src/shipModel.js` | Teams, procedural ships, cockpit interior |
| `src/hud.js`, `src/ui.js` | Canvas-texture HUD, panels, and laser pointer / mouse picking |
| `src/input.js` | Keyboard, gamepad and XR controller mapping |
| `src/weapons.js` | Weapon pickups, projectiles, damage, elimination and AI weapon use |
| `src/audio.js`, `src/synthMusic.js` | Sound effects, announcer, music playback, generative soundtrack |
| `assets/voice/` | Announcer clips, generated with `tools/make-voice.sh` (eSpeak NG + ffmpeg) |
| `src/psx.js` | Optional loader for track data from your own disc |
| `tools/serve.mjs` | Static server (http, or https with an auto-generated certificate) |
| `tools/sim.mjs`, `tools/check-tracks.mjs` | Headless AI race and layout checks (`npm install` first) |
| `tools/extract-psx-disc.py`, `tools/extract-psx-music.py` | Extract data and music from your own disc image |
| `tools/make-fake-psx.mjs` | Writes a synthetic track in the PSX formats, for testing the loader without a disc |
| `tools/make-music-index.mjs` | Indexes the files in `music/` |

Debug URL parameters: `?autostart=1&track=N&autopilot=1&view=chase&opponents=N&maxdt=0.3`

## Legal

This is an independent fan project. It is **not affiliated with, endorsed by or connected to
Sony Interactive Entertainment** or the makers of WipEout. WipEout is a trademark of its
respective owner and is mentioned only to describe file compatibility. All ships, teams,
tracks, graphics and sounds in this repository are original. The optional loader reads data
only from discs you own.

Code: [MIT License](LICENSE). Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
