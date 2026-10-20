import React, { useState, useEffect } from 'react';
import { Trophy, Medal, Skull, Search, RefreshCw, Sparkles, Clock, CheckCircle2, User } from 'lucide-react';
import { horrorApi } from '../services/supabase';

export default function LeaderboardPage({ currentParticipant, gameSettings: propGameSettings }) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [gameSettings, setGameSettings] = useState(propGameSettings || { game_status: 'waiting', answers_revealed: false, total_rounds: 30 });

  useEffect(() => {
    if (propGameSettings) {
      setGameSettings(propGameSettings);
    }
  }, [propGameSettings]);

  const totalQuestions = Number(gameSettings?.total_rounds) || 30;

  const debounceTimerRef = React.useRef(null);

  const fetchStandings = async (showSpinner = false, forceRefresh = false) => {
    try {
      if (showSpinner) setIsRefreshing(true);
      const [boardData, settingsData] = await Promise.all([
        horrorApi.getLeaderboard(forceRefresh),
        horrorApi.getGameSettings(forceRefresh)
      ]);
      setLeaderboard(boardData || []);
      setGameSettings(settingsData || {});
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    fetchStandings(false, true);

    // Debounced refresh helper for high-frequency events
    const triggerDebouncedFetch = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        if (isMounted) fetchStandings(false, true);
      }, 800);
    };

    // 1. Supabase Realtime Subscriptions
    const unsubLeaderboard = horrorApi.subscribeToLeaderboard(() => {
      triggerDebouncedFetch();
    });

    const unsubSettings = horrorApi.subscribeToGameSettings((newSettings) => {
      if (newSettings && isMounted) setGameSettings(newSettings);
    });

    // 2. Custom local events
    const handleSubmission = () => {
      triggerDebouncedFetch();
    };
    window.addEventListener('horror_submission_made', handleSubmission);
    window.addEventListener('horror_game_reset', handleSubmission);

    // 3. Fallback poll with random jitter (12s to 18s) to avoid synchronicity spikes
    let pollTimerId = null;
    const scheduleNextPoll = () => {
      if (!isMounted) return;
      const jitter = 12000 + Math.floor(Math.random() * 6000);
      pollTimerId = setTimeout(() => {
        if (isMounted) {
          fetchStandings(false);
          scheduleNextPoll();
        }
      }, jitter);
    };
    scheduleNextPoll();

    return () => {
      isMounted = false;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (pollTimerId) clearTimeout(pollTimerId);
      if (unsubLeaderboard) unsubLeaderboard();
      if (unsubSettings) unsubSettings();
      window.removeEventListener('horror_submission_made', handleSubmission);
      window.removeEventListener('horror_game_reset', handleSubmission);
    };
  }, []);

  const filteredLeaderboard = leaderboard.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.participant_code && p.participant_code.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const topThree = leaderboard.slice(0, 3);
  const isFinal = gameSettings.game_status === 'ended';

  const formatCompletionTime = (isoString) => {
    if (!isoString) return '--:--';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '--:--';
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      
      {/* Header Banner */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-semibold bg-red-950/80 text-red-400 border border-red-800/70 mb-3 shadow-[0_0_15px_rgba(220,38,38,0.3)]">
          <Trophy className="w-4 h-4 text-amber-400" />
          <span>{isFinal ? 'EVENT CONCLUDED • FINAL RANKINGS' : 'LIVE EVENT STANDINGS'}</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-black font-cinzel tracking-wider text-white uppercase drop-shadow-[0_2px_10px_rgba(220,38,38,0.5)]">
          HALL OF SURVIVORS
        </h1>
        <p className="text-xs sm:text-sm text-zinc-400 font-typewriter mt-1">
          Sorted by total points, correct answers, and survival speed
        </p>
      </div>

      {/* Top 3 Prominent Podium */}
      {topThree.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12 items-end max-w-4xl mx-auto">
          
          {/* #2 Silver (Placed on left in desktop) */}
          {topThree[1] ? (
            <div className="order-2 md:order-1 bg-[#12121c]/90 border border-zinc-700/60 rounded-3xl p-6 text-center relative overflow-hidden backdrop-blur-md shadow-lg">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-zinc-800/80 border border-zinc-600 flex items-center justify-center text-xl font-black font-mono text-zinc-200">
                2
              </div>
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">RUNNER UP</span>
              <h3 className="text-lg font-bold text-white mt-1 truncate">{topThree[1].name}</h3>
              <p className="text-[11px] font-mono text-zinc-500 mb-3">{topThree[1].participant_code}</p>
              
              <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-around text-xs">
                <div>
                  <span className="text-zinc-500 block text-[10px]">SCORE</span>
                  <span className="font-mono font-bold text-white text-base">{topThree[1].total_score} pts</span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[10px]">CORRECT</span>
                  <span className="font-mono font-bold text-emerald-400 text-base">{topThree[1].correct_count}/{totalQuestions}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="order-2 md:order-1 h-44 rounded-3xl border border-dashed border-zinc-900 flex items-center justify-center text-xs text-zinc-600">
              Awaiting 2nd Survivor
            </div>
          )}

          {/* #1 Champion / Gold (Center, elevated) */}
          {topThree[0] ? (
            <div className="order-1 md:order-2 bg-gradient-to-b from-red-950/60 via-[#161219]/90 to-[#0e0e15] border-2 border-red-600/80 rounded-3xl p-7 text-center relative overflow-hidden backdrop-blur-md shadow-[0_0_40px_rgba(220,38,38,0.4)] md:-translate-y-4">
              <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-red-600 to-amber-600 text-white flex items-center justify-center text-2xl font-black font-mono shadow-[0_0_20px_rgba(220,38,38,0.7)]">
                👑
              </div>
              <span className="text-xs font-black uppercase tracking-widest text-amber-400">SUPREME SURVIVOR</span>
              <h3 className="text-xl sm:text-2xl font-extrabold text-white mt-1 truncate">{topThree[0].name}</h3>
              <p className="text-xs font-mono text-red-400 mb-4">{topThree[0].participant_code}</p>

              <div className="pt-4 border-t border-red-950 flex items-center justify-around text-xs">
                <div>
                  <span className="text-red-300 block text-[10px]">TOTAL SCORE</span>
                  <span className="font-mono font-black text-white text-xl">{topThree[0].total_score} PTS</span>
                </div>
                <div>
                  <span className="text-red-300 block text-[10px]">ACCURACY</span>
                  <span className="font-mono font-black text-emerald-400 text-xl">{topThree[0].correct_count} / {totalQuestions}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="order-1 md:order-2 h-52 rounded-3xl border border-dashed border-zinc-900 flex items-center justify-center text-xs text-zinc-600">
              Awaiting 1st Survivor
            </div>
          )}

          {/* #3 Bronze (Right) */}
          {topThree[2] ? (
            <div className="order-3 bg-[#12121c]/90 border border-amber-900/50 rounded-3xl p-6 text-center relative overflow-hidden backdrop-blur-md shadow-lg">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-amber-950/60 border border-amber-800/60 flex items-center justify-center text-xl font-black font-mono text-amber-500">
                3
              </div>
              <span className="text-xs font-bold uppercase tracking-widest text-amber-600">3RD PLACE</span>
              <h3 className="text-lg font-bold text-white mt-1 truncate">{topThree[2].name}</h3>
              <p className="text-[11px] font-mono text-zinc-500 mb-3">{topThree[2].participant_code}</p>

              <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-around text-xs">
                <div>
                  <span className="text-zinc-500 block text-[10px]">SCORE</span>
                  <span className="font-mono font-bold text-white text-base">{topThree[2].total_score} pts</span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[10px]">CORRECT</span>
                  <span className="font-mono font-bold text-emerald-400 text-base">{topThree[2].correct_count}/{totalQuestions}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="order-3 h-44 rounded-3xl border border-dashed border-zinc-900 flex items-center justify-center text-xs text-zinc-600">
              Awaiting 3rd Survivor
            </div>
          )}
        </div>
      )}

      {/* Search & Refresh Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search survivor or code..."
            className="w-full pl-10 pr-4 py-2 bg-zinc-950 border border-zinc-800 focus:border-red-600 rounded-xl text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-all"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-between">
          <span className="text-xs text-zinc-500 font-mono">
            Total Survivors: <span className="text-zinc-200 font-bold">{leaderboard.length}</span>
          </span>

          <button
            onClick={() => fetchStandings(true)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-semibold cursor-pointer transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-red-500' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Main Leaderboard Table */}
      <div className="bg-[#0e0e15]/95 border border-red-950/70 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800/80 bg-zinc-950/70 text-zinc-400 text-[11px] font-mono uppercase tracking-wider">
                <th className="py-4 px-4 sm:px-6">Rank</th>
                <th className="py-4 px-4">Survivor</th>
                <th className="py-4 px-4 text-center">Score (/{totalQuestions * 10})</th>
                <th className="py-4 px-4 text-center">Correct</th>
                <th className="py-4 px-4 text-center hidden sm:table-cell">Rounds</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 text-sm">
              {filteredLeaderboard.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-zinc-500 font-typewriter">
                    {loading ? 'Consulting the dark archives...' : 'No survivors registered yet. Be the first to enter the arena!'}
                  </td>
                </tr>
              ) : (
                filteredLeaderboard.map((survivor) => {
                  const isCurrent = currentParticipant?.id === survivor.id;
                  let rankColor = "text-zinc-400";
                  if (survivor.rank === 1) rankColor = "text-amber-400 font-black";
                  if (survivor.rank === 2) rankColor = "text-zinc-200 font-bold";
                  if (survivor.rank === 3) rankColor = "text-amber-600 font-bold";

                  return (
                    <tr
                      key={survivor.id}
                      className={`transition-colors ${
                        isCurrent
                          ? 'bg-red-950/40 border-l-4 border-l-red-600'
                          : 'hover:bg-zinc-900/50'
                      }`}
                    >
                      {/* Rank */}
                      <td className="py-4 px-4 sm:px-6 font-mono font-bold">
                        <span className={`text-sm sm:text-base ${rankColor}`}>
                          #{survivor.rank}
                        </span>
                      </td>

                      {/* Name & ID */}
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                            isCurrent ? 'bg-red-600 text-white' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                          }`}>
                            <User className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-semibold text-zinc-100 flex items-center gap-2">
                              <span>{survivor.name}</span>
                              {isCurrent && (
                                <span className="text-[10px] bg-red-600 text-white px-1.5 py-0.2 rounded font-mono font-bold">
                                  YOU
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] font-mono text-zinc-500">
                              {survivor.participant_code}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Total Score */}
                      <td className="py-4 px-4 text-center">
                        <span className="font-mono font-black text-red-400 text-base sm:text-lg">
                          {survivor.total_score}
                        </span>
                      </td>

                      {/* Correct Answers */}
                      <td className="py-4 px-4 text-center">
                        <span className="font-mono text-xs font-semibold text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-md border border-emerald-900/60">
                          {survivor.correct_count} / {totalQuestions}
                        </span>
                      </td>

                      {/* Completed Rounds */}
                      <td className="py-4 px-4 text-center hidden sm:table-cell">
                        <span className="font-mono text-xs text-zinc-400">
                          {survivor.completed_rounds || 0} / {totalQuestions}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
