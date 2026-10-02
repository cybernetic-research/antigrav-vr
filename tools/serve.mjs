// Tiny zero-dependency static server for the game.
//
//   node tools/serve.mjs            -> http://localhost:8080  (WebXR works on localhost)
//   node tools/serve.mjs --https    -> https://<lan-ip>:8443  (self-signed, for a Quest on your LAN)
//
// WebXR needs a "secure context": either localhost or HTTPS. For a Quest you can
// either use --https (accept the certificate warning in the Quest browser) or
// keep plain http and run `adb reverse tcp:8080 tcp:8080` with the headset
// plugged in, then open http://localhost:8080 on the headset.

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Serves the game folder, or another folder given with --root <dir> (used by add-ons
// that include this repo as a submodule)
const rootArg = process.argv.indexOf('--root');
const root = rootArg > 0 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const useHttps = process.argv.includes('--https');
const port = Number(process.env.PORT) || (useHttps ? 8443 : 8080);

const types = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json',
	'.webmanifest': 'application/manifest+json',
	'.css': 'text/css',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.glb': 'model/gltf-binary',
	'.ogg': 'audio/ogg',
	'.mp3': 'audio/mpeg',
	'.wasm': 'application/wasm'
};

function handler(req, res) {
	let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
	if (urlPath.endsWith('/')) urlPath += 'index.html';
	const file = path.join(root, urlPath);
	if (!file.startsWith(root)) {
		res.writeHead(403).end();
		return;
	}
	fs.stat(file, (err, stat) => {
		if (err || !stat.isFile()) {
			res.writeHead(404).end('not found');
			return;
		}
		res.writeHead(200, {
			'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
			'Content-Length': stat.size,
			'Cache-Control': 'no-cache'
		});
		if (req.method === 'HEAD') {
			res.end();
			return;
		}
		fs.createReadStream(file).pipe(res);
	});
}

function lanAddresses() {
	return Object.values(os.networkInterfaces())
		.flat()
		.filter((a) => a && a.family === 'IPv4' && !a.internal)
		.map((a) => a.address);
}

if (useHttps) {
	const certDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cert');
	const key = path.join(certDir, 'key.pem');
	const cert = path.join(certDir, 'cert.pem');
	if (!fs.existsSync(key) || !fs.existsSync(cert)) {
		fs.mkdirSync(certDir, { recursive: true });
		console.log('Generating self-signed certificate...');
		execSync(
			`openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=antigrav-vr" ` +
				`-keyout "${key}" -out "${cert}"`,
			{ stdio: 'ignore' }
		);
	}
	https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, handler).listen(port, () => {
		console.log(`Serving ${root}`);
		for (const ip of lanAddresses()) console.log(`  https://${ip}:${port}/`);
		console.log(`  https://localhost:${port}/`);
	});
} else {
	http.createServer(handler).listen(port, () => {
		console.log(`Serving ${root}`);
		console.log(`  http://localhost:${port}/`);
	});
}
