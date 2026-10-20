import React from 'react';
import { Skull, X, CheckCircle2, AlertOctagon } from 'lucide-react';

export default function RulesModal({ isOpen, onClose, gameSettings }) {
  if (!isOpen) return null;

  const totalRounds = Number(gameSettings?.total_rounds) || 30;
  const maxScore = totalRounds * 10;

  const rules = [
    { num: 1, title: "Survivor Registration", desc: "Register using your real or survivor name before starting the challenge." },
    { num: 2, title: "Single Playback Only", desc: "Listen carefully to each 3-second song clip. Clips play ONCE without replays." },
    { num: 3, title: "Strict 10-Second Timer", desc: "A 10-second answer countdown begins automatically after audio ends. Submissions after time expires award 0 points." },
    { num: 4, title: "Time-Based Points (10s to 1pt)", desc: "Skribbl-style scoring: answer in 10s for 10 points, 9s for 9 points, down to 1s for 1 point. Wrong answers award 0 points." },
    { num: 5, title: "Zero Penalty", desc: "Wrong answers earn 0 points. There is no negative marking." },
    { num: 6, title: `${totalRounds} Chilling Rounds`, desc: `There are exactly ${totalRounds} rounds of horror themes, movie scores, and dark anthems in this event.` },
    { num: 7, title: `${maxScore} Points Maximum`, desc: `A perfect fast survival run awards the maximum possible score of ${maxScore} points.` },
    { num: 8, title: "Live Leaderboard Rankings", desc: "Final rankings are sorted by total score, then correct answers, then earliest completion time." },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-[#0e0e15] border border-red-900/60 rounded-2xl p-6 sm:p-8 shadow-[0_0_50px_rgba(220,38,38,0.3)] max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-950/80 border border-red-700/60 flex items-center justify-center text-red-500 shadow-[0_0_15px_rgba(220,38,38,0.5)]">
              <Skull className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-cinzel font-black tracking-wider text-red-500 uppercase">
                Survival Rules
              </h2>
              <p className="text-xs text-zinc-400">
                Official rules of the Horror Song Trivia event
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Rules Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 my-6">
          {rules.map((rule) => (
            <div 
              key={rule.num}
              className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-900 hover:border-red-900/40 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="w-6 h-6 rounded-md bg-red-950 text-red-400 border border-red-800/50 flex items-center justify-center text-xs font-bold font-mono">
                  {rule.num}
                </span>
                <h4 className="text-sm font-semibold text-zinc-200">{rule.title}</h4>
              </div>
              <p className="text-xs text-zinc-400 pl-8 leading-relaxed">
                {rule.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Footer Warning & Button */}
        <div className="pt-4 border-t border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-amber-500/90">
            <AlertOctagon className="w-4 h-4 shrink-0" />
            <span>Once submitted, answers cannot be edited.</span>
          </div>

          <button
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm tracking-wide shadow-[0_0_20px_rgba(220,38,38,0.5)] transition-all cursor-pointer"
          >
            UNDERSTOOD & ENTER
          </button>
        </div>
      </div>
    </div>
  );
}
