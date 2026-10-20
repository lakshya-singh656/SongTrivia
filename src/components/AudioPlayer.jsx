import React, { useState, useEffect, useRef } from 'react';
import { Play, Volume2, Music, AlertCircle, ShieldAlert, CheckCircle2, Lock } from 'lucide-react';
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
  targetDuration = 5
}) {
  const [actualDuration, setActualDuration] = useState(targetDuration || 5);
  const [audioRemaining, setAudioRemaining] = useState(targetDuration || 5);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [isProbeLoading, setIsProbeLoading] = useState(false);
  const audioControllerRef = useRef(null);

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
          const probed = await horrorSoundEngine.getAudioDuration(audioPath, targetDuration || 5.0);
          if (isMounted) {
            setActualDuration(probed);
            setAudioRemaining(Math.ceil(probed));
          }
        } catch (e) {
          if (isMounted) setActualDuration(targetDuration || 5.0);
        }
      } else {
        const synthDur = 5.0; // Procedural synth clips run for 5 seconds
        setActualDuration(synthDur);
        setAudioRemaining(5);
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
      {/* Anti-cheat watermarking accent */}
      <div className="absolute top-0 right-0 px-3 py-1 bg-red-950/40 border-b border-l border-red-900/40 rounded-bl-xl text-[10px] font-mono text-zinc-500 uppercase flex items-center gap-1 pointer-events-none">
        <ShieldAlert className="w-3 h-3 text-red-500" />
        <span>Strict Single Playback</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-red-950/60 border border-red-800/40 flex items-center justify-center text-red-500">
            <Music className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <h4 className="text-sm font-semibold tracking-wider uppercase text-zinc-200">
              Audio Snippet {roundNumber ? `#${roundNumber}` : ''}
            </h4>
            <p className="text-xs text-zinc-500">
              Duration: {actualDuration ? `${actualDuration}s` : 'Probing...'} &bull; Single-Play Only
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div>
          {isPlaying ? (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-950 text-red-400 border border-red-700 shadow-[0_0_15px_rgba(220,38,38,0.5)] animate-pulse">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              AUDIO PLAYING
            </span>
          ) : hasPlayed ? (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-900 text-zinc-500 border border-zinc-800">
              <Lock className="w-3 h-3 text-zinc-500" />
              PLAYBACK EXPENDED
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-zinc-900 text-zinc-300 border border-zinc-800">
              READY TO LISTEN
            </span>
          )}
        </div>
      </div>

      {/* Soundwave Visualizer (No seeking or scrubbing allowed) */}
      <div className="h-16 w-full bg-[#08080d] rounded-xl flex items-center justify-center gap-1.5 px-4 mb-4 border border-zinc-900 pointer-events-none overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-r from-red-950/15 via-transparent to-red-950/15 pointer-events-none" />

        {visualizerBars.map((height, i) => {
          const animatedHeight = isPlaying 
            ? Math.max(15, Math.min(100, height * (0.4 + Math.sin((i + Date.now()/200)) * 0.6)))
            : 18;
          return (
            <div
              key={i}
              className={`w-1.5 rounded-full transition-all duration-150 ${
                isPlaying 
                  ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.85)]' 
                  : hasPlayed
                  ? 'bg-zinc-900'
                  : 'bg-zinc-800'
              }`}
              style={{ height: `${animatedHeight}%` }}
            />
          );
        })}
      </div>

      {/* Progress Bar & Audio Remaining Countdown */}
      <div className="mb-4">
        <div className="w-full bg-zinc-950 h-2 rounded-full overflow-hidden border border-zinc-900 relative">
          <div 
            className="h-full bg-gradient-to-r from-red-800 to-red-500 transition-all duration-100 shadow-[0_0_12px_rgba(220,38,38,0.8)]"
            style={{ width: `${Math.min(100, Math.max(0, playbackProgress))}%` }}
          />
        </div>

        <div className="flex justify-between items-center text-xs mt-2 font-mono">
          <span className={`font-semibold ${isPlaying ? 'text-red-400 animate-pulse' : 'text-zinc-500'}`}>
            {isPlaying 
              ? `Audio remaining: ${audioRemaining}s` 
              : hasPlayed 
              ? 'Audio finished (0s remaining)' 
              : `Total Clip: ${actualDuration}s`}
          </span>

          <span className="text-zinc-600">
            {hasPlayed ? 'No replays permitted' : '1 attempt allowed'}
          </span>
        </div>
      </div>

      {/* Controls Row: Only Single Start Button (No Pause, No Replay, No Scrubbing) */}
      <div className="flex items-center justify-between pt-1 border-t border-zinc-900">
        <div className="text-xs text-zinc-500 flex items-center gap-1.5">
          {hasPlayed ? (
            <span className="text-zinc-500 italic">Clip played. Answer timer activated.</span>
          ) : (
            <span className="text-amber-500/90 font-medium">
              ⚠️ Warning: 10-second timer begins immediately after audio ends!
            </span>
          )}
        </div>

        <div>
          {hasPlayed ? (
            <button
              type="button"
              disabled
              className="px-6 py-2.5 rounded-xl bg-zinc-900/80 text-zinc-500 border border-zinc-800 text-xs font-mono font-bold tracking-wider cursor-not-allowed flex items-center gap-2"
            >
              <Lock className="w-3.5 h-3.5 text-zinc-500" />
              <span>CLIP EXPENDED</span>
            </button>
          ) : isPlaying ? (
            <button
              type="button"
              disabled
              className="px-6 py-2.5 rounded-xl bg-red-950 text-red-400 border border-red-700/80 text-xs font-mono font-bold tracking-wider cursor-not-allowed flex items-center gap-2 shadow-[0_0_15px_rgba(220,38,38,0.5)] animate-pulse"
            >
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              <span>PLAYING ({audioRemaining}s)...</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartPlay}
              disabled={disabled || isProbeLoading}
              className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs tracking-wider transition-all shadow-[0_0_20px_rgba(220,38,38,0.6)] hover:shadow-[0_0_30px_rgba(239,68,68,0.8)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border border-red-500 flex items-center gap-2"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
              <span>START AUDIO CLIP</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
