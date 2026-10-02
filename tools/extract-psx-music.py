#!/usr/bin/env python3
"""Rip the soundtrack of a PSX disc image whose music is CD audio exposed as
*.SWP files (e.g. WipEout 2097). Each .SWP directory entry points at the
start of a CD-DA track; the audio is read from the raw 2352-byte sectors and
encoded with ffmpeg. Titles default to the file names; edit index.json to
rename them.

Usage:
  extract-psx-music.py <raw .img/.bin image> <out_dir>    e.g. WIPEOUT2/MUSIC

Writes <out_dir>/<NAME>.m4a plus index.json for the game. Reads the image
only. For discs you own; never commit or host the output.
"""
import json, os, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
Disc = import_module('extract-psx-disc').Disc


def main(image, out):
    disc = Disc(image)
    if not disc.raw:
        raise SystemExit('need a raw 2352-byte image (.img/.bin); CD audio is not in .iso files')
    os.makedirs(out, exist_ok=True)
    entries = sorted((e for e in disc.listdir(disc.root()) if e['name'].upper().endswith('.SWP')), key=lambda e: e['lba'])
    if not entries:
        raise SystemExit('no .SWP entries on this disc')
    tracks = []
    for e in entries:
        name = e['name'][:-4]
        sectors = e['size'] // 2048  # the directory entry counts 2048-byte sectors
        dst = os.path.join(out, name + '.m4a')
        print(f'{name}: {sectors / 75 / 60:.1f} min -> {dst}')
        ff = subprocess.Popen(
            ['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', '-',
             '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', dst],
            stdin=subprocess.PIPE)
        disc.f.seek(e['lba'] * 2352)
        left = sectors * 2352
        while left:
            chunk = disc.f.read(min(left, 2352 * 1000))
            if not chunk:
                break
            ff.stdin.write(chunk)
            left -= len(chunk)
        ff.stdin.close()
        if ff.wait():
            raise SystemExit(f'ffmpeg failed on {name}')
        tracks.append({'file': name + '.m4a', 'title': name.title()})
    with open(os.path.join(out, 'index.json'), 'w') as f:
        json.dump({'tracks': tracks}, f, indent=1)
    print(f'wrote {len(tracks)} tracks + index.json')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
