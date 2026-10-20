import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, LogOut, Play, Pause, Square, Eye, RotateCcw, Download, 
  Upload, Music, CheckCircle2, AlertCircle, Trash2, Edit3, Save, Sparkles, User, RefreshCw,
  Database, ExternalLink
} from 'lucide-react';
import { horrorApi, isSupabaseConfigured } from '../services/supabase';
import { DEFAULT_HORROR_SONGS } from '../data/defaultSongs';
import AudioPlayer from '../components/AudioPlayer';

export default function AdminDashboard({ onAdminStateChange }) {
  const [session, setSession] = useState(null);
  const [emailInput, setEmailInput] = useState('admin@horrortrivia.com');
  const [passwordInput, setPasswordInput] = useState('bloodcurdling666');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [supabaseHealth, setSupabaseHealth] = useState(null);

  // Dashboard Data
  const [songs, setSongs] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [gameSettings, setGameSettings] = useState({
    game_status: 'waiting',
    current_round: 1,
    answers_revealed: false,
    total_rounds: 30
  });

  const [activeTab, setActiveTab] = useState('songs'); // 'songs' | 'live' | 'answers'
  const [editingRound, setEditingRound] = useState(null); // song object being edited
  const [editModalError, setEditModalError] = useState('');
  const [uploadingRound, setUploadingRound] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [audioPreviewUrl, setAudioPreviewUrl] = useState(null);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [actionSuccessMessage, setActionSuccessMessage] = useState('');

  // Check health and session on load
  useEffect(() => {
    async function initAdmin() {
      try {
        const health = await horrorApi.checkSupabaseHealth();
        setSupabaseHealth(health);
      } catch (e) {}

      const sess = await horrorApi.getAdminSession();
      if (sess) {
        setSession(sess);
        loadAdminData();
      }
    }
    initAdmin();
  }, []);

  // Real-time synchronization for Organizer Portal
  useEffect(() => {
    if (!session) return;

    // 1. Subscribe to live participant registrations
    const unsubParticipants = horrorApi.subscribeToParticipants(() => {
      loadAdminData();
    });

    const unsubLeaderboard = horrorApi.subscribeToLeaderboard(() => {
      loadAdminData();
    });

    const unsubSettings = horrorApi.subscribeToGameSettings((newSettings) => {
      if (newSettings) setGameSettings(newSettings);
    });

    const handleParticipantChanged = () => {
      loadAdminData();
    };

    window.addEventListener('horror_participant_changed', handleParticipantChanged);
    window.addEventListener('horror_submission_made', handleParticipantChanged);
    window.addEventListener('horror_game_reset', handleParticipantChanged);

    // 2. Poll every 4 seconds while admin is logged in so lobby count is always fresh
    const pollInterval = setInterval(() => {
      loadAdminData();
    }, 4000);

    return () => {
      if (unsubParticipants) unsubParticipants();
      if (unsubLeaderboard) unsubLeaderboard();
      if (unsubSettings) unsubSettings();
      window.removeEventListener('horror_participant_changed', handleParticipantChanged);
      window.removeEventListener('horror_submission_made', handleParticipantChanged);
      window.removeEventListener('horror_game_reset', handleParticipantChanged);
      clearInterval(pollInterval);
    };
  }, [session]);

  const loadAdminData = async () => {
    try {
      const [songsData, settingsData, partsData, subsData, health] = await Promise.all([
        horrorApi.getAllAdminSongs(),
        horrorApi.getGameSettings(true),
        horrorApi.getAllParticipants(true),
        horrorApi.getAllSubmissions(),
        horrorApi.checkSupabaseHealth()
      ]);
      setSongs(songsData || []);
      setGameSettings(settingsData || {});
      setParticipants(partsData || []);
      setSubmissions(subsData || []);
      setSupabaseHealth(health);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    }
  };

  const showSuccessBanner = (msg) => {
    setActionSuccessMessage(msg);
    setTimeout(() => setActionSuccessMessage(''), 4000);
  };

  // Login handler
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      setIsLoggingIn(true);
      setLoginError('');
      const res = await horrorApi.adminLogin(emailInput, passwordInput);
      setSession(res.session);
      loadAdminData();
      showSuccessBanner('Logged into Organizer Portal.');
    } catch (err) {
      setLoginError(err.message || 'Login failed.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    await horrorApi.adminLogout();
    setSession(null);
  };

  // Update Game Status (with strict 30-round validation on start/activate)
  const handleStatusChange = async (newStatus) => {
    if (newStatus === 'active') {
      // Requirement 10: Validate that all 30 rounds are configured correctly before allowing the organizer to start the game.
      const invalidRounds = [];

      for (let r = 1; r <= 30; r++) {
        const song = songs.find(s => s.round_number === r);
        if (!song) {
          invalidRounds.push(`Round ${r}: Missing song entry`);
          continue;
        }

        const optA = (song.option_a || '').trim();
        const optB = (song.option_b || '').trim();
        const optC = (song.option_c || '').trim();
        const optD = (song.option_d || '').trim();
        const correctOpt = (song.correct_option || '').trim().toUpperCase();

        if (!optA || !optB || !optC || !optD) {
          invalidRounds.push(`Round ${r}: Options A, B, C, D must all be filled`);
          continue;
        }

        if (!['A', 'B', 'C', 'D'].includes(correctOpt)) {
          invalidRounds.push(`Round ${r}: Must select a correct option (A, B, C, or D)`);
          continue;
        }

        // Duplicate check (ignoring capitalization and extra spaces)
        const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
        const set = new Set([norm(optA), norm(optB), norm(optC), norm(optD)]);
        if (set.size < 4) {
          invalidRounds.push(`Round ${r}: Duplicate options found`);
        }
      }

      if (invalidRounds.length > 0) {
        alert(
          `Cannot start the game! All 30 rounds must have 4 unique options and 1 correct answer.\n\nIssues found (${invalidRounds.length}):\n` +
          invalidRounds.slice(0, 8).join('\n') +
          (invalidRounds.length > 8 ? `\n...and ${invalidRounds.length - 8} more` : '')
        );
        return;
      }
    }

    try {
      const updated = await horrorApi.updateGameSettings({ game_status: newStatus });
      setGameSettings(prev => ({ ...prev, game_status: newStatus }));
      showSuccessBanner(`Game status changed to: ${newStatus.toUpperCase()}`);
    } catch (e) {
      alert('Error updating status: ' + e.message);
    }
  };

  // Toggle Answers Reveal
  const handleToggleReveal = async () => {
    try {
      const nextVal = !gameSettings.answers_revealed;
      await horrorApi.updateGameSettings({ answers_revealed: nextVal });
      setGameSettings(prev => ({ ...prev, answers_revealed: nextVal }));
      showSuccessBanner(nextVal ? 'Correct answers are now REVEALED to participants!' : 'Answers hidden.');
    } catch (e) {
      alert('Error toggling reveal: ' + e.message);
    }
  };

  // Seed 30 Default Songs with MCQ options
  const handleSeedSongs = async () => {
    if (!confirm('Populate 30 iconic horror songs with 4 multiple-choice options? This will update empty rounds.')) return;
    try {
      for (const song of DEFAULT_HORROR_SONGS) {
        await horrorApi.saveSong({
          round_number: song.round_number,
          title: song.title,
          option_a: song.option_a,
          option_b: song.option_b,
          option_c: song.option_c,
          option_d: song.option_d,
          correct_option: song.correct_option,
          correct_answer: song.correct_answer,
          accepted_answers: song.accepted_answers,
          hint: song.hint,
          audio_path: song.audio_path || '',
          synth_motif: song.synth_motif
        });
      }
      await loadAdminData();
      showSuccessBanner('All 30 iconic horror songs & MCQ options successfully seeded!');
    } catch (e) {
      alert('Error seeding songs: ' + e.message);
    }
  };

  // Save single song edit with MCQ validation
  const handleSaveSongEdit = async (e) => {
    e.preventDefault();
    if (!editingRound) return;

    setEditModalError('');

    const optA = (editingRound.option_a || '').trim();
    const optB = (editingRound.option_b || '').trim();
    const optC = (editingRound.option_c || '').trim();
    const optD = (editingRound.option_d || '').trim();
    const correctOpt = (editingRound.correct_option || '').trim().toUpperCase();

    // 1. Require all four options to be filled
    if (!optA || !optB || !optC || !optD) {
      setEditModalError('All four options (Option A, Option B, Option C, and Option D) must be filled.');
      return;
    }

    // 2. Require exactly one correct answer
    if (!['A', 'B', 'C', 'D'].includes(correctOpt)) {
      setEditModalError('Exactly one correct answer option (A, B, C, or D) must be selected.');
      return;
    }

    // 3. Prevent duplicate options within the same question (ignoring capitalization and extra spaces)
    const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const optionsNorm = [norm(optA), norm(optB), norm(optC), norm(optD)];
    const uniqueOptions = new Set(optionsNorm);
    if (uniqueOptions.size < 4) {
      setEditModalError('Duplicate options detected! All four options must be unique (ignoring capitalization and spacing).');
      return;
    }

    try {
      await horrorApi.saveSong({
        ...editingRound,
        option_a: optA,
        option_b: optB,
        option_c: optC,
        option_d: optD,
        correct_option: correctOpt
      });
      setEditingRound(null);
      setEditModalError('');
      await loadAdminData();
      showSuccessBanner(`Round ${editingRound.round_number} options saved.`);
    } catch (e) {
      setEditModalError(e.message || 'Error saving round.');
    }
  };

  // Audio Clip Upload handler
  const handleAudioUpload = async (roundNumber, file) => {
    if (!file) return;
    try {
      setUploadingRound(roundNumber);
      setUploadError('');
      const audioUrl = await horrorApi.uploadAudioClip(file, roundNumber);

      // Find song and update
      const existing = songs.find(s => s.round_number === roundNumber) || { round_number: roundNumber };
      await horrorApi.saveSong({
        ...existing,
        audio_path: audioUrl
      });

      await loadAdminData();
      showSuccessBanner(`Audio clip for Round ${roundNumber} uploaded successfully!`);
    } catch (err) {
      console.error('Audio upload failed:', err);
      setUploadError(err.message || 'Audio upload failed.');
      alert('Audio upload failed: ' + err.message);
    } finally {
      setUploadingRound(null);
    }
  };

  // Reset Game / Lobby
  const handleResetToLobby = async () => {
    const confirmed = window.confirm(
      "⚠️ RESET THE LOBBY?\n\nThis will:\n• Wipe all participants, scores, and round submissions\n• Set all leaderboard statistics back to 0\n• Require every participant to register again\n• Return game status to Waiting Lobby\n\nDo you want to proceed?"
    );
    if (!confirmed) return;

    try {
      await horrorApi.resetGame();
      setParticipants([]);
      setSubmissions([]);
      setGameSettings({
        id: 1,
        game_status: 'waiting',
        current_round: 1,
        total_rounds: 30,
        answers_revealed: false
      });
      await loadAdminData();
      showSuccessBanner('Lobby has been reset! All participant scores wiped and status set to waiting.');
    } catch (e) {
      console.error('Reset lobby failed:', e);
      alert('Reset failed: ' + e.message);
    }
  };

  const handleConfirmReset = async () => {
    if (resetConfirmText.trim().toUpperCase() !== 'RESET') {
      alert('Please type "RESET" to confirm.');
      return;
    }
    try {
      await horrorApi.resetGame();
      setResetModalOpen(false);
      setResetConfirmText('');
      setParticipants([]);
      setSubmissions([]);
      setGameSettings({
        id: 1,
        game_status: 'waiting',
        current_round: 1,
        total_rounds: 30,
        answers_revealed: false
      });
      await loadAdminData();
      showSuccessBanner('Game has been reset. All submissions wiped and status set to waiting.');
    } catch (e) {
      alert('Reset failed: ' + e.message);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (participants.length === 0) {
      alert('No participant data to export.');
      return;
    }

    let csv = 'Rank,Survivor Name,Survivor Code,Total Score,Correct Count,Completed Rounds,Finished Time\n';
    participants.forEach((p, idx) => {
      csv += `"${idx + 1}","${p.name}","${p.participant_code}",${p.total_score},${p.correct_count},${p.completed_rounds},"${p.completion_time || ''}"\n`;
    });

    csv += '\n\nRound,Survivor Name,Submitted Answer,Correct Answer,Is Correct,Points Awarded,Submitted At\n';
    submissions.forEach(s => {
      csv += `${s.round_number},"${s.participant_name || s.participant_id}","${s.submitted_answer}","${s.correct_answer || ''}",${s.is_correct},${s.points_awarded},"${s.submitted_at}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `horror_song_trivia_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Supabase Connection Banner
  const renderSupabaseBanner = () => {
    if (!isSupabaseConfigured) {
      return (
        <div className="mb-6 p-4 rounded-2xl bg-amber-950/70 border border-amber-700 text-amber-100 text-xs leading-relaxed">
          <strong className="font-bold">Local mode active.</strong> Supabase URL and key are not configured in <code className="font-mono text-amber-200">.env</code>.
        </div>
      );
    }

    if (supabaseHealth && !supabaseHealth.tablesReady) {
      const sqlEditorUrl = supabaseHealth.projectId 
        ? `https://supabase.com/dashboard/project/${supabaseHealth.projectId}/sql/new` 
        : 'https://supabase.com/dashboard';

      return (
        <div className="mb-6 p-5 rounded-2xl bg-amber-950/80 border border-amber-500/80 text-amber-100 shadow-xl">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-amber-900/60 border border-amber-600/60 text-amber-300 mt-0.5 shrink-0">
              <Database className="w-5 h-5 animate-pulse" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-amber-200 text-sm tracking-wide flex items-center gap-2">
                  <span>Supabase Connected &bull; Database Schema Needed</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-900 border border-amber-700 font-mono text-amber-300">
                    {supabaseHealth.projectId || 'npjsysfagimulasonbpu'}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={async () => {
                    const fresh = await horrorApi.checkSupabaseHealth();
                    setSupabaseHealth(fresh);
                    if (fresh.tablesReady) {
                      loadAdminData();
                      showSuccessBanner('Database tables detected and verified!');
                    }
                  }}
                  className="text-xs px-2.5 py-1 bg-amber-900/80 hover:bg-amber-800 border border-amber-600 rounded-lg text-amber-200 cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Verify Again</span>
                </button>
              </div>
              
              <p className="text-xs text-amber-200/90 mt-1.5 leading-relaxed">
                Your Supabase project is authenticated, but database tables (games, songs, participants, anti-cheat functions) have not been initialized yet.
              </p>

              <div className="mt-3.5 p-3 rounded-xl bg-black/40 border border-amber-800/60 text-xs font-mono text-amber-100/90 space-y-1.5">
                <p className="font-sans font-semibold text-amber-300">To initialize database in 1 click:</p>
                <p>1. Open your Supabase project's SQL Editor.</p>
                <p>2. Open <code className="text-white font-bold">supabase/schema.sql</code> in this project and copy all lines.</p>
                <p>3. Paste into the SQL Editor and click <strong className="text-emerald-400 font-bold">RUN</strong>.</p>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a
                  href={sqlEditorUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-[0_0_15px_rgba(220,38,38,0.5)] transition-all cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Supabase SQL Editor</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (supabaseHealth && supabaseHealth.tablesReady) {
      return (
        <div className="mb-6 p-3 rounded-2xl bg-emerald-950/60 border border-emerald-700/70 text-emerald-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
            <span className="font-semibold text-emerald-300">Supabase Cloud Connected:</span>
            <span className="font-mono text-zinc-300">{supabaseHealth.projectId || 'npjsysfagimulasonbpu'}.supabase.co</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700 text-emerald-300">
              30 Rounds & Realtime Live
            </span>
          </div>
          <button
            type="button"
            onClick={loadAdminData}
            className="text-[11px] text-emerald-400 hover:text-emerald-200 flex items-center gap-1 cursor-pointer font-medium"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Sync</span>
          </button>
        </div>
      );
    }

    return null;
  };

  // 1. UNPROTECTED LOGIN SCREEN
  if (!session) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#0e0e15]/95 border border-red-900/60 rounded-3xl p-8 shadow-2xl backdrop-blur-xl">
          {renderSupabaseBanner()}
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-red-950/80 border border-red-700/60 flex items-center justify-center text-3xl shadow-[0_0_20px_rgba(220,38,38,0.5)]">
              🛡️
            </div>
            <h2 className="text-2xl font-cinzel font-black text-white uppercase tracking-wider">
              Organizer Portal
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Restricted event management access
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-zinc-300 mb-1.5">
                Admin Email
              </label>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-[#08080c] border border-zinc-800 focus:border-red-600 rounded-xl text-sm text-zinc-100 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-zinc-300 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-[#08080c] border border-zinc-800 focus:border-red-600 rounded-xl text-sm text-zinc-100 outline-none"
              />
            </div>

            {loginError && (
              <div className="p-3 rounded-xl bg-red-950/70 border border-red-800 text-xs text-red-200">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm tracking-wide shadow-[0_0_20px_rgba(220,38,38,0.6)] cursor-pointer transition-all border border-red-500"
            >
              {isLoggingIn ? 'AUTHENTICATING...' : 'ENTER CONTROL ROOM'}
            </button>
          </form>

          <div className="mt-6 p-3 rounded-xl bg-zinc-950 border border-zinc-900 text-xs text-zinc-500">
            <span className="text-red-400 font-semibold block mb-0.5">Instant Organizer Demo:</span>
            <span>Email: <code className="text-zinc-300">admin@horrortrivia.com</code></span><br />
            <span>Pass: <code className="text-zinc-300">bloodcurdling666</code></span>
          </div>
        </div>
      </div>
    );
  }

  // 2. AUTHENTICATED DASHBOARD
  const totalAnswers = submissions.length;
  const totalCorrect = submissions.filter(s => s.is_correct).length;
  const accuracyPct = totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0;
  const roundsWithAudio = songs.filter(s => s.audio_path || s.synth_motif).length;

  return (
    <div className="min-h-[calc(100vh-4rem)] max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {renderSupabaseBanner()}
      
      {/* Success Notification Banner */}
      {actionSuccessMessage && (
        <div className="mb-6 p-4 rounded-2xl bg-emerald-950/80 border border-emerald-700 text-emerald-200 text-xs font-semibold flex items-center justify-between shadow-lg animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{actionSuccessMessage}</span>
          </div>
          <button onClick={() => setActionSuccessMessage('')} className="text-emerald-400 hover:text-white">&times;</button>
        </div>
      )}

      {/* Top Bar: Title & Session Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-950 border border-red-700/60 flex items-center justify-center text-red-500 shadow-[0_0_15px_rgba(220,38,38,0.5)]">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-cinzel font-black text-white uppercase tracking-wider">
                Organizer Control Room
              </h1>
              <p className="text-xs text-zinc-400">
                Logged in as: <span className="text-zinc-200 font-mono">{session.user?.email || session.email}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-between">
          <button
            onClick={loadAdminData}
            className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-semibold flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sync</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-xs font-semibold flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-red-400" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded-xl bg-red-950/70 hover:bg-red-900 text-red-300 border border-red-800/60 text-xs font-semibold flex items-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </div>

      {/* Organizer Master Controls Card */}
      <div className="my-6 p-6 rounded-3xl bg-[#0f0f17]/95 border border-red-950/90 shadow-2xl backdrop-blur-xl">
        <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-400 mb-4">
          LIVE EVENT MASTER CONTROLLER
        </h3>

        <div className="flex flex-wrap items-center justify-between gap-4">
          
          {/* Status buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleStatusChange('active')}
              className={`px-4 py-2 rounded-xl text-xs font-bold tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                gameSettings.game_status === 'active'
                  ? 'bg-red-600 text-white shadow-[0_0_20px_rgba(220,38,38,0.7)]'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white'
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>START / ACTIVATE</span>
            </button>

            <button
              onClick={() => handleStatusChange('paused')}
              className={`px-4 py-2 rounded-xl text-xs font-bold tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                gameSettings.game_status === 'paused'
                  ? 'bg-amber-600 text-white shadow-[0_0_20px_rgba(245,158,11,0.6)]'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white'
              }`}
            >
              <Pause className="w-3.5 h-3.5 fill-current" />
              <span>PAUSE</span>
            </button>

            <button
              onClick={() => handleStatusChange('ended')}
              className={`px-4 py-2 rounded-xl text-xs font-bold tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                gameSettings.game_status === 'ended'
                  ? 'bg-zinc-800 text-white shadow-lg'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white'
              }`}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>END EVENT</span>
            </button>

            <button
              onClick={handleResetToLobby}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                gameSettings.game_status === 'waiting'
                  ? 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                  : 'bg-red-950/40 text-red-400 border border-red-800/60 hover:bg-red-900/80 hover:text-white'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>RESET TO LOBBY</span>
            </button>
          </div>

          {/* Reveal & Reset Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleReveal}
              className={`px-4 py-2 rounded-xl text-xs font-bold tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                gameSettings.answers_revealed
                  ? 'bg-red-950 text-red-300 border border-red-700 shadow-[0_0_15px_rgba(220,38,38,0.4)]'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-red-400" />
              <span>{gameSettings.answers_revealed ? 'ANSWERS REVEALED' : 'REVEAL ANSWERS'}</span>
            </button>

            <button
              onClick={() => setResetModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-red-950/40 hover:bg-red-900/80 text-red-400 hover:text-white border border-red-800/50 text-xs font-bold flex items-center gap-2 cursor-pointer transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>RESET GAME</span>
            </button>
          </div>
        </div>
      </div>

      {/* Admin Summary Metric Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <div className="p-4 rounded-2xl bg-[#12121a] border border-zinc-900">
          <span className="text-xs text-zinc-500 uppercase tracking-wider block">Game Status</span>
          <span className="text-base font-mono font-bold text-red-400 uppercase mt-1 block">
            {gameSettings.game_status}
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-[#12121a] border border-zinc-900">
          <span className="text-xs text-zinc-500 uppercase tracking-wider block">Survivors</span>
          <span className="text-2xl font-mono font-bold text-white mt-1 block">
            {participants.length}
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-[#12121a] border border-zinc-900">
          <span className="text-xs text-zinc-500 uppercase tracking-wider block">Submissions</span>
          <span className="text-2xl font-mono font-bold text-white mt-1 block">
            {totalAnswers}
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-[#12121a] border border-zinc-900">
          <span className="text-xs text-zinc-500 uppercase tracking-wider block">Correct</span>
          <span className="text-2xl font-mono font-bold text-emerald-400 mt-1 block">
            {totalCorrect}
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-[#12121a] border border-zinc-900">
          <span className="text-xs text-zinc-500 uppercase tracking-wider block">Accuracy</span>
          <span className="text-2xl font-mono font-bold text-amber-400 mt-1 block">
            {accuracyPct}%
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-[#12121a] border border-zinc-900">
          <span className="text-xs text-zinc-500 uppercase tracking-wider block">Rounds Ready</span>
          <span className="text-2xl font-mono font-bold text-white mt-1 block">
            {roundsWithAudio}/30
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-3 border-b border-zinc-800 mb-6">
        <button
          onClick={() => setActiveTab('songs')}
          className={`pb-3 text-sm font-semibold tracking-wider uppercase transition-colors cursor-pointer border-b-2 ${
            activeTab === 'songs'
              ? 'border-red-600 text-red-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          30-Round Audio Manager ({songs.length}/30)
        </button>

        <button
          onClick={() => setActiveTab('live')}
          className={`pb-3 text-sm font-semibold tracking-wider uppercase transition-colors cursor-pointer border-b-2 ${
            activeTab === 'live'
              ? 'border-red-600 text-red-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Live Participants ({participants.length})
        </button>

        <button
          onClick={() => setActiveTab('answers')}
          className={`pb-3 text-sm font-semibold tracking-wider uppercase transition-colors cursor-pointer border-b-2 ${
            activeTab === 'answers'
              ? 'border-red-600 text-red-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Submissions Review ({submissions.length})
        </button>
      </div>

      {/* TAB 1: 30-ROUND SONG & AUDIO MANAGER */}
      {activeTab === 'songs' && (
        <div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
            <p className="text-xs text-zinc-400">
              Configure each round's song title, correct answer, accepted variations, and audio clip.
            </p>

            <button
              onClick={handleSeedSongs}
              className="px-4 py-2 rounded-xl bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-800 text-xs font-bold flex items-center gap-2 cursor-pointer shadow-md"
            >
              <Sparkles className="w-3.5 h-3.5 text-red-400" />
              <span>Seed 30 Iconic Horror Songs</span>
            </button>
          </div>

          {/* Songs Table */}
          <div className="bg-[#0e0e15]/95 border border-zinc-900 rounded-3xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-zinc-950 text-zinc-400 text-[11px] font-mono uppercase border-b border-zinc-800">
                    <th className="py-3 px-4">Round</th>
                    <th className="py-3 px-4">Track Title</th>
                    <th className="py-3 px-4">4 Multiple-Choice Options</th>
                    <th className="py-3 px-4 text-center">Correct</th>
                    <th className="py-3 px-4 text-center">Audio Clip</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {songs.map((song) => {
                    const hasAudio = Boolean(song.audio_path);
                    const corrOpt = song.correct_option || 'A';
                    return (
                      <tr key={song.round_number} className="hover:bg-zinc-900/40 transition-colors">
                        <td className="py-3.5 px-4 font-mono font-bold text-red-400">
                          #{song.round_number}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-zinc-200">
                          {song.title || `Round ${song.round_number}`}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-w-lg">
                            {[
                              { k: 'A', text: song.option_a },
                              { k: 'B', text: song.option_b },
                              { k: 'C', text: song.option_c },
                              { k: 'D', text: song.option_d }
                            ].map(item => {
                              const isCorr = corrOpt === item.k;
                              return (
                                <div 
                                  key={item.k} 
                                  className={`text-xs px-2 py-1 rounded-lg border flex items-center gap-1.5 truncate ${
                                    isCorr 
                                      ? 'bg-emerald-950/70 border-emerald-700/80 text-emerald-200 font-semibold' 
                                      : 'bg-zinc-950 border-zinc-900 text-zinc-400'
                                  }`}
                                >
                                  <span className={`w-4 h-4 rounded text-[10px] flex items-center justify-center font-bold font-mono shrink-0 ${
                                    isCorr ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-500'
                                  }`}>
                                    {item.k}
                                  </span>
                                  <span className="truncate">{item.text || `<Empty ${item.k}>`}</span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            Option {corrOpt}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {hasAudio ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                              <CheckCircle2 className="w-3 h-3" />
                              Custom Audio
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-950 text-amber-400 border border-amber-800">
                              Synth Motif
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right space-x-2">
                          {/* Upload audio button */}
                          <label 
                            title="Upload audio clip (MP3, WAV, M4A)"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs cursor-pointer"
                          >
                            <Upload className="w-3 h-3 text-red-400" />
                            <span>{uploadingRound === song.round_number ? '...' : 'Audio'}</span>
                            <input
                              type="file"
                              accept="audio/*,.mp3,.wav,.m4a,.ogg,.mp4"
                              className="hidden"
                              onChange={(e) => {
                                if (e.target.files?.[0]) {
                                  handleAudioUpload(song.round_number, e.target.files[0]);
                                }
                              }}
                            />
                          </label>

                          {/* Edit info button */}
                          <button
                            onClick={() => {
                              setEditingRound(song);
                              setEditModalError('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-950/70 hover:bg-red-900 text-red-300 border border-red-800/60 text-xs cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Configure</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: LIVE PARTICIPANTS */}
      {activeTab === 'live' && (
        <div className="space-y-4">
          {/* Waiting Room Organizer Banner */}
          {gameSettings.game_status === 'waiting' && (
            <div className="p-4 sm:p-5 rounded-3xl bg-red-950/40 border border-red-800/70 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-900 to-black border border-red-600/60 flex items-center justify-center text-2xl shadow-lg shrink-0">
                  ⏳
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-cinzel font-black text-white uppercase tracking-wider">
                      Lobby Waiting Room Open
                    </h3>
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950 text-emerald-400 border border-emerald-700 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                      LIVE SYNC
                    </span>
                  </div>
                  <p className="text-xs text-zinc-300 mt-0.5">
                    <strong className="text-red-400 font-mono text-sm">{participants.length}</strong> survivor{participants.length === 1 ? '' : 's'} are currently registered and waiting for you to start the quiz.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <button
                  onClick={() => loadAdminData()}
                  className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh</span>
                </button>
                <button
                  onClick={() => handleStatusChange('active')}
                  className="flex-1 sm:flex-initial px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-red-900/50 transition-all hover:scale-105"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Start Game Now</span>
                </button>
              </div>
            </div>
          )}

          <div className="bg-[#0e0e15]/95 border border-zinc-900 rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-red-500" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300">
                  Registered Survivors ({participants.length})
                </span>
              </div>
              <span className="text-[11px] font-mono text-zinc-500">Auto-syncing every 4s</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-zinc-950 text-zinc-400 text-[11px] font-mono uppercase border-b border-zinc-800">
                    <th className="py-3 px-4">#</th>
                    <th className="py-3 px-4">Survivor</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Score</th>
                    <th className="py-3 px-4 text-center">Correct</th>
                    <th className="py-3 px-4 text-right">Completion Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {participants.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-zinc-500">
                        <div className="w-12 h-12 mx-auto mb-2 rounded-2xl bg-zinc-900/80 flex items-center justify-center text-xl">
                          👻
                        </div>
                        <p className="text-sm text-zinc-400">No participants registered yet.</p>
                        <p className="text-xs text-zinc-600 mt-1">Direct players to register on your hosted website.</p>
                      </td>
                    </tr>
                  ) : (
                    participants.map((p, idx) => (
                      <tr key={p.id} className="hover:bg-zinc-900/40 transition-colors">
                        <td className="py-3.5 px-4 font-mono font-bold text-red-400">#{idx + 1}</td>
                        <td className="py-3.5 px-4">
                          <span className="font-semibold text-zinc-200 block">{p.name}</span>
                          <span className="text-[11px] font-mono text-zinc-500">{p.participant_code}</span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {gameSettings.game_status === 'waiting' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              READY IN LOBBY
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-zinc-900 text-zinc-300 border border-zinc-800">
                              Round {p.completed_rounds || 0} / 30
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono font-bold text-white">{p.total_score}</td>
                        <td className="py-3.5 px-4 text-center font-mono text-emerald-400">{p.correct_count} / 30</td>
                        <td className="py-3.5 px-4 text-right font-mono text-xs text-zinc-500">
                          {p.completion_time ? new Date(p.completion_time).toLocaleTimeString() : '--:--'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: SUBMISSIONS REVIEW */}
      {activeTab === 'answers' && (
        <div className="bg-[#0e0e15]/95 border border-zinc-900 rounded-3xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-zinc-950 text-zinc-400 text-[11px] font-mono uppercase border-b border-zinc-800">
                  <th className="py-3 px-4">Round</th>
                  <th className="py-3 px-4">Survivor</th>
                  <th className="py-3 px-4">Selected Option</th>
                  <th className="py-3 px-4">Correct Option</th>
                  <th className="py-3 px-4 text-center">Result</th>
                  <th className="py-3 px-4 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {submissions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-zinc-500">
                      No submissions recorded yet.
                    </td>
                  </tr>
                ) : (
                  submissions.map((sub) => {
                    const selOpt = sub.selected_option || '??';
                    const isTimeOut = selOpt === 'EXPIRED' || sub.submitted_answer === '[TIME_EXPIRED]';
                    return (
                      <tr key={sub.id} className="hover:bg-zinc-900/40">
                        <td className="py-3 px-4 font-mono font-bold text-red-400">#{sub.round_number}</td>
                        <td className="py-3 px-4 font-semibold text-zinc-200">
                          {sub.participant_name || sub.participant_id}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono">
                          {isTimeOut ? (
                            <span className="text-red-400 font-bold">[TIME EXPIRED]</span>
                          ) : (
                            <span className="text-zinc-200 font-semibold">
                              <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-red-400 font-bold mr-1.5">
                                Option {selOpt}
                              </span>
                              {sub.submitted_answer}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-zinc-300 font-mono">
                          <span className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-400 font-bold mr-1.5">
                            Option {sub.correct_option || 'A'}
                          </span>
                          {sub.correct_answer || '--'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {sub.is_correct ? (
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                              +10 PTS
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-950 text-red-400 border border-red-800">
                              0 PTS
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-zinc-500">
                          {sub.submitted_at ? new Date(sub.submitted_at).toLocaleTimeString() : '--'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EDIT ROUND MODAL (MCQ CONFIGURATION) */}
      {editingRound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
          <div className="w-full max-w-xl bg-[#0e0e15] border border-red-900/60 rounded-3xl p-6 sm:p-7 shadow-2xl my-8">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800">
              <h3 className="text-lg font-cinzel font-bold text-white uppercase flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-red-950 border border-red-700 text-red-400 font-mono text-xs flex items-center justify-center font-bold">
                  #{editingRound.round_number}
                </span>
                <span>Configure Round #{editingRound.round_number} Options</span>
              </h3>
              <button 
                onClick={() => { setEditingRound(null); setEditModalError(''); }}
                className="text-zinc-400 hover:text-white text-lg p-1"
              >
                &times;
              </button>
            </div>

            {editModalError && (
              <div className="mb-4 p-3 rounded-xl bg-red-950/80 border border-red-700 text-red-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{editModalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveSongEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1">Song / Track Title</label>
                <input
                  type="text"
                  value={editingRound.title || ''}
                  onChange={(e) => setEditingRound({ ...editingRound, title: e.target.value })}
                  placeholder="e.g. Thriller - Michael Jackson"
                  required
                  className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 focus:border-red-600 rounded-xl text-sm text-zinc-100 outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-300">
                    Four Answer Options (A, B, C, D)
                  </label>
                  <span className="text-[11px] text-zinc-400 font-mono">
                    Select radio for correct answer
                  </span>
                </div>

                <div className="space-y-2.5">
                  {[
                    { key: 'A', field: 'option_a' },
                    { key: 'B', field: 'option_b' },
                    { key: 'C', field: 'option_c' },
                    { key: 'D', field: 'option_d' }
                  ].map(({ key, field }) => {
                    const isCorrect = (editingRound.correct_option || 'A') === key;
                    return (
                      <div 
                        key={key} 
                        className={`p-2.5 rounded-xl border flex items-center gap-3 transition-all ${
                          isCorrect 
                            ? 'bg-red-950/30 border-red-600 ring-1 ring-red-600/50' 
                            : 'bg-zinc-950/80 border-zinc-800'
                        }`}
                      >
                        {/* Radio selector for correct answer */}
                        <label className="flex items-center gap-2 cursor-pointer shrink-0 pl-1">
                          <input
                            type="radio"
                            name="correct_option_choice"
                            checked={isCorrect}
                            onChange={() => setEditingRound({ ...editingRound, correct_option: key })}
                            className="w-4 h-4 text-red-600 accent-red-600 cursor-pointer"
                          />
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center font-cinzel text-xs font-bold ${
                            isCorrect 
                              ? 'bg-red-600 text-white shadow-[0_0_8px_rgba(220,38,38,0.8)]' 
                              : 'bg-zinc-900 border border-zinc-700 text-zinc-400'
                          }`}>
                            {key}
                          </span>
                        </label>

                        {/* Text input for option */}
                        <input
                          type="text"
                          value={editingRound[field] || ''}
                          onChange={(e) => setEditingRound({ ...editingRound, [field]: e.target.value })}
                          placeholder={`Option ${key} text...`}
                          required
                          className="flex-1 px-3 py-1.5 bg-zinc-900/80 border border-zinc-800 focus:border-red-600 rounded-lg text-sm text-zinc-100 outline-none"
                        />

                        {isCorrect && (
                          <span className="text-[10px] font-mono font-bold uppercase text-emerald-400 bg-emerald-950/80 px-2 py-1 rounded border border-emerald-800 shrink-0">
                            CORRECT ANSWER
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1">
                  Cryptic Hint (Optional)
                </label>
                <input
                  type="text"
                  value={editingRound.hint || ''}
                  onChange={(e) => setEditingRound({ ...editingRound, hint: e.target.value })}
                  placeholder="e.g. Vincent Price's laughter echoes through the night..."
                  className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 focus:border-red-600 rounded-xl text-sm text-zinc-100 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => { setEditingRound(null); setEditModalError(''); }}
                  className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-[0_0_15px_rgba(220,38,38,0.6)] cursor-pointer"
                >
                  Save Round Options
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET GAME CONFIRMATION MODAL */}
      {resetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="w-full max-w-md bg-[#0e0e15] border border-red-800 rounded-3xl p-6 text-center shadow-2xl">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-red-950 border border-red-700 flex items-center justify-center text-red-500 text-2xl">
              ⚠️
            </div>
            <h3 className="text-xl font-cinzel font-bold text-white mb-2 uppercase">
              Confirm Game Reset
            </h3>
            <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
              This will completely wipe all registered participants and submitted answers, and return the game to the lobby waiting state.
            </p>
            <p className="text-xs text-red-400 font-mono mb-2">
              Type &ldquo;RESET&rdquo; to confirm:
            </p>
            <input
              type="text"
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder="RESET"
              className="w-full text-center px-4 py-2.5 bg-zinc-950 border border-red-900 rounded-xl text-sm text-white font-mono uppercase mb-4 outline-none"
            />
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => {
                  setResetModalOpen(false);
                  setResetConfirmText('');
                }}
                className="px-4 py-2 rounded-xl bg-zinc-900 text-zinc-400 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReset}
                disabled={resetConfirmText.trim().toUpperCase() !== 'RESET'}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-bold shadow-[0_0_20px_rgba(220,38,38,0.6)] cursor-pointer"
              >
                WIPE & RESET
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
