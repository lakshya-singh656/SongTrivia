import React, { useState } from 'react';
import { Skull, User, ArrowRight, ShieldCheck, AlertCircle, Sparkles } from 'lucide-react';
import { horrorApi } from '../services/supabase';

export default function RegisterPage({ onRegistered }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || cleanName.length < 2) {
      setError('Please provide a survivor name with at least 2 characters.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      const participant = await horrorApi.registerParticipant(cleanName);
      
      // Save participant to session/local storage
      localStorage.setItem('horror_participant_session', JSON.stringify(participant));
      
      if (onRegistered) {
        onRegistered(participant);
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError(err.message || 'Failed to register survivor. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#0e0e15]/95 border border-red-900/60 rounded-3xl p-5 sm:p-8 shadow-[0_0_50px_rgba(220,38,38,0.3)] backdrop-blur-xl relative overflow-hidden">
        
        {/* Glow ambient accent */}
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-red-600/20 rounded-full blur-2xl pointer-events-none" />

        {/* Icon Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-red-950 to-black border border-red-600/70 flex items-center justify-center text-3xl shadow-[0_0_25px_rgba(220,38,38,0.5)]">
            🩸
          </div>
          <h2 className="text-2xl sm:text-3xl font-cinzel font-black tracking-wider text-white uppercase">
            Survivor Registration
          </h2>
          <p className="text-xs text-zinc-400 mt-2 font-typewriter">
            Enter your name to step into the 30-round arena
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-zinc-300 mb-2">
              Full Name or Call-Sign <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                <User className="w-4 h-4 text-zinc-500" />
              </div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Laurie Strode or Jack Torrance"
                maxLength={40}
                autoFocus
                disabled={isSubmitting}
                className="w-full pl-10 pr-4 py-3 bg-[#08080c] border border-zinc-800 focus:border-red-600 focus:ring-1 focus:ring-red-600 rounded-xl text-zinc-100 placeholder-zinc-600 text-sm transition-all outline-none"
              />
            </div>
            <p className="text-[11px] text-zinc-500 mt-1.5">
              This name will be displayed on the live survivor leaderboard.
            </p>
          </div>

          {/* Automatic ID info */}
          <div className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-900 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0" />
            <div className="text-xs">
              <p className="text-zinc-300 font-medium">Automatic Survivor ID</p>
              <p className="text-zinc-500 text-[11px]">
                A unique cryptographically generated Survivor Code will be assigned.
              </p>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-xs text-red-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !name.trim()}
            className="w-full py-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(220,38,38,0.6)] hover:shadow-[0_0_30px_rgba(239,68,68,0.8)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border border-red-500"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                REGISTERING SURVIVOR...
              </span>
            ) : (
              <>
                <span>ENTER THE ARENA</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <p className="text-center text-[11px] text-zinc-500 mt-6">
          No password required. Your session is securely stored in this browser.
        </p>
      </div>
    </div>
  );
}
