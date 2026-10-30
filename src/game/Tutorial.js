// Tutorial.js — first-run 'Dweeb Boot Camp' tutorial.
// Steps play sequentially; each completes from real player input or times out after 25 s.

export class TutorialDirector {
  constructor({ hud }) {
    this.hud = hud;
    this.card = null;
    this.step = 0;
    this._active = false;
    this.timer = 0;
    this.done = false;

    // Step definitions: each has a prompt and a check function
    this.steps = [
      {
        id: 'move',
        prompt: 'Move with WASD / left stick',
        check: (player, dt) => this._checkMove(player, dt),
        timeout: 25,
      },
      {
        id: 'jump',
        prompt: 'Jump with SPACE / A — tap twice to double jump',
        check: (player, dt) => this._checkJump(player, dt),
        timeout: 25,
      },
      {
        id: 'punch',
        prompt: 'Punch with LEFT CLICK / X — hold to charge a SMASH',
        check: () => this._checkHit(),
        timeout: 25,
      },
      {
        id: 'grab',
        prompt: 'Grab with E / B, then press again to THROW',
        check: () => this._checkThrow(),
        timeout: 25,
      },
      {
        id: 'dive',
        prompt: 'Dive or air-dodge with SHIFT / RB',
        check: (player) => this._checkDive(player),
        timeout: 25,
      },
      {
        id: 'ko',
        prompt: 'Knock someone off the island to score a KO!',
        check: () => this._checkKO(),
        timeout: 25,
      },
    ];

    // Internal state for tracking
    this._moveDistance = 0;
    this._lastPos = null;
    this._jumpCount = 0;
    this._wasGrounded = false;
    this._hitDetected = false;
    this._throwDetected = false;
    this._diveDetected = false;
    this._koDetected = false;
  }

  start(player) {
    if (this.done) return;
    if (localStorage.getItem('dweebs.tutorialDone') === '1') {
      this.done = true;
      return;
    }
    this.player = player;
    this._active = true;
    this.step = 0;
    this._resetStepState();
    this._createCard();
    this._updateCard();
  }

  skip() {
    if (!this.active) return;
    this._hideCard();
    this._active = false;
    this.done = true;
    localStorage.setItem('dweebs.tutorialDone', '1');
  }

  note(event, data) {
    if (!this.active) return;
    switch (event) {
      case 'hit':
        this._hitDetected = true;
        break;
      case 'throw':
        this._throwDetected = true;
        break;
      case 'ko':
        this._koDetected = true;
        break;
    }
  }

  update(dt) {
    if (!this._active || this.done) return;
    if (!this.player || !this.player.active) return;

    const stepDef = this.steps[this.step];
    if (!stepDef) return;

    this.timer += dt;

    // Check completion condition
    let completed = false;
    try {
      completed = stepDef.check(this.player, dt);
    } catch (e) {
      // Never throw
      console.warn('Tutorial check error:', e);
    }

    // Timeout auto-advance
    if (!completed && this.timer >= stepDef.timeout) {
      completed = true;
    }

    if (completed) {
      this._completeStep();
    }
  }

  get active() {
    return this._active && !this.done;
  }

  hide() {
    this._hideCard();
  }

  _resetStepState() {
    this.timer = 0;
    this._moveDistance = 0;
    this._lastPos = this.player ? { ...this.player.getPosition() } : null;
    this._jumpCount = 0;
    this._wasGrounded = this.player?.grounded ?? false;
    this._hitDetected = false;
    this._throwDetected = false;
    this._diveDetected = false;
    this._koDetected = false;
  }

  _checkMove(player, dt) {
    const pos = player.getPosition();
    if (this._lastPos) {
      const dx = pos.x - this._lastPos.x;
      const dz = pos.z - this._lastPos.z;
      this._moveDistance += Math.hypot(dx, dz);
    }
    this._lastPos = { ...pos };
    return this._moveDistance >= 4;
  }

  _checkJump(player, dt) {
    // Detect jump: transition from grounded to not grounded with upward velocity
    const grounded = player.grounded;
    const vel = player.velocity;
    if (this._wasGrounded && !grounded && vel.y > 4) {
      this._jumpCount++;
    }
    this._wasGrounded = grounded;
    return this._jumpCount >= 2;
  }

  _checkHit() {
    return this._hitDetected;
  }

  _checkThrow() {
    return this._throwDetected;
  }

  _checkDive(player) {
    if (player.diveTimer > 0 || player.airDodgeTimer > 0) {
      this._diveDetected = true;
    }
    return this._diveDetected;
  }

  _checkKO() {
    return this._koDetected;
  }

  _completeStep() {
    // Green check flash on card border
    if (this.card) {
      this.card.style.borderLeftColor = '#5ee06a';
      setTimeout(() => {
        if (this.card) this.card.style.borderLeftColor = '#ffd23f';
      }, 400);
    }

    // Popup feedback
    if (this.hud?.popup && this.player) {
      this.hud.popup('NICE!', this.player.getPosition(), 'small', 0x5ee06a);
    }

    this.step++;
    this._resetStepState();

    if (this.step >= this.steps.length) {
      this._finish();
    } else {
      this._updateCard();
    }
  }

  _finish() {
    this._active = false;
    this.done = true;
    localStorage.setItem('dweebs.tutorialDone', '1');
    this._hideCard();
    if (this.hud?.announce) {
      this.hud.announce('BOOT CAMP COMPLETE!', '', 1.6);
    }
  }

  _createCard() {
    if (this.card) return;
    this.card = document.createElement('div');
    this.card.id = 'tutorial-card';
    this.card.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: 150px;
      transform: translateX(-50%);
      background: rgba(27, 16, 48, 0.85);
      color: white;
      font-family: "Nunito", sans-serif;
      font-weight: 900;
      font-size: 18px;
      padding: 14px 24px;
      border-radius: 14px;
      border-left: 6px solid #ffd23f;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      pointer-events: auto;
    `;
    this.card.innerHTML = `
      <span id="tutorial-step-text"></span>
      <button id="tutorial-skip-btn" style="
        background: transparent;
        border: 2px solid #ffd23f;
        color: #ffd23f;
        font-family: 'Nunito', sans-serif;
        font-weight: 900;
        font-size: 14px;
        padding: 6px 14px;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      ">Skip</button>
    `;
    document.body.appendChild(this.card);

    this.card.querySelector('#tutorial-skip-btn').addEventListener('mouseenter', (e) => {
      e.target.style.background = '#ffd23f';
      e.target.style.color = '#1b1030';
    });
    this.card.querySelector('#tutorial-skip-btn').addEventListener('mouseleave', (e) => {
      e.target.style.background = 'transparent';
      e.target.style.color = '#ffd23f';
    });
    this.card.querySelector('#tutorial-skip-btn').addEventListener('click', () => this.skip());
  }

  _updateCard() {
    if (!this.card) return;
    const stepDef = this.steps[this.step];
    if (!stepDef) return;
    const counter = this.card.querySelector('#tutorial-step-text');
    if (counter) {
      counter.textContent = `BOOT CAMP ${this.step + 1}/${this.steps.length} — ${stepDef.prompt}`;
    }
  }

  _hideCard() {
    if (this.card) {
      this.card.remove();
      this.card = null;
    }
  }
}