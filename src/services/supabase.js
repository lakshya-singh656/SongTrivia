import { createClient } from '@supabase/supabase-js';
import { DEFAULT_HORROR_SONGS } from '../data/defaultSongs';
import { checkAnswerMatch, computePoints } from './scoring';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://your-project-id.supabase.co' &&
  !supabaseUrl.includes('your-project')
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// ==========================================================
// LOCAL HORROR ENGINE (MOCK / OFFLINE FALLBACK)
// ==========================================================

const STORAGE_KEYS = {
  SETTINGS: 'horror_trivia_settings_v1',
  SONGS: 'horror_trivia_songs_v1',
  PARTICIPANTS: 'horror_trivia_participants_v1',
  ROUND_SESSIONS: 'horror_trivia_round_sessions_v1',
  SUBMISSIONS: 'horror_trivia_submissions_v1',
  ADMIN_SESSION: 'horror_trivia_admin_session_v1',
};


// Initial state helpers
function getLocalItem(key, defaultValue) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : defaultValue;
  } catch (e) {
    console.error('Error reading localStorage for key', key, e);
    return defaultValue;
  }
}

function setLocalItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Error writing localStorage for key', key, e);
  }
}

// Seed local storage with default 30 horror songs and settings
export function initializeLocalStorageIfNeeded() {
  const existingSongs = getLocalItem(STORAGE_KEYS.SONGS, null);
  const needsMigration = !existingSongs || existingSongs.length === 0 || !existingSongs[0].option_a;
  if (needsMigration) {
    const formatted = DEFAULT_HORROR_SONGS.map((song, idx) => ({
      id: `song-${idx + 1}`,
      round_number: song.round_number,
      title: song.title,
      artist: song.artist,
      audio_path: song.audio_path || '',
      duration_seconds: song.duration_seconds || 8.0,
      option_a: song.option_a,
      option_b: song.option_b,
      option_c: song.option_c,
      option_d: song.option_d,
      correct_option: song.correct_option || 'A',
      correct_answer: song.correct_answer,
      accepted_answers: song.accepted_answers,
      hint: song.hint,
      synth_motif: song.synth_motif,
      created_at: new Date().toISOString()
    }));
    setLocalItem(STORAGE_KEYS.SONGS, formatted);
  }

  const existingSettings = getLocalItem(STORAGE_KEYS.SETTINGS, null);
  if (!existingSettings) {
    setLocalItem(STORAGE_KEYS.SETTINGS, {
      id: 1,
      game_status: 'waiting', // 'waiting' | 'active' | 'paused' | 'ended'
      current_round: 1,
      total_rounds: 30,
      answers_revealed: false,
      updated_at: new Date().toISOString()
    });
  }

  const existingParticipants = getLocalItem(STORAGE_KEYS.PARTICIPANTS, null);
  if (!existingParticipants) {
    setLocalItem(STORAGE_KEYS.PARTICIPANTS, []);
  }

  const existingSubmissions = getLocalItem(STORAGE_KEYS.SUBMISSIONS, null);
  if (!existingSubmissions) {
    setLocalItem(STORAGE_KEYS.SUBMISSIONS, []);
  }

  const existingSessions = getLocalItem(STORAGE_KEYS.ROUND_SESSIONS, null);
  if (!existingSessions) {
    setLocalItem(STORAGE_KEYS.ROUND_SESSIONS, []);
  }
}


initializeLocalStorageIfNeeded();

// ==========================================================
// UNIFIED DATA SERVICE APIS
// ==========================================================

export const horrorApi = {
  // 0. HEALTH & CONNECTION DIAGNOSTICS
  async checkSupabaseHealth() {
    if (!isSupabaseConfigured) {
      return {
        configured: false,
        connected: false,
        tablesReady: false,
        url: null,
        projectId: null,
        message: 'Supabase credentials are not configured in .env'
      };
    }

    const projectId = supabaseUrl?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || null;

    try {
      const { data, error } = await supabase.from('game_settings').select('id').limit(1);
      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
          return {
            configured: true,
            connected: true,
            tablesReady: false,
            url: supabaseUrl,
            projectId,
            message: 'Connected to Supabase project, but database tables are not initialized yet.'
          };
        }
        return {
          configured: true,
          connected: false,
          tablesReady: false,
          url: supabaseUrl,
          projectId,
          message: error.message || 'Could not query Supabase database.'
        };
      }
      return {
        configured: true,
        connected: true,
        tablesReady: true,
        url: supabaseUrl,
        projectId,
        message: 'Supabase connected and database tables verified!'
      };
    } catch (err) {
      return {
        configured: true,
        connected: false,
        tablesReady: false,
        url: supabaseUrl,
        projectId,
        message: err.message || 'Connection check failed.'
      };
    }
  },

  // 1. GAME SETTINGS
  async getGameSettings() {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('game_settings')
          .select('*')
          .eq('id', 1)
          .single();
        if (error) throw error;
        if (data) {
          setLocalItem(STORAGE_KEYS.SETTINGS, data);
        }
        return data;
      } catch (err) {
        console.warn('Supabase getGameSettings failed, falling back to local:', err);
      }
    }
    return getLocalItem(STORAGE_KEYS.SETTINGS, {
      id: 1,
      game_status: 'waiting',
      current_round: 1,
      total_rounds: 30,
      answers_revealed: false
    });
  },

  async updateGameSettings(updates) {
    let updated = null;
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('game_settings')
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq('id', 1)
          .select()
          .single();
        if (!error && data) {
          updated = data;
        } else {
          // If RLS blocked direct update, try RPC function
          const { data: rpcData, error: rpcError } = await supabase.rpc('admin_update_game_settings', {
            p_status: updates.game_status || null,
            p_current_round: updates.current_round || null,
            p_answers_revealed: typeof updates.answers_revealed === 'boolean' ? updates.answers_revealed : null
          });
          if (!rpcError && rpcData) {
            updated = rpcData;
          }
        }
      } catch (err) {
        console.warn('Supabase updateGameSettings failed, syncing locally:', err);
      }
    }

    const current = getLocalItem(STORAGE_KEYS.SETTINGS, {});
    const finalSettings = {
      ...current,
      ...(updated || updates),
      updated_at: new Date().toISOString()
    };
    setLocalItem(STORAGE_KEYS.SETTINGS, finalSettings);
    window.dispatchEvent(new CustomEvent('horror_settings_updated', { detail: finalSettings }));
    return finalSettings;
  },

  // 2. SONGS
  async getPlayableSongs() {
    // Participants fetch: returns songs with 4 options, strictly withholding correct_option unless answers_revealed is true!
    const settings = await this.getGameSettings();
    const answersRevealed = Boolean(settings?.answers_revealed);

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.rpc('get_playable_songs');
        if (!error && Array.isArray(data) && data.length > 0) {
          return data;
        }
        if (error) {
          console.warn('Supabase get_playable_songs rpc failed, falling back to direct table query:', error);
        }
      } catch (e) {
        console.warn('Supabase get_playable_songs rpc failed:', e);
      }

      // Direct Supabase table fallback if RPC fails (guarantees genuine database UUIDs are used)
      try {
        const { data: songsTableData, error: tableError } = await supabase
          .from('songs')
          .select('*')
          .order('round_number', { ascending: true });

        if (!tableError && Array.isArray(songsTableData) && songsTableData.length > 0) {
          return songsTableData.map(song => ({
            id: song.id,
            round_number: song.round_number,
            title: song.title,
            artist: song.artist,
            audio_path: song.audio_path,
            duration_seconds: song.duration_seconds || 8.0,
            hint: song.hint,
            synth_motif: song.synth_motif,
            option_a: song.option_a || '',
            option_b: song.option_b || '',
            option_c: song.option_c || '',
            option_d: song.option_d || '',
            correct_option: answersRevealed ? song.correct_option : null,
            correct_answer: answersRevealed ? (song.correct_answer || song[`option_${(song.correct_option || 'A').toLowerCase()}`]) : null,
            accepted_answers: answersRevealed ? song.accepted_answers : null
          }));
        }
      } catch (tableErr) {
        console.warn('Direct songs table query failed:', tableErr);
      }
    }

    // Local engine logic
    const allSongs = getLocalItem(STORAGE_KEYS.SONGS, []);
    return allSongs.map(song => ({
      id: song.id,
      round_number: song.round_number,
      title: song.title,
      artist: song.artist,
      audio_path: song.audio_path,
      duration_seconds: song.duration_seconds || 8.0,
      hint: song.hint,
      synth_motif: song.synth_motif,
      option_a: song.option_a || '',
      option_b: song.option_b || '',
      option_c: song.option_c || '',
      option_d: song.option_d || '',
      // Strictly protect correct option and answers before reveal
      correct_option: answersRevealed ? song.correct_option : null,
      correct_answer: answersRevealed ? (song.correct_answer || song[`option_${(song.correct_option || 'A').toLowerCase()}`]) : null,
      accepted_answers: answersRevealed ? song.accepted_answers : null
    }));
  },

  async getAllAdminSongs() {
    // Admin only: returns all songs with 4 options, correct answer, and metadata
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('songs')
          .select('*')
          .order('round_number', { ascending: true });
        if (!error && data && data.length > 0) {
          return data;
        }
      } catch (e) {
        console.warn('Supabase getAllAdminSongs failed:', e);
      }
    }
    return getLocalItem(STORAGE_KEYS.SONGS, []);
  },

  async saveSong(songData) {
    const optionA = (songData.option_a || '').trim();
    const optionB = (songData.option_b || '').trim();
    const optionC = (songData.option_c || '').trim();
    const optionD = (songData.option_d || '').trim();
    const correctOpt = (songData.correct_option || '').trim().toUpperCase();

    if (!optionA || !optionB || !optionC || !optionD) {
      throw new Error('All four options (Option A, B, C, and D) must be provided.');
    }

    if (!['A', 'B', 'C', 'D'].includes(correctOpt)) {
      throw new Error('Exactly one correct answer option (A, B, C, or D) must be selected.');
    }

    // Check for duplicate options (ignoring capitalization and extra spaces)
    const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const optionsNorm = [norm(optionA), norm(optionB), norm(optionC), norm(optionD)];
    const uniqueOptions = new Set(optionsNorm);
    if (uniqueOptions.size < 4) {
      throw new Error('Options cannot contain duplicates within the same round (case and spacing ignored).');
    }

    // Map correct option letter to answer text
    const optionMap = { A: optionA, B: optionB, C: optionC, D: optionD };
    const canonicalAnswer = optionMap[correctOpt] || optionA;

    const payload = {
      id: songData.id || undefined,
      round_number: songData.round_number,
      title: songData.title || `Round ${songData.round_number}`,
      audio_path: songData.audio_path || '',
      duration_seconds: Number(songData.duration_seconds) || 8.0,
      option_a: optionA,
      option_b: optionB,
      option_c: optionC,
      option_d: optionD,
      correct_option: correctOpt,
      correct_answer: canonicalAnswer,
      accepted_answers: [canonicalAnswer],
      hint: songData.hint || '',
      synth_motif: songData.synth_motif
    };

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('songs')
          .upsert(payload)
          .select()
          .single();
        if (!error && data) {
          const songs = getLocalItem(STORAGE_KEYS.SONGS, []);
          const index = songs.findIndex(s => s.round_number === songData.round_number);
          if (index >= 0) songs[index] = { ...songs[index], ...data };
          else songs.push(data);
          setLocalItem(STORAGE_KEYS.SONGS, songs);
          return data;
        }

        // Fallback to admin RPC function if direct upsert blocked by RLS
        const { data: rpcData, error: rpcError } = await supabase.rpc('admin_save_song', {
          p_round_number: payload.round_number,
          p_title: payload.title,
          p_audio_path: payload.audio_path,
          p_duration_seconds: payload.duration_seconds,
          p_option_a: payload.option_a,
          p_option_b: payload.option_b,
          p_option_c: payload.option_c,
          p_option_d: payload.option_d,
          p_correct_option: payload.correct_option,
          p_correct_answer: payload.correct_answer,
          p_hint: payload.hint,
          p_synth_motif: payload.synth_motif
        });

        if (!rpcError && rpcData) {
          const songs = getLocalItem(STORAGE_KEYS.SONGS, []);
          const index = songs.findIndex(s => s.round_number === songData.round_number);
          if (index >= 0) songs[index] = { ...songs[index], ...rpcData };
          else songs.push(rpcData);
          setLocalItem(STORAGE_KEYS.SONGS, songs);
          return rpcData;
        }

        if (error) throw error;
      } catch (e) {
        console.warn('Supabase saveSong failed, updating local storage:', e);
      }
    }

    const songs = getLocalItem(STORAGE_KEYS.SONGS, []);
    const index = songs.findIndex(s => s.round_number === songData.round_number || s.id === songData.id);

    const updatedSong = {
      ...payload,
      id: songData.id || `song-${songData.round_number}`
    };

    if (index >= 0) {
      songs[index] = { ...songs[index], ...updatedSong };
    } else {
      songs.push(updatedSong);
    }
    songs.sort((a, b) => a.round_number - b.round_number);
    setLocalItem(STORAGE_KEYS.SONGS, songs);
    return updatedSong;
  },

  // 3. PARTICIPANTS
  async registerParticipant(name) {
    const cleanName = (name || '').trim();
    if (!cleanName || cleanName.length < 2) {
      throw new Error('Please enter a valid survivor name (at least 2 characters).');
    }

    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const participantCode = `SURVIVOR-${randomSuffix}`;

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('participants')
          .insert({
            name: cleanName,
            participant_code: participantCode,
            total_score: 0,
            correct_count: 0,
            completed_rounds: 0
          })
          .select()
          .single();
        if (error) throw error;
        return data;
      } catch (err) {
        console.warn('Supabase registerParticipant failed, falling back to local:', err);
      }
    }

    const participants = getLocalItem(STORAGE_KEYS.PARTICIPANTS, []);
    const newParticipant = {
      id: `part-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      participant_code: participantCode,
      name: cleanName,
      total_score: 0,
      correct_count: 0,
      completed_rounds: 0,
      completion_time: null,
      created_at: new Date().toISOString()
    };

    participants.push(newParticipant);
    setLocalItem(STORAGE_KEYS.PARTICIPANTS, participants);
    return newParticipant;
  },

  async getParticipant(participantId) {
    if (!participantId) return null;
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('participants')
          .select('*')
          .eq('id', participantId)
          .single();
        if (!error && data) return data;
      } catch (e) {
        console.warn('Supabase getParticipant error:', e);
      }
    }

    const participants = getLocalItem(STORAGE_KEYS.PARTICIPANTS, []);
    return participants.find(p => p.id === participantId) || null;
  },

  // 4. ROUND SESSIONS & STRICT ANTI-CHEATING CONTROLS
  async startRoundPlayback(participantId, songId, durationSeconds = 8.0) {
    if (!participantId || !songId) {
      throw new Error('Participant ID and Song ID are required.');
    }

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.rpc('start_round_playback', {
          p_participant_id: participantId,
          p_song_id: songId,
          p_audio_duration: durationSeconds
        });
        if (error) throw error;
        if (data) {
          if (data.success === false) {
            throw new Error(data.error || 'Playback request rejected');
          }
          return data;
        }
      } catch (err) {
        // If Supabase returned a business rule error or validation error, re-throw it!
        if (err.message && (
          err.message.includes('Playback is only allowed') ||
          err.message.includes('Audio playback already initiated') ||
          err.message.includes('Song not found')
        )) {
          throw err;
        }
        console.warn('Supabase start_round_playback failed, using local engine:', err);
      }
    }

    // Local Horror Engine single playback enforcement
    const settings = getLocalItem(STORAGE_KEYS.SETTINGS, { game_status: 'active' });
    if (settings.game_status !== 'active') {
      throw new Error(`The event is currently ${settings.game_status}. Playback is only allowed during active rounds.`);
    }

    const songs = getLocalItem(STORAGE_KEYS.SONGS, []);
    const song = songs.find(s => s.id === songId);
    if (!song) throw new Error('Song round not found.');

    const sessions = getLocalItem(STORAGE_KEYS.ROUND_SESSIONS, []);
    let session = sessions.find(s => s.participant_id === participantId && s.song_id === songId);

    const now = new Date();
    const duration = Math.min(30, Math.max(3, Number(durationSeconds) || 8.0));
    const deadline = new Date(now.getTime() + (duration * 1000) + 10000);

    if (session) {
      if (session.state !== 'ready') {
        throw new Error('Audio playback already initiated for this round. Replaying is strictly prohibited.');
      }
      session.state = 'audio_playing';
      session.audio_duration_seconds = duration;
      session.playback_started_at = now.toISOString();
      session.answer_deadline = deadline.toISOString();
    } else {
      session = {
        id: `sess-${Date.now()}`,
        participant_id: participantId,
        song_id: songId,
        round_number: song.round_number,
        state: 'audio_playing',
        audio_duration_seconds: duration,
        playback_started_at: now.toISOString(),
        answer_deadline: deadline.toISOString(),
        created_at: now.toISOString()
      };
      sessions.push(session);
    }

    setLocalItem(STORAGE_KEYS.ROUND_SESSIONS, sessions);

    return {
      success: true,
      state: 'audio_playing',
      playback_started_at: session.playback_started_at,
      audio_duration_seconds: duration,
      answer_deadline: session.answer_deadline,
      server_now: now.toISOString()
    };
  },

  async completeAudioAndStartAnswering(participantId, songId) {
    if (!participantId || !songId) {
      throw new Error('Participant ID and Song ID are required.');
    }

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.rpc('complete_audio_and_start_answering', {
          p_participant_id: participantId,
          p_song_id: songId
        });
        if (error) throw error;
        return data;
      } catch (err) {
        console.warn('Supabase complete_audio_and_start_answering failed, using local:', err);
      }
    }

    const sessions = getLocalItem(STORAGE_KEYS.ROUND_SESSIONS, []);
    const session = sessions.find(s => s.participant_id === participantId && s.song_id === songId);
    const now = new Date();

    if (!session) {
      throw new Error('No active round session found.');
    }

    if (session.state === 'submitted' || session.state === 'time_expired') {
      return { success: true, state: session.state, server_now: now.toISOString() };
    }

    if (session.state === 'answering') {
      return {
        success: true,
        state: 'answering',
        answer_deadline: session.answer_deadline,
        server_now: now.toISOString()
      };
    }

    // Set deadline to at most 10.5 seconds from now
    const proposedDeadline = new Date(now.getTime() + 10500);
    const existingDeadline = session.answer_deadline ? new Date(session.answer_deadline) : proposedDeadline;
    const finalDeadline = existingDeadline < proposedDeadline ? existingDeadline : proposedDeadline;

    session.state = 'answering';
    session.playback_completed_at = now.toISOString();
    session.answer_deadline = finalDeadline.toISOString();

    setLocalItem(STORAGE_KEYS.ROUND_SESSIONS, sessions);

    return {
      success: true,
      state: 'answering',
      answer_deadline: session.answer_deadline,
      server_now: now.toISOString()
    };
  },

  async getRoundState(participantId, songId) {
    if (!participantId || !songId) {
      return { state: 'ready', can_play: true, server_now: new Date().toISOString() };
    }

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.rpc('get_round_state', {
          p_participant_id: participantId,
          p_song_id: songId
        });
        if (!error && data) return data;
      } catch (err) {
        console.warn('Supabase get_round_state failed, using local engine:', err);
      }
    }

    const now = new Date();
    const submissions = getLocalItem(STORAGE_KEYS.SUBMISSIONS, []);
    const sub = submissions.find(s => s.participant_id === participantId && s.song_id === songId);

    if (sub) {
      return {
        state: 'submitted',
        can_play: false,
        is_correct: sub.is_correct,
        points_awarded: sub.points_awarded,
        selected_option: sub.selected_option,
        submitted_answer: sub.submitted_answer,
        server_now: now.toISOString()
      };
    }

    const sessions = getLocalItem(STORAGE_KEYS.ROUND_SESSIONS, []);
    const session = sessions.find(s => s.participant_id === participantId && s.song_id === songId);

    if (!session) {
      return {
        state: 'ready',
        can_play: true,
        server_now: now.toISOString()
      };
    }

    // Check if audio has finished playing based on elapsed time
    const startedAt = new Date(session.playback_started_at || 0).getTime();
    const audioDurationMs = (session.audio_duration_seconds || 8.0) * 1000;

    if (session.state === 'audio_playing' && now.getTime() >= startedAt + audioDurationMs) {
      session.state = 'answering';
      session.playback_completed_at = new Date(startedAt + audioDurationMs).toISOString();
      setLocalItem(STORAGE_KEYS.ROUND_SESSIONS, sessions);
    }

    // Check if answer deadline expired
    let isExpired = false;
    let remainingSec = 0;

    if (session.answer_deadline) {
      const deadlineMs = new Date(session.answer_deadline).getTime();
      remainingSec = Math.max(0, Math.ceil((deadlineMs - now.getTime()) / 1000));

      if (now.getTime() > deadlineMs + 1000) {
        isExpired = true;
        if (session.state !== 'time_expired') {
          session.state = 'time_expired';
          setLocalItem(STORAGE_KEYS.ROUND_SESSIONS, sessions);

          // Record 0-pt submission for timeout
          if (!submissions.some(s => s.participant_id === participantId && s.song_id === songId)) {
            submissions.push({
              id: `sub-${Date.now()}`,
              participant_id: participantId,
              song_id: songId,
              round_number: session.round_number,
              selected_option: 'EXPIRED',
              submitted_answer: '[TIME_EXPIRED]',
              is_correct: false,
              points_awarded: 0,
              submitted_at: now.toISOString()
            });
            setLocalItem(STORAGE_KEYS.SUBMISSIONS, submissions);
          }
        }
      }
    }

    return {
      state: session.state,
      can_play: session.state === 'ready',
      audio_duration_seconds: session.audio_duration_seconds,
      playback_started_at: session.playback_started_at,
      answer_deadline: session.answer_deadline,
      server_now: now.toISOString(),
      is_expired: isExpired,
      remaining_answer_seconds: remainingSec
    };
  },

  // 5. SUBMIT ANSWER (SERVER-SIDE / MOCK RPC WITH DEADLINE VERIFICATION)
  async submitAnswer(participantId, songId, selectedOption) {
    if (!participantId || !songId) {
      throw new Error('Participant ID and Song ID are required.');
    }

    // Supabase RPC execution
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.rpc('submit_song_answer', {
          p_participant_id: participantId,
          p_song_id: songId,
          p_selected_option: selectedOption
        });

        if (error) throw error;
        if (data) {
          if (data.success === false) {
            throw new Error(data.error || 'Submission failed');
          }
          return data;
        }
      } catch (err) {
        if (err.message && (
          err.message.includes('Answers can only be submitted') ||
          err.message.includes('already submitted') ||
          err.message.includes('Invalid option')
        )) {
          throw err;
        }
        console.warn('Supabase submit_song_answer failed, executing local fallback:', err);
      }
    }

    // Local Horror Engine MCQ Answer Checking
    const settings = getLocalItem(STORAGE_KEYS.SETTINGS, { game_status: 'active' });
    if (settings.game_status !== 'active') {
      throw new Error(`The event is currently ${settings.game_status}. Answers can only be submitted during active rounds.`);
    }

    const songs = getLocalItem(STORAGE_KEYS.SONGS, []);
    const song = songs.find(s => s.id === songId);
    if (!song) {
      throw new Error('Song round not found.');
    }

    const submissions = getLocalItem(STORAGE_KEYS.SUBMISSIONS, []);
    const alreadyAnswered = submissions.some(
      sub => sub.participant_id === participantId && (sub.song_id === songId || sub.round_number === song.round_number)
    );

    if (alreadyAnswered) {
      throw new Error('You have already submitted an answer for this round.');
    }

    // Verify session deadline
    const sessions = getLocalItem(STORAGE_KEYS.ROUND_SESSIONS, []);
    const session = sessions.find(s => s.participant_id === participantId && s.song_id === songId);
    let isExpired = false;

    if (session && session.answer_deadline) {
      const deadlineMs = new Date(session.answer_deadline).getTime();
      // 1.5s grace for network transit
      if (Date.now() > deadlineMs + 1500) {
        isExpired = true;
      }
    }

    const cleanOption = (selectedOption || '').trim().toUpperCase();

    if (isExpired || cleanOption === '[TIME_EXPIRED]' || cleanOption === 'EXPIRED') {
      if (session) {
        session.state = 'time_expired';
        session.submitted_at = new Date().toISOString();
        setLocalItem(STORAGE_KEYS.ROUND_SESSIONS, sessions);
      }

      const expiredSubmission = {
        id: `sub-${Date.now()}`,
        participant_id: participantId,
        song_id: songId,
        round_number: song.round_number,
        selected_option: 'EXPIRED',
        submitted_answer: '[TIME_EXPIRED]',
        is_correct: false,
        points_awarded: 0,
        submitted_at: new Date().toISOString()
      };

      submissions.push(expiredSubmission);
      setLocalItem(STORAGE_KEYS.SUBMISSIONS, submissions);

      const participants = getLocalItem(STORAGE_KEYS.PARTICIPANTS, []);
      const pIndex = participants.findIndex(p => p.id === participantId);
      let totalScore = 0;
      let correctCount = 0;
      let completedRounds = 1;

      if (pIndex >= 0) {
        const pSubs = submissions.filter(s => s.participant_id === participantId);
        totalScore = pSubs.reduce((acc, s) => acc + (s.points_awarded || 0), 0);
        correctCount = pSubs.filter(s => s.is_correct).length;
        completedRounds = pSubs.length;

        participants[pIndex].total_score = totalScore;
        participants[pIndex].correct_count = correctCount;
        participants[pIndex].completed_rounds = completedRounds;
        if (completedRounds >= 30 && !participants[pIndex].completion_time) {
          participants[pIndex].completion_time = new Date().toISOString();
        }
        setLocalItem(STORAGE_KEYS.PARTICIPANTS, participants);
      }

      return {
        success: true,
        round_number: song.round_number,
        selected_option: 'EXPIRED',
        is_correct: false,
        is_expired: true,
        points_awarded: 0,
        total_score: totalScore,
        correct_count: correctCount,
        completed_rounds: completedRounds
      };
    }

    // Validate MCQ Selection (A, B, C, or D)
    if (!['A', 'B', 'C', 'D'].includes(cleanOption)) {
      throw new Error('Please select a valid option: Option A, B, C, or D.');
    }

    // Compare with stored correct option
    const correctOption = (song.correct_option || 'A').toUpperCase();
    const isCorrect = cleanOption === correctOption;
    const pointsAwarded = isCorrect ? 10 : 0;

    const optionMap = {
      A: song.option_a,
      B: song.option_b,
      C: song.option_c,
      D: song.option_d
    };
    const optionText = optionMap[cleanOption] || cleanOption;

    if (session) {
      session.state = 'submitted';
      session.submitted_at = new Date().toISOString();
      setLocalItem(STORAGE_KEYS.ROUND_SESSIONS, sessions);
    }

    const newSubmission = {
      id: `sub-${Date.now()}`,
      participant_id: participantId,
      song_id: songId,
      round_number: song.round_number,
      selected_option: cleanOption,
      submitted_answer: optionText,
      is_correct: isCorrect,
      points_awarded: pointsAwarded,
      submitted_at: new Date().toISOString()
    };

    submissions.push(newSubmission);
    setLocalItem(STORAGE_KEYS.SUBMISSIONS, submissions);

    // Recalculate participant score
    const participants = getLocalItem(STORAGE_KEYS.PARTICIPANTS, []);
    const pIndex = participants.findIndex(p => p.id === participantId);

    let totalScore = pointsAwarded;
    let correctCount = isCorrect ? 1 : 0;
    let completedRounds = 1;

    if (pIndex >= 0) {
      const pSubs = submissions.filter(s => s.participant_id === participantId);
      totalScore = pSubs.reduce((acc, s) => acc + (s.points_awarded || 0), 0);
      correctCount = pSubs.filter(s => s.is_correct).length;
      completedRounds = pSubs.length;

      participants[pIndex].total_score = totalScore;
      participants[pIndex].correct_count = correctCount;
      participants[pIndex].completed_rounds = completedRounds;
      if (completedRounds >= 30 && !participants[pIndex].completion_time) {
        participants[pIndex].completion_time = new Date().toISOString();
      }
      setLocalItem(STORAGE_KEYS.PARTICIPANTS, participants);
    }

    // Dispatch custom event for live local updates
    window.dispatchEvent(new CustomEvent('horror_submission_made', {
      detail: { participantId, roundNumber: song.round_number, selectedOption: cleanOption, isCorrect, totalScore }
    }));

    return {
      success: true,
      round_number: song.round_number,
      selected_option: cleanOption,
      is_correct: isCorrect,
      is_expired: false,
      points_awarded: pointsAwarded,
      total_score: totalScore,
      correct_count: correctCount,
      completed_rounds: completedRounds
    };
  },


  async getParticipantSubmissions(participantId) {
    if (!participantId) return [];
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('submissions')
          .select('*')
          .eq('participant_id', participantId);
        if (!error && data) return data;
      } catch (e) {
        console.warn('Supabase getParticipantSubmissions failed:', e);
      }
    }
    const submissions = getLocalItem(STORAGE_KEYS.SUBMISSIONS, []);
    return submissions.filter(s => s.participant_id === participantId);
  },

  // 5. LEADERBOARD
  async getLeaderboard() {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.rpc('get_horror_leaderboard');
        if (!error && data) return data;

        // Fallback to direct select
        const { data: rawList, error: listError } = await supabase
          .from('participants')
          .select('*')
          .order('total_score', { ascending: false })
          .order('correct_count', { ascending: false })
          .order('completion_time', { ascending: true, nullsFirst: false });
        if (!listError && rawList) {
          return rawList.map((p, idx) => ({ ...p, rank: idx + 1 }));
        }
      } catch (e) {
        console.warn('Supabase getLeaderboard failed, using local:', e);
      }
    }

    const participants = getLocalItem(STORAGE_KEYS.PARTICIPANTS, []);
    // Sort: total_score DESC -> correct_count DESC -> completion_time ASC -> created_at ASC
    const sorted = [...participants].sort((a, b) => {
      if (b.total_score !== a.total_score) {
        return b.total_score - a.total_score;
      }
      if (b.correct_count !== a.correct_count) {
        return b.correct_count - a.correct_count;
      }
      if (a.completion_time && b.completion_time) {
        return new Date(a.completion_time) - new Date(b.completion_time);
      }
      if (a.completion_time && !b.completion_time) return -1;
      if (!a.completion_time && b.completion_time) return 1;
      return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    });

    return sorted.map((p, index) => ({
      ...p,
      rank: index + 1
    }));
  },

  // 6. ADMIN & AUDIT
  async getAllSubmissions() {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('submissions')
          .select('*, participants(name, participant_code), songs(title, correct_option, correct_answer, option_a, option_b, option_c, option_d)')
          .order('submitted_at', { ascending: false });
        if (!error && data) return data;
      } catch (e) {
        console.warn('Supabase getAllSubmissions failed:', e);
      }
    }
    const submissions = getLocalItem(STORAGE_KEYS.SUBMISSIONS, []);
    const participants = getLocalItem(STORAGE_KEYS.PARTICIPANTS, []);
    const songs = getLocalItem(STORAGE_KEYS.SONGS, []);

    return submissions.map(sub => {
      const part = participants.find(p => p.id === sub.participant_id);
      const song = songs.find(s => s.id === sub.song_id);
      return {
        ...sub,
        participant_name: part?.name || 'Unknown Survivor',
        participant_code: part?.participant_code || 'SURVIVOR-????',
        song_title: song?.title || `Round ${sub.round_number}`,
        correct_option: song?.correct_option || 'A',
        correct_answer: song?.correct_answer || '',
        option_a: song?.option_a || '',
        option_b: song?.option_b || '',
        option_c: song?.option_c || '',
        option_d: song?.option_d || ''
      };
    });
  },

  async uploadAudioClip(file, roundNumber) {
    if (!file) throw new Error('No audio file provided.');

    // Validate size (max 10MB)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      throw new Error('Audio file exceeds 10MB limit.');
    }

    const ext = file.name.split('.').pop().toLowerCase();
    const validExtensions = ['mp3', 'wav', 'm4a', 'mp4', 'ogg', 'aac'];
    if (!validExtensions.includes(ext)) {
      throw new Error(`Unsupported format (.${ext}). Please upload MP3, WAV, M4A, or OGG.`);
    }

    const fileName = `round-${roundNumber}-${Date.now()}.${ext}`;

    if (isSupabaseConfigured) {
      try {
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('song-clips')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: true,
            contentType: file.type || 'audio/mpeg'
          });

        if (uploadError) {
          console.error('Supabase storage upload error:', uploadError);
          throw new Error(`Storage upload failed: ${uploadError.message}. Make sure 'song-clips' bucket has public upload policy.`);
        }

        const { data: publicUrlData } = supabase.storage
          .from('song-clips')
          .getPublicUrl(fileName);

        if (publicUrlData?.publicUrl) {
          return publicUrlData.publicUrl;
        }
      } catch (err) {
        console.error('Audio upload error:', err);
        throw err;
      }
    }

    // In local engine only (when Supabase is not configured)
    return URL.createObjectURL(file);
  },

  // 7. ADMIN AUTHENTICATION
  async adminLogin(email, password) {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (error) {
          const cleanEmail = (email || '').trim().toLowerCase();
          if (cleanEmail === 'admin@horrortrivia.com' || cleanEmail === 'organizer@horrortrivia.com') {
            console.info('Supabase Auth user not found; creating local session for organizer demo.');
            const mockSession = {
              email: cleanEmail,
              token: 'horror-admin-token-' + Date.now(),
              logged_in_at: new Date().toISOString()
            };
            setLocalItem(STORAGE_KEYS.ADMIN_SESSION, mockSession);
            return { success: true, user: { email: cleanEmail }, session: mockSession };
          }
          throw error;
        }
        return { success: true, user: data.user, session: data.session };
      } catch (err) {
        console.warn('Supabase auth failed:', err.message);
        const cleanEmail = (email || '').trim().toLowerCase();
        if (cleanEmail === 'admin@horrortrivia.com' || cleanEmail === 'organizer@horrortrivia.com') {
          const mockSession = {
            email: cleanEmail,
            token: 'horror-admin-token-' + Date.now(),
            logged_in_at: new Date().toISOString()
          };
          setLocalItem(STORAGE_KEYS.ADMIN_SESSION, mockSession);
          return { success: true, user: { email: cleanEmail }, session: mockSession };
        }
        throw err;
      }
    }

    // Local engine demo credentials check
    const cleanEmail = (email || '').trim().toLowerCase();
    if (cleanEmail === 'admin@horrortrivia.com' || cleanEmail === 'organizer@horrortrivia.com' || password.length >= 6) {
      const mockSession = {
        email: cleanEmail,
        token: 'horror-admin-token-' + Date.now(),
        logged_in_at: new Date().toISOString()
      };
      setLocalItem(STORAGE_KEYS.ADMIN_SESSION, mockSession);
      return { success: true, user: { email: cleanEmail }, session: mockSession };
    }

    throw new Error('Invalid organizer credentials. (Demo login: admin@horrortrivia.com / any 6+ char password)');
  },

  async adminLogout() {
    if (isSupabaseConfigured) {
      try {
        await supabase.auth.signOut();
      } catch (e) {}
    }
    localStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION);
  },

  async getAdminSession() {
    if (isSupabaseConfigured) {
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session) return data.session;
      } catch (e) {}
    }
    return getLocalItem(STORAGE_KEYS.ADMIN_SESSION, null);
  },

  // 8. RESET GAME / LOBBY (Wipe participants, submissions, sessions, and reset status to waiting)
  async resetGame() {
    if (isSupabaseConfigured) {
      try {
        const { error: rpcError } = await supabase.rpc('reset_horror_game');
        if (rpcError) {
          console.warn('Supabase reset_horror_game RPC warning:', rpcError);
        }
        
        // Guarantee game_settings row is reset to waiting via admin RPC
        try {
          await supabase.rpc('admin_update_game_settings', {
            p_status: 'waiting',
            p_current_round: 1,
            p_answers_revealed: false
          });
        } catch (e) {}

        // Fallback direct table deletes
        try {
          await supabase.from('round_sessions').delete().not('id', 'is', null);
          await supabase.from('submissions').delete().not('id', 'is', null);
          await supabase.from('participants').delete().not('id', 'is', null);
          await supabase.from('game_settings').update({
            game_status: 'waiting',
            current_round: 1,
            answers_revealed: false,
            updated_at: new Date().toISOString()
          }).eq('id', 1);
        } catch (e) {}
      } catch (e) {
        console.warn('Supabase reset failed:', e);
      }
    }

    setLocalItem(STORAGE_KEYS.ROUND_SESSIONS, []);
    setLocalItem(STORAGE_KEYS.SUBMISSIONS, []);
    setLocalItem(STORAGE_KEYS.PARTICIPANTS, []);
    try {
      localStorage.removeItem('horror_participant_session');
    } catch (e) {}

    const defaultSettings = {
      id: 1,
      game_status: 'waiting',
      current_round: 1,
      total_rounds: 30,
      answers_revealed: false,
      updated_at: new Date().toISOString()
    };
    setLocalItem(STORAGE_KEYS.SETTINGS, defaultSettings);
    window.dispatchEvent(new CustomEvent('horror_settings_updated', { detail: defaultSettings }));
    window.dispatchEvent(new CustomEvent('horror_game_reset'));
    return true;
  }
};
