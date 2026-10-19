import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Ghost } from 'lucide-react';
import { horrorSoundEngine } from '../services/soundGenerator';

export default function Atmosphere() {
  const [isAmbientOn, setIsAmbientOn] = useState(false);

  const toggleSound = () => {
    const active = horrorSoundEngine.toggleAmbientDrone();
    setIsAmbientOn(active);
  };

  return (
    <>
      {/* Fog & Vignette Overlays */}
      <div className="fog-overlay" aria-hidden="true" />
      <div className="vignette-effect" aria-hidden="true" />
      <div className="grain-overlay" aria-hidden="true" />

      {/* Creepy Red Horizon Ambient Glow */}
      <div 
        className="fixed top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-red-600/10 blur-[130px] rounded-full pointer-events-none z-0" 
        aria-hidden="true" 
      />

      {/* Floating Eerie Ambient Audio Switch in bottom-right */}
      <div className="fixed bottom-5 right-5 z-40 flex items-center gap-2">
        <button
          onClick={toggleSound}
          title={isAmbientOn ? "Mute haunted house ambient drone" : "Enable haunted house ambient drone"}
          className={`flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium tracking-wide transition-all border backdrop-blur-md cursor-pointer ${
            isAmbientOn 
              ? 'bg-red-950/80 text-red-200 border-red-600 shadow-[0_0_15px_rgba(220,38,38,0.5)]' 
              : 'bg-zinc-900/80 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-700'
          }`}
        >
          {isAmbientOn ? (
            <>
              <Volume2 className="w-4 h-4 text-red-400 animate-pulse" />
              <span className="hidden sm:inline">Ambience: Active</span>
            </>
          ) : (
            <>
              <VolumeX className="w-4 h-4 text-zinc-500" />
              <span className="hidden sm:inline">Ambience: Muted</span>
            </>
          )}
        </button>
      </div>
    </>
  );
}
