// Built-in, original track layouts. Coordinates are [x, z, y] in metres.
// The racing direction follows the point order. The start line sits at point 0.

function figureEight({ a, b, base, rise, n = 28 }) {
	const pts = [];
	for (let i = 0; i < n; i++) {
		const t = (i / n) * Math.PI * 2;
		// Lemniscate of Gerono; crossing at t = 0 and t = PI. The height
		// difference between those two moments makes the crossing a bridge.
		const x = a * Math.sin(t);
		const z = (b * Math.sin(2 * t)) / 2 + 40 * Math.sin(3 * t);
		const y = base + rise * Math.cos(t);
		pts.push([x, z, y]);
	}
	return pts;
}

export const BUILTIN_TRACKS = [
	{
		id: 'aurora',
		name: 'Aurora Ring',
		blurb: 'Flowing, wide and forgiving. A good first race.',
		halfWidth: 13,
		bank: 22,
		theme: {
			skyTop: 0x050b2a,
			skyBottom: 0x22123c,
			fog: 0x140b26,
			fogDensity: 0.0014,
			ground: 'grid',
			gridColor: '#3a8bff',
			accent: '#2ad1ff',
			stripe: '#ff3d7f',
			rail: 0x2ad1ff,
			towers: 70
		},
		points: [
			[0, 0, 0], [0, -150, 0], [-10, -280, 3], [-70, -370, 8], [-180, -405, 12],
			[-300, -375, 14], [-375, -285, 12], [-385, -160, 8], [-335, -60, 4], [-255, -5, 2],
			[-205, 70, 0], [-200, 175, 0], [-150, 262, 2], [-60, 292, 3], [20, 252, 2],
			[40, 150, 0], [20, 70, 0]
		],
		boosts: [
			{ at: 0.05, x: 0, len: 8 },
			{ at: 0.36, x: -5, len: 8 },
			{ at: 0.6, x: 5, len: 8 },
			{ at: 0.86, x: 0, len: 8 }
		]
	},
	{
		id: 'kessler',
		name: 'Kessler Canyon',
		blurb: 'Climbs, drops and tighter bends through red rock.',
		halfWidth: 11.5,
		bank: 28,
		theme: {
			skyTop: 0x141e38,
			skyBottom: 0x9a5233,
			fog: 0x5e3524,
			fogDensity: 0.0016,
			ground: 'terrain',
			accent: '#ffb02a',
			stripe: '#ffb02a',
			rail: 0xff8a2a,
			towers: 0,
			mesas: 46
		},
		points: [
			[0, 0, 10], [0, -180, 14], [30, -300, 22], [120, -352, 30], [230, -332, 34],
			[292, -250, 30], [282, -150, 22], [212, -88, 16], [172, -8, 10], [202, 82, 6],
			[300, 122, 8], [400, 92, 14], [470, 2, 22], [522, -118, 30], [602, -180, 32],
			[692, -150, 28], [722, -40, 20], [702, 100, 12], [622, 222, 8], [482, 282, 6],
			[302, 292, 6], [142, 252, 8], [42, 172, 10], [8, 82, 10]
		],
		boosts: [
			{ at: 0.03, x: -4, len: 8 },
			{ at: 0.42, x: 4, len: 8 },
			{ at: 0.7, x: 0, len: 8 }
		]
	},
	{
		id: 'halcyon',
		name: 'Halcyon Skyway',
		blurb: 'A figure-eight high above the city. Crosses over itself.',
		halfWidth: 12,
		bank: 24,
		theme: {
			skyTop: 0x01030a,
			skyBottom: 0x0a1e2a,
			fog: 0x06121a,
			fogDensity: 0.0012,
			ground: 'grid',
			gridColor: '#19ffb0',
			accent: '#19ffb0',
			stripe: '#19ffb0',
			rail: 0x19ffb0,
			towers: 160
		},
		points: figureEight({ a: 430, b: 320, base: 22, rise: 15 }),
		boosts: [
			{ at: 0.02, x: 0, len: 8 },
			{ at: 0.27, x: -5, len: 8 },
			{ at: 0.52, x: 0, len: 8 },
			{ at: 0.77, x: 5, len: 8 }
		]
	}
];
