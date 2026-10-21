import React, { useState, useEffect, useRef } from 'react';
import { Volume2, Music, Lock, Radio } from 'lucide-react';
import { horrorSoundEngine } from '../services/soundGenerator';

export default function AudioPlayer({ 
  audioPath, 
  synthMotif, 
  roundNumber = 1,
  hasPlayed = false,
  isPlaying = false,
  onStartPlayback,
  onAudioCompleted,
  disabled = false,
  targetDuration = 3
}) {
  const [actualDuration, setActualDuration] = useState(targetDuration || 3);
  const [audioRemaining, setAudioRemaining] = useState(targetDuration || 3);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [isPreparing, setIsPreparing] = useState(false);
  const audioControllerRef = useRef(null);
  const autoPlayTimerRef = useRef(null);

  // Probe audio duration from file metadata on mount or audioPath change
  useEffect(() => {
    let isMounted = true;
    async function probeDuration() {
      if (audioPath && (audioPath.startsWith('http') || audioPath.startsWith('blob:'))) {
        // Preload audio into memory/HTTP cache immediately
        horrorSoundEngine.preloadAudio(audioPath);

        // If targetDuration is explicitly known from songs table, use it right away
        if (targetDuration && targetDuration > 0) {
          setActualDuration(targetDuration);
          setAudioRemaining(Math.ceil(targetDuration));
          return;
        }

        try {
          const probed = await horrorSoundEngine.getAudioDuration(audioPath, targetDuration || 3.0);
          if (isMounted) {
            setActualDuration(probed);
            setAudioRemaining(Math.ceil(probed));
          }
        } catch (e) {
          if (isMounted) setActualDuration(targetDuration || 3.0);
        }
      } else {
        const synthDur = 3.0; // Procedural synth clips run for 3 seconds
        setActualDuration(synthDur);
        setAudioRemaining(3);
      }
    }
    probeDuration();

    return () => {
      isMounted = false;
      stopAudio();
    };
  }, [audioPath, roundNumber, targetDuration]);

  // Stop playback when unmounting or switching
  const stopAudio = () => {
    if (audioControllerRef.current?.stop) {
      audioControllerRef.current.stop();
    }
    horrorSoundEngine.stopAudio();
  };

  const handleStartPlay = async () => {
    // If already played, disabled, or currently playing: strictly reject
    if (hasPlayed || isPlaying || disabled) return;

    try {
      // 1. Authorize on backend first to lock in timestamp and single-playback attempt
      if (onStartPlayback) {
        const authResult = await onStartPlayback(actualDuration);
        if (!authResult?.success) {
          return;
        }
      }

      setAudioRemaining(Math.ceil(actualDuration));
      setPlaybackProgress(0);

      const onProgress = (stats) => {
        setPlaybackProgress(stats.progress || 0);
        if (typeof stats.remainingTime === 'number') {
          setAudioRemaining(stats.remainingTime);
        }
      };

      const onEnded = () => {
        setPlaybackProgress(100);
        setAudioRemaining(0);
        stopAudio();
        if (onAudioCompleted) {
          onAudioCompleted();
        }
      };

      if (audioPath && (audioPath.startsWith('http') || audioPath.startsWith('blob:'))) {
        audioControllerRef.current = horrorSoundEngine.playAudioUrl(
          audioPath,
          actualDuration,
          onProgress,
          onEnded
        );
      } else {
        horrorSoundEngine.playProceduralMotif(
          synthMotif || 'halloween',
          actualDuration,
          onProgress,
          onEnded
        );
      }
    } catch (err) {
      console.error('Audio start rejected:', err);
      stopAudio();
    }
  };

  // Auto-play after 2 seconds without any manual button required
  useEffect(() => {
    // If already played, playing, or disabled: do not schedule auto-play
    if (hasPlayed || isPlaying || disabled) {
      setIsPreparing(false);
      clearTimeout(autoPlayTimerRef.current);
      return;
    }

    setIsPreparing(true);
    clearTimeout(autoPlayTimerRef.current);

    autoPlayTimerRef.current = setTimeout(() => {
      setIsPreparing(false);
      handleStartPlay();
    }, 2000);

    return () => {
      clearTimeout(autoPlayTimerRef.current);
    };
  }, [roundNumber, hasPlayed, isPlaying, disabled, audioPath, actualDuration]);

  // Prevent right-click context menu and inspect on player
  const handleContextMenu = (e) => {
    e.preventDefault();
    return false;
  };

  // Generate visualizer bars
  const visualizerBars = [24, 60, 95, 45, 80, 100, 75, 40, 85, 90, 50, 70, 30, 90, 60, 45, 80, 35];

  return (
    <div 
      onContextMenu={handleContextMenu}
      className="w-full select-none bg-[#101018]/95 border border-red-950/80 rounded-2xl p-5 shadow-2xl backdrop-blur-md relative overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors ${
            isPlaying 
              ? 'bg-red-950/80 border-red-700 text-red-500 shadow-[0_0_15px_rgba(220,38,38,0.5)]' 
              : isPreparing
              ? 'bg-amber-950/60 border-amber-700/60 text-amber-400'
              : 'bg-zinc-900 border-zinc-800 text-zinc-500'
          }`}>
            <Music className={`w-4 h-4 ${isPlaying ? 'animate-bounce' : isPreparing ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <h4 className="text-sm font-bold tracking-wider uppercase text-zinc-100 font-cinzel">
              Round {roundNumber ? `#${roundNumber}` : ''}
            </h4>
            <p className="text-xs text-zinc-400">
              {actualDuration ? `${actualDuration}s Song Clip` : '3s Song Clip'}
            </p>
          </div>
        </div>

        {/* Status Badge (No timer shown during 2s pause) */}
        <div>
          {isPlaying ? (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-950 text-red-400 border border-red-700 shadow-[0_0_15px_rgba(220,38,38,0.5)] animate-pulse">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              PLAYING AUDIO
            </span>
          ) : hasPlayed ? (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-900 text-zinc-500 border border-zinc-800">
              <Lock className="w-3 h-3 text-zinc-500" />
              AUDIO FINISHED
            </span>
          ) : isPreparing ? (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-950/70 text-amber-400 border border-amber-700/60 shadow-[0_0_15px_rgba(245,158,11,0.25)] animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              GET READY
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-900 text-zinc-500 border border-zinc-800">
              STANDBY
            </span>
          )}
        </div>
      </div>

      {/* Soundwave Visualizer */}
      <div className="h-16 w-full bg-[#08080d] rounded-xl flex items-center justify-center gap-1.5 px-4 mb-4 border border-zinc-900 pointer-events-none overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-r from-red-950/15 via-transparent to-red-950/15 pointer-events-none" />

        {visualizerBars.map((height, i) => {
          const animatedHeight = isPlaying 
            ? Math.max(15, Math.min(100, height * (0.4 + Math.sin((i + Date.now()/200)) * 0.6)))
            : isPreparing
            ? Math.max(12, Math.min(40, height * 0.3))
            : 15;
          return (
            <div
              key={i}
              className={`w-1.5 rounded-full transition-all duration-150 ${
                isPlaying 
                  ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.85)]' 
                  : isPreparing
                  ? 'bg-amber-600/70'
                  : hasPlayed
                  ? 'bg-zinc-900'
                  : 'bg-zinc-800'
              }`}
              style={{ height: `${animatedHeight}%` }}
            />
          );
        })}
      </div>

      {/* Progress Bar & Audio Progress */}
      <div className="mb-4">
        <div className="w-full bg-zinc-950 h-2 rounded-full overflow-hidden border border-zinc-900 relative">
          <div 
            className={`h-full transition-all duration-100 ${
              isPlaying 
                ? 'bg-gradient-to-r from-red-800 to-red-500 shadow-[0_0_12px_rgba(220,38,38,0.8)]' 
                : isPreparing
                ? 'bg-amber-600/40 animate-pulse'
                : 'bg-zinc-900'
            }`}
            style={{ width: isPlaying ? `${Math.min(100, Math.max(0, playbackProgress))}%` : isPreparing ? '100%' : '0%' }}
          />
        </div>

        <div className="flex justify-between items-center text-xs mt-2 font-mono">
          <span className={`font-semibold ${
            isPlaying ? 'text-red-400 animate-pulse' : isPreparing ? 'text-amber-400/90' : 'text-zinc-500'
          }`}>
            {isPlaying 
              ? `${audioRemaining}s remaining` 
              : isPreparing
              ? 'Preparing clip...'
              : hasPlayed 
              ? 'Finished' 
              : `${actualDuration}s Clip`}
          </span>
        </div>
      </div>

      {/* Status Bar (No Play Audio button) */}
      <div className="flex items-center justify-between pt-2 border-t border-zinc-900/80">
        <div className="text-xs">
          {isPlaying ? (
            <span className="text-red-400 font-semibold animate-pulse flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5" />
              Listening to song clip...
            </span>
          ) : isPreparing ? (
            <span className="text-amber-300/90 flex items-center gap-1.5 animate-pulse">
              <Radio className="w-3.5 h-3.5 text-amber-400" />
              Audio starting in a moment... Listen carefully!
            </span>
          ) : hasPlayed ? (
            <span className="text-zinc-500">Audio finished. Select your answer below.</span>
          ) : (
            <span className="text-zinc-400">Standby for audio playback.</span>
          )}
        </div>

        <div>
          {isPlaying ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-950/60 border border-red-800/60 text-red-400 font-mono text-xs font-semibold shadow-[0_0_10px_rgba(220,38,38,0.3)]">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              <span>CLIP PLAYING</span>
            </div>
          ) : isPreparing ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-950/50 border border-amber-800/50 text-amber-400 font-mono text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>STARTING...</span>
            </div>
          ) : (
            <div className="px-3 py-1.5 rounded-xl bg-zinc-900/80 text-zinc-500 border border-zinc-800 text-xs font-mono">
              <Lock className="w-3 h-3 inline mr-1" />
              <span>LOCKED</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
