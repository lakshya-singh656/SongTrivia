// Web Audio Horror Synthesizer & Audio Clip Player

class HorrorSoundEngine {
  constructor() {
    this.audioCtx = null;
    this.ambientNodes = null;
    this.isAmbientPlaying = false;
    this.currentAudioElement = null;
    this.activeSynthTimeouts = [];
    this.durationCache = new Map();
    this.preloadCache = new Map();
  }

  getAudioContext() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  // Preload an audio clip into browser HTTP and memory cache for smooth playback
  preloadAudio(url) {
    if (!url || (!url.startsWith('http') && !url.startsWith('blob:'))) return;
    if (this.preloadCache.has(url)) return;

    try {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = url;
      // Keep reference to trigger browser buffering
      this.preloadCache.set(url, audio);
      // Clean up after 5 minutes if not used
      setTimeout(() => {
        if (this.preloadCache.has(url)) {
          this.preloadCache.delete(url);
        }
      }, 300000);
    } catch (e) {
      console.warn('Audio preload silent error:', e);
    }
  }

  // Probe audio duration from metadata or return cached/configured duration
  async getAudioDuration(url, fallbackDuration = 3.0) {
    if (!url || (!url.startsWith('http') && !url.startsWith('blob:'))) {
      return fallbackDuration;
    }
    if (this.durationCache.has(url)) {
      return this.durationCache.get(url);
    }
    // If fallback is already a specific valid duration (e.g. from songs table), use it to avoid blocking
    if (fallbackDuration && fallbackDuration > 0 && fallbackDuration !== 3.0) {
      this.durationCache.set(url, fallbackDuration);
      return fallbackDuration;
    }

    return new Promise((resolve) => {
      const audio = new Audio();
      const timer = setTimeout(() => {
        this.durationCache.set(url, fallbackDuration);
        resolve(fallbackDuration);
      }, 2500);

      audio.addEventListener('loadedmetadata', () => {
        clearTimeout(timer);
        if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
          const dur = Math.min(10, Math.max(3, Math.round(audio.duration * 10) / 10));
          this.durationCache.set(url, dur);
          resolve(dur);
        } else {
          this.durationCache.set(url, fallbackDuration);
          resolve(fallbackDuration);
        }
      });

      audio.addEventListener('error', () => {
        clearTimeout(timer);
        this.durationCache.set(url, fallbackDuration);
        resolve(fallbackDuration);
      });

      audio.src = url;
    });
  }

  // Play a custom uploaded audio URL (MP3, WAV, M4A, etc.) with strict single-play enforcement
  playAudioUrl(url, targetSeconds = 3, onProgress = null, onEnded = null) {
    this.stopAudio();
    const audio = new Audio();
    audio.src = url;
    audio.controls = false;
    this.currentAudioElement = audio;

    let timer = null;
    let progressInterval = null;
    let isTerminated = false;

    const terminate = () => {
      if (isTerminated) return;
      isTerminated = true;
      clearInterval(progressInterval);
      clearTimeout(timer);
      this.stopAudio();
      if (onEnded) onEnded();
    };

    audio.addEventListener('loadedmetadata', () => {
      // Use actual audio duration if smaller than targetSeconds
      const actualDuration = (audio.duration && isFinite(audio.duration))
        ? Math.min(audio.duration, targetSeconds)
        : targetSeconds;

      timer = setTimeout(() => {
        terminate();
      }, actualDuration * 1000);
    });

    audio.addEventListener('play', () => {
      progressInterval = setInterval(() => {
        if (isTerminated) return;
        const dur = (audio.duration && isFinite(audio.duration)) 
          ? Math.min(audio.duration, targetSeconds) 
          : targetSeconds;
        const cur = Math.min(audio.currentTime, dur);
        const rem = Math.max(0, dur - cur);

        if (onProgress) {
          onProgress({
            currentTime: cur,
            duration: dur,
            remainingTime: Math.ceil(rem),
            progress: (cur / dur) * 100
          });
        }

        if (cur >= dur) {
          terminate();
        }
      }, 100);
    });

    audio.addEventListener('ended', terminate);
    audio.addEventListener('error', (e) => {
      console.warn('Audio playback error:', e);
      terminate();
    });

    audio.play().catch(err => {
      console.warn('Audio play rejection:', err);
      terminate();
    });

    return {
      stop: () => {
        terminate();
      }
    };
  }


  // Stop currently playing audio or synth sequence
  stopAudio() {
    if (this.currentAudioElement) {
      try {
        this.currentAudioElement.pause();
        this.currentAudioElement.currentTime = 0;
      } catch (e) {}
      this.currentAudioElement = null;
    }
    this.activeSynthTimeouts.forEach(t => clearTimeout(t));
    this.activeSynthTimeouts = [];
  }

  // Synthesize procedural horror motifs if no MP3 file uploaded yet
  playProceduralMotif(motifKey = 'halloween', durationSec = 3, onProgress = null, onEnded = null) {
    this.stopAudio();
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const startTime = ctx.currentTime;
    let isPlaying = true;

    // Progress updates
    const interval = setInterval(() => {
      if (!isPlaying) {
        clearInterval(interval);
        return;
      }
      const elapsed = ctx.currentTime - startTime;
      if (onProgress) {
        onProgress({
          currentTime: elapsed,
          duration: durationSec,
          remainingTime: Math.ceil(Math.max(0, durationSec - elapsed)),
          progress: Math.min(100, (elapsed / durationSec) * 100)
        });
      }
    }, 100);



    const endTimer = setTimeout(() => {
      isPlaying = false;
      clearInterval(interval);
      if (onEnded) onEnded();
    }, durationSec * 1000);
    this.activeSynthTimeouts.push(endTimer);

    // Play specific motif pattern
    switch (motifKey) {
      case 'halloween':
        this._playHalloweenPiano(ctx, durationSec);
        break;
      case 'psycho':
        this._playPsychoStrings(ctx, durationSec);
        break;
      case 'jaws':
        this._playJawsTension(ctx, durationSec);
        break;
      case 'stranger':
        this._playStrangerThingsSynth(ctx, durationSec);
        break;
      case 'tubular':
        this._playTubularBells(ctx, durationSec);
        break;
      case 'saw':
        this._playSawIndustrial(ctx, durationSec);
        break;
      case 'xfiles':
        this._playXFilesWhistle(ctx, durationSec);
        break;
      case 'thriller':
        this._playThrillerStabs(ctx, durationSec);
        break;
      default:
        this._playGenericHorrorChimes(ctx, durationSec);
        break;
    }
  }

  // 1. Halloween Theme (5/4 piano motif: F#6 C#6 F#6 C#6 F#6 C#6 F#6 D6)
  _playHalloweenPiano(ctx, durationSec) {
    const notes = [932.33, 554.37, 932.33, 554.37, 932.33, 554.37, 932.33, 587.33, 932.33, 554.37];
    const noteLen = 0.14;
    const repetitions = Math.floor(durationSec / (notes.length * noteLen));

    for (let r = 0; r < repetitions; r++) {
      notes.forEach((freq, idx) => {
        const time = ctx.currentTime + (r * notes.length + idx) * noteLen;
        this._playPianoNote(ctx, freq, time, noteLen * 0.95);
      });
    }
  }

  // 2. Psycho screeching strings (Herrmann's high Eb / diminished stabs)
  _playPsychoStrings(ctx, durationSec) {
    const stabs = Math.floor(durationSec / 0.55);
    for (let i = 0; i < stabs; i++) {
      const time = ctx.currentTime + i * 0.55;
      this._playViolinScreech(ctx, 2489, time); // High D#7
      this._playViolinScreech(ctx, 2637, time + 0.01); // High E7 (dissonance)
    }
  }

  // 3. Jaws tension (E1 - F1 alternating and accelerating)
  _playJawsTension(ctx, durationSec) {
    const baseE = 82.41;
    const baseF = 87.31;
    let time = ctx.currentTime;
    let delay = 0.65;

    while (time < ctx.currentTime + durationSec) {
      this._playDeepBass(ctx, baseE, time, 0.25);
      time += delay;
      this._playDeepBass(ctx, baseF, time, 0.25);
      time += delay;
      delay = Math.max(0.2, delay * 0.88); // accelerates!
    }
  }

  // 4. Stranger Things 80s analog arpeggiator
  _playStrangerThingsSynth(ctx, durationSec) {
    const notes = [130.81, 164.81, 196.00, 246.94, 261.63, 246.94, 196.00, 164.81]; // C3, E3, G3, B3, C4...
    const noteLen = 0.12;
    const count = Math.floor(durationSec / noteLen);

    for (let i = 0; i < count; i++) {
      const freq = notes[i % notes.length];
      const time = ctx.currentTime + i * noteLen;
      this._playAnalogSynthNote(ctx, freq, time, noteLen * 0.9);
    }
  }

  // 5. Tubular Bells (The Exorcist)
  _playTubularBells(ctx, durationSec) {
    const notes = [440, 523.25, 440, 493.88, 523.25, 440, 659.25, 587.33, 440, 523.25, 493.88, 392];
    const noteLen = 0.22;
    const count = Math.floor(durationSec / noteLen);

    for (let i = 0; i < count; i++) {
      const freq = notes[i % notes.length];
      const time = ctx.currentTime + i * noteLen;
      this._playBellChime(ctx, freq, time, 0.8);
    }
  }

  // 6. Saw Industrial String Ostinato
  _playSawIndustrial(ctx, durationSec) {
    const notes = [220, 220, 261.63, 246.94, 220, 220, 261.63, 293.66];
    const noteLen = 0.16;
    const count = Math.floor(durationSec / noteLen);

    for (let i = 0; i < count; i++) {
      const freq = notes[i % notes.length];
      const time = ctx.currentTime + i * noteLen;
      this._playViolinScreech(ctx, freq, time, 0.18, 0.2);
    }
  }

  // 7. X-Files Whistle
  _playXFilesWhistle(ctx, durationSec) {
    const melody = [587.33, 659.25, 698.46, 659.25, 587.33, 440];
    const noteLen = 0.6;
    melody.forEach((freq, idx) => {
      const time = ctx.currentTime + idx * noteLen;
      this._playThereminWhistle(ctx, freq, time, noteLen * 0.9);
    });
  }

  // 8. Thriller Brass / Dark Stabs
  _playThrillerStabs(ctx, durationSec) {
    const notes = [146.83, 174.61, 196.00, 220.00];
    const times = [0, 0.6, 1.2, 1.8, 2.5, 3.2, 4.0, 4.8, 5.5];
    times.forEach(t => {
      if (t < durationSec) {
        this._playDeepBass(ctx, 110, ctx.currentTime + t, 0.4);
        this._playAnalogSynthNote(ctx, notes[Math.floor(Math.random() * notes.length)], ctx.currentTime + t + 0.1, 0.3);
      }
    });
  }

  // 9. Generic Gothic Horror Chimes
  _playGenericHorrorChimes(ctx, durationSec) {
    const notes = [329.63, 349.23, 392.00, 440.00, 493.88, 523.25];
    const count = Math.floor(durationSec / 0.4);
    for (let i = 0; i < count; i++) {
      const freq = notes[(i * 3) % notes.length];
      const time = ctx.currentTime + i * 0.4;
      this._playBellChime(ctx, freq, time, 0.7);
    }
  }

  // Synthesis Primitives
  _playPianoNote(ctx, freq, time, dur) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.25, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  _playViolinScreech(ctx, freq, time, dur = 0.3, volume = 0.3) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    // Slight pitch bend down
    osc.frequency.exponentialRampToValueAtTime(freq * 0.96, time + dur);

    gain.gain.setValueAtTime(0.01, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  _playDeepBass(ctx, freq, time, dur = 0.3) {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(250, time);

    gain.gain.setValueAtTime(0.01, time);
    gain.gain.exponentialRampToValueAtTime(0.4, time + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  _playAnalogSynthNote(ctx, freq, time, dur) {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, time);
    filter.frequency.exponentialRampToValueAtTime(300, time + dur);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.18, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  _playBellChime(ctx, freq, time, dur) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.2, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  _playThereminWhistle(ctx, freq, time, dur) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    // Add vibrato
    const vibrato = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    vibrato.frequency.setValueAtTime(5.5, time); // 5.5 Hz vibrato
    vibratoGain.gain.setValueAtTime(10, time);
    vibrato.connect(osc.frequency);
    vibrato.start(time);
    vibrato.stop(time + dur);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.15, time + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  // Sound Effects for Game Events
  playCorrectFX() {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Sinister Victory Chime / Cathedral Bell
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      this._playBellChime(ctx, freq, now + i * 0.07, 1.2);
    });
  }

  playWrongFX() {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Dissonant screech & heavy thud
    this._playViolinScreech(ctx, 440, now, 0.4, 0.25);
    this._playViolinScreech(ctx, 466.16, now, 0.4, 0.25); // Minor second dissonance
    this._playDeepBass(ctx, 55, now, 0.5);
  }

  playHeartbeatFX() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Double heartbeat thud
      this._playDeepBass(ctx, 60, now, 0.15);
      this._playDeepBass(ctx, 48, now + 0.18, 0.22);
    } catch (e) {
      console.warn('Heartbeat FX error:', e);
    }
  }

  // Haunted House Ambient Drone (Background atmosphere)
  toggleAmbientDrone() {
    const ctx = this.getAudioContext();
    if (!ctx) return false;

    if (this.isAmbientPlaying) {
      this.stopAmbientDrone();
      return false;
    } else {
      this.startAmbientDrone();
      return true;
    }
  }

  startAmbientDrone() {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    this.stopAmbientDrone();

    // Low sub rumble
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(45, ctx.currentTime);

    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(48.5, ctx.currentTime); // Beat frequency

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(90, ctx.currentTime);

    gain.gain.setValueAtTime(0.01, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 3);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();

    this.ambientNodes = { osc1, osc2, gain };
    this.isAmbientPlaying = true;
  }

  stopAmbientDrone() {
    if (this.ambientNodes) {
      try {
        const ctx = this.getAudioContext();
        if (ctx) {
          this.ambientNodes.gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 1);
          setTimeout(() => {
            this.ambientNodes?.osc1?.stop();
            this.ambientNodes?.osc2?.stop();
            this.ambientNodes = null;
          }, 1100);
        }
      } catch (e) {}
    }
    this.isAmbientPlaying = false;
  }
}

export const horrorSoundEngine = new HorrorSoundEngine();
