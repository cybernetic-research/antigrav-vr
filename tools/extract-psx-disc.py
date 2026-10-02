#!/usr/bin/env python3
"""Extract a directory from a PSX disc image (raw 2352-byte .img/.bin or 2048-byte .iso).

Usage:
  extract-psx-disc.py <image> --list [PATH]
  extract-psx-disc.py <image> <DISC_DIR> <out_dir>    e.g. WIPEOUT2 game/WIPEOUT2

Reads the image only; never modifies it. Use only with discs you own, and
never commit the extracted data.
"""
import os, struct, sys

class Disc:
    def __init__(self, path):
        self.f = open(path, 'rb')
        size = os.path.getsize(path)
        self.raw = size % 2352 == 0 and size % 2048 != 0 or self._looks_raw()
        self.sector_size = 2352 if self.raw else 2048

    def _looks_raw(self):
        self.f.seek(0)
        return self.f.read(12) == b'\x00' + b'\xff' * 10 + b'\x00'

    def sector(self, lba):
        if not self.raw:
            self.f.seek(lba * 2048)
            return self.f.read(2048)
        self.f.seek(lba * 2352)
        s = self.f.read(2352)
        mode = s[15]
        return s[24:24 + 2048] if mode == 2 else s[16:16 + 2048]

    def read(self, lba, length):
        out = bytearray()
        while len(out) < length:
            out += self.sector(lba)
            lba += 1
        return bytes(out[:length])

    def root(self):
        pvd = self.sector(16)
        assert pvd[1:6] == b'CD001', 'not an ISO9660 image'
        return self._record(pvd[156:156 + 34])

    @staticmethod
    def _record(r):
        lba = struct.unpack_from('<I', r, 2)[0]
        size = struct.unpack_from('<I', r, 10)[0]
        flags = r[25]
        nlen = r[32]
        name = r[33:33 + nlen].decode('ascii', 'replace').split(';')[0]
        return {'lba': lba, 'size': size, 'dir': bool(flags & 2), 'name': name}

    def listdir(self, d):
        data = self.read(d['lba'], d['size'])
        out, i = [], 0
        while i < len(data):
            n = data[i]
            if n == 0:  # records don't cross sector boundaries
                i = (i // 2048 + 1) * 2048
                continue
            rec = self._record(data[i:i + n])
            if rec['name'] not in ('\x00', '\x01'):
                out.append(rec)
            i += n
        return out

    def find(self, path):
        d = self.root()
        for part in [p for p in path.strip('/').split('/') if p]:
            d = next((e for e in self.listdir(d) if e['name'].upper() == part.upper()), None)
            if d is None:
                raise SystemExit(f'not found: {path}')
        return d

    def extract(self, d, out):
        os.makedirs(out, exist_ok=True)
        for e in self.listdir(d):
            p = os.path.join(out, e['name'])
            if e['dir']:
                self.extract(e, p)
            else:
                with open(p, 'wb') as f:
                    f.write(self.read(e['lba'], e['size']))

if __name__ == '__main__':
    disc = Disc(sys.argv[1])
    if sys.argv[2] == '--list':
        d = disc.find(sys.argv[3] if len(sys.argv) > 3 else '/')
        for e in disc.listdir(d):
            print(('[D] ' if e['dir'] else '    ') + e['name'], e['size'])
    else:
        disc.extract(disc.find(sys.argv[2]), sys.argv[3])
        print('extracted', sys.argv[2], '->', sys.argv[3])
