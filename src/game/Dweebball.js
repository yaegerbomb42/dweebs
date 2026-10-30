// Dweebball.js — 2v2 sport mode: kick the ball into the opponent goal!
// Teams: dweebs[0], dweebs[1] = RED (team 0), dweebs[2], dweebs[3] = BLUE (team 1)

import * as THREE from 'three';
import { toonMat } from '../render/Toon.js';
import { CORE_RADIUS, STAGE_RADIUS, WATER_LEVEL } from '../world/Arena.js';
import { PALETTE } from '../render/Toon.js';

const BALL_RADIUS = 0.9;
const BALL_MASS = 1.2;
const BALL_RESTITUTION = 0.8;
const GOAL_HALF_WIDTH = 2.2;
const GOAL_HALF_DEPTH = 1.2;
const GOAL_HEIGHT = 3.5;
const SCORE_ANNOUNCE_TIME = 1.6;
const BALL_RESET_DELAY = 1.2;
const WIN_SCORE = 3;

export class Dweebball {
  constructor({ physics, scene, arena, hud, fx, audio }) {
    this.physics = physics;
    this.scene = scene;
    this.arena = arena;
    this.hud = hud;
    this.fx = fx;
    this.audio = audio;

    this.ball = null;
    this.ballBody = null;
    this.goalA = null; // RED team goal (x < 0)
    this.goalB = null; // BLUE team goal (x > 0)

    this.score = { red: 0, blue: 0 };
    this.scoreEl = null;
    this.resetting = false;
    this.resetTimer = 0;
    this.matchEnded = false;
    this.winnerTeam = null;

    // Bot steering overrides
    this.botForcedTargets = new Map(); // bot -> {x, z}

    // Spawn center cache
    this._spawnCenter = null;
  }

  start(dweebs) {
    this.dweebs = dweebs;
    this.matchEnded = false;
    this.winnerTeam = null;
    this.score = { red: 0, blue: 0 };
    this.resetting = false;
    this.resetTimer = 0;

    // Assign teams
    dweebs.forEach((d, i) => {
      d.team = i < 2 ? 0 : 1; // 0 = RED, 1 = BLUE
      d.teamColor = d.team === 0 ? PALETTE.red : PALETTE.blue;
    });

    // Create scoreboard HUD
    this._createScoreboard();

    // Find arena center for ball spawn
    this._findSpawnCenter();

    // Create ball
    this._createBall();

    // Create goals
    this._createGoals();

    // Initial ball spawn
    this._resetBall();
  }

  _findSpawnCenter() {
    // Use arena's spawn point logic to find center
    const p0 = this.arena.getSpawnPoint(0, 4);
    const p1 = this.arena.getSpawnPoint(2, 4);
    this._spawnCenter = {
      x: (p0.x + p1.x) * 0.5,
      y: 2,
      z: (p0.z + p1.z) * 0.5,
    };
  }

  _createBall() {
    // Bright orange toon mesh with stripes
    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 24, 16);
    const ballMat = toonMat({ color: 0xff6600 }); // bright orange

    const ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.castShadow = true;
    ballMesh.receiveShadow = true;

    // Add black stripes for soccer ball look
    const stripeGeo = new THREE.TorusGeometry(BALL_RADIUS * 1.02, 0.06, 8, 32);
    const stripeMat = toonMat({ color: 0x1a1a1a });
    const stripe1 = new THREE.Mesh(stripeGeo, stripeMat);
    const stripe2 = new THREE.Mesh(stripeGeo, stripeMat);
    stripe1.rotation.x = Math.PI / 2;
    stripe2.rotation.y = Math.PI / 2;
    ballMesh.add(stripe1);
    ballMesh.add(stripe2);

    this.scene.add(ballMesh);

    // Create physics body
    const { body, collider } = this.physics.createDynamicBody(
      this._spawnCenter.x,
      this._spawnCenter.y,
      this._spawnCenter.z,
      'sphere',
      { radius: BALL_RADIUS },
      { mass: BALL_MASS, material: 'rubber', restitution: BALL_RESTITUTION, id: 'dweebball_ball' }
    );

    this.ball = ballMesh;
    this.ballBody = body;
    this.ballCollider = collider;
    this.ball.userData.physicsBody = body;

    // Make ball roll nicely
    body.setAngularDamping(0.1);
    body.setLinearDamping(0.02);
  }

  _createGoals() {
    const halfWidth = STAGE_RADIUS * 0.7;
    const goalY = GOAL_HEIGHT / 2;

    // RED goal (team A, x < 0)
    this.goalA = this._createGoalMesh(-halfWidth, goalY, 0, PALETTE.red);

    // BLUE goal (team B, x > 0)
    this.goalB = this._createGoalMesh(halfWidth, goalY, 0, PALETTE.blue);
  }

  _createGoalMesh(x, y, z, color) {
    const group = new THREE.Group();

    const postGeo = new THREE.CylinderGeometry(0.15, 0.15, GOAL_HEIGHT, 8);
    const postMat = toonMat({ color });

    // Left post
    const postL = new THREE.Mesh(postGeo, postMat);
    postL.position.set(-GOAL_HALF_WIDTH, y, -GOAL_HALF_DEPTH);
    postL.castShadow = true;
    group.add(postL);

    // Right post
    const postR = new THREE.Mesh(postGeo, postMat);
    postR.position.set(-GOAL_HALF_WIDTH, y, GOAL_HALF_DEPTH);
    postR.castShadow = true;
    group.add(postR);

    // Crossbar
    const barGeo = new THREE.CylinderGeometry(0.12, 0.12, GOAL_HALF_WIDTH * 2, 8);
    const barMat = toonMat({ color });
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(-GOAL_HALF_WIDTH, y + GOAL_HEIGHT / 2, 0);
    bar.castShadow = true;
    group.add(bar);

    // Net (visual only - simple planes)
    const netMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });

    // Back net
    const backNet = new THREE.Mesh(
      new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_HEIGHT),
      netMat
    );
    backNet.position.set(-GOAL_HALF_WIDTH - 0.5, y, 0);
    group.add(backNet);

    // Side nets
    for (const side of [-1, 1]) {
      const sideNet = new THREE.Mesh(
        new THREE.PlaneGeometry(GOAL_HALF_DEPTH, GOAL_HEIGHT),
        netMat
      );
      sideNet.rotation.y = side * Math.PI / 2;
      sideNet.position.set(-GOAL_HALF_WIDTH + side * GOAL_HALF_WIDTH, y, side * GOAL_HALF_DEPTH / 2);
      group.add(sideNet);
    }

    // Top net
    const topNet = new THREE.Mesh(
      new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_HALF_DEPTH),
      netMat
    );
    topNet.rotation.x = -Math.PI / 2;
    topNet.position.set(-GOAL_HALF_WIDTH, y + GOAL_HEIGHT / 2, 0);
    group.add(topNet);

    group.position.set(x, 0, z);
    this.scene.add(group);

    return group;
  }

  _createScoreboard() {
    const el = document.createElement('div');
    el.id = 'dweebball-scoreboard';
    el.style.cssText = `
      position: fixed;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      font-family: 'Lilita One', 'Arial Black', sans-serif;
      font-size: 28px;
      color: #fff8ee;
      -webkit-text-stroke: 4px #1b1030;
      paint-order: stroke fill;
      text-shadow: 0 5px 0 #1b1030;
      background: rgba(27,16,48,0.85);
      border: 4px solid #1b1030;
      border-radius: 14px;
      padding: 6px 24px;
      z-index: 15;
      pointer-events: none;
      white-space: nowrap;
    `;
    el.textContent = 'RED 0 - 0 BLUE';
    document.getElementById('hud').appendChild(el);
    this.scoreEl = el;
  }

  _updateScoreboard() {
    if (this.scoreEl) {
      this.scoreEl.textContent = `RED ${this.score.red} - ${this.score.blue} BLUE`;
      // Color the team names
      this.scoreEl.innerHTML = `
        <span style="color:#ff4d5e">RED</span> ${this.score.red} - ${this.score.blue}
        <span style="color:#3fa9ff">BLUE</span>
      `;
    }
  }

  _resetBall() {
    if (!this.ball || !this.ballBody) return;

    this.ballBody.setTranslation(
      { x: this._spawnCenter.x, y: this._spawnCenter.y, z: this._spawnCenter.z },
      true
    );
    this.ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.ballBody.wakeUp();

    this.resetting = false;
  }

  _checkGoals() {
    if (!this.ball || !this.ballBody) return;

    const pos = this.ballBody.translation();
    const goalX = STAGE_RADIUS * 0.7;

    // Check RED goal (team 0 scores on BLUE goal at x > 0)
    if (pos.x > goalX - 0.5 &&
        Math.abs(pos.z) < GOAL_HALF_DEPTH + 0.5 &&
        pos.y < GOAL_HEIGHT + 0.5) {
      this._scoreGoal(0); // RED scores
      return;
    }

    // Check BLUE goal (team 1 scores on RED goal at x < 0)
    if (pos.x < -goalX + 0.5 &&
        Math.abs(pos.z) < GOAL_HALF_DEPTH + 0.5 &&
        pos.y < GOAL_HEIGHT + 0.5) {
      this._scoreGoal(1); // BLUE scores
      return;
    }
  }

  _scoreGoal(team) {
    if (this.matchEnded) return;

    if (team === 0) {
      this.score.red++;
      this.hud.announce('GOAL!', 'go', SCORE_ANNOUNCE_TIME);
      this.hud.feed('<b style="color:#ff4d5e">RED</b> SCORES!', 'ko');
    } else {
      this.score.blue++;
      this.hud.announce('GOAL!', 'go', SCORE_ANNOUNCE_TIME);
      this.hud.feed('<b style="color:#3fa9ff">BLUE</b> SCORES!', 'ko');
    }

    this._updateScoreboard();

    // Effects
    if (this.fx) {
      const ballPos = this.ballBody.translation();
      this.fx.particles?.confetti?.(ballPos, 48);
      this.fx.bursts?.spawn?.(ballPos, 1.6, team === 0 ? PALETTE.red : PALETTE.blue);
      this.fx.cam?.shake?.(0.2);
    }
    if (this.audio) {
      this.audio.playCheer?.(1);
      this.audio.playTech?.(1);
    }

    // Check win condition
    if (this.score.red >= WIN_SCORE || this.score.blue >= WIN_SCORE) {
      this.matchEnded = true;
      this.winnerTeam = this.score.red >= WIN_SCORE ? 0 : 1;
      const winnerName = this.winnerTeam === 0 ? 'RED' : 'BLUE';
      this.hud.announce(`${winnerName} WINS!`, this.winnerTeam === 0 ? 'go' : 'go', 2.5);
    }

    // Schedule ball reset
    this.resetting = true;
    this.resetTimer = BALL_RESET_DELAY;
  }

  _checkBallOutOfBounds() {
    if (!this.ballBody) return;
    const pos = this.ballBody.translation();

    // Ball fell off stage or into water
    if (pos.y < WATER_LEVEL + 1 || Math.hypot(pos.x, pos.z) > STAGE_RADIUS + 3) {
      if (!this.resetting) {
        this.resetting = true;
        this.resetTimer = BALL_RESET_DELAY;
        if (this.fx) this.fx.splash({ x: pos.x, y: WATER_LEVEL, z: pos.z }, true);
      }
    }
  }

  update(dt, dweebs, match) {
    if (this.matchEnded) return;

    // Keep the visible ball glued to its physics body
    if (this.ball && this.ballBody) {
      const t = this.ballBody.translation(), r = this.ballBody.rotation();
      this.ball.position.set(t.x, t.y, t.z);
      this.ball.quaternion.set(r.x, r.y, r.z, r.w);
    }
    if (this.resetting) { this.resetTimer -= dt; if (this.resetTimer <= 0) this._resetBall(); return; }
    this._checkGoals();
    this._checkBallOutOfBounds();


    // Bot AI: set forced targets for each team
    this._updateBotTargets(dweebs);
  }

  _updateBotTargets(dweebs) {
    if (!this.ballBody) return;

    const ballPos = this.ballBody.translation();
    const ballX = ballPos.x;
    const ballZ = ballPos.z;

    // Find bots by team
    const teamABots = dweebs.filter((d, i) => i < 2 && !d.isPlayer);
    const teamBBots = dweebs.filter((d, i) => i >= 2 && !d.isPlayer);

    // For each team, nearest to ball chases, other defends
    this._assignBotRoles(teamABots, ballX, ballZ, 0); // RED team
    this._assignBotRoles(teamBBots, ballX, ballZ, 1); // BLUE team
  }

  _assignBotRoles(bots, ballX, ballZ, team) {
    if (bots.length === 0) return;

    // Find nearest to ball
    let nearest = null;
    let nearestDist = Infinity;
    for (const bot of bots) {
      const pos = bot.getPosition();
      const dist = Math.hypot(pos.x - ballX, pos.z - ballZ);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = bot;
      }
    }

    // Set forced targets
    for (const bot of bots) {
      const botObj = bot.bot; // Bot instance
      if (!botObj) continue;

      if (bot === nearest) {
        // Chaser: push ball toward opponent goal
        // Get behind the ball (on the far side from the goal we attack), then drive through it
        const goalX = team === 0 ? STAGE_RADIUS * 0.7 : -STAGE_RADIUS * 0.7;
        let gx = goalX - ballX, gz = -ballZ; const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
        const bx = ballX - gx * 1.6, bz = ballZ - gz * 1.6;
        const p = bot.getPosition();
        const lined = Math.hypot(p.x - bx, p.z - bz) < 1.2;
        botObj.forcedTarget = lined ? { x: ballX + gx * 2, z: ballZ + gz * 2 } : { x: bx, z: bz };
      } else {
        // Defender: hang near own goal
        const defendX = team === 0 ? -STAGE_RADIUS * 0.6 : STAGE_RADIUS * 0.6;
        botObj.forcedTarget = { x: defendX, z: 0 };
      }
    }
  }

  dispose() {
    // Remove ball
    if (this.ball) {
      this.scene.remove(this.ball);
      this.ball.geometry?.dispose();
      this.ball.material?.dispose?.();
      this.ball = null;
    }
    if (this.ballBody) {
      this.physics.removeBody('dweebball_ball');
      this.ballBody = null;
    }

    // Remove goals
    if (this.goalA) {
      this.scene.remove(this.goalA);
      this.goalA.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
      this.goalA = null;
    }
    if (this.goalB) {
      this.scene.remove(this.goalB);
      this.goalB.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
      this.goalB = null;
    }

    // Remove scoreboard
    if (this.scoreEl) {
      this.scoreEl.remove();
      this.scoreEl = null;
    }

    for (const d of this.dweebs || []) if (d.bot) d.bot.forcedTarget = null;
    this.dweebs = null;
    this.botForcedTargets.clear();
  }
}