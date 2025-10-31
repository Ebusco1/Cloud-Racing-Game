import React, { useEffect, useRef, useState } from 'react';

const WIDTH = 800; // virtual width
const HEIGHT = 500; // virtual height
const CLOUD_RADIUS = 20;
const PLAYER_SPEED = 260; // px/sec
const BASE_SCROLL_SPEED = 200; // px/sec (baseline)
const ASTEROID_SPAWN_EVERY_MS = 700; // more frequent
const ALIEN_SPAWN_EVERY_MS = 1100; // more frequent

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function length(x, y) {
  return Math.hypot(x, y);
}

function App() {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const keysRef = useRef(new Set());
  const lastTimeRef = useRef(0);
  const spawnTimersRef = useRef({ asteroidMs: 0, alienMs: 0 });
  const obstaclesRef = useRef([]);
  const scoreRef = useRef(0);
  const scaleRef = useRef(1);
  const pointerRef = useRef({ active: false, x: 0, y: 0 });
  const speechAllowedRef = useRef(false);
  const isMutedRef = useRef(false);
  const difficultyRef = useRef('easy'); // 'easy' | 'medium' | 'hard'
  const audioCtxRef = useRef(null);
  const musicStateRef = useRef({ playing: false, intervalId: null });
  const audioElRef = useRef(null);

  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [gameState, setGameState] = useState('menu'); // 'menu' | 'playing'
  const [isMuted, setIsMuted] = useState(false);
  const [difficulty, setDifficulty] = useState('easy');
  const [musicUrl, setMusicUrl] = useState((process.env.PUBLIC_URL ? process.env.PUBLIC_URL : '') + '/sounds/game-music-loop-6-144641.mp3');

  const playerRef = useRef({ x: 120, y: HEIGHT / 2 });

  useEffect(() => {
    const handleKeyDown = (e) => {
      keysRef.current.add(e.key.toLowerCase());
      speechAllowedRef.current = true;
      // restart
      if (gameOver && (e.code === 'Space' || e.code === 'Enter')) {
        restart();
        setGameState('playing');
      }
      if (gameState === 'menu' && (e.code === 'Space' || e.code === 'Enter')) {
        startGame();
      }
    };
    const handleKeyUp = (e) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameOver, gameState]);

  useEffect(() => {
    // responsive canvas sizing
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const maxCssWidth = Math.min(window.innerWidth - 24, 900);
      const cssWidth = Math.min(maxCssWidth, WIDTH);
      const cssHeight = cssWidth * (HEIGHT / WIDTH);
      canvas.style.width = cssWidth + 'px';
      canvas.style.height = cssHeight + 'px';
      canvas.width = Math.floor(cssWidth * dpr);
      canvas.height = Math.floor(cssHeight * dpr);
      scaleRef.current = canvas.width / WIDTH;
    };
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    const ctx = canvasRef.current.getContext('2d');
    lastTimeRef.current = performance.now();

    const loop = (t) => {
      const dt = Math.min(0.033, (t - lastTimeRef.current) / 1000);
      lastTimeRef.current = t;
      if (gameState === 'playing') {
        update(dt);
      }
      render(ctx);
      if (!(gameOver && gameState !== 'playing')) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver, gameState]);

  useEffect(() => {
    isMutedRef.current = isMuted;
    // react to mute toggle while playing
    if (gameState === 'playing') {
      // MP3 route
      const a = audioElRef.current;
      if (a) {
        a.muted = isMuted;
        if (!isMuted && a.paused) {
          a.play().catch(() => {});
        }
        if (isMuted && !a.paused) a.pause();
      }
      // fallback synth
      if (isMuted) stopMusic(); else startMusic();
    }
  }, [isMuted]);

  useEffect(() => {
    difficultyRef.current = difficulty;
  }, [difficulty]);

  // initialize MP3 audio element
  useEffect(() => {
    const fallbackSrc = (process.env.PUBLIC_URL ? process.env.PUBLIC_URL : '') + '/music.mp3';
    const a = new Audio(musicUrl || fallbackSrc);
    a.loop = true;
    a.volume = 0.35;
    a.preload = 'auto';
    a.crossOrigin = 'anonymous';
    audioElRef.current = a;
    return () => {
      try { a.pause(); } catch (_) {}
      audioElRef.current = null;
    };
  }, [musicUrl]);

  function restart() {
    obstaclesRef.current = [];
    spawnTimersRef.current = { asteroidMs: 0, alienMs: 0 };
    scoreRef.current = 0;
    setScore(0);
    playerRef.current = { x: 120, y: HEIGHT / 2 };
    setGameOver(false);
    lastTimeRef.current = performance.now();
    // keep music running if in playing and not muted
  }

  function startGame() {
    restart();
    setGameState('playing');
    // try MP3 first
    const a = audioElRef.current;
    if (a) {
      a.muted = isMutedRef.current;
      a.play().catch(() => {});
    } else if (!isMutedRef.current) {
      // fallback to synth if mp3 not available
      startMusic();
    }
  }

  function update(dt) {
    const player = playerRef.current;
    const keys = keysRef.current;

    const vertical = (keys.has('arrowdown') || keys.has('s') ? 1 : 0) - (keys.has('arrowup') || keys.has('w') ? 1 : 0);
    const horizontal = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);

    player.x += horizontal * PLAYER_SPEED * dt;
    player.y += vertical * PLAYER_SPEED * dt;

    // touch/pointer steering: move toward pointer while active
    if (pointerRef.current.active) {
      const dx = pointerRef.current.x - player.x;
      const dy = pointerRef.current.y - player.y;
      const dist = Math.hypot(dx, dy);
      const deadZone = 6;
      if (dist > deadZone) {
        const ux = dx / dist;
        const uy = dy / dist;
        player.x += ux * PLAYER_SPEED * dt;
        player.y += uy * PLAYER_SPEED * dt;
      }
    }
    player.x = Math.max(CLOUD_RADIUS, Math.min(WIDTH - CLOUD_RADIUS, player.x));
    player.y = Math.max(CLOUD_RADIUS, Math.min(HEIGHT - CLOUD_RADIUS, player.y));

    // difficulty increases with score and chosen difficulty
    const diffMult = difficultyRef.current === 'hard' ? 1.25 : difficultyRef.current === 'medium' ? 1.0 : 0.85;
    const speedBoost = Math.min(260, (scoreRef.current / 20) * 9);
    const scrollSpeed = (BASE_SCROLL_SPEED * diffMult) + speedBoost;

    // spawn timers
    spawnTimersRef.current.asteroidMs += dt * 1000;
    spawnTimersRef.current.alienMs += dt * 1000;
    const baseAst = difficultyRef.current === 'hard' ? 520 : difficultyRef.current === 'medium' ? 700 : 900;
    const baseAli = difficultyRef.current === 'hard' ? 800 : difficultyRef.current === 'medium' ? 1100 : 1400;
    const astInterval = Math.max(baseAst * 0.55, baseAst - scoreRef.current * 3.5);
    const aliInterval = Math.max(baseAli * 0.6, baseAli - scoreRef.current * 3.8);
    if (spawnTimersRef.current.asteroidMs >= astInterval) {
      spawnTimersRef.current.asteroidMs = 0;
      spawnObstacle('asteroid', scrollSpeed * (1.0 + (Math.random() - 0.5) * 0.2));
    }
    if (spawnTimersRef.current.alienMs >= aliInterval) {
      spawnTimersRef.current.alienMs = 0;
      spawnObstacle('alien', scrollSpeed * 1.12 * (1.0 + (Math.random() - 0.5) * 0.2));
    }

    // update obstacles
    const obstacles = obstaclesRef.current;
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.x -= o.speed * dt;
      if (o.type === 'alien') {
        o.y += Math.sin((o.life * 2 + o.wobblePhase) * 2.2) * 40 * dt;
        o.life += dt;
      }
      // scoring: when obstacle fully passes behind the player, count once
      if (!o.scored && o.x + o.radius < player.x - CLOUD_RADIUS * 0.2) {
        o.scored = true;
        scoreRef.current += o.type === 'alien' ? 8 : 5;
        setScore(Math.floor(scoreRef.current));
      }
      if (o.x < -o.radius * 2) {
        obstacles.splice(i, 1);
        continue;
      }
      // collision
      const dist = length(player.x - o.x, player.y - o.y);
      if (dist < CLOUD_RADIUS + o.radius * 0.9) {
        setGameOver(true);
        speak(`Game over. Score ${Math.floor(scoreRef.current)}`);
        setGameState('menu');
        // stop both music paths
        const a = audioElRef.current;
        if (a) {
          try { a.pause(); } catch (_) {}
        }
        stopMusic();
        return;
      }
    }

    // score is driven by pass events only

  }

  function spawnObstacle(type, speed) {
    const y = rand(40, HEIGHT - 40);
    if (type === 'asteroid') {
      obstaclesRef.current.push({
        type,
        x: WIDTH + 40,
        y,
        radius: rand(14, 28),
        speed: speed * rand(0.95, 1.25),
        scored: false,
      });
    } else {
      obstaclesRef.current.push({
        type,
        x: WIDTH + 60,
        y,
        radius: rand(18, 26),
        speed: speed * rand(0.95, 1.2),
        wobblePhase: rand(0, Math.PI * 2),
        life: 0,
        scored: false,
      });
    }
  }

  function render(ctx) {
    // apply DPR scaling to draw in virtual space
    ctx.setTransform(scaleRef.current, 0, 0, scaleRef.current, 0, 0);
    // sky
    const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    grad.addColorStop(0, '#6ec3ff');
    grad.addColorStop(1, '#d9f1ff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // parallax clouds background
    ctx.globalAlpha = 0.25;
    drawCloud(ctx, (Date.now() * 0.03) % (WIDTH + 200) - 200, 90, 26);
    drawCloud(ctx, (Date.now() * 0.02 + 300) % (WIDTH + 220) - 220, 160, 30);
    ctx.globalAlpha = 1;

    // subtle INCO watermark in the sky
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#003';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 120px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText('INCO', WIDTH / 2, HEIGHT / 2);
    ctx.restore();

    // obstacles
    for (const o of obstaclesRef.current) {
      if (o.type === 'asteroid') drawAsteroid(ctx, o.x, o.y, o.radius);
      else drawAlien(ctx, o.x, o.y, o.radius);
    }

    // player cloud
    drawPlayerCloud(ctx, playerRef.current.x, playerRef.current.y, CLOUD_RADIUS);

    // HUD
    ctx.fillStyle = '#003';
    ctx.font = 'bold 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText(`Score: ${Math.floor(scoreRef.current)}`, 16, 28);

    if (gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 36px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Game Over', WIDTH / 2, HEIGHT / 2 - 10);
      ctx.font = 'bold 20px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.fillText('Press Space or Enter to Restart', WIDTH / 2, HEIGHT / 2 + 28);
      ctx.textAlign = 'start';
    }
  }

  function drawCloud(ctx, x, y, r) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r * 0.9, y - r * 0.4, r * 0.9, 0, Math.PI * 2);
    ctx.arc(x + r * 1.8, y, r * 1.1, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }

  function drawPlayerCloud(ctx, x, y, r) {
    drawCloud(ctx, x - r, y, r);
    // face
    const eyeOffsetX = r * 0.4;
    const eyeOffsetY = -r * 0.2;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(x - eyeOffsetX, y + eyeOffsetY, r * 0.15, 0, Math.PI * 2);
    ctx.arc(x + eyeOffsetX * 0.3, y + eyeOffsetY, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
    // smile
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const smileR = r * 0.7;
    ctx.arc(x - r * 0.2, y + r * 0.2, smileR, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
  }

  function drawAsteroid(ctx, x, y, r) {
    ctx.fillStyle = '#7a7a7a';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9a9a9a';
    ctx.beginPath();
    ctx.arc(x - r * 0.4, y - r * 0.2, r * 0.35, 0, Math.PI * 2);
    ctx.arc(x + r * 0.3, y + r * 0.1, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawAlien(ctx, x, y, r) {
    ctx.fillStyle = '#3bd16f';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.2, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f6';
    ctx.beginPath();
    ctx.arc(x + r * 0.3, y - r * 0.2, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(x + r * 0.35, y - r * 0.2, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  // speech synthesis helper
  function speak(text) {
    if (!speechAllowedRef.current || isMutedRef.current) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.pitch = 1.0;
    utter.volume = 0.8;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  // background music: lightweight chiptune-style loop using Web Audio
  function startMusic() {
    if (musicStateRef.current.playing) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = audioCtxRef.current || new AudioCtx();
      audioCtxRef.current = ctx;
      // ensure context is running (required by many browsers)
      if (ctx.state === 'suspended') {
        try { ctx.resume(); } catch (_) {}
      }
      const master = ctx.createGain();
      master.gain.value = 0.12; // overall volume (slightly louder)
      master.connect(ctx.destination);

      const bpm = 116;
      const beatMs = (60_000 / bpm);
      const scale = [0, 3, 5, 7, 10]; // minor pentatonic degrees
      const baseFreq = 196; // G3

      const playNote = (freq, durationMs) => {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.22, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + durationMs / 1000 + 0.02);
      };

      // simple two-voice pattern
      let step = 0;
      const intervalId = setInterval(() => {
        if (isMutedRef.current || gameState !== 'playing') return; // guard
        const degree = scale[step % scale.length];
        const leadFreq = baseFreq * Math.pow(2, degree / 12);
        const bassFreq = baseFreq / 2 * (step % 2 === 0 ? 1 : 4 / 3); // G3/D3 pattern
        playNote(leadFreq, beatMs * 0.9);
        if (step % 2 === 0) setTimeout(() => playNote(bassFreq, beatMs * 0.8), 0);
        step = (step + 1) % 64;
      }, beatMs);

      musicStateRef.current = { playing: true, intervalId };
    } catch (_) {
      // ignore audio errors
    }
  }

  function stopMusic() {
    if (musicStateRef.current.intervalId) {
      clearInterval(musicStateRef.current.intervalId);
    }
    musicStateRef.current = { playing: false, intervalId: null };
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== 'closed') {
      try { ctx.suspend(); } catch (_) { /* noop */ }
    }
  }

  // pointer/touch controls
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const toVirtual = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
      const y = ((e.clientY - rect.top) / rect.height) * HEIGHT;
      return { x, y };
    };
    const onDown = (e) => {
      e.preventDefault();
      const p = toVirtual(e);
      pointerRef.current = { active: true, x: p.x, y: p.y };
      speechAllowedRef.current = true;
    };
    const onMove = (e) => {
      if (!pointerRef.current.active) return;
      const p = toVirtual(e);
      pointerRef.current.x = p.x;
      pointerRef.current.y = p.y;
    };
    const onUp = () => {
      pointerRef.current.active = false;
    };
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#e6f6ff', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ border: '2px solid #99d', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', background: '#bfe8ff', touchAction: 'none' }}
      />

      {gameState === 'menu' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto', background: 'rgba(255,255,255,0.9)', border: '2px solid #99d', borderRadius: 12, padding: 16, minWidth: 280, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 12, color: '#234' }}>Cloud Racing</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={startGame} style={{ flex: 1, padding: '10px 12px', background: '#4da3ff', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Start</button>
              <button onClick={() => setIsMuted((m) => !m)} style={{ padding: '10px 12px', background: '#eee', color: '#234', border: '1px solid #aac', borderRadius: 8, fontWeight: 600, cursor: 'pointer', minWidth: 100 }}>{isMuted ? 'Unmute' : 'Mute'}</button>
            </div>
            <div style={{ marginBottom: 8, color: '#345', fontWeight: 700 }}>Difficulty</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['easy','medium','hard'].map((d) => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: difficulty === d ? '2px solid #4da3ff' : '1px solid #aac', background: difficulty === d ? '#e7f2ff' : '#fff', cursor: 'pointer', fontWeight: 700, color: '#234' }}
                >
                  {d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
            {/* Music URL field hidden as requested */}
            <div style={{ marginTop: 12, color: '#567', fontSize: 12 }}>Space/Enter to start • WASD/Arrows or touch to steer</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
