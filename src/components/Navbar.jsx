import React, { useState, useEffect } from 'react';
import { Skull, Trophy, Play, ShieldAlert, Menu, X, User, Lock } from 'lucide-react';
import { horrorApi } from '../services/supabase';

export default function Navbar({ 
  currentView, 
  setCurrentView, 
  participant, 
  gameStatus = 'waiting' 
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isOrganizerLoggedIn, setIsOrganizerLoggedIn] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const sess = await horrorApi.getAdminSession();
        setIsOrganizerLoggedIn(!!sess);
      } catch (e) {}
    }
    checkAuth();

    const handleAuthChange = (e) => {
      setIsOrganizerLoggedIn(!!e.detail);
    };
    window.addEventListener('horror_admin_auth_changed', handleAuthChange);
    return () => {
      window.removeEventListener('horror_admin_auth_changed', handleAuthChange);
    };
  }, []);

  const getStatusBadge = () => {
    switch (gameStatus) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono tracking-wider bg-red-950/90 text-red-400 border border-red-700/80 shadow-[0_0_10px_rgba(220,38,38,0.5)] whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
            LIVE EVENT
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono tracking-wider bg-amber-950/90 text-amber-400 border border-amber-700/80 whitespace-nowrap">
            PAUSED
          </span>
        );
      case 'ended':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono tracking-wider bg-zinc-900 text-zinc-400 border border-zinc-700 whitespace-nowrap">
            CONCLUDED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono tracking-wider bg-zinc-900/90 text-zinc-400 border border-zinc-800 whitespace-nowrap">
            LOBBY OPEN
          </span>
        );
    }
  };

  const navItems = [
    { id: 'landing', label: 'Home', icon: Skull },
    { id: 'game', label: 'Trivia Arena', icon: Play },
    { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
    { id: 'admin', label: 'Organizer Portal', icon: ShieldAlert },
  ];

  const handleNav = (viewId) => {
    setCurrentView(viewId);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-[#08080c]/95 border-b border-red-950/70 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        
        {/* Left: Brand Logo & Title (Strictly 1 line, no wrapping) */}
        <div 
          onClick={() => handleNav('landing')} 
          className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group shrink-0"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-red-900 to-black border border-red-600/60 flex items-center justify-center text-lg sm:text-xl shadow-[0_0_15px_rgba(220,38,38,0.4)] group-hover:shadow-[0_0_22px_rgba(220,38,38,0.8)] transition-all shrink-0">
            🩸
          </div>
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-2">
              <span className="text-[clamp(0.65rem,3.2vw,1.125rem)] font-cinzel font-black tracking-[0.04em] sm:tracking-wider text-zinc-100 group-hover:text-red-400 transition-colors whitespace-nowrap leading-none">
                HORROR SONG TRIVIA
              </span>
              <div className="hidden xl:inline-flex">
                {getStatusBadge()}
              </div>
            </div>
            <p className="text-[9px] sm:text-[10px] tracking-wider font-mono text-red-500/80 hidden sm:block whitespace-nowrap mt-1 leading-none">
              RECOGNIZE THE TUNE. SURVIVE THE NIGHT.
            </p>
          </div>
        </div>

        {/* Center: Desktop Navigation (Single Line, No Wrap) */}
        <nav className="hidden md:flex items-center gap-1 lg:gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs lg:text-sm font-semibold tracking-wide whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-red-950/90 text-red-400 border border-red-800/80 shadow-[0_0_15px_rgba(220,38,38,0.35)]'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/60'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-red-500' : 'text-zinc-500'}`} />
                <span>{item.label}</span>
                {item.id === 'admin' && (
                  isOrganizerLoggedIn ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981] animate-pulse" title="Organizer Authenticated" />
                  ) : (
                    <Lock className="w-3 h-3 text-zinc-500 opacity-60" title="Login Required" />
                  )
                )}
              </button>
            );
          })}
        </nav>

        {/* Right: Participant Status or Register Button */}
        <div className="hidden md:flex items-center gap-3 shrink-0">
          {participant ? (
            <div 
              onClick={() => handleNav('game')}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-zinc-900/90 border border-red-950 hover:border-red-800 text-xs cursor-pointer transition-colors shadow-sm"
            >
              <div className="w-5 h-5 rounded-full bg-red-950 text-red-400 flex items-center justify-center font-bold text-[10px] shrink-0 border border-red-800/60">
                <User className="w-3 h-3" />
              </div>
              <div className="flex flex-col text-left leading-tight">
                <span className="font-semibold text-zinc-200 max-w-[120px] truncate">{participant.name}</span>
                <span className="text-[10px] text-red-400 font-mono font-bold">{participant.total_score || 0} pts</span>
              </div>
            </div>
          ) : (
            <button
              onClick={() => handleNav('register')}
              className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-black tracking-widest uppercase shadow-[0_0_18px_rgba(220,38,38,0.6)] hover:shadow-[0_0_25px_rgba(239,68,68,0.8)] transition-all cursor-pointer border border-red-500 whitespace-nowrap"
            >
              REGISTER
            </button>
          )}
        </div>

        {/* Mobile: Hamburger Button */}
        <div className="flex items-center gap-2 md:hidden">
          {getStatusBadge()}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 cursor-pointer"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-zinc-900 bg-[#0c0c12]/98 backdrop-blur-2xl px-4 py-4 space-y-2 animate-in fade-in duration-150">
          {participant ? (
            <div className="p-3 mb-3 rounded-xl bg-zinc-950 border border-red-900/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-red-500" />
                <span className="font-semibold text-sm text-zinc-200">{participant.name}</span>
              </div>
              <span className="text-xs font-mono font-bold text-red-400 bg-red-950/80 px-2.5 py-0.5 rounded border border-red-800">
                {participant.total_score || 0} PTS
              </span>
            </div>
          ) : (
            <button
              onClick={() => handleNav('register')}
              className="w-full py-2.5 mb-2 rounded-xl bg-red-600 text-white text-xs font-bold tracking-wider uppercase text-center shadow-[0_0_15px_rgba(220,38,38,0.5)]"
            >
              REGISTER TO PLAY
            </button>
          )}

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                  isActive
                    ? 'bg-red-950/90 text-red-400 border border-red-800/80'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5 text-red-500" />
                  <span>{item.label}</span>
                </div>
                {item.id === 'admin' && (
                  isOrganizerLoggedIn ? (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-400 font-mono font-bold">
                      AUTHENTICATED
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-500 font-mono flex items-center gap-1">
                      <Lock className="w-2.5 h-2.5" />
                      LOCKED
                    </span>
                  )
                )}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}
