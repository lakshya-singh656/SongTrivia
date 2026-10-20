import React from 'react';
import { Skull, Trophy, Play, Music, Flame, Shield, ArrowRight, Sparkles, Volume2 } from 'lucide-react';

export default function LandingPage({ onEnterGame, onOpenLeaderboard, onOpenRules, participant, gameSettings }) {
  const totalRounds = Number(gameSettings?.total_rounds) || 30;
  const maxScore = totalRounds * 10;

  const rulesList = [
    { num: 1, text: "Register your survivor name before playing." },
    { num: 2, text: "Each 5–10s audio clip plays ONLY ONCE. No replays permitted." },
    { num: 3, text: "Strict 10-second timer begins right after audio ends. Submit before 0s." },
    { num: 4, text: "Every correct answer earns 10 points." },
    { num: 5, text: "Wrong answers or expired timers earn 0 points." },
    { num: 6, text: `There are ${totalRounds} chilling horror song rounds.` },
    { num: 7, text: `Maximum possible score: ${maxScore} points.` },
    { num: 8, text: "Final rankings are based on highest total score." },
  ];

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex flex-col justify-between py-12 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
      
      {/* Hero Section */}
      <div className="text-center pt-6 sm:pt-12 pb-12 relative z-10">
        
        {/* Sinister Subtitle / Tag */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-950/70 border border-red-800/80 text-red-400 text-xs sm:text-sm font-semibold tracking-widest uppercase mb-6 shadow-[0_0_20px_rgba(220,38,38,0.35)] animate-flicker">
          <Flame className="w-4 h-4 text-red-500 animate-pulse" />
          <span>The Ultimate Halloween Audio Challenge</span>
        </div>

        {/* Title */}
        <h1 className="text-[clamp(1.7rem,8vw,3.75rem)] md:text-7xl lg:text-8xl font-black font-cinzel tracking-[0.04em] sm:tracking-wider text-transparent bg-clip-text bg-gradient-to-b from-white via-red-200 to-red-600 blood-glow my-3 uppercase drop-shadow-[0_5px_15px_rgba(0,0,0,0.9)]">
          HORROR SONG TRIVIA
        </h1>

        {/* Subtitle */}
        <p className="text-lg sm:text-2xl font-typewriter text-zinc-300 tracking-wide max-w-2xl mx-auto mt-2 mb-8">
          &ldquo;Recognize the tune. Survive the night.&rdquo;
        </p>

        {/* Description */}
        <p className="text-sm sm:text-base text-zinc-400 max-w-2xl mx-auto leading-relaxed mb-10">
          Step into the shadows for {totalRounds} spine-chilling audio rounds. From iconic slasher themes 
          and demonic chimes to 80s synth nightmares and gothic anthems—test your ears, type your answer, 
          and claim your spot on the survivor leaderboard.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto mb-16">
          <button
            onClick={onEnterGame}
            className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-base tracking-wider flex items-center justify-center gap-3 transition-all duration-300 shadow-[0_0_25px_rgba(220,38,38,0.7)] hover:shadow-[0_0_40px_rgba(239,68,68,0.9)] hover:scale-105 cursor-pointer border border-red-500"
          >
            <Play className="w-5 h-5 fill-current" />
            <span>{participant ? 'CONTINUE CHALLENGE' : 'ENTER THE GAME'}</span>
            <ArrowRight className="w-5 h-5" />
          </button>

          <button
            onClick={onOpenLeaderboard}
            className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-[#14141d]/90 hover:bg-zinc-800 text-zinc-200 hover:text-white font-bold text-base tracking-wider flex items-center justify-center gap-2.5 transition-all duration-300 border border-zinc-800 hover:border-red-900 shadow-lg cursor-pointer"
          >
            <Trophy className="w-5 h-5 text-amber-500" />
            <span>LEADERBOARD</span>
          </button>
        </div>

        {/* Atmospheric Metric Badges */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto mb-16">
          <div className="p-4 rounded-2xl bg-[#12121a]/80 border border-red-950/60 backdrop-blur-sm">
            <span className="text-2xl sm:text-3xl font-black font-mono text-red-500">{totalRounds}</span>
            <h4 className="text-xs uppercase tracking-wider text-zinc-400 mt-1">Horror Rounds</h4>
          </div>
          <div className="p-4 rounded-2xl bg-[#12121a]/80 border border-red-950/60 backdrop-blur-sm">
            <span className="text-2xl sm:text-3xl font-black font-mono text-red-500">{maxScore}</span>
            <h4 className="text-xs uppercase tracking-wider text-zinc-400 mt-1">Max Points</h4>
          </div>
          <div className="p-4 rounded-2xl bg-[#12121a]/80 border border-red-950/60 backdrop-blur-sm">
            <span className="text-2xl sm:text-3xl font-black font-mono text-red-500">5s</span>
            <h4 className="text-xs uppercase tracking-wider text-zinc-400 mt-1">Song Clips</h4>
          </div>
          <div className="p-4 rounded-2xl bg-[#12121a]/80 border border-red-950/60 backdrop-blur-sm">
            <span className="text-2xl sm:text-3xl font-black font-mono text-red-500">LIVE</span>
            <h4 className="text-xs uppercase tracking-wider text-zinc-400 mt-1">Server Scoring</h4>
          </div>
        </div>
      </div>

      {/* Rules Section */}
      <div className="relative z-10 bg-[#0d0d14]/90 border border-red-950/80 rounded-3xl p-6 sm:p-10 shadow-[0_0_40px_rgba(0,0,0,0.8)] backdrop-blur-md mb-12">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-6 border-b border-zinc-800/80 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-950 border border-red-700/60 flex items-center justify-center text-red-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-cinzel font-bold text-white uppercase tracking-wider">
                Event Survival Rules
              </h2>
              <p className="text-xs text-zinc-400">Read carefully before stepping into the arena</p>
            </div>
          </div>
          
          <button
            onClick={onOpenRules}
            className="text-xs font-semibold text-red-400 hover:text-red-300 underline underline-offset-4 cursor-pointer"
          >
            View Full Rulebook &rarr;
          </button>
        </div>

        {/* 8 Rules Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6">
          {rulesList.map((rule) => (
            <div 
              key={rule.num} 
              className="flex items-start gap-3 p-3 rounded-xl bg-zinc-950/50 border border-zinc-900 hover:border-red-950 transition-colors"
            >
              <span className="w-7 h-7 shrink-0 rounded-lg bg-red-950/80 text-red-400 border border-red-800/50 flex items-center justify-center text-xs font-bold font-mono">
                {rule.num}
              </span>
              <p className="text-xs sm:text-sm text-zinc-300 leading-snug pt-0.5">
                {rule.text}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 text-center py-6 border-t border-zinc-900 text-xs text-zinc-500 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span>🩸 Horror Song Trivia &copy; 2026</span>
          <span>&bull;</span>
          <span>Live Interactive Event</span>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={onOpenRules} className="hover:text-zinc-300 cursor-pointer">Rules</button>
          <button onClick={onOpenLeaderboard} className="hover:text-zinc-300 cursor-pointer">Standings</button>
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="hover:text-zinc-300 cursor-pointer">Top &uarr;</button>
        </div>
      </footer>
    </div>
  );
}
