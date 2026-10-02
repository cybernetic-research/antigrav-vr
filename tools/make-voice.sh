#!/bin/sh
# Generates the race announcer clips in assets/voice/ with espeak-ng (GPL
# program; its audio output is ours to ship) and ffmpeg for a PA-system sound.
#   brew install espeak-ng ffmpeg   (or apt install espeak-ng ffmpeg)
#   sh tools/make-voice.sh
set -e
cd "$(dirname "$0")/.."
OUT=assets/voice
mkdir -p "$OUT"
VOICE=${VOICE:-en-gb+f3}
TMP=$(mktemp -d)

say() { # id, text, [speed], [pitch]
	espeak-ng -v "$VOICE" -s "${3:-140}" -p "${4:-38}" -a 180 -w "$TMP/$1.wav" "$2"
	ffmpeg -v error -y -i "$TMP/$1.wav" -af \
		"highpass=f=180,lowpass=f=7000,acompressor=threshold=-18dB:ratio=4:attack=5:release=80,aecho=0.8:0.6:45|90:0.22|0.12,loudnorm=I=-16:TP=-1.5" \
		-ac 1 -ar 44100 -c:a aac -b:a 64k "$OUT/$1.m4a"
	echo "$1"
}

say three "Three" 120 36
say two "Two" 120 36
say one "One" 120 36
say go "Go!" 120 50
say rockets "Rockets"
say missile "Missile"
say mines "Mines"
say autopilot "Auto pilot"
say autopilot_on "Auto pilot engaged"
say autopilot_off "Auto pilot disengaged"
say contender_eliminated "Contender eliminated"
say opponent_destroyed "Opponent destroyed"
say player_eliminated "You have been eliminated" 130
say shield_critical "Warning. Shield critical"
say missile_incoming "Warning. Missile incoming" 150
say final_lap "Final lap"
say lap_two "Lap two"
say lap_three "Lap three"
say lap_four "Lap four"
say race_complete "Race complete"
say wrong_way "Wrong way"
rm -rf "$TMP"
