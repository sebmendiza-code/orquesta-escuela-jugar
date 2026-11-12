import { t } from './i18n.js';
const OBSTACLES = ['low-stand', 'high-stand', 'violin-case', 'cello-case', 'bench', 'drum', 'sheet-pile', 'rolling-case', 'flying-sheets'];
const STAGE_NAMES = ['ESCUELA DE MÚSICA', 'TEATRO CLÁSICO', 'VIENA MUSICAL', 'GRAN CONCIERTO'];
const STAGE_COLORS = ['#16a67b', '#e15357', '#ed9e49', '#8173ee'];
const RUNNER_PHASES = [
  { name: 'ANDANTE', until: 60 },
  { name: 'ALLEGRO', until: 150 },
  { name: 'PRESTO', until: 240 },
  { name: 'PRESTISSIMO', until: 360 },
  { name: 'GRAN FINAL', until: Infinity },
];
const SALIERI_ENCOUNTERS = [
  {
    at: 60,
    opening: '¡SOY SALIERI! ¡VEAMOS SI PODÉS SEGUIR EL RITMO!',
    victory: '¡PRIMER DESAFÍO SUPERADO!',
    trick: 'flying-sheets',
    pattern: ['flying-sheets', 'sheet-pile', 'flying-sheets'],
  },
  {
    at: 150,
    opening: '¡NADA MAL! ¡PERO AHORA VIENE LO DIFÍCIL!',
    victory: '¡SEGUNDO DESAFÍO SUPERADO!',
    trick: 'musical-obstacles',
    pattern: ['low-stand', 'drum', 'violin-case'],
  },
  {
    at: 210,
    opening: '¡ESTA SERÁ MI ÚLTIMA PRUEBA!',
    victory: '¡TERCER DESAFÍO SUPERADO!',
    trick: 'grand-finale',
    pattern: ['flying-sheets', 'high-stand', 'rolling-case', 'flying-sheets'],
  },
];
const OBSTACLE_BANDS = {
  low: ['bench', 'sheet-pile', 'low-stand', 'violin-case'],
  medium: ['drum', 'rolling-case', 'violin-case'],
  high: ['high-stand', 'cello-case', 'flying-sheets'],
};
const OBSTACLE_SHAPES = {
  'low-stand': [0.57, 0.48],
  'high-stand': [0.55, 0.9],
  'violin-case': [0.78, 0.38],
  'cello-case': [0.49, 0.88],
  bench: [0.73, 0.43],
  drum: [0.58, 0.55],
  'sheet-pile': [0.7, 0.37],
  'rolling-case': [0.5, 0.72],
  'flying-sheets': [0.68, 0.42],
};

export class SalieriEscapeGame {
  constructor({ avatar, avatarFallback = avatar, avatarAspectRatio = null, backgrounds, salieri, salieriFallback = null, salieriPoses = null, obstacleSprites = {}, achievements = [], doubleJumpUnlocked = false, allyUnlocked = false, salieriCleanChallengesTotal = 0, salieriFriendlyVisits = 0 }) {
    this.avatar = avatar;
    this.avatarFallback = avatarFallback;
    this.avatarAspectRatio = avatarAspectRatio;
    this.backgrounds = backgrounds;
    this.salieriImage = salieri;
    this.salieriFallback = salieriFallback;
    this.salieriPoses = salieriPoses || { challenger: salieri, trickster: salieri, friendly: salieriFallback || salieri };
    this.obstacleSprites = obstacleSprites;
    this.allyAchievementUnlocked = !!allyUnlocked;
    this.salieriCleanChallengesTotal = Math.max(0, Math.floor(Number(salieriCleanChallengesTotal) || 0));
    this.salieriFriendlyVisits = Math.max(0, Math.floor(Number(salieriFriendlyVisits) || 0));
    this.reset({ achievements, doubleJumpUnlocked, allyUnlocked, salieriCleanChallengesTotal, salieriFriendlyVisits });
  }

  setAvatar(avatar, fallbackAvatar = avatar, aspectRatio = null) {
    this.avatar = avatar;
    this.avatarFallback = fallbackAvatar;
    this.avatarAspectRatio = aspectRatio;
  }

  reset({ achievements = [], doubleJumpUnlocked = false, allyUnlocked = this.allyUnlocked, salieriCleanChallengesTotal = this.salieriCleanChallengesTotal, salieriFriendlyVisits = this.salieriFriendlyVisits } = {}) {
    this.time = 0;
    this.distance = 0;
    this.notes = 0;
    this.score = 0;
    this.bonusScore = 0;
    this.lives = 3;
    this.nextLifeScore = 500;
    this.dodges = 0;
    this.appearances = 0;
    this.salieriChallengesCleared = 0;
    this.salieriCleanChallengesTotal = Math.max(0, Math.floor(Number(salieriCleanChallengesTotal) || 0));
    this.salieriFriendlyVisits = Math.max(0, Math.floor(Number(salieriFriendlyVisits) || 0));
    this.allyAchievementUnlocked = !!allyUnlocked || this.allyAchievementUnlocked;
    this.allyUnlocked = false;
    this.allyDialogOpen = false;
    this.allyDialogPage = 0;
    this.shieldCharges = 0;
    this.shieldTimer = 0;
    this.slowTimer = 0;
    this.allyHelpTimer = 0;
    this.salieriChallengeId = 0;
    this.encountersStarted = 0;
    this.encountersCompleted = 0;
    this.currentEncounter = 0;
    this.encounterRewarded = false;
    this.invulnerable = 0;
    this.hitFlash = 0;
    this.landingTimer = 0;
    this.dust = [];
    this.dustTimer = 0;
    this.playerY = null;
    this.playerVy = 0;
    this.grounded = true;
    this.jumpsLeft = doubleJumpUnlocked ? 2 : 1;
    this.doubleJumpUnlocked = !!doubleJumpUnlocked;
    this.paused = false;
    this.finished = false;
    this.won = false;
    this.finalized = false;
    this.retreatTime = 0;
    this.obstaclePool ||= [];
    this.obstacles ||= [];
    while (this.obstacles.length && this.obstaclePool.length < 24) this.obstaclePool.push(this.obstacles.pop());
    this.obstacles.length = 0;
    this.collectibles ||= [];
    this.collectibles.length = 0;
    this.particles ||= [];
    this.particles.length = 0;
    this.specialObstacleQueue = [];
    this.obstaclePatternQueue = [];
    this.lastObstaclePattern = '';
    this.lastObstacleKind = '';
    this.intenseWave = false;
    this.waveTimer = 7 + Math.random() * 5;
    this.difficultyStage = 0;
    this.events = [];
    this.spawnTimer = 1.8;
    this.noteTimer = 1.9;
    this.sceneIndex = 0;
    this.tempoMessage = 'ANDANTE · ¡A correr!';
    this.tempoMessageTimer = 2.6;
    this.windTimer = 0;
    this.speedSurgeTimer = 0;
    this.salieri = { active: false, time: 0, exitTime: 0, trick: '', triggered: false, hit: false, challengeId: 0, friendly: false };
    this.salieriWarningTimer = 0;
    this.salieriWarningShown = false;
    this.nextSalieriAt = SALIERI_ENCOUNTERS[0].at;
    this.achievements = new Set(Array.isArray(achievements) ? achievements : []);
    this.backgroundOffset = 0;
    this.runId = `escape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  dimensions(width, height) {
    const desiredPlayerH = height * 0.26;
    const primaryReady = this.avatar?.naturalWidth && this.avatar?.naturalHeight;
    const primaryFailed = this.avatar?.complete && !this.avatar?.naturalWidth;
    const ratioSource = primaryReady ? this.avatar : this.avatarFallback;
    const ratio = primaryReady
      ? ratioSource.naturalWidth / ratioSource.naturalHeight
      : (!primaryFailed && this.avatarAspectRatio) || (ratioSource?.naturalWidth && ratioSource?.naturalHeight
        ? ratioSource.naturalWidth / ratioSource.naturalHeight
        : 0.92);
    const playerH = Math.min(desiredPlayerH, (width * 0.23) / ratio);
    const playerW = playerH * ratio;
    return {
      groundY: height * 0.785,
      playerH,
      playerW,
      playerX: width * 0.14,
      scale: height / 225,
    };
  }

  emit(type, extra = {}) {
    this.events.push({ type, ...extra });
  }

  drainEvents() {
    const pending = this.events;
    this.events = [];
    return pending;
  }

  unlockAchievement(id) {
    if (this.achievements.has(id)) return;
    this.achievements.add(id);
    this.emit('achievement', { id });
  }

  jump() {
    if (this.paused || this.finished || this.allyDialogOpen) return false;
    if (this.grounded) {
      const height = this._height || 225;
      const scale = height / 225;
      this.playerVy = -Math.max(530 * scale, height * 2.55);
      this.grounded = false;
      this.jumpsLeft = this.doubleJumpUnlocked ? 1 : 0;
      this.emit('jump');
      return true;
    }
    if (this.doubleJumpUnlocked && this.jumpsLeft > 0) {
      this.jumpsLeft -= 1;
      const height = this._height || 225;
      const scale = height / 225;
      this.playerVy = -Math.max(480 * scale, height * 2.32);
      this.emit('double-jump');
      return true;
    }
    return false;
  }

  closeAllyDialog() {
    if (!this.allyDialogOpen) return false;
    if (this.allyDialogPage < 2) {
      this.allyDialogPage += 1;
      return true;
    }
    this.allyDialogOpen = false;
    this.emit('ally-dialog-closed');
    return true;
  }

  togglePause() {
    if (this.finished || this.allyDialogOpen) return this.paused;
    this.paused = !this.paused;
    this.emit(this.paused ? 'pause' : 'resume');
    return this.paused;
  }

  spawnObstacle(kind, x = null, yOffset = 0, challengeId = null) {
    const { groundY, playerH, scale } = this.dimensions(this._width, this._height);
    const obstacleKind = kind || OBSTACLES[Math.floor(Math.random() * OBSTACLES.length)];
    const [widthFactor, heightFactor] = OBSTACLE_SHAPES[obstacleKind] || OBSTACLE_SHAPES['low-stand'];
    const width = playerH * widthFactor;
    const height = playerH * heightFactor;
    const obstacle = this.obstaclePool.pop() || {};
    const isAerialSheet = obstacleKind === 'flying-sheets';
    Object.assign(obstacle, {
      kind: obstacleKind,
      x: x ?? this._width + width + 10 * scale,
      y: groundY - height + yOffset - (isAerialSheet ? playerH * 0.39 : 0),
      w: width,
      h: height,
      passed: false,
      hit: false,
      challengeId,
      rotation: 0,
    });
    this.obstacles.push(obstacle);
    this.collectibles.forEach((item) => {
      const overlaps = item.x + item.r > obstacle.x && item.x - item.r < obstacle.x + obstacle.w
        && item.y + item.r > obstacle.y && item.y - item.r < obstacle.y + obstacle.h;
      if (overlaps) item.x = obstacle.x + obstacle.w + playerH * 1.35;
    });
    return obstacle;
  }

  safeObstacleDelay() {
    const { playerH, scale } = this.dimensions(this._width, this._height);
    const speed = Math.max(1, this.currentSpeed || 205 * scale);
    const gravity = 1650 * scale;
    const jumpImpulse = Math.max(530 * scale, this._height * 2.55);
    const airtime = (2 * jumpImpulse) / gravity;
    const widestObstacle = playerH * 0.88;
    const safeReactionDelay = airtime + 0.38 + widestObstacle / speed;
    const stageFloor = [1.9, 1.82, 1.74, 1.68, 1.64][this.difficultyStage] || 1.64;
    return Math.max(safeReactionDelay, stageFloor);
  }

  chooseObstaclePattern() {
    const stage = this.difficultyStage;
    const patterns = [
      { id: 'single-low', bands: ['low'] },
      { id: 'single-low-alt', bands: ['low'] },
    ];
    if (stage >= 1) patterns.push({ id: 'single-medium', bands: ['medium'] });
    if (stage >= 2) patterns.push({ id: 'single-high', bands: ['high'] });
    const pairChance = [0.03, 0.14, 0.24, 0.3, 0.32][stage] + (this.intenseWave ? 0.08 : 0);
    if (Math.random() < pairChance) {
      patterns.push({ id: 'pair-low-medium', bands: ['low', 'medium'] });
      if (stage >= 2) patterns.push({ id: 'pair-medium-high', bands: ['medium', 'high'] });
      if (stage >= 3) patterns.push({ id: 'pair-low-low', bands: ['low', 'low'] });
      if (stage >= 4) patterns.push({ id: 'pair-high-medium', bands: ['high', 'medium'] });
    }
    if (!this.intenseWave && Math.random() < (stage === 0 ? 0.11 : 0.07)) {
      this.lastObstaclePattern = 'recovery';
      return [];
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const pattern = patterns[Math.floor(Math.random() * patterns.length)];
      const kinds = [];
      for (const band of pattern.bands) {
        let choices = OBSTACLE_BANDS[band].filter((kind) => !kinds.includes(kind)
          && kind !== (kinds.length ? kinds[kinds.length - 1] : this.lastObstacleKind));
        if (!choices.length) choices = OBSTACLE_BANDS[band].filter((kind) => !kinds.includes(kind));
        kinds.push(choices[Math.floor(Math.random() * choices.length)]);
      }
      const signature = `${pattern.id}:${kinds.join('>')}`;
      if (signature !== this.lastObstaclePattern) {
        this.lastObstaclePattern = signature;
        this.lastObstacleKind = kinds[kinds.length - 1];
        return kinds.map((kind) => ({ kind, challengeId: null }));
      }
    }
    const fallbackKind = OBSTACLE_BANDS.low.find((kind) => kind !== this.lastObstacleKind) || 'bench';
    this.lastObstaclePattern = `fallback:${fallbackKind}`;
    this.lastObstacleKind = fallbackKind;
    return [{ kind: fallbackKind, challengeId: null }];
  }

  nextObstacleDelay(sequenceContinues = false) {
    const safeDelay = this.safeObstacleDelay();
    if (sequenceContinues) return safeDelay * (1.08 + Math.random() * 0.16);
    const extra = this.intenseWave ? 1.12 + Math.random() * 0.38 : 1.38 + Math.random() * 0.7;
    return safeDelay * extra;
  }

  spawnNotes() {
    const { groundY, playerH, scale } = this.dimensions(this._width, this._height);
    const noteX = this._width + 25 * scale;
    const noteY = groundY - playerH * (0.57 + Math.random() * 0.3);
    const conflicts = this.obstacles.some((obstacle) => noteX + 11 * scale > obstacle.x
      && noteX - 11 * scale < obstacle.x + obstacle.w
      && noteY + 11 * scale > obstacle.y && noteY - 11 * scale < obstacle.y + obstacle.h);
    if (conflicts) return;
    this.collectibles.push({ x: noteX, y: noteY, r: 11 * scale, phase: Math.random() * Math.PI * 2, collected: false });
  }

  updateScore() {
    this.score = Math.floor(this.distance) + this.notes * 15 + this.bonusScore;
    while (this.score >= this.nextLifeScore) {
      const threshold = this.nextLifeScore;
      this.nextLifeScore += threshold < 1500 ? 500 : 1000;
      if (this.lives < 5) {
        this.lives += 1;
        this.emit('life-reward', { lives: this.lives, threshold, reason: 'score' });
      }
    }
  }

  grantLife(reason) {
    if (this.lives >= 5) return false;
    this.lives += 1;
    this.emit('life-reward', { lives: this.lives, reason });
    return true;
  }

  beginSalieriAppearance() {
    this.appearances += 1;
    this.salieriChallengeId += 1;
    const friendly = this.allyUnlocked;
    const encounter = friendly ? null : (SALIERI_ENCOUNTERS[this.encountersStarted] || null);
    if (encounter) {
      this.currentEncounter = this.encountersStarted + 1;
      this.encountersStarted += 1;
      this.nextSalieriAt = SALIERI_ENCOUNTERS[this.encountersStarted]?.at ?? Infinity;
    } else {
      this.currentEncounter = 0;
      this.nextSalieriAt = this.time + 28 + Math.random() * 18;
    }
    this.salieri = {
      active: true,
      time: 0,
      exitTime: 0,
      trick: friendly ? 'friendly-help' : encounter?.trick || 'grand-finale',
      message: friendly ? '¡SALIERI TE AYUDA!' : (encounter?.opening || '¡ESTA SERÁ MI ÚLTIMA PRUEBA!'),
      victory: encounter?.victory || '¡DESAFÍO SUPERADO!',
      pattern: encounter?.pattern || [],
      triggered: friendly,
      hit: false,
      rewarded: false,
      friendly,
      challengeId: this.salieriChallengeId,
      encounter: this.currentEncounter,
    };
    this.salieriWarningShown = false;
    this.emit(friendly ? 'salieri-friendly' : 'salieri', {
      appearance: this.appearances,
      encounter: this.currentEncounter,
      trick: this.salieri.trick,
      challengeId: this.salieri.challengeId,
      message: this.salieri.message,
    });
  }

  resolveSalieriChallenge() {
    if (this.finished || !this.salieri.active || !this.salieri.triggered || this.salieri.rewarded || this.lives <= 0) return;
    this.salieri.rewarded = true;
    this.salieriChallengesCleared += 1;
    this.encountersCompleted += 1;
    const clean = !this.salieri.hit;
    if (clean) this.salieriCleanChallengesTotal += 1;
    this.bonusScore += 100;
    this.notes += 5;
    this.updateScore();
    this.emit('salieri-defeated', {
      challengeId: this.salieri.challengeId,
      cleared: this.encountersCompleted,
      encounter: this.salieri.encounter,
      clean,
      cleanTotal: this.salieriCleanChallengesTotal,
      score: this.score,
      notes: this.notes,
      victory: this.salieri.victory,
    });
    if (this.salieri.encounter === 3 && !this.allyUnlocked && this.lives > 0) {
      this.allyUnlocked = true;
      this.allyAchievementUnlocked = true;
      this.allyDialogOpen = true;
      this.allyDialogPage = 0;
      this.nextSalieriAt = this.time + 28 + Math.random() * 18;
      this.emit('salieri-ally-unlocked', { encounter: 3, clean, permanent: true });
    }
  }

  chooseAllyHelp() {
    const options = ['notes'];
    if (this.lives < 5) options.push('life');
    if (this.shieldCharges === 0) options.push('shield');
    if (this.slowTimer <= 0) options.push('slow');
    return options[Math.floor(Math.random() * options.length)];
  }

  resolveFriendlyAppearance() {
    if (!this.salieri.active || !this.salieri.friendly || this.salieri.rewarded) return;
    this.salieri.rewarded = true;
    this.salieriFriendlyVisits += 1;
    const help = this.chooseAllyHelp();
    if (help === 'life') this.grantLife('salieri-ally');
    else if (help === 'notes') {
      this.notes += 5;
      this.updateScore();
    } else if (help === 'shield') {
      this.shieldCharges = 1;
      this.shieldTimer = 12;
    } else if (help === 'slow') this.slowTimer = 3;
    this.nextSalieriAt = this.time + 28 + Math.random() * 18;
    this.emit('salieri-help', { visits: this.salieriFriendlyVisits, help, lives: this.lives, notes: this.notes });
  }

  performTrick() {
    if (this.allyUnlocked || this.salieri.friendly || this.salieri.triggered) return;
    this.salieri.triggered = true;
    this.obstaclePatternQueue.length = 0;
    this.specialObstacleQueue = this.salieri.pattern.map((kind) => ({ kind, challengeId: this.salieri.challengeId }));
    this.spawnTimer = Math.max(this.spawnTimer, this.safeObstacleDelay() * 1.1);
    this.emit('challenge-start', {
      encounter: this.salieri.encounter,
      trick: this.salieri.trick,
      challengeId: this.salieri.challengeId,
      message: this.salieri.message,
    });
  }

  hitObstacle(obstacle) {
    if (this.invulnerable > 0 || obstacle.hit) return;
    obstacle.hit = true;
    if (this.shieldCharges > 0 && this.shieldTimer > 0) {
      this.shieldCharges = 0;
      this.shieldTimer = 0;
      this.invulnerable = 0.75;
      this.emit('shield-block', { lives: this.lives });
      return;
    }
    if (this.salieri.active || obstacle.challengeId === this.salieri.challengeId) this.salieri.hit = true;
    this.lives = Math.max(0, this.lives - 1);
    this.invulnerable = 1.5;
    this.hitFlash = 0.48;
    this.emit('hit', { lives: this.lives });
    if (this.lives <= 0) this.finish(false);
  }

  finish(won) {
    if (this.finished) return;
    this.finished = true;
    this.won = !!won;
    this.paused = false;
    this.retreatTime = 0;
    this.updateScore();
    this.emit('finish', { won: this.won, score: this.score, distance: Math.floor(this.distance), notes: this.notes, dodges: this.dodges, appearances: this.appearances, runId: this.runId });
  }

  update(dt, width, height) {
    this._width = width;
    this._height = height;
    if (this.paused || this.allyDialogOpen || !width || !height) return;
    dt = Math.min(0.05, Math.max(0, dt));
    if (this.finished) {
      if (this.won) this.retreatTime += dt;
      return;
    }
    const dims = this.dimensions(width, height);
    const { groundY, playerH, playerW, playerX, scale } = dims;
    if (this.playerY === null) this.playerY = groundY - playerH;
    this._playerH = playerH;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.landingTimer = Math.max(0, this.landingTimer - dt);
    this.salieriWarningTimer = Math.max(0, this.salieriWarningTimer - dt);
    this.tempoMessageTimer = Math.max(0, this.tempoMessageTimer - dt);
    this.windTimer = Math.max(0, this.windTimer - dt);
    this.speedSurgeTimer = Math.max(0, this.speedSurgeTimer - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    if (this.shieldTimer <= 0) this.shieldCharges = 0;
    if (!this.salieri.active && this.salieri.exitTime > 0) this.salieri.exitTime = Math.max(0, this.salieri.exitTime - dt);
    this.time += dt;
    const newScene = Math.min(3, Math.floor(this.time / 30));
    if (newScene !== this.sceneIndex) this.sceneIndex = newScene;

    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.intenseWave = !this.intenseWave;
      this.waveTimer = this.intenseWave ? 5.5 + Math.random() * 4 : 9 + Math.random() * 8;
    }

    const phaseIndex = RUNNER_PHASES.findIndex((phase) => this.time < phase.until);
    const nextPhase = phaseIndex < 0 ? RUNNER_PHASES.length - 1 : phaseIndex;
    if (nextPhase !== this.difficultyStage) {
      this.difficultyStage = nextPhase;
      this.tempoMessage = `${RUNNER_PHASES[nextPhase].name} · ¡seguí el compás!`;
      this.tempoMessageTimer = 3;
      this.emit('stage', { stage: nextPhase, playbackRate: Math.min(1.22, 1 + nextPhase * 0.045) });
    }
    const baseSpeed = Math.min(300 * scale, (190 + Math.min(this.time, 360) * 0.25) * scale);
    let speed = baseSpeed * (this.speedSurgeTimer > 0 ? 1.06 : 1);
    if (this.slowTimer > 0) speed *= 0.72;
    this.currentSpeed = speed;
    this.distance += speed * dt * 0.05 / scale;
    this.updateScore();
    this.backgroundOffset += speed * dt;

    const wasGrounded = this.grounded;
    this.playerVy += 1650 * scale * dt;
    this.playerY += this.playerVy * dt;
    if (this.playerY >= groundY - playerH) {
      this.playerY = groundY - playerH;
      this.playerVy = 0;
      this.grounded = true;
      this.jumpsLeft = this.doubleJumpUnlocked ? 2 : 1;
      if (!wasGrounded) {
        this.landingTimer = 0.22;
        // Pequeño impacto de aterrizaje: polvo hacia ambos lados de los pies.
        for (let i = 0; i < 9; i++) {
          const dir = i % 2 ? 1 : -1;
          this.dust.push({
            x: playerX + playerW * (0.5 + dir * 0.18), y: groundY - 2 * scale,
            vx: dir * (30 + Math.random() * 55) * scale, vy: -(8 + Math.random() * 18) * scale,
            r: (1.6 + Math.random() * 1.8) * scale, life: 0.45, max: 0.45,
          });
        }
      }
    } else this.grounded = false;

    // Polvo detrás de los pies mientras corre por el suelo.
    if (!this.dust) this.dust = [];
    this.dustTimer -= dt;
    if (this.grounded && this.dustTimer <= 0) {
      this.dustTimer = 0.07;
      this.dust.push({
        x: playerX + playerW * 0.22, y: groundY - (1 + Math.random() * 3) * scale,
        vx: -(25 + Math.random() * 35) * scale, vy: -(4 + Math.random() * 10) * scale,
        r: (1.2 + Math.random() * 1.4) * scale, life: 0.4, max: 0.4,
      });
    }
    this.dust.forEach((p) => {
      p.x += (p.vx - speed * 0.35) * dt;
      p.y += p.vy * dt;
      p.vy += 40 * scale * dt;
      p.r += 6 * scale * dt;
      p.life -= dt;
    });
    this.dust = this.dust.filter((p) => p.life > 0);
    if (this.dust.length > 60) this.dust.splice(0, this.dust.length - 60);

    if (this.time >= 60 && !this.doubleJumpUnlocked) {
      this.doubleJumpUnlocked = true;
      this.jumpsLeft = 2;
      this.unlockAchievement('survive-60');
      this.emit('double-jump-unlocked');
    }
    if (this.distance >= 100) this.unlockAchievement('distance-100');
    if (this.time >= 60) this.unlockAchievement('survive-60');
    if (this.dodges >= 50) this.unlockAchievement('dodge-50');
    if (this.encountersCompleted >= 3) {
      this.unlockAchievement('salieri-3');
      this.unlockAchievement('mozart-proud');
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const special = this.specialObstacleQueue.length ? this.specialObstacleQueue.shift() : null;
      if (!special && !this.obstaclePatternQueue.length) this.obstaclePatternQueue = this.chooseObstaclePattern();
      const next = special || this.obstaclePatternQueue.shift();
      if (next) {
        this.spawnObstacle(next.kind, null, 0, next.challengeId || null);
        const sequenceContinues = this.specialObstacleQueue.length > 0 || this.obstaclePatternQueue.length > 0;
        this.spawnTimer = this.nextObstacleDelay(sequenceContinues);
      } else {
        this.spawnTimer = this.safeObstacleDelay() * (1.55 + Math.random() * 0.5);
      }
    }
    this.noteTimer -= dt;
    if (this.noteTimer <= 0) {
      this.spawnNotes();
      this.noteTimer = 2.0 + Math.random() * 1.6;
    }

    if (!this.salieri.active && Number.isFinite(this.nextSalieriAt) && !this.salieriWarningShown && this.time >= this.nextSalieriAt - 2) {
      this.salieriWarningTimer = 2;
      this.salieriWarningShown = true;
      this.emit(this.allyUnlocked ? 'salieri-friendly-warning' : 'salieri-warning', { appearance: this.appearances + 1 });
    }
    if (!this.salieri.active && this.salieriWarningShown && this.salieriWarningTimer <= 0 && this.time >= this.nextSalieriAt) this.beginSalieriAppearance();
    let retireSalieri = false;
    if (this.salieri.active) {
      this.salieri.time += dt;
      if (this.salieri.friendly && this.salieri.time >= 1.1) this.resolveFriendlyAppearance();
      else if (!this.salieri.friendly && this.salieri.time >= 1.35 && !this.salieri.triggered) this.performTrick();
      retireSalieri = this.salieri.time >= (this.salieri.friendly ? 2.7 : 5);
    }

    const playerBox = {
      x: playerX + playerW * 0.2,
      y: this.playerY + playerH * 0.12,
      w: playerW * 0.62,
      h: playerH * 0.84,
    };
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obstacle = this.obstacles[i];
      obstacle.x -= speed * dt;
      if (!obstacle.hit && this.invulnerable <= 0) {
        const paddingX = obstacle.w * 0.1;
        const obstacleBox = {
          x: obstacle.x + paddingX,
          y: obstacle.y + obstacle.h * 0.12,
          w: obstacle.w - paddingX * 2,
          h: obstacle.h * 0.84,
        };
        const overlaps = playerBox.x < obstacleBox.x + obstacleBox.w
          && playerBox.x + playerBox.w > obstacleBox.x
          && playerBox.y < obstacleBox.y + obstacleBox.h
          && playerBox.y + playerBox.h > obstacleBox.y;
        if (overlaps) this.hitObstacle(obstacle);
      }
      if (!obstacle.passed && obstacle.x + obstacle.w < playerX) {
        obstacle.passed = true;
        if (!obstacle.hit) {
          this.dodges += 1;
          if (this.dodges >= 50) this.unlockAchievement('dodge-50');
        }
      }
      if (obstacle.hit || obstacle.x + obstacle.w <= -40 * scale) {
        this.obstacles.splice(i, 1);
        if (this.obstaclePool.length < 24) this.obstaclePool.push(obstacle);
      }
    }
    if (retireSalieri && this.salieri.active) {
      if (this.salieri.friendly) {
        this.salieri.active = false;
        this.salieri.exitTime = 0.62;
      } else {
        const challengeId = this.salieri.challengeId;
        const hasQueuedHazards = this.specialObstacleQueue.some((item) => item.challengeId === challengeId);
        const hasOnscreenHazards = this.obstacles.some((obstacle) => obstacle.challengeId === challengeId && !obstacle.passed && !obstacle.hit);
        if (!hasQueuedHazards && !hasOnscreenHazards) {
          this.resolveSalieriChallenge();
          this.salieri.active = false;
          this.salieri.exitTime = 0.62;
        }
      }
    }

    for (let i = this.collectibles.length - 1; i >= 0; i--) {
      const item = this.collectibles[i];
      item.x -= speed * dt;
      item.phase += dt * 4;
      const px = playerX + playerW * 0.5;
      const py = this.playerY + playerH * 0.45;
      if (Math.hypot(item.x - px, item.y - py) < item.r + Math.min(playerW, playerH) * 0.33) {
        if (item.collected) continue;
        item.collected = true;
        this.notes += 1;
        this.updateScore();
        this.emit('collect', { notes: this.notes, x: item.x, y: item.y });
        for (let spark = 0; spark < 6; spark++) {
          const angle = (Math.PI * 2 * spark) / 6;
          this.particles.push({ x: item.x, y: item.y, vx: Math.cos(angle) * 42 * scale, vy: Math.sin(angle) * 42 * scale, life: 0.42, kind: 'note', color: '#ffe45d', r: 2.5 * scale });
        }
        this.collectibles.splice(i, 1);
      } else if (item.x <= -40 * scale) this.collectibles.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt;
      if (particle.life <= 0) this.particles.splice(i, 1);
    }
    if (this.encountersCompleted >= 3 && !this.achievements.has('salieri-3')) this.unlockAchievement('salieri-3');
  }

  drawBackground(ctx, width, height, now) {
    const current = this.backgrounds[this.sceneIndex];
    ctx.fillStyle = '#11132b';
    ctx.fillRect(0, 0, width, height);
    const drawImage = (image, alpha = 1) => {
      if (!image?.complete || !image.naturalWidth) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      const targetAspect = width / height;
      const zoom = 1.08;
      let sourceWidth = image.naturalWidth;
      let sourceHeight = image.naturalHeight;
      if (sourceWidth / sourceHeight > targetAspect) {
        sourceHeight = image.naturalHeight / zoom;
        sourceWidth = sourceHeight * targetAspect;
      } else {
        sourceWidth = image.naturalWidth / zoom;
        sourceHeight = sourceWidth / targetAspect;
      }
      const maxSourceX = Math.max(0, image.naturalWidth - sourceWidth);
      const maxSourceY = Math.max(0, image.naturalHeight - sourceHeight);
      const pan = 0.5 + Math.sin(this.backgroundOffset * 0.00015) * 0.34;
      const sourceX = maxSourceX * pan;
      const sourceY = maxSourceY * 0.5;
      ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
      ctx.restore();
    };
    if (this.sceneIndex > 0 && this.time % 30 < 1.2) {
      drawImage(this.backgrounds[this.sceneIndex - 1], 1 - Math.min(1, (this.time % 30) / 1.2));
      drawImage(current, Math.min(1, (this.time % 30) / 1.2));
    } else drawImage(current, 1);
    // Soft tint keeps the illustrated scenery behind the readable gameplay layer.
    ctx.fillStyle = 'rgba(224,229,239,0.16)';
    ctx.fillRect(0, 0, width, height);
  }

  drawTrack(ctx, width, height, scale) {
    const groundY = height * 0.785;
    const ground = ctx.createLinearGradient(0, groundY, 0, height);
    ground.addColorStop(0, '#e9c786');
    ground.addColorStop(0.14, '#d5ad70');
    ground.addColorStop(1, '#b98759');
    ctx.fillStyle = ground;
    ctx.fillRect(0, groundY, width, height - groundY);
    ctx.fillStyle = '#fff1c2';
    ctx.fillRect(0, groundY, width, Math.max(2, 3 * scale));
    ctx.fillStyle = 'rgba(79,49,44,0.16)';
    ctx.fillRect(0, groundY + 5 * scale, width, Math.max(1, scale));
  }

  drawObstacle(ctx, obstacle, scale, now) {
    const { x, y, w, h, kind } = obstacle;
    ctx.save();
    ctx.fillStyle = 'rgba(28,18,35,0.25)';
    const shadowY = obstacle.kind === 'flying-sheets' ? this.dimensions(this._width, this._height).groundY - 2 * scale : y + h * 0.98;
    ctx.beginPath(); ctx.ellipse(x + w * 0.5, shadowY, w * 0.47, Math.max(2, 3 * scale), 0, 0, Math.PI * 2); ctx.fill();
    const sprite = this.obstacleSprites?.[kind];
    if (sprite?.complete && sprite.naturalWidth && sprite.naturalHeight) {
      const fit = Math.min(w / sprite.naturalWidth, h / sprite.naturalHeight);
      const drawW = sprite.naturalWidth * fit;
      const drawH = sprite.naturalHeight * fit;
      ctx.drawImage(sprite, x + (w - drawW) / 2, y + h - drawH, drawW, drawH);
      ctx.restore();
      return;
    }
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(obstacle.rotation || 0);
    ctx.translate(-w / 2, -h / 2);
    ctx.lineWidth = 2.8 * scale;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#24172f';
    if (kind === 'stand') {
      ctx.fillStyle = '#b66b2b';
      ctx.beginPath(); ctx.moveTo(w * 0.06, h * 0.2); ctx.lineTo(w * 0.92, h * 0.34); ctx.lineTo(w * 0.86, h * 0.65); ctx.lineTo(w * 0.1, h * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f7d28b'; ctx.beginPath(); ctx.moveTo(w * 0.14, h * 0.25); ctx.lineTo(w * 0.83, h * 0.36); ctx.lineTo(w * 0.79, h * 0.53); ctx.lineTo(w * 0.17, h * 0.43); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w * 0.53, h * 0.53); ctx.lineTo(w * 0.37, h * 0.94); ctx.moveTo(w * 0.53, h * 0.53); ctx.lineTo(w * 0.75, h * 0.9); ctx.stroke();
    } else if (kind === 'case') {
      ctx.fillStyle = '#332844'; ctx.beginPath(); ctx.roundRect(w * 0.04, h * 0.1, w * 0.92, h * 0.84, h * 0.22); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#f3b84b'; ctx.lineWidth = 3 * scale; ctx.beginPath(); ctx.roundRect(w * 0.1, h * 0.16, w * 0.8, h * 0.72, h * 0.18); ctx.stroke();
      ctx.fillStyle = '#e4b549'; ctx.fillRect(w * 0.44, h * 0.4, w * 0.12, h * 0.15);
    } else if (kind === 'drum') {
      ctx.fillStyle = '#d43b4b'; ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.32, w * 0.46, h * 0.26, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f2d9b0'; ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.28, w * 0.37, h * 0.16, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#36233a'; ctx.beginPath(); ctx.moveTo(w * 0.25, h * 0.48); ctx.lineTo(w * 0.2, h * 0.98); ctx.moveTo(w * 0.75, h * 0.48); ctx.lineTo(w * 0.8, h * 0.98); ctx.stroke();
      ctx.strokeStyle = '#f3d286'; ctx.beginPath(); ctx.moveTo(w * 0.78, h * 0.04); ctx.lineTo(w * 0.98, h * 0.48); ctx.stroke();
    } else if (kind === 'stool') {
      ctx.fillStyle = '#c7354d'; ctx.beginPath(); ctx.roundRect(w * 0.08, h * 0.05, w * 0.84, h * 0.27, 7 * scale); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d2a34e';
      ctx.beginPath(); ctx.moveTo(w * 0.2, h * 0.32); ctx.lineTo(w * 0.32, h * 0.32); ctx.lineTo(w * 0.26, h * 0.96); ctx.lineTo(w * 0.15, h * 0.96); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w * 0.69, h * 0.32); ctx.lineTo(w * 0.8, h * 0.32); ctx.lineTo(w * 0.88, h * 0.96); ctx.lineTo(w * 0.76, h * 0.96); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (kind === 'sheet-stack') {
      ctx.fillStyle = '#f5e5bd';
      for (let i = 0; i < 3; i++) {
        const dy = i * h * 0.08;
        ctx.beginPath(); ctx.roundRect(w * 0.08 + dy * 0.3, h * 0.34 - dy, w * 0.84, h * 0.58, 3 * scale); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#a68b65'; ctx.lineWidth = 1 * scale;
        for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.moveTo(w * 0.22, h * (0.39 + j * 0.1) - dy); ctx.lineTo(w * 0.76, h * (0.39 + j * 0.1) - dy); ctx.stroke(); }
        ctx.strokeStyle = '#302039'; ctx.lineWidth = 2.4 * scale;
      }
    } else if (kind === 'music-box') {
      ctx.fillStyle = '#c98730'; ctx.beginPath(); ctx.roundRect(w * 0.07, h * 0.25, w * 0.86, h * 0.71, 5 * scale); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f0c459'; ctx.beginPath(); ctx.roundRect(w * 0.02, h * 0.2, w * 0.96, h * 0.21, 5 * scale); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#603654'; ctx.font = `${Math.max(12, h * 0.42)}px Georgia`; ctx.fillText('♫', w * 0.32, h * 0.74);
      ctx.fillStyle = '#ffe487'; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.42, 3.3 * scale, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#fff1c8'; ctx.beginPath(); ctx.moveTo(w * 0.08, h * 0.08); ctx.lineTo(w * 0.88, h * 0.02); ctx.lineTo(w * 0.94, h * 0.88); ctx.lineTo(w * 0.12, h * 0.94); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#49324b'; ctx.font = `${Math.max(10, h * 0.3)}px Georgia`; ctx.fillText('♪', w * 0.38, h * 0.57 + Math.sin(now * 9) * 3 * scale);
      ctx.strokeStyle = '#6d5570'; ctx.lineWidth = 1.1 * scale;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(w * 0.23, h * (0.26 + i * 0.11)); ctx.lineTo(w * 0.77, h * (0.26 + i * 0.11)); ctx.stroke(); }
    }
    ctx.restore();
  }

  drawPlayer(ctx, width, height, now) {
    const { groundY, playerH, playerW, playerX, scale } = this.dimensions(width, height);
    const primary = this.avatar;
    const img = primary?.complete && primary.naturalWidth ? primary : this.avatarFallback;
    const jumpOffset = this.playerY === null ? 0 : groundY - playerH - this.playerY;
    // Leve rebote vertical de la imagen completa (sin animar extremidades ni deformar).
    const runBob = this.grounded && !this.finished && !this.paused ? -Math.abs(Math.sin(now * 9)) * 1.6 * scale : 0;
    const landingBob = this.landingTimer > 0 ? Math.sin((0.22 - this.landingTimer) / 0.22 * Math.PI) * 1.5 * scale : 0;
    (this.dust || []).forEach((p) => {
      ctx.fillStyle = `rgba(214,196,168,${0.45 * Math.max(0, p.life / p.max)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    });
    const hitBlink = this.invulnerable > 0 && Math.floor(this.invulnerable * 12) % 2 === 0;
    const shadowScale = 1 - Math.min(0.55, jumpOffset / (playerH * 2));
    ctx.fillStyle = 'rgba(25,19,38,0.3)';
    ctx.beginPath(); ctx.ellipse(playerX + playerW / 2, groundY - 2 * scale, playerW * 0.42 * shadowScale, 5 * scale * shadowScale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.globalAlpha = hitBlink ? 0.48 : 1;
    const imageRatio = img?.naturalWidth && img?.naturalHeight ? img.naturalWidth / img.naturalHeight : playerW / playerH;
    const drawW = playerH * imageRatio;
    if (img?.complete && img.naturalWidth) {
      ctx.drawImage(img, playerX + (playerW - drawW) / 2, groundY - jumpOffset - playerH + runBob + landingBob, drawW, playerH);
    } else {
      ctx.fillStyle = '#e67928'; ctx.strokeStyle = '#44273d'; ctx.lineWidth = 2 * scale;
      ctx.beginPath(); ctx.ellipse(playerX + playerW / 2, groundY - jumpOffset - playerH * 0.48, playerW * 0.34, playerH * 0.43, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff1cf'; ctx.font = `bold ${16 * scale}px Georgia`; ctx.textAlign = 'center'; ctx.fillText('♪', playerX + playerW / 2, groundY - jumpOffset - playerH * 0.38);
    }
    ctx.restore();
  }

  drawNotes(ctx, scale, now) {
    this.collectibles.forEach((item) => {
      const y = item.y + Math.sin(item.phase) * 4 * scale;
      const size = item.r;
      ctx.save();
      ctx.translate(item.x, y);
      ctx.shadowColor = '#ffe45d'; ctx.shadowBlur = 9 * scale;
      ctx.fillStyle = '#ffd84a'; ctx.strokeStyle = '#70421f'; ctx.lineWidth = 1.8 * scale; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.ellipse(-size * 0.18, size * 0.32, size * 0.42, size * 0.28, -0.24, 0, Math.PI * 2);
      ctx.moveTo(size * 0.13, size * 0.28);
      ctx.lineTo(size * 0.13, -size * 0.8);
      ctx.quadraticCurveTo(size * 0.88, -size * 0.65, size * 0.65, -size * 0.12);
      ctx.quadraticCurveTo(size * 0.74, -size * 0.55, size * 0.13, -size * 0.5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,220,0.9)'; ctx.lineWidth = 1.2 * scale;
      ctx.beginPath(); ctx.moveTo(-size * 0.38, size * 0.23); ctx.quadraticCurveTo(-size * 0.2, size * 0.02, size * 0.02, size * 0.1); ctx.stroke();
      ctx.restore();
    });
  }

  drawSalieriFallback(ctx, x, y, width, height, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(width, height);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 0.035;
    ctx.fillStyle = 'rgba(27,16,42,0.24)';
    ctx.beginPath(); ctx.ellipse(0.5, 0.97, 0.35, 0.03, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#741d3b'; ctx.strokeStyle = '#24162d';
    ctx.beginPath(); ctx.moveTo(0.31,0.48); ctx.lineTo(0.68,0.48); ctx.lineTo(0.83,0.92); ctx.lineTo(0.17,0.92); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#f0bf48'; ctx.lineWidth = 0.018;
    ctx.beginPath(); ctx.moveTo(0.35,0.51); ctx.lineTo(0.5,0.89); ctx.lineTo(0.66,0.51); ctx.stroke();
    ctx.fillStyle = '#edbd42'; ctx.beginPath(); ctx.moveTo(0.43,0.53); ctx.lineTo(0.57,0.53); ctx.lineTo(0.6,0.83); ctx.lineTo(0.5,0.89); ctx.lineTo(0.4,0.83); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a8a1b3'; ctx.strokeStyle = '#251a30'; ctx.lineWidth = 0.026;
    ctx.beginPath(); ctx.moveTo(0.28,0.27); ctx.lineTo(0.25,0.08); ctx.lineTo(0.42,0.19); ctx.lineTo(0.6,0.19); ctx.lineTo(0.76,0.07); ctx.lineTo(0.72,0.29); ctx.quadraticCurveTo(0.79,0.43,0.64,0.49); ctx.lineTo(0.36,0.49); ctx.quadraticCurveTo(0.2,0.42,0.28,0.27); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f4dfc7'; ctx.beginPath(); ctx.ellipse(0.5,0.35,0.23,0.15,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f2e8d8';
    [[0.33,0.21,0.08],[0.4,0.12,0.09],[0.5,0.1,0.1],[0.6,0.13,0.09],[0.68,0.22,0.075]].forEach(([cx,cy,r])=>{ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();ctx.stroke();});
    ctx.fillStyle = '#241a30'; ctx.beginPath(); ctx.ellipse(0.42,0.31,0.025,0.04,0,0,Math.PI*2); ctx.ellipse(0.58,0.31,0.025,0.04,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#8b3d4a'; ctx.beginPath(); ctx.ellipse(0.5,0.38,0.045,0.03,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#5a3042'; ctx.lineWidth = 0.012;
    for (let whisker = 0; whisker < 2; whisker += 1) { const yy = 0.38 + whisker * 0.035; ctx.beginPath(); ctx.moveTo(0.34,yy); ctx.lineTo(0.19,yy - 0.02); ctx.moveTo(0.66,yy); ctx.lineTo(0.81,yy - 0.02); ctx.stroke(); }
    ctx.fillStyle = '#fff5df'; ctx.strokeStyle = '#35213c'; ctx.lineWidth = 0.014;
    ctx.beginPath(); ctx.moveTo(0.46,0.5); ctx.lineTo(0.54,0.5); ctx.lineTo(0.5,0.62); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#f0bf48'; ctx.lineWidth = 0.014; ctx.beginPath(); ctx.moveTo(0.74,0.43); ctx.lineTo(0.92,0.18); ctx.stroke();
    ctx.fillStyle = '#ffe071'; ctx.beginPath(); ctx.arc(0.92,0.18,0.025,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  drawSalieriWarning(ctx, width, height, scale) {
    if (this.salieriWarningTimer <= 0) return;
    const alpha = Math.min(1, this.salieriWarningTimer * 2, (2 - this.salieriWarningTimer) * 4 + 0.15);
    const boxW = width * 0.38;
    const boxH = height * 0.075;
    const boxX = width * 0.33;
    ctx.save();
    ctx.globalAlpha = Math.max(0.55, Math.min(1, alpha));
    ctx.fillStyle = 'rgba(74,24,46,0.94)'; ctx.strokeStyle = '#ffe05c'; ctx.lineWidth = 2 * scale;
    ctx.beginPath(); ctx.roundRect(boxX, height * 0.22, boxW, boxH, 12 * scale); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff2ae'; ctx.textAlign = 'center'; ctx.font = `900 ${Math.max(12, height * 0.034)}px Nunito,sans-serif`;
    ctx.fillText(t(this.allyUnlocked ? '¡SALIERI TE AYUDA!' : '¡CUIDADO! ¡LLEGA SALIERI!'), boxX + boxW / 2, height * 0.268, boxW * 0.94);
    ctx.restore();
  }

  drawSalieri(ctx, width, height, scale, now) {
    const warningPose = this.salieriWarningTimer > 0 && !this.salieri.active && !this.allyUnlocked;
    const winningRetreat = this.finished && this.won;
    if (!this.salieri.active && this.salieri.exitTime <= 0 && !winningRetreat && !warningPose && !this.allyDialogOpen) return;
    const t = winningRetreat ? this.retreatTime : (this.salieri.active ? this.salieri.time : this.salieri.exitTime);
    const entrance = this.salieri.active ? Math.min(1, t / 0.5) : 1;
    const retreat = winningRetreat ? Math.max(0, 1 - (t / 4.5))
      : this.salieri.active ? 1 : warningPose ? Math.min(1, Math.max(0.28, (2 - this.salieriWarningTimer) * 2.5))
        : Math.max(0, this.salieri.exitTime / 0.62);
    const poseKey = this.allyUnlocked && (this.salieri.friendly || this.allyDialogOpen || winningRetreat)
      ? 'friendly'
      : warningPose || !this.salieri.triggered ? 'challenger' : 'trickster';
    const preferred = this.salieriPoses?.[poseKey];
    const activeSprite = [preferred, this.salieriPoses?.challenger, this.salieriPoses?.trickster, this.salieriPoses?.friendly,
      this.salieriFallback, this.salieriImage].find((image) => image?.complete && image.naturalWidth) || null;
    const aspect = activeSprite?.naturalWidth && activeSprite?.naturalHeight
      ? activeSprite.naturalWidth / activeSprite.naturalHeight : 0.92;
    // Salieri grande (~40 % del alto), separado del borde derecho y elevado sobre el suelo.
    // Zona segura bajo la interfaz superior (barra de puntos 6–42 y vidas 45–66, en unidades de escala).
    const floatAmp = 3 * scale;
    const safeTop = Math.max(height * 0.2, 76 * scale) + floatAmp;
    const safeBottom = height * 0.785 - height * 0.06 - floatAmp;
    const availH = Math.max(40, safeBottom - safeTop);
    const spriteH = Math.min(height * 0.4, availH, (width * 0.3) / aspect);
    const spriteW = spriteH * aspect;
    const ease = 1 - Math.pow(1 - entrance, 3);
    // Más hacia el centro, con margen amplio al borde derecho.
    const baseX = width - spriteW - width * 0.12;
    const x = baseX + (1 - ease) * (spriteW + width * 0.12) + (1 - retreat) * spriteW * 1.25;
    const y = safeTop + Math.max(0, (availH - spriteH) * 0.35) - Math.sin(now * 2.4) * floatAmp;
    // Plataforma musical luminosa bajo Salieri.
    ctx.save();
    ctx.globalAlpha = retreat * 0.55;
    const glow = ctx.createRadialGradient(x + spriteW / 2, y + spriteH * 0.98, 0, x + spriteW / 2, y + spriteH * 0.98, spriteW * 0.55);
    glow.addColorStop(0, 'rgba(190,120,255,0.9)'); glow.addColorStop(1, 'rgba(190,120,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.ellipse(x + spriteW / 2, y + spriteH * 0.98, spriteW * 0.55, spriteH * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (activeSprite) {
      ctx.save(); ctx.globalAlpha = retreat; ctx.drawImage(activeSprite, x, y, spriteW, spriteH); ctx.restore();
    } else this.drawSalieriFallback(ctx, x, y, spriteW, spriteH, retreat);
    // Nube de notas durante la entrada.
    const appearT = this.salieri.active ? this.salieri.time : 99;
    if (appearT < 1.6) {
      const fade = 1 - appearT / 1.6;
      ctx.save();
      ctx.textAlign = 'center';
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7 + appearT * 2.2;
        const r = spriteW * (0.35 + appearT * 0.35);
        ctx.globalAlpha = fade * retreat;
        ctx.fillStyle = i % 2 ? '#ffe45d' : '#d6a0ff';
        ctx.font = `900 ${Math.max(12, height * 0.04)}px Nunito,sans-serif`;
        ctx.fillText(i % 2 ? '♪' : '♫', x + spriteW / 2 + Math.cos(a) * r, y + spriteH * 0.5 + Math.sin(a) * r * 0.7);
      }
      ctx.restore();
    }
    for (let i = 0; i < 7; i++) {
      const swirl = now * 2 + i * 0.8;
      const sx = x + spriteW * (0.2 + (Math.sin(swirl) + 1) * 0.1) - i * 4 * scale;
      const sy = y + spriteH * (0.78 + Math.cos(swirl * 0.8) * 0.1) + i * 2 * scale;
      ctx.save(); ctx.globalAlpha = retreat * (0.12 + i * 0.018);
      ctx.fillStyle = '#a648ff'; ctx.beginPath(); ctx.arc(sx, sy, (6 + i * 1.1) * scale, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (!this.finished && this.salieri.active && !this.salieri.friendly && this.salieri.time < 2.6) {
      const bubbleW = width * 0.36;
      const bubbleH = height * 0.07;
      const bx = Math.max(width * 0.2, x - bubbleW - 6 * scale);
      const by = height * 0.17;
      ctx.save();
      ctx.fillStyle = 'rgba(35,16,58,0.96)'; ctx.strokeStyle = '#d6a0ff'; ctx.lineWidth = 1.7 * scale;
      ctx.beginPath(); ctx.roundRect(bx, by, bubbleW, bubbleH, 10 * scale); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(10, height * 0.024)}px Nunito,sans-serif`; ctx.textAlign = 'center';
      const phrase = this.salieri.time < 1.35 ? this.salieri.message : `${this.trickMessage()} · ¡Preparáte!`;
      ctx.fillText(t(phrase), bx + bubbleW / 2, by + bubbleH * 0.63, bubbleW * 0.94);
      ctx.restore();
    }
  }

  trickMessage() {
    return ({
      'flying-sheets': '¡Partituras voladoras!',
      'musical-obstacles': '¡Más obstáculos musicales!',
      'grand-finale': '¡Final musical: cuatro obstáculos!',
      'friendly-help': '¡SALIERI TE AYUDA!',
      wind: '¡Soplido de humo violeta!',
      'tempo-surge': '¡Acelero el tempo!',
      'rhythm-line': '¡Una secuencia rítmica!',
    })[this.salieri.trick] || '¡No tan rápido!';
  }

  draw(ctx, width, height, scale, now) {
    this._width = width;
    this._height = height;
    this.drawBackground(ctx, width, height, now);
    this.drawTrack(ctx, width, height, scale);
    this.drawNotes(ctx, scale, now);
    this.obstacles.forEach((obstacle) => this.drawObstacle(ctx, obstacle, scale, now));
    this.drawPlayer(ctx, width, height, now);
    this.drawSalieriWarning(ctx, width, height, scale);
    this.drawSalieri(ctx, width, height, scale, now);
    this.particles.forEach((particle) => {
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(particle.kind === 'wind' ? 0.28 : 1, particle.life));
      if (particle.kind === 'wind') {
        ctx.strokeStyle = '#d7c2ff'; ctx.lineWidth = 1.8 * scale; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(particle.x, particle.y); ctx.quadraticCurveTo(particle.x + 20 * scale, particle.y - 6 * scale, particle.x + 42 * scale, particle.y); ctx.stroke();
      } else {
        ctx.fillStyle = particle.color || '#b35cff'; ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.r || 6 * scale, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    });
    if (this.tempoMessageTimer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.tempoMessageTimer * 1.4);
      ctx.fillStyle = 'rgba(20,20,53,0.76)';
      ctx.beginPath(); ctx.roundRect(width * 0.34, height * 0.24, width * 0.32, height * 0.065, 14 * scale); ctx.fill();
      ctx.fillStyle = '#ffe45d'; ctx.font = `bold ${Math.max(13, height * 0.036)}px Nunito,sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(t(this.tempoMessage), width / 2, height * 0.283);
      ctx.restore();
    }
  }
}
