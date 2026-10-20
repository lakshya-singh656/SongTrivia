import React from 'react';
import { AlertCircle, RotateCcw, Home } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    try {
      localStorage.removeItem('horror_participant_session');
    } catch (e) {}
    window.location.href = window.location.origin;
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#07070a] text-zinc-100 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#0e0e15] border border-red-900/80 rounded-3xl p-8 text-center shadow-[0_0_50px_rgba(220,38,38,0.3)]">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-950 border border-red-700/60 flex items-center justify-center text-red-500 shadow-[0_0_20px_rgba(220,38,38,0.5)]">
              <AlertCircle className="w-8 h-8" />
            </div>

            <h2 className="text-2xl font-cinzel font-black text-white uppercase tracking-wider mb-2">
              The Ritual Encountered an Error
            </h2>
            <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
              A temporary glitch interrupted the arena. You can safely reload the page to restore your round.
            </p>

            {this.state.error && (
              <div className="p-3 rounded-xl bg-black/60 border border-red-950 text-left mb-6 font-mono text-xs text-red-400/90 overflow-x-auto max-h-32">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={this.handleReload}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs tracking-wider transition-all shadow-[0_0_20px_rgba(220,38,38,0.6)] cursor-pointer flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>RELOAD ARENA</span>
              </button>
              <button
                onClick={this.handleReset}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-semibold text-xs tracking-wider border border-zinc-800 cursor-pointer flex items-center justify-center gap-2"
              >
                <Home className="w-4 h-4" />
                <span>RETURN HOME</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
