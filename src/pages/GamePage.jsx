import React, { useState, useEffect, useRef } from 'react';
import { 
  Skull, Trophy, CheckCircle2, XCircle, ArrowRight, Lock, 
  Sparkles, AlertCircle, Clock, Volume2, Timer,
  Users, User, RefreshCw
} from 'lucide-react';
import confetti from 'canvas-confetti';
import AudioPlayer from '../components/AudioPlayer';
import { horrorApi } from '../services/supabase';
import { horrorSoundEngine } from '../services/soundGenerator';

export default function GamePage({ 
  participant, 
  onNeedRegister, 
  onGoToLeaderboard,
  gameSettings: propGameSettings
}) {
  const [songs, setSongs] = useState([]);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0); // 0 to totalRounds - 1
  const [submissions, setSubmissions] = useState({}); // { [songId]: submissionObj }
  
  // Anti-cheating Round States: 'ready' | 'audio_playing' | 'answering' | 'submitted' | 'time_expired'
  const [roundState, setRoundState] = useState('ready');
  const [answerDeadline, setAnswerDeadline] = useState(null);
  const [answerTimeRemaining, setAnswerTimeRemaining] = useState(10);
  const [selectedOption, setSelectedOption] = useState(null); // 'A' | 'B' | 'C' | 'D'
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionFeedback, setSubmissionFeedback] = useState(null);
  const [gameSettings, setGameSettings] = useState(propGameSettings || { 
    game_status: 'waiting', 
    answers_revealed: false,
    total_rounds: 30
  });
  const [waitingParticipants, setWaitingParticipants] = useState([]);
  const [isRefreshingWaiting, setIsRefreshingWaiting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkingRoundState, setCheckingRoundState] = useState(false);
  const [isAutoAdvancing, setIsAutoAdvancing] = useState(false);
  
  const [stats, setStats] = useState({
    score: participant?.total_score || 0,
    correctCount: participant?.correct_count || 0,
    completedRounds: participant?.completed_rounds || 0
  });

  const timerIntervalRef = useRef(null);
  const autoAdvanceTimeoutRef = useRef(null);

  // Synchronize with external propGameSettings if passed
  useEffect(() => {
    if (propGameSettings) {
      setGameSettings(propGameSettings);
    }
  }, [propGameSettings]);

  // Live Waiting Room synchronization
  const fetchWaitingList = async (showSpinner = false) => {
    try {
      if (showSpinner) setIsRefreshingWaiting(true);
      const list = await horrorApi.getAllParticipants(true);
      if (Array.isArray(list)) {
        setWaitingParticipants(list);
      }
    } catch (e) {
      console.warn('Failed to load waiting participants:', e);
    } finally {
      if (showSpinner) setIsRefreshingWaiting(false);
    }
  };

  useEffect(() => {
    if (gameSettings.game_status !== 'waiting') return;

    fetchWaitingList();

    // Subscribe to live participant changes
    const unsubParticipants = horrorApi.subscribeToParticipants(() => {
      fetchWaitingList();
    });

    const handleParticipantEvent = () => {
      fetchWaitingList();
    };
    window.addEventListener('horror_participant_changed', handleParticipantEvent);

    // Auto-poll every 3.5s while in lobby to catch any new survivors
    const waitingPoll = setInterval(() => {
      fetchWaitingList();
    }, 3500);

    return () => {
      if (unsubParticipants) unsubParticipants();
      window.removeEventListener('horror_participant_changed', handleParticipantEvent);
      clearInterval(waitingPoll);
    };
  }, [gameSettings.game_status]);

  // 1. Initial Load of Songs, Submissions & Settings
  useEffect(() => {
    let isMounted = true;

    async function loadGameData() {
      try {
        setLoading(true);
        const [settingsData, songsData] = await Promise.all([
          horrorApi.getGameSettings(),
          horrorApi.getPlayableSongs()
        ]);

        if (!isMounted) return;
        setGameSettings(settingsData || { game_status: 'waiting', answers_revealed: false });
        setSongs(songsData || []);

        if (participant?.id) {
          const prevSubs = await horrorApi.getParticipantSubmissions(participant.id);
          const subMap = {};
          prevSubs.forEach(sub => {
            subMap[sub.song_id] = sub;
          });
          setSubmissions(subMap);

          const totalPts = prevSubs.reduce((acc, s) => acc + (s.points_awarded || 0), 0);
          const correctNum = prevSubs.filter(s => s.is_correct).length;
          setStats({
            score: totalPts,
            correctCount: correctNum,
            completedRounds: prevSubs.length
          });

          // Jump to first uncompleted round
          const firstUnansweredIndex = songsData.findIndex(s => !subMap[s.id]);
          if (firstUnansweredIndex >= 0) {
            setCurrentRoundIndex(firstUnansweredIndex);
          } else if (songsData.length > 0) {
            setCurrentRoundIndex(songsData.length - 1);
          }
        }
      } catch (err) {
        console.error('Failed to load trivia data:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadGameData();

    // Event listeners
    const handleSettingsUpdate = async (e) => {
      if (e.detail) {
        setGameSettings(e.detail);
        try {
          const freshSongs = await horrorApi.getPlayableSongs(true);
          if (freshSongs && isMounted) {
            setSongs(freshSongs);
          }
        } catch (err) {}
      }
    };
    const handleReset = () => {
      setSubmissions({});
      setSubmissionFeedback(null);
      setCurrentRoundIndex(0);
      setSelectedOption(null);
      setRoundState('ready');
      setAnswerDeadline(null);
      setAnswerTimeRemaining(10);
      setStats({ score: 0, correctCount: 0, completedRounds: 0 });
      if (onNeedRegister) onNeedRegister();
    };

    const handleSongsShuffled = async () => {
      try {
        const freshSongs = await horrorApi.getPlayableSongs(true);
        if (freshSongs && isMounted) {
          setSongs(freshSongs);
          if (gameSettings.game_status === 'waiting' || Object.keys(submissions).length === 0) {
            setCurrentRoundIndex(0);
          }
        }
      } catch (e) {
        console.warn('Failed to refresh shuffled songs:', e);
      }
    };

    window.addEventListener('horror_settings_updated', handleSettingsUpdate);
    window.addEventListener('horror_game_reset', handleReset);
    window.addEventListener('horror_songs_shuffled', handleSongsShuffled);

    // Supabase Realtime subscription for instant zero-polling updates
    const unsubscribeRealtime = horrorApi.subscribeToGameSettings(async (fresh) => {
      if (fresh && isMounted) {
        setGameSettings(fresh);
        if (fresh.total_rounds) {
          try {
            const freshSongs = await horrorApi.getPlayableSongs(true);
            if (freshSongs && isMounted) {
              setSongs(freshSongs);
            }
          } catch (e) {}
        }
      }
    });

    // Adaptive fallback poll with jitter (14s to 20s) to avoid query bursts from 100 participants
    let pollTimerId = null;
    const schedulePoll = () => {
      if (!isMounted) return;
      const jitter = 14000 + Math.floor(Math.random() * 6000);
      pollTimerId = setTimeout(async () => {
        try {
          const fresh = await horrorApi.getGameSettings();
          if (fresh && isMounted) {
            setGameSettings(fresh);
          }
        } catch (e) {}
        schedulePoll();
      }, jitter);
    };
    schedulePoll();

    return () => {
      isMounted = false;
      window.removeEventListener('horror_settings_updated', handleSettingsUpdate);
      window.removeEventListener('horror_game_reset', handleReset);
      window.removeEventListener('horror_songs_shuffled', handleSongsShuffled);
      if (unsubscribeRealtime) unsubscribeRealtime();
      if (pollTimerId) clearTimeout(pollTimerId);
      clearTimeout(autoAdvanceTimeoutRef.current);
    };
  }, [participant]);

  // Current Song & Round Limits
  const totalRounds = Number(gameSettings.total_rounds) || (songs.length ? Math.min(songs.length, 30) : 30);
  const playableSongs = songs.slice(0, totalRounds);
  const currentSong = playableSongs[currentRoundIndex] || null;
  const currentRoundNum = currentRoundIndex + 1;
  const currentSubmission = currentSong ? submissions[currentSong.id] : null;

  // Background Audio Preloading: Pre-buffer current and next round audio into browser cache
  useEffect(() => {
    if (!playableSongs || playableSongs.length === 0) return;
    const current = playableSongs[currentRoundIndex];
    if (current?.audio_path) {
      horrorSoundEngine.preloadAudio(current.audio_path);
    }
    const next = playableSongs[currentRoundIndex + 1];
    if (next?.audio_path) {
      horrorSoundEngine.preloadAudio(next.audio_path);
    }
  }, [currentRoundIndex, songs]);

  // 2. Fetch / Restore Round State on Round Change or Refresh
  useEffect(() => {
    let isMounted = true;
    clearInterval(timerIntervalRef.current);

    async function checkState() {
      if (!currentSong || !participant?.id) return;

      // If already recorded in submissions
      const existingSub = submissions[currentSong.id];
      if (existingSub) {
        setRoundState(
          existingSub.submitted_answer === '[TIME_EXPIRED]' || existingSub.selected_option === 'EXPIRED'
            ? 'time_expired'
            : 'submitted'
        );
        setSelectedOption(existingSub.selected_option || null);
        return;
      }

      try {
        setCheckingRoundState(true);
        const stateData = await horrorApi.getRoundState(participant.id, currentSong.id);
        if (!isMounted) return;

        if (stateData.state === 'submitted') {
          setRoundState('submitted');
          setSelectedOption(stateData.selected_option || null);
        } else if (stateData.state === 'time_expired' || stateData.is_expired) {
          setRoundState('time_expired');
          setSelectedOption('EXPIRED');
          setSubmissionFeedback({
            type: 'wrong',
            message: "TIME'S UP! The 10-second deadline expired. 0 points awarded."
          });
        } else if (stateData.state === 'answering') {
          // Participant refreshed or reopened during answer phase
          setRoundState('answering');
          if (stateData.answer_deadline) {
            setAnswerDeadline(stateData.answer_deadline);
            initAnswerTimer(stateData.answer_deadline);
          }
        } else if (stateData.state === 'audio_playing') {
          // Participant refreshed while audio was playing!
          // Prohibit replay: advance immediately to answering
          setRoundState('answering');
          if (stateData.answer_deadline) {
            setAnswerDeadline(stateData.answer_deadline);
            initAnswerTimer(stateData.answer_deadline);
          } else {
            handleAudioCompleted();
          }
        } else {
          setRoundState('ready');
          setSelectedOption(null);
          setAnswerDeadline(null);
          setAnswerTimeRemaining(10);
        }
      } catch (err) {
        console.error('Failed to get round state:', err);
      } finally {
        if (isMounted) setCheckingRoundState(false);
      }
    }

    checkState();

    return () => {
      isMounted = false;
      clearInterval(timerIntervalRef.current);
    };
  }, [currentRoundIndex, currentSong?.id, participant?.id]);

  // 3. Strict 10-Second Timer Engine (Calculated via Server-Side Deadline)
  const initAnswerTimer = (deadlineIso) => {
    clearInterval(timerIntervalRef.current);
    if (!deadlineIso) return;

    const deadlineMs = new Date(deadlineIso).getTime();

    const updateTimer = () => {
      const now = Date.now();
      const remainingMs = deadlineMs - now;
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));

      setAnswerTimeRemaining(remainingSec);

      // Heartbeat pulse sound in last 3 seconds
      if (remainingSec <= 3 && remainingSec > 0) {
        try { horrorSoundEngine.playWrongFX(); } catch (e) {}
      }

      if (remainingMs <= 0) {
        clearInterval(timerIntervalRef.current);
        handleTimerExpired();
      }
    };

    updateTimer();
    timerIntervalRef.current = setInterval(updateTimer, 200);
  };

  // 4. Action: Start Audio Playback (Strict Single Attempt)
  const handleStartPlayback = async (durationSec) => {
    if (!currentSong || !participant?.id) return { success: false };

    try {
      const auth = await horrorApi.startRoundPlayback(participant.id, currentSong.id, durationSec);
      if (auth.success) {
        setRoundState('audio_playing');
        setAnswerDeadline(auth.answer_deadline);
        return { success: true };
      }
      return { success: false };
    } catch (err) {
      alert(err.message || 'Playback unauthorized.');
      return { success: false };
    }
  };

  // 5. Action: Audio Playback Completed -> Transition to 10-Second Answering
  const handleAudioCompleted = async () => {
    if (!currentSong || !participant?.id) return;
    if (roundState === 'submitted' || roundState === 'time_expired') return;

    try {
      setRoundState('answering');
      const res = await horrorApi.completeAudioAndStartAnswering(participant.id, currentSong.id);
      const deadline = res.answer_deadline || new Date(Date.now() + 10000).toISOString();
      setAnswerDeadline(deadline);
      initAnswerTimer(deadline);
    } catch (err) {
      console.warn('Error completing audio:', err);
      // Fallback: 10 seconds from now
      const fallback = new Date(Date.now() + 10000).toISOString();
      setAnswerDeadline(fallback);
      initAnswerTimer(fallback);
    }
  };

  // 6. Action: Timer Expired (Auto-Submit Unanswered / 0 Points)
  const handleTimerExpired = async () => {
    if (isSubmitting || roundState === 'submitted' || roundState === 'time_expired') return;

    try {
      setIsSubmitting(true);
      setRoundState('time_expired');
      setSelectedOption('EXPIRED');
      try { horrorSoundEngine.playWrongFX(); } catch (e) {}

      const result = await horrorApi.submitAnswer(participant.id, currentSong.id, '[TIME_EXPIRED]');

      setSubmissions(prev => ({
        ...prev,
        [currentSong.id]: {
          song_id: currentSong.id,
          round_number: currentRoundNum,
          selected_option: 'EXPIRED',
          submitted_answer: '[TIME_EXPIRED]',
          is_correct: false,
          points_awarded: 0
        }
      }));

      setStats({
        score: result.total_score,
        correctCount: result.correct_count,
        completedRounds: result.completed_rounds
      });

      setSubmissionFeedback({
        type: 'wrong',
        message: "TIME'S UP! The 10-second deadline expired. 0 points awarded."
      });

      // Automatically advance to next round after timeout
      if (currentRoundIndex < totalRounds - 1) {
        setIsAutoAdvancing(true);
        clearTimeout(autoAdvanceTimeoutRef.current);
        autoAdvanceTimeoutRef.current = setTimeout(() => {
          handleNextRound();
        }, 1200);
      }
    } catch (err) {
      console.error('Timeout submit error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 7. Action: Manual MCQ Answer Submission (Before 10s Timer Expires)
  const handleSubmitAnswer = async (e) => {
    if (e) e.preventDefault();
    if (roundState !== 'answering' || isSubmitting || !currentSong || !selectedOption) return;

    // Check if time remaining > 0
    if (answerTimeRemaining <= 0) {
      handleTimerExpired();
      return;
    }

    try {
      setIsSubmitting(true);
      clearInterval(timerIntervalRef.current);

      const result = await horrorApi.submitAnswer(participant.id, currentSong.id, selectedOption, answerTimeRemaining);

      setRoundState(result.is_expired ? 'time_expired' : 'submitted');

      const optionKey = `option_${selectedOption.toLowerCase()}`;
      const optionText = currentSong[optionKey] || selectedOption;

      setSubmissions(prev => ({
        ...prev,
        [currentSong.id]: {
          song_id: currentSong.id,
          round_number: currentRoundNum,
          selected_option: result.selected_option || selectedOption,
          submitted_answer: result.is_expired ? '[TIME_EXPIRED]' : optionText,
          is_correct: result.is_correct,
          points_awarded: result.points_awarded
        }
      }));

      setStats({
        score: result.total_score,
        correctCount: result.correct_count,
        completedRounds: result.completed_rounds
      });

      // Feedback display rule (Requirement 6)
      const showDirect = Boolean(gameSettings.answers_revealed || gameSettings.immediate_feedback);

      if (showDirect) {
        if (result.is_correct) {
          try { horrorSoundEngine.playCorrectFX(); } catch (e) {}
          const pts = result.points_awarded ?? (answerTimeRemaining <= 3 ? 8 : 10);
          setSubmissionFeedback({
            type: 'correct',
            message: `CORRECT! Option ${selectedOption} is right. +${pts} Points!${pts === 8 ? ' (Late Answer: 8 PTS)' : ' (Speed Bonus: 10 PTS)'}`
          });
        } else {
          try { horrorSoundEngine.playWrongFX(); } catch (e) {}
          setSubmissionFeedback({
            type: 'wrong',
            message: result.is_expired 
              ? "LATE SUBMISSION! The 10-second timer expired. 0 points." 
              : `MISSED! Option ${selectedOption} is incorrect. 0 points.`
          });
        }
      } else {
        // Standard secret reveal mode: confirm submission without leaking correctness
        try { horrorSoundEngine.playHeartbeatFX(); } catch (e) {}
        setSubmissionFeedback({
          type: 'submitted',
          message: `Answer Locked! Option ${selectedOption} submitted. Official results will be revealed by the organizer.`
        });
      }

      // Check if finished 30 rounds
      if (result.completed_rounds >= totalRounds) {
        confetti({
          particleCount: 130,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#dc2626', '#b91c1c', '#7f1d1d', '#ffffff']
        });
      }

      // Automatically advance to next round after submitting answer
      if (currentRoundIndex < totalRounds - 1) {
        setIsAutoAdvancing(true);
        clearTimeout(autoAdvanceTimeoutRef.current);
        autoAdvanceTimeoutRef.current = setTimeout(() => {
          handleNextRound();
        }, 1200);
      }
    } catch (err) {
      console.error('Answer submission error:', err);
      setSubmissionFeedback({
        type: 'error',
        message: err.message || 'Submission error. Please check your connection.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNextRound = () => {
    setIsAutoAdvancing(false);
    clearTimeout(autoAdvanceTimeoutRef.current);
    setSubmissionFeedback(null);
    setSelectedOption(null);
    setRoundState('ready');
    setAnswerDeadline(null);
    setAnswerTimeRemaining(10);
    setCurrentRoundIndex(prev => (prev < totalRounds - 1 ? prev + 1 : prev));
  };

  // 8. UNREGISTERED STATE
  if (!participant) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#0e0e15] border border-red-900/60 rounded-3xl p-8 text-center shadow-2xl">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-950 border border-red-600/70 flex items-center justify-center text-3xl">
            🩸
          </div>
          <h2 className="text-2xl font-cinzel font-bold text-white mb-2">Registration Required</h2>
          <p className="text-xs text-zinc-400 mb-6">
            You must enter your survivor name before joining the Horror Song Trivia challenge.
          </p>
          <button
            onClick={onNeedRegister}
            className="w-full py-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm tracking-wide shadow-[0_0_20px_rgba(220,38,38,0.6)] cursor-pointer"
          >
            REGISTER TO PLAY
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center gap-4 text-zinc-400">
        <div className="w-10 h-10 border-4 border-red-600/20 border-t-red-600 rounded-full animate-spin" />
        <p className="font-typewriter text-sm tracking-wider text-red-400">Summoning Horror Sounds...</p>
      </div>
    );
  }

  // 9. EVENT STATUS: WAITING LOBBY
  if (gameSettings.game_status === 'waiting') {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 py-8">
        <div className="w-full max-w-xl bg-[#0e0e15]/95 border border-red-900/60 rounded-3xl p-6 sm:p-8 text-center shadow-[0_0_50px_rgba(220,38,38,0.25)] backdrop-blur-xl relative overflow-hidden">
          {/* Ambient red flare */}
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-red-600/15 rounded-full blur-2xl pointer-events-none" />

          <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 rounded-2xl bg-red-950/80 border border-red-700/60 flex items-center justify-center text-3xl sm:text-4xl shadow-[0_0_25px_rgba(220,38,38,0.5)]">
            ⏳
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-950 text-red-400 border border-red-800 mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>LOBBY WAITING ROOM</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-cinzel font-black text-white uppercase tracking-wider mb-2">
            The Gates Are Locked
          </h2>
          <p className="text-xs sm:text-sm text-zinc-300 max-w-md mx-auto leading-relaxed mb-5">
            Welcome, <span className="text-red-400 font-bold">{participant.name}</span>. The organizer will start the event shortly. Listen to each song and choose the correct answer before time runs out!
          </p>

          {/* Player Quick Info Cards */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-950/90 border border-zinc-900 flex items-center justify-around text-center mb-5">
            <div>
              <p className="text-[10px] sm:text-xs text-zinc-500 uppercase font-mono">Participant ID</p>
              <p className="text-xs sm:text-sm font-mono font-bold text-zinc-200">{participant.participant_code}</p>
            </div>
            <div className="w-px h-8 bg-zinc-800" />
            <div>
              <p className="text-[10px] sm:text-xs text-zinc-500 uppercase font-mono">Format</p>
              <p className="text-xs sm:text-sm font-mono font-bold text-zinc-200">{totalRounds} MCQ Rounds</p>
            </div>
            <div className="w-px h-8 bg-zinc-800" />
            <div>
              <p className="text-[10px] sm:text-xs text-zinc-500 uppercase font-mono">Total Points</p>
              <p className="text-xs sm:text-sm font-mono font-bold text-amber-400">{totalRounds * 10} PTS</p>
            </div>
          </div>


          {/* LIVE PARTICIPANTS IN WAITING ROOM */}
          <div className="mb-6 p-4 rounded-2xl bg-zinc-950/80 border border-red-950/90 text-left">
            <div className="flex items-center justify-between mb-3 border-b border-zinc-900 pb-2.5">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-red-500" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                  Survivors in Lobby ({waitingParticipants.length})
                </h4>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 animate-pulse">
                  LIVE
                </span>
              </div>
              <button
                onClick={() => fetchWaitingList(true)}
                disabled={isRefreshingWaiting}
                className="text-[11px] font-mono text-zinc-400 hover:text-red-400 flex items-center gap-1 cursor-pointer transition-colors"
                title="Refresh lobby list"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshingWaiting ? 'animate-spin text-red-500' : ''}`} />
                <span>Sync</span>
              </button>
            </div>

            {waitingParticipants.length === 0 ? (
              <div className="py-6 text-center text-zinc-500">
                <p className="text-xs">Gathering survivors in the lobby...</p>
              </div>
            ) : (
              <div className="max-h-52 overflow-y-auto pr-1 space-y-2">
                {waitingParticipants.map((p) => {
                  const isSelf = p.id === participant.id || p.participant_code === participant.participant_code;
                  return (
                    <div
                      key={p.id || p.participant_code}
                      className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-all ${
                        isSelf
                          ? 'bg-red-950/50 border-red-700/80 text-white shadow-[0_0_12px_rgba(220,38,38,0.25)]'
                          : 'bg-[#12121c]/80 border-zinc-900 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-red-950/80 border border-red-800/60 flex items-center justify-center text-xs shrink-0">
                          🩸
                        </div>
                        <div className="truncate">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-semibold truncate">{p.name}</span>
                            {isSelf && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold font-mono bg-red-600 text-white uppercase">
                                YOU
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] font-mono text-zinc-500 truncate">
                            {p.participant_code}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] font-mono font-bold text-emerald-400 tracking-wider">
                          READY
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-[10px] text-zinc-500 text-center mt-3 font-typewriter">
              When the organizer clicks Start Game, your arena will begin automatically.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onGoToLeaderboard}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-xs sm:text-sm font-semibold cursor-pointer transition-colors"
            >
              View Leaderboard
            </button>
            <div className="text-xs text-zinc-500 flex items-center gap-1.5 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span>Awaiting organizer signal...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 10. EVENT STATUS: PAUSED
  if (gameSettings.game_status === 'paused') {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#0e0e15] border border-amber-900/60 rounded-3xl p-8 text-center shadow-2xl">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-950/60 border border-amber-600/50 flex items-center justify-center text-3xl">
            ⏸️
          </div>
          <h2 className="text-2xl font-cinzel font-bold text-white mb-2">Event Intermission</h2>
          <p className="text-sm text-zinc-300 mb-6">
            The organizer has paused the game. Submissions are temporarily held. Please standby...
          </p>
          <div className="text-xs font-mono text-amber-400 animate-pulse">
            PAUSED BY ORGANIZER
          </div>
        </div>
      </div>
    );
  }

  // 11. SURVIVOR COMPLETED ALL ROUNDS (OR EVENT ENDED)
  const isAllCompleted = stats.completedRounds >= totalRounds && totalRounds > 0;
  if (isAllCompleted || gameSettings.game_status === 'ended') {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 py-8">
        <div className="w-full max-w-2xl bg-[#0e0e15]/95 border border-red-900/70 rounded-3xl p-8 text-center shadow-[0_0_60px_rgba(220,38,38,0.4)] backdrop-blur-xl">
          <div className="w-24 h-24 mx-auto mb-4 rounded-3xl bg-gradient-to-br from-red-950 to-black border border-red-600 flex items-center justify-center text-5xl shadow-[0_0_30px_rgba(220,38,38,0.7)]">
            🏆
          </div>

          <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-950 text-red-400 border border-red-800">
            CHALLENGE CONCLUDED
          </span>

          <h2 className="text-3xl sm:text-4xl font-cinzel font-black text-white mt-3 mb-2">
            YOU SURVIVED THE NIGHT
          </h2>

          <p className="text-sm text-zinc-400 font-typewriter max-w-md mx-auto mb-6">
            Congratulations, survivor {participant.name}. All {totalRounds} rounds are locked and evaluated.
          </p>

          <div className="grid grid-cols-3 gap-3 p-4 rounded-2xl bg-zinc-950 border border-zinc-900 mb-8 max-w-lg mx-auto">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Final Score</p>
              <p className="text-2xl sm:text-3xl font-black font-mono text-red-500 mt-1">
                {stats.score} <span className="text-xs text-zinc-500 font-normal">/ {totalRounds * 10}</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Correct</p>
              <p className="text-2xl sm:text-3xl font-black font-mono text-emerald-400 mt-1">
                {stats.correctCount} <span className="text-xs text-zinc-500 font-normal">/ {totalRounds}</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Accuracy</p>
              <p className="text-2xl sm:text-3xl font-black font-mono text-amber-400 mt-1">
                {totalRounds > 0 ? Math.round((stats.correctCount / totalRounds) * 100) : 0}%
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={onGoToLeaderboard}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm tracking-wide shadow-[0_0_20px_rgba(220,38,38,0.6)] cursor-pointer flex items-center justify-center gap-2"
            >
              <Trophy className="w-4 h-4 text-amber-300" />
              <span>VIEW FINAL LEADERBOARD</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 12. ACTIVE ROUND TRIVIA INTERFACE
  const percentComplete = Math.round((stats.completedRounds / totalRounds) * 100);
  const hasAudioPlayed = roundState !== 'ready';
  const isAudioPlaying = roundState === 'audio_playing';
  const isAnswering = roundState === 'answering';
  const isLocked = roundState === 'submitted' || roundState === 'time_expired';

  // Answer countdown progress (10s down to 0s)
  const timerPercent = Math.max(0, Math.min(100, (answerTimeRemaining / 10) * 100));
  const isTimerCritical = isAnswering && answerTimeRemaining <= 3;

  return (
    <div className="min-h-[calc(100vh-4rem)] max-w-4xl mx-auto px-4 py-8">
      
      {/* Top Banner: Progress & Score Ticker */}
      <div className="bg-[#0f0f17]/95 border border-red-950/80 rounded-2xl p-4 sm:p-6 mb-6 shadow-xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-red-950 border border-red-700/60 flex items-center justify-center text-red-400 font-mono font-bold text-base shadow-[0_0_15px_rgba(220,38,38,0.4)]">
              {currentRoundNum}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-cinzel font-bold text-zinc-100 uppercase tracking-wider">
                  Round {currentRoundNum} of {totalRounds}
                </h3>
                {isAnswering && (
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold uppercase ${
                    isTimerCritical 
                      ? 'bg-red-950 text-red-400 border border-red-600 animate-ping' 
                      : 'bg-amber-950 text-amber-400 border border-amber-700 animate-pulse'
                  }`}>
                    ANSWER NOW
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                Survivor: <span className="text-zinc-200 font-semibold">{participant.name}</span> ({participant.participant_code})
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end">
            <div className="px-3.5 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-right">
              <span className="text-[10px] text-zinc-500 uppercase block">Correct</span>
              <span className="text-sm font-mono font-bold text-emerald-400">
                {stats.correctCount} / {totalRounds}
              </span>
            </div>

            <div className="px-4 py-1.5 rounded-xl bg-red-950/70 border border-red-800/80 text-right shadow-[0_0_15px_rgba(220,38,38,0.3)]">
              <span className="text-[10px] text-red-400 uppercase font-semibold block">Total Score</span>
              <span className="text-base font-mono font-black text-white">
                {stats.score} <span className="text-xs font-normal text-red-300">/ {totalRounds * 10} PTS</span>
              </span>
            </div>
          </div>
        </div>

        {/* Global Progress Bar */}
        <div>
          <div className="flex justify-between items-center text-xs text-zinc-400 mb-1.5 font-mono">
            <span>Overall Progress: {stats.completedRounds} / {totalRounds} completed</span>
            <span>{percentComplete}%</span>
          </div>
          <div className="w-full bg-zinc-950 h-2 rounded-full overflow-hidden border border-zinc-800/80">
            <div 
              className="h-full bg-gradient-to-r from-red-800 to-red-500 transition-all duration-300 shadow-[0_0_10px_rgba(220,38,38,0.8)]"
              style={{ width: `${percentComplete}%` }}
            />
          </div>
        </div>
      </div>

      {/* Main Round Arena Card */}
      <div className={`bg-[#0e0e15]/95 border rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl mb-6 transition-all duration-300 ${
        isTimerCritical 
          ? 'border-red-600 shadow-[0_0_40px_rgba(220,38,38,0.6)] animate-pulse' 
          : 'border-red-900/60'
      }`}>
        
        {/* Audio Player */}
        <div className="mb-6">
          <AudioPlayer
            roundNumber={currentRoundNum}
            audioPath={currentSong?.audio_path}
            synthMotif={currentSong?.synth_motif}
            targetDuration={currentSong?.duration_seconds || 5}
            hasPlayed={hasAudioPlayed}
            isPlaying={isAudioPlaying}
            onStartPlayback={handleStartPlayback}
            onAudioCompleted={handleAudioCompleted}
            disabled={isLocked || isAnswering}
          />
        </div>

        {/* 10-Second Answer Timer Banner (Visible when ANSWERING) */}
        {isAnswering && (
          <div className={`p-4 rounded-2xl mb-6 border transition-all duration-200 ${
            isTimerCritical 
              ? 'bg-red-950/80 border-red-500 shadow-[0_0_30px_rgba(220,38,38,0.8)]' 
              : 'bg-zinc-950/90 border-amber-600/50 shadow-[0_0_20px_rgba(245,158,11,0.3)]'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Timer className={`w-5 h-5 ${isTimerCritical ? 'text-red-400 animate-spin' : 'text-amber-400 animate-pulse'}`} />
                <span className="text-xs font-mono font-bold tracking-wider uppercase text-zinc-200">
                  {isTimerCritical ? 'LAST 3 SECONDS (8 PTS)' : 'ANSWER TIMER (10 PTS)'}
                </span>
              </div>
              <div className={`text-xl sm:text-2xl font-mono font-black tracking-widest ${
                isTimerCritical ? 'text-red-400 blood-glow animate-pulse' : 'text-amber-400'
              }`}>
                TIME LEFT: {answerTimeRemaining}s
              </div>
            </div>

            {/* Decreasing Timer Progress Bar */}
            <div className="w-full bg-zinc-900 h-2.5 rounded-full overflow-hidden border border-zinc-800">
              <div 
                className={`h-full transition-all duration-200 ${
                  isTimerCritical 
                    ? 'bg-red-600 shadow-[0_0_12px_rgba(220,38,38,0.9)]' 
                    : 'bg-gradient-to-r from-amber-600 to-amber-400'
                }`}
                style={{ width: `${timerPercent}%` }}
              />
            </div>
            
            {isTimerCritical ? (
              <p className="text-[11px] font-mono text-red-300 text-center mt-2 animate-bounce">
                ⚠️ FINAL 3 SECONDS: Answers now award 8 points instead of 10!
              </p>
            ) : (
              <p className="text-[11px] font-mono text-amber-300/80 text-center mt-2">
                ⚡ Speed Zone: Submit before 3s left for full 10 points!
              </p>
            )}
          </div>
        )}

        {/* Answer Submission Section */}
        {isLocked ? (
          /* Locked State after submitting or expiration */
          <div className="p-6 rounded-2xl bg-zinc-950/80 border border-zinc-800/80 text-center">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Lock className="w-4 h-4 text-zinc-500" />
              <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                Round {currentRoundNum} &bull; Answer Locked
              </span>
            </div>

            {roundState === 'time_expired' ? (
              <div className="my-3">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold bg-red-950 text-red-400 border border-red-700 shadow-[0_0_20px_rgba(220,38,38,0.5)]">
                  <XCircle className="w-4 h-4 text-red-500" />
                  <span>TIME EXPIRED &bull; 0 POINTS</span>
                </div>
                <p className="text-xs text-zinc-400 mt-2">
                  The 10-second timer elapsed before an answer was submitted.
                </p>
              </div>
            ) : (
              <div className="my-3">
                {/* Check if answers revealed */}
                {gameSettings.answers_revealed ? (
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold mb-3">
                    {currentSubmission?.is_correct ? (
                      <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 px-3.5 py-1 rounded-full flex items-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        CORRECT &bull; +10 POINTS
                      </span>
                    ) : (
                      <span className="bg-red-950 text-red-400 border border-red-800 px-3.5 py-1 rounded-full flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 text-red-500" />
                        MISSED &bull; 0 POINTS
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono font-semibold bg-zinc-900 border border-zinc-800 text-zinc-300 mb-3">
                    <CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Answer Recorded &bull; Results Revealed by Organizer</span>
                  </div>
                )}
              </div>
            )}

            {/* 4 Options in Locked Review Display */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4 text-left">
              {[
                { key: 'A', text: currentSong?.option_a },
                { key: 'B', text: currentSong?.option_b },
                { key: 'C', text: currentSong?.option_c },
                { key: 'D', text: currentSong?.option_d }
              ].map(opt => {
                const isSelected = (currentSubmission?.selected_option || selectedOption) === opt.key;
                const isCorrect = gameSettings.answers_revealed && currentSong?.correct_option === opt.key;
                const isWrongSelection = gameSettings.answers_revealed && isSelected && !isCorrect;

                let cardStyle = "border-zinc-900 bg-[#08080c] opacity-40 text-zinc-500";
                let badgeStyle = "bg-zinc-900 border border-zinc-800 text-zinc-600";

                if (isCorrect) {
                  cardStyle = "border-emerald-500 bg-emerald-950/70 shadow-[0_0_20px_rgba(16,185,129,0.4)] text-emerald-100 opacity-100 ring-1 ring-emerald-500";
                  badgeStyle = "bg-emerald-600 text-white font-bold shadow";
                } else if (isWrongSelection) {
                  cardStyle = "border-red-600 bg-red-950/70 shadow-[0_0_20px_rgba(220,38,38,0.4)] text-red-200 opacity-100 ring-1 ring-red-600";
                  badgeStyle = "bg-red-700 text-white font-bold";
                } else if (isSelected) {
                  cardStyle = "border-red-500/80 bg-red-950/50 shadow-[0_0_15px_rgba(220,38,38,0.3)] text-zinc-100 opacity-100";
                  badgeStyle = "bg-red-600 text-white font-bold";
                }

                return (
                  <div
                    key={opt.key}
                    className={`min-h-[58px] p-3.5 sm:p-4 rounded-2xl border flex items-center justify-between gap-3 transition-all ${cardStyle}`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-cinzel text-xs shrink-0 ${badgeStyle}`}>
                        {opt.key}
                      </span>
                      <span className="text-sm font-medium leading-snug truncate">
                        {opt.text || `Option ${opt.key}`}
                      </span>
                    </div>

                    <div className="shrink-0 text-right">
                      {isCorrect && (
                        <span className="text-[10px] font-mono font-bold uppercase text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                          {isSelected ? 'YOUR PICK &bull; CORRECT' : 'CORRECT ANSWER'}
                        </span>
                      )}
                      {isWrongSelection && (
                        <span className="text-[10px] font-mono font-bold uppercase text-red-400 bg-red-950 px-2 py-0.5 rounded border border-red-800">
                          YOUR PICK &bull; MISSED
                        </span>
                      )}
                      {!gameSettings.answers_revealed && isSelected && (
                        <span className="text-[10px] font-mono font-bold uppercase text-red-300 bg-red-950/80 px-2 py-0.5 rounded border border-red-800">
                          YOUR SELECTION
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Revealed Canonical Info (if organizer enabled reveal mode) */}
            {gameSettings.answers_revealed && currentSong?.correct_answer && (
              <div className="mt-3 p-3 bg-red-950/30 border border-red-900/50 rounded-xl text-xs text-red-200 max-w-md mx-auto">
                Official Answer: <span className="font-bold text-white">Option {currentSong.correct_option}: {currentSong.correct_answer}</span>
              </div>
            )}

            {/* Automatic round advance status indicator (Proceed button removed) */}
            {currentRoundIndex < totalRounds - 1 ? (
              isAutoAdvancing ? (
                <div className="pt-4 flex items-center justify-center gap-2.5 text-xs font-mono text-red-400 animate-pulse">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                  <span className="font-semibold tracking-wide">Advancing to Round {currentRoundNum + 1}...</span>
                </div>
              ) : null
            ) : (
              <div className="pt-4">
                <button
                  onClick={onGoToLeaderboard}
                  className="px-8 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs tracking-wider transition-all shadow-[0_0_20px_rgba(220,38,38,0.6)] cursor-pointer inline-flex items-center gap-2"
                >
                  <Trophy className="w-4 h-4 text-amber-300" />
                  <span>VIEW FINAL STANDINGS</span>
                </button>
              </div>
            )}
          </div>
        ) : !isAnswering ? (
          /* Matted State: Concealed & Blurred Options while Audio Plays or Before Play */
          <div className="relative overflow-hidden rounded-2xl border border-zinc-900 bg-[#09090f] p-5 sm:p-6 text-center select-none min-h-[220px] flex items-center justify-center">
            {/* Matted Background Cards (heavily blurred skeleton placeholders) */}
            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 filter blur-md opacity-15 pointer-events-none">
              {['A', 'B', 'C', 'D'].map(letter => (
                <div
                  key={letter}
                  className="p-4 rounded-xl border border-zinc-800 bg-[#101018] flex items-center gap-3 text-left"
                >
                  <span className="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-600 flex items-center justify-center font-cinzel text-xs font-bold">
                    {letter}
                  </span>
                  <div className="h-4 bg-zinc-700/50 rounded w-28" />
                </div>
              ))}
            </div>

            {/* Frosted Matte Overlay */}
            <div className="absolute inset-0 bg-[#08080d]/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
              <div className="w-12 h-12 rounded-2xl bg-zinc-900/90 border border-zinc-800/90 flex items-center justify-center mb-3 shadow-[0_0_20px_rgba(0,0,0,0.8)]">
                {isAudioPlaying ? (
                  <Volume2 className="w-6 h-6 text-red-500 animate-pulse" />
                ) : (
                  <Lock className="w-5 h-5 text-zinc-500" />
                )}
              </div>

              <h4 className="text-sm sm:text-base font-bold uppercase tracking-wider text-zinc-200 mb-1 font-cinzel">
                {isAudioPlaying ? 'LISTENING TO SONG...' : 'OPTIONS CONCEALED'}
              </h4>

              <p className="text-xs text-zinc-400 max-w-sm mx-auto leading-relaxed">
                {isAudioPlaying ? (
                  <span className="text-red-400 font-semibold animate-pulse block">
                    Options will appear the moment the audio finishes!
                  </span>
                ) : (
                  <span>
                    Press <span className="text-red-400 font-bold">&ldquo;PLAY AUDIO&rdquo;</span> above. The 4 options will unlock immediately after the clip finishes.
                  </span>
                )}
              </p>
            </div>
          </div>
        ) : (
          /* Active Answering Interface: 4 Clickable MCQ Option Cards */
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-200 flex items-center gap-1.5">
                  <span className="text-red-500">&bull;</span>
                  <span>Select The Correct Song / Theme (Options A - D)</span>
                </label>
                <span className={`text-xs font-mono font-bold ${
                  isTimerCritical ? 'text-red-400 animate-pulse' : 'text-amber-400'
                }`}>
                  {answerTimeRemaining}s left
                </span>
              </div>

              {/* 4 Selectable Answer Cards (2x2 Grid) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {[
                  { key: 'A', text: currentSong?.option_a },
                  { key: 'B', text: currentSong?.option_b },
                  { key: 'C', text: currentSong?.option_c },
                  { key: 'D', text: currentSong?.option_d }
                ].map(opt => {
                  const isSelected = selectedOption === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={isSubmitting || answerTimeRemaining <= 0}
                      onClick={() => setSelectedOption(opt.key)}
                      className={`min-h-[64px] p-4 rounded-2xl border text-left flex items-center justify-between gap-3.5 transition-all cursor-pointer select-none active:scale-[0.98] ${
                        isSelected
                          ? 'border-red-500 bg-red-950/80 shadow-[0_0_25px_rgba(220,38,38,0.6)] ring-2 ring-red-500 text-white'
                          : 'border-zinc-800/90 bg-[#0c0c14] hover:border-red-900/80 hover:bg-zinc-900/70 text-zinc-300 hover:text-white'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <div className="flex items-center gap-3.5 flex-1 min-w-0">
                        <span className={`w-9 h-9 rounded-xl flex items-center justify-center font-cinzel font-black text-sm shrink-0 transition-all ${
                          isSelected
                            ? 'bg-red-600 text-white shadow-[0_0_12px_rgba(220,38,38,0.8)]'
                            : 'bg-zinc-900 border border-zinc-800 text-zinc-400'
                        }`}>
                          {opt.key}
                        </span>
                        <span className="text-sm sm:text-base font-semibold leading-snug break-words">
                          {opt.text || `Option ${opt.key}`}
                        </span>
                      </div>

                      {/* Selection Radio Indicator */}
                      <div className="shrink-0 pl-2">
                        {isSelected ? (
                          <div className="w-5 h-5 rounded-full bg-red-600 border border-red-400 flex items-center justify-center shadow-[0_0_10px_rgba(220,38,38,0.9)]">
                            <div className="w-2 h-2 rounded-full bg-white" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border border-zinc-700 bg-zinc-900/80" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <p className="text-[11px] text-zinc-500 mt-2.5 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>You can change your selection anytime before submitting or before the 10s timer expires.</span>
              </p>
            </div>

            {/* Submission Feedback Message */}
            {submissionFeedback && (
              <div className={`p-3.5 rounded-xl border text-xs flex items-center gap-2.5 ${
                submissionFeedback.type === 'correct'
                  ? 'bg-emerald-950/70 border-emerald-700 text-emerald-200'
                  : submissionFeedback.type === 'wrong'
                  ? 'bg-red-950/70 border-red-700 text-red-200'
                  : 'bg-zinc-900/90 border-zinc-700 text-zinc-200'
              }`}>
                {submissionFeedback.type === 'correct' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : submissionFeedback.type === 'wrong' ? (
                  <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                ) : (
                  <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                )}
                <span>{submissionFeedback.message}</span>
              </div>
            )}

            {/* Submit Answer Button */}
            <button
              type="button"
              onClick={handleSubmitAnswer}
              disabled={isSubmitting || !selectedOption || answerTimeRemaining <= 0}
              className={`w-full py-4 rounded-xl font-extrabold text-sm tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer border ${
                selectedOption
                  ? isTimerCritical
                    ? 'bg-red-600 hover:bg-red-500 text-white border-red-500 shadow-[0_0_30px_rgba(220,38,38,0.9)] animate-pulse'
                    : 'bg-red-600 hover:bg-red-500 text-white border-red-500 shadow-[0_0_20px_rgba(220,38,38,0.7)]'
                  : 'bg-zinc-900 text-zinc-500 border-zinc-800 cursor-not-allowed opacity-50'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  LOCKING IN SUBMISSION...
                </span>
              ) : selectedOption ? (
                <span>SUBMIT OPTION {selectedOption} ({answerTimeRemaining}s LEFT &bull; {answerTimeRemaining <= 3 ? '8 PTS' : '10 PTS'})</span>
              ) : (
                <span>SELECT AN OPTION TO SUBMIT ({answerTimeRemaining}s LEFT &bull; {answerTimeRemaining <= 3 ? '8 PTS' : '10 PTS'})</span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Round Matrix Grid (1 to 30) - Anti-Cheating: View Only, No Skipping Ahead */}
      <div className="bg-[#0f0f17]/80 border border-zinc-900 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3 text-xs text-zinc-400 font-mono">
          <span>ROUNDS MATRIX (1 - {totalRounds})</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" /> Correct
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600" /> Missed / Expired
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-800" /> Unanswered
            </span>
          </div>
        </div>

        <div className="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-15 gap-2">
          {playableSongs.map((s, idx) => {
            const sub = submissions[s.id];
            const isCurrent = idx === currentRoundIndex;
            const isCompleted = Boolean(sub);
            const isAccessible = isCompleted || idx === currentRoundIndex;

            let bgClass = "bg-zinc-900 text-zinc-500 border-zinc-800 opacity-60 cursor-not-allowed";

            if (sub) {
              bgClass = sub.is_correct 
                ? "bg-emerald-950/80 text-emerald-300 border-emerald-700 cursor-pointer" 
                : "bg-red-950/80 text-red-400 border-red-800 cursor-pointer";
            } else if (isCurrent) {
              bgClass = "bg-red-950/40 text-red-200 border-red-600 ring-2 ring-red-500 font-bold scale-105 shadow-[0_0_10px_rgba(220,38,38,0.5)]";
            }

            return (
              <button
                key={s.id}
                disabled={!isAccessible}
                onClick={() => {
                  if (isAccessible && idx !== currentRoundIndex && !isAudioPlaying && !isAnswering) {
                    setIsAutoAdvancing(false);
                    clearTimeout(autoAdvanceTimeoutRef.current);
                    setCurrentRoundIndex(idx);
                    setSubmissionFeedback(null);
                    setSelectedOption(null);
                  }
                }}
                className={`py-1.5 px-2 rounded-lg text-xs font-mono border transition-all ${bgClass}`}
              >
                {s.round_number}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
