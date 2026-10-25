// DeathCinema.js — "Dumb Ways to Die" Death Recorder & Replay Cinema.
// Continuously records a ring buffer of player positions, velocities, rotations,
// expressions, and impact events during the match. When a hilarious KO occurs,
// it freezes the clip (10 seconds pre-mortem + 4 seconds post-mortem ragdoll)
// and plays it back with slow-mo, dynamic camera tracking, and Darwin award voting.

import * as THREE from 'three';

const BUFFER_SECONDS = 14;
const FPS = 30;
const MAX_SAMPLES = BUFFER_SECONDS * FPS;

export class DeathCinema {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.tracks = new Map(); // dweeb -> Array of { time, x, y, z, qx, qy, qz, qw, vx, vy, vz, mood, screaming }
    this.savedClips = [];    // Array of recorded death sequences
    this.isPlaying = false;
    this.currentClip = null;
    this.playbackTime = 0;
    this.playbackSpeed = 1.0;
    this.originalCamTarget = new THREE.Vector3();
    this.trackingMesh = null;
    this.onCinemaEnd = null;

    this._createCinemaOverlay();
  }

  _createCinemaOverlay() {
    let el = document.getElementById('death-cinema-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'death-cinema-overlay';
      el.className = 'overlay hidden';
      el.style.cssText = `
        z-index: 100;
        background: rgba(10, 8, 20, 0.85);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        padding: 30px 20px;
        pointer-events: auto;
      `;
      el.innerHTML = `
        <div style="text-align:center;">
          <div style="font-family:'Lilita One',Arial,sans-serif; font-size:42px; color:#ff4d5e; -webkit-text-stroke:3px #14101c; text-shadow:0 6px 0 #14101c; letter-spacing:2px;">
            ☠️ REPLAY CINEMA: DUMB WAYS TO DIE ☠️
          </div>
          <div id="cinema-death-cause" style="font-family:'Nunito',sans-serif; font-weight:800; font-size:22px; color:#ffd23f; margin-top:6px;">
            CRUSHED BY HYDRAULIC TENDERIZER
          </div>
        </div>

        <div id="cinema-voting-podium" style="display:flex; gap:20px; flex-wrap:wrap; justify-content:center; max-width:900px; width:100%;">
          <!-- Dynamic candidate cards inserted here -->
        </div>

        <div style="display:flex; gap:16px;">
          <button class="btn big pink" id="btn-cinema-replay">WATCH AGAIN (SLOW-MO)</button>
          <button class="btn big yellow" id="btn-cinema-continue">CONTINUE TO NEXT ROUND</button>
        </div>
      `;
      document.body.appendChild(el);

      document.getElementById('btn-cinema-replay')?.addEventListener('click', () => {
        this.playbackTime = 0;
        this.playbackSpeed = 0.5; // slow-mo replay!
      });

      document.getElementById('btn-cinema-continue')?.addEventListener('click', () => {
        this.stop();
        this.onCinemaEnd?.();
      });
    }
    this.overlay = el;
  }

  recordFrame(dweeb, time) {
    if (!dweeb || !dweeb.active) return;
    let track = this.tracks.get(dweeb);
    if (!track) {
      track = [];
      this.tracks.set(dweeb, track);
    }

    const pos = dweeb.getPosition();
    const rot = dweeb.mesh.quaternion;
    const vel = dweeb.body?.linvel?.() || { x: 0, y: 0, z: 0 };

    track.push({
      time,
      x: pos.x, y: pos.y, z: pos.z,
      qx: rot.x, qy: rot.y, qz: rot.z, qw: rot.w,
      vx: vel.x, vy: vel.y, vz: vel.z,
      speed: Math.hypot(vel.x, vel.y, vel.z),
      screaming: dweeb.ragdolling || dweeb.hitstun > 0,
      mood: dweeb.mood,
    });

    if (track.length > MAX_SAMPLES) {
      track.shift();
    }
  }

  captureDeath(victim, cause = 'CRUSHED BY MACHINERY', creditedBy = null) {
    const track = this.tracks.get(victim);
    if (!track || track.length < 10) return;

    // Snapshot the prior frames up to this moment
    const clipFrames = track.slice(-Math.min(track.length, FPS * 12));
    const maxSpeed = Math.max(...clipFrames.map(f => f.speed || 0));
    let awardTitle = 'DARWIN NOMINEE';
    if (maxSpeed > 25) awardTitle = '🚀 STRATOSPHERIC EJECTION';
    else if (cause.includes('SHREDDER')) awardTitle = '⚙️ TOTAL PULVERIZATION';
    else if (cause.includes('TENDERIZER')) awardTitle = '🥩 100% MEAT PANCAKE';
    else if (cause.includes('LAGOON')) awardTitle = '🌊 OLYMPIC BELLY FLOP';

    const clip = {
      id: Math.random().toString(36).slice(2, 8),
      victim: victim.name,
      victimType: victim.type,
      color: victim.color,
      cause,
      creditedBy: creditedBy?.name || 'Gravity / Machinery',
      maxSpeed: Math.round(maxSpeed * 3.6), // km/h
      frames: clipFrames,
      votes: 0,
      awardTitle,
      duration: (clipFrames[clipFrames.length - 1].time - clipFrames[0].time) || 6,
    };

    this.savedClips.push(clip);
    return clip;
  }

  playCinema(clips, onDone) {
    if (!clips || !clips.length) {
      onDone?.();
      return;
    }

    this.savedClips = clips;
    this.currentClip = clips[clips.length - 1]; // play the most spectacular recent death
    this.isPlaying = true;
    this.playbackTime = 0;
    this.playbackSpeed = 1.0;
    this.onCinemaEnd = onDone;

    // Render voting podium cards
    const podium = document.getElementById('cinema-voting-podium');
    if (podium) {
      podium.innerHTML = clips.map((c, i) => `
        <div class="panel" style="background:#1b1030; border:4px solid #332b57; border-radius:18px; padding:16px 20px; display:flex; flex-direction:column; align-items:center; min-width:200px;">
          <div style="font-family:'Lilita One',Arial,sans-serif; font-size:24px; color:#ffd84a;">#${i + 1} ${c.victim}</div>
          <div style="font-size:13px; color:#ff6fb5; font-weight:700; margin-top:4px;">${c.cause}</div>
          <div style="font-size:11px; background:#ff4d5e; color:#fff; font-weight:900; padding:2px 8px; border-radius:8px; margin-top:4px;">${c.awardTitle}</div>
          <div style="font-size:12px; color:#5ee06a; margin-top:6px;">Impact Speed: ${c.maxSpeed} km/h</div>
          <button class="btn pink" style="font-size:16px; padding:6px 16px; margin-top:12px;" onclick="window.__voteDeath('${c.id}')">VOTE BEST DEATH</button>
          <span id="votes-${c.id}" style="font-size:12px; font-weight:800; color:#ffd23f; margin-top:6px;">⭐ ${c.votes} votes</span>
        </div>
      `).join('');
    }

    window.__voteDeath = (id) => {
      const c = this.savedClips.find(x => x.id === id);
      if (c) {
        c.votes++;
        const el = document.getElementById(`votes-${c.id}`);
        if (el) el.textContent = `⭐ ${c.votes} votes (WINNER!)`;
      }
    };

    const causeEl = document.getElementById('cinema-death-cause');
    if (causeEl) causeEl.textContent = `${this.currentClip.victim.toUpperCase()} · ${this.currentClip.cause.toUpperCase()}`;

    this.overlay.classList.remove('hidden');
  }

  update(dt, followCamera) {
    if (!this.isPlaying || !this.currentClip) return;

    this.playbackTime += dt * this.playbackSpeed;
    const frames = this.currentClip.frames;
    if (!frames.length) return;

    // Find sample frame along timeline
    const startT = frames[0].time;
    const curTargetTime = startT + (this.playbackTime % this.currentClip.duration);
    let sample = frames[0];
    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i].time <= curTargetTime && frames[i + 1].time >= curTargetTime) {
        sample = frames[i];
        break;
      }
    }

    // Dynamic tracking broadcast camera: rotates slowly around the doomed victim
    const angle = this.playbackTime * 1.5;
    const camDist = 6.0;
    const camX = sample.x + Math.cos(angle) * camDist;
    const camZ = sample.z + Math.sin(angle) * camDist;
    const camY = Math.max(1.5, sample.y + 2.5);

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(sample.x, sample.y + 0.5, sample.z);
  }

  stop() {
    this.isPlaying = false;
    this.overlay?.classList.add('hidden');
    this.tracks.clear();
  }
}
