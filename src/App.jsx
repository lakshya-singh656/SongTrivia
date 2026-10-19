import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Atmosphere from './components/Atmosphere';
import RulesModal from './components/RulesModal';
import LandingPage from './pages/LandingPage';
import RegisterPage from './pages/RegisterPage';
import GamePage from './pages/GamePage';
import LeaderboardPage from './pages/LeaderboardPage';
import AdminDashboard from './pages/AdminDashboard';
import { horrorApi } from './services/supabase';

export default function App() {
  // Determine initial view based on URL path or hash
  const getInitialView = () => {
    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();

    if (path.includes('/admin') || hash === '#admin') return 'admin';
    if (path.includes('/leaderboard') || hash === '#leaderboard') return 'leaderboard';
    if (path.includes('/play') || path.includes('/game') || hash === '#game') return 'game';
    return 'landing';
  };

  const [currentView, setCurrentView] = useState(getInitialView());
  const [participant, setParticipant] = useState(null);
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [gameSettings, setGameSettings] = useState({
    game_status: 'waiting',
    current_round: 1,
    answers_revealed: false
  });

  // Load participant session and game settings on initial mount
  useEffect(() => {
    // 1. Participant session from localStorage
    try {
      const stored = localStorage.getItem('horror_participant_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        setParticipant(parsed);
      }
    } catch (e) {
      console.warn('Could not parse participant session:', e);
    }

    // 2. Initial game settings
    async function loadSettings() {
      try {
        const settings = await horrorApi.getGameSettings();
        if (settings) {
          setGameSettings(settings);
        }
      } catch (e) {
        console.warn('Could not load game settings:', e);
      }
    }
    loadSettings();

    // 3. Listen for popstate / hashchange to sync view
    const handleLocationChange = () => {
      setCurrentView(getInitialView());
    };
    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);

    // 4. Listen for settings updates and reset
    const handleSettingsUpdate = (e) => {
      if (e.detail) setGameSettings(e.detail);
    };
    window.addEventListener('horror_settings_updated', handleSettingsUpdate);

    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
      window.removeEventListener('horror_settings_updated', handleSettingsUpdate);
    };
  }, []);

  // Sync browser URL / hash when currentView changes
  const handleSetCurrentView = (viewId) => {
    setCurrentView(viewId);
    if (viewId === 'admin') {
      window.history.pushState(null, '', '#admin');
    } else if (viewId === 'leaderboard') {
      window.history.pushState(null, '', '#leaderboard');
    } else if (viewId === 'game') {
      window.history.pushState(null, '', '#game');
    } else {
      window.history.pushState(null, '', '#home');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleParticipantRegistered = (newParticipant) => {
    setParticipant(newParticipant);
    handleSetCurrentView('game');
  };

  return (
    <div className="relative min-h-screen bg-[#07070a] text-zinc-100 flex flex-col font-sans selection:bg-red-900 selection:text-white">
      {/* Horror Visual Atmosphere & Haunted Audio Ambiance */}
      <Atmosphere />

      {/* Main Header / Navigation */}
      <Navbar
        currentView={currentView}
        setCurrentView={handleSetCurrentView}
        participant={participant}
        onOpenRules={() => setIsRulesOpen(true)}
        gameStatus={gameSettings.game_status}
      />

      {/* Main View Container */}
      <main className="flex-1 relative z-10">
        {currentView === 'landing' && (
          <LandingPage
            onEnterGame={() => {
              if (participant) {
                handleSetCurrentView('game');
              } else {
                handleSetCurrentView('register');
              }
            }}
            onOpenLeaderboard={() => handleSetCurrentView('leaderboard')}
            onOpenRules={() => setIsRulesOpen(true)}
            participant={participant}
          />
        )}

        {currentView === 'register' && (
          <RegisterPage
            onRegistered={handleParticipantRegistered}
          />
        )}

        {currentView === 'game' && (
          <GamePage
            participant={participant}
            onNeedRegister={() => handleSetCurrentView('register')}
            onGoToLeaderboard={() => handleSetCurrentView('leaderboard')}
          />
        )}

        {currentView === 'leaderboard' && (
          <LeaderboardPage
            currentParticipant={participant}
          />
        )}

        {currentView === 'admin' && (
          <AdminDashboard />
        )}
      </main>

      {/* Official Rules Modal */}
      <RulesModal
        isOpen={isRulesOpen}
        onClose={() => setIsRulesOpen(false)}
      />
    </div>
  );
}
