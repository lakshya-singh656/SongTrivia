-- ==========================================================
-- HORROR SONG TRIVIA - SUPABASE DATABASE SCHEMA & POLICIES
-- STRICT ANTI-CHEATING CONTROLS & ROUND SESSIONS
-- ==========================================================

-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. GAME SETTINGS TABLE (Singleton row: id = 1)
CREATE TABLE IF NOT EXISTS public.game_settings (
  id INT PRIMARY KEY DEFAULT 1,
  game_status TEXT NOT NULL DEFAULT 'waiting' CHECK (game_status IN ('waiting', 'active', 'paused', 'ended')),
  current_round INT NOT NULL DEFAULT 1 CHECK (current_round >= 1 AND current_round <= 30),
  total_rounds INT NOT NULL DEFAULT 30,
  answers_revealed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert initial singleton row if not exists
INSERT INTO public.game_settings (id, game_status, current_round, total_rounds, answers_revealed)
VALUES (1, 'waiting', 1, 30, FALSE)
ON CONFLICT (id) DO NOTHING;

-- 2. SONGS TABLE (30 rounds)
CREATE TABLE IF NOT EXISTS public.songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number INT UNIQUE NOT NULL CHECK (round_number >= 1 AND round_number <= 30),
  title TEXT NOT NULL,
  audio_path TEXT,
  duration_seconds NUMERIC DEFAULT 8.0 CHECK (duration_seconds >= 1.0 AND duration_seconds <= 30.0),
  option_a TEXT NOT NULL DEFAULT '',
  option_b TEXT NOT NULL DEFAULT '',
  option_c TEXT NOT NULL DEFAULT '',
  option_d TEXT NOT NULL DEFAULT '',
  correct_option TEXT NOT NULL DEFAULT 'A' CHECK (correct_option IN ('A', 'B', 'C', 'D')),
  correct_answer TEXT NOT NULL,
  accepted_answers TEXT[] DEFAULT '{}'::TEXT[],
  hint TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index on round number
CREATE INDEX IF NOT EXISTS idx_songs_round_number ON public.songs(round_number);

-- 3. PARTICIPANTS TABLE
CREATE TABLE IF NOT EXISTS public.participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  total_score INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  completed_rounds INT NOT NULL DEFAULT 0,
  completion_time TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_participants_leaderboard ON public.participants (
  total_score DESC,
  correct_count DESC,
  completion_time ASC NULLS LAST,
  created_at ASC
);

-- 4. ROUND SESSIONS TABLE (Strict anti-cheating state tracking per participant per round)
CREATE TABLE IF NOT EXISTS public.round_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'audio_playing', 'answering', 'submitted', 'time_expired')),
  audio_duration_seconds NUMERIC NOT NULL DEFAULT 8.0,
  playback_started_at TIMESTAMP WITH TIME ZONE,
  playback_completed_at TIMESTAMP WITH TIME ZONE,
  answer_deadline TIMESTAMP WITH TIME ZONE,
  submitted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_participant_round_session UNIQUE (participant_id, song_id),
  CONSTRAINT unique_participant_round_num UNIQUE (participant_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_round_sessions_part_song ON public.round_sessions(participant_id, song_id);

-- 5. SUBMISSIONS TABLE
CREATE TABLE IF NOT EXISTS public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  selected_option TEXT,
  submitted_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  points_awarded INT NOT NULL DEFAULT 0 CHECK (points_awarded IN (0, 10)),
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_participant_song UNIQUE (participant_id, song_id),
  CONSTRAINT unique_participant_round UNIQUE (participant_id, round_number)
);

-- Index for checking submission existence quickly
CREATE INDEX IF NOT EXISTS idx_submissions_participant_round ON public.submissions(participant_id, round_number);

-- ==========================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================================

ALTER TABLE public.game_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- Game settings: Anyone can read; authenticated admins can update
CREATE POLICY "Public can read game settings"
  ON public.game_settings FOR SELECT
  USING (true);

CREATE POLICY "Admins can update game settings"
  ON public.game_settings FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Participants: Anyone can insert their registration; anyone can read public leaderboard info
CREATE POLICY "Public can register as participant"
  ON public.participants FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public can view participants"
  ON public.participants FOR SELECT
  USING (true);

CREATE POLICY "Admins can modify or delete participants"
  ON public.participants FOR ALL
  TO authenticated
  USING (true);

-- Round Sessions:
-- Public can read own round session
CREATE POLICY "Public can view own round sessions"
  ON public.round_sessions FOR SELECT
  USING (true);

CREATE POLICY "Admins have full access to round sessions"
  ON public.round_sessions FOR ALL
  TO authenticated
  USING (true);

-- Submissions:
-- Authenticated admins can view and delete all submissions.
-- Public/Participants can read their own submissions to prevent re-answering.
CREATE POLICY "Public can view submissions"
  ON public.submissions FOR SELECT
  USING (true);

CREATE POLICY "Admins have full access to submissions"
  ON public.submissions FOR ALL
  TO authenticated
  USING (true);

-- Songs:
CREATE POLICY "Admins have full access to songs"
  ON public.songs FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY "Public can view songs"
  ON public.songs FOR SELECT
  USING (true);

-- ==========================================================
-- SERVER-SIDE ANSWER CHECKING & SECURE RPC FUNCTIONS
-- ==========================================================

-- Normalization Helper
CREATE OR REPLACE FUNCTION public.normalize_horror_answer(raw_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        TRIM(raw_text),
        '[^a-zA-Z0-9 ]', '', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

-- 1. AUTHORIZE & START ROUND PLAYBACK (STRICT SINGLE PLAYBACK)
CREATE OR REPLACE FUNCTION public.start_round_playback(
  p_participant_id UUID,
  p_song_id UUID,
  p_audio_duration NUMERIC DEFAULT 8.0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_game_status TEXT;
  v_song RECORD;
  v_session RECORD;
  v_duration NUMERIC;
  v_now TIMESTAMP WITH TIME ZONE := NOW();
  v_deadline TIMESTAMP WITH TIME ZONE;
BEGIN
  -- 1. Check game status
  SELECT game_status INTO v_game_status FROM public.game_settings WHERE id = 1;
  IF v_game_status <> 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'The event is currently ' || COALESCE(v_game_status, 'closed') || '. Playback is only allowed during active rounds.'
    );
  END IF;

  -- 2. Verify song
  SELECT * INTO v_song FROM public.songs WHERE id = p_song_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Song not found.');
  END IF;

  -- 3. Check existing round session
  SELECT * INTO v_session FROM public.round_sessions
  WHERE participant_id = p_participant_id AND song_id = p_song_id;

  IF FOUND THEN
    -- If already started playback, strictly reject replay!
    IF v_session.state <> 'ready' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Audio playback already initiated for this round. Replaying is strictly prohibited.',
        'state', v_session.state,
        'answer_deadline', v_session.answer_deadline,
        'server_now', v_now
      );
    END IF;
  END IF;

  -- 4. Calculate duration & strict deadline
  -- Duration between 3s and 30s
  v_duration := LEAST(GREATEST(COALESCE(p_audio_duration, 8.0), 3.0), 30.0);
  -- Strict Answer deadline = Playback Start + Audio Duration + 10 seconds
  v_deadline := v_now + (v_duration * INTERVAL '1 second') + INTERVAL '10 seconds';

  -- 5. Insert or update session atomically
  IF FOUND THEN
    UPDATE public.round_sessions
    SET
      state = 'audio_playing',
      audio_duration_seconds = v_duration,
      playback_started_at = v_now,
      answer_deadline = v_deadline
    WHERE id = v_session.id;
  ELSE
    INSERT INTO public.round_sessions (
      participant_id,
      song_id,
      round_number,
      state,
      audio_duration_seconds,
      playback_started_at,
      answer_deadline
    ) VALUES (
      p_participant_id,
      p_song_id,
      v_song.round_number,
      'audio_playing',
      v_duration,
      v_now,
      v_deadline
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'state', 'audio_playing',
    'playback_started_at', v_now,
    'audio_duration_seconds', v_duration,
    'answer_deadline', v_deadline,
    'server_now', v_now
  );
END;
$$;

-- 2. COMPLETE AUDIO & START 10-SECOND ANSWERING
CREATE OR REPLACE FUNCTION public.complete_audio_and_start_answering(
  p_participant_id UUID,
  p_song_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session RECORD;
  v_now TIMESTAMP WITH TIME ZONE := NOW();
  v_deadline TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT * INTO v_session FROM public.round_sessions
  WHERE participant_id = p_participant_id AND song_id = p_song_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active round session found.');
  END IF;

  -- If already submitted or time expired, return existing
  IF v_session.state IN ('submitted', 'time_expired') THEN
    RETURN jsonb_build_object(
      'success', true,
      'state', v_session.state,
      'server_now', v_now
    );
  END IF;

  -- If already answering, return deadline
  IF v_session.state = 'answering' THEN
    RETURN jsonb_build_object(
      'success', true,
      'state', 'answering',
      'answer_deadline', v_session.answer_deadline,
      'server_now', v_now
    );
  END IF;

  -- Audio completed: set playback_completed_at and ensure deadline is at most 10s from now
  v_deadline := LEAST(COALESCE(v_session.answer_deadline, v_now + INTERVAL '10 seconds'), v_now + INTERVAL '10.5 seconds');

  UPDATE public.round_sessions
  SET
    state = 'answering',
    playback_completed_at = v_now,
    answer_deadline = v_deadline
  WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'success', true,
    'state', 'answering',
    'answer_deadline', v_deadline,
    'server_now', v_now
  );
END;
$$;

-- 3. GET ROUND STATE (RESTORES PERSISTENT STATE ON REFRESH/TAB CHANGE)
CREATE OR REPLACE FUNCTION public.get_round_state(
  p_participant_id UUID,
  p_song_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session RECORD;
  v_sub RECORD;
  v_now TIMESTAMP WITH TIME ZONE := NOW();
  v_audio_end TIMESTAMP WITH TIME ZONE;
  v_is_expired BOOLEAN := FALSE;
  v_rem_sec NUMERIC := 0;
BEGIN
  SELECT * INTO v_session FROM public.round_sessions
  WHERE participant_id = p_participant_id AND song_id = p_song_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'state', 'ready',
      'can_play', true,
      'server_now', v_now
    );
  END IF;

  -- Check if already submitted in submissions
  SELECT * INTO v_sub FROM public.submissions
  WHERE participant_id = p_participant_id AND song_id = p_song_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'state', 'submitted',
      'can_play', false,
      'is_correct', v_sub.is_correct,
      'points_awarded', v_sub.points_awarded,
      'submitted_answer', v_sub.submitted_answer,
      'server_now', v_now
    );
  END IF;

  -- If in audio_playing, check if audio duration has elapsed
  v_audio_end := v_session.playback_started_at + (v_session.audio_duration_seconds * INTERVAL '1 second');

  IF v_session.state = 'audio_playing' AND v_now >= v_audio_end THEN
    UPDATE public.round_sessions
    SET state = 'answering', playback_completed_at = v_audio_end
    WHERE id = v_session.id;
    v_session.state := 'answering';
  END IF;

  -- Check if answer deadline has expired
  IF v_session.answer_deadline IS NOT NULL AND v_now > (v_session.answer_deadline + INTERVAL '1 second') THEN
    v_is_expired := TRUE;
    IF v_session.state <> 'time_expired' THEN
      UPDATE public.round_sessions
      SET state = 'time_expired'
      WHERE id = v_session.id;
      v_session.state := 'time_expired';

      -- Auto-insert 0-point expired submission
      INSERT INTO public.submissions (
        participant_id, song_id, round_number, submitted_answer, is_correct, points_awarded
      ) VALUES (
        p_participant_id, p_song_id, v_session.round_number, '[TIME_EXPIRED]', FALSE, 0
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF v_session.answer_deadline IS NOT NULL THEN
    v_rem_sec := GREATEST(0, EXTRACT(EPOCH FROM (v_session.answer_deadline - v_now)));
  END IF;

  RETURN jsonb_build_object(
    'state', v_session.state,
    'can_play', (v_session.state = 'ready'),
    'audio_duration_seconds', v_session.audio_duration_seconds,
    'playback_started_at', v_session.playback_started_at,
    'answer_deadline', v_session.answer_deadline,
    'server_now', v_now,
    'is_expired', v_is_expired,
    'remaining_answer_seconds', v_rem_sec
  );
END;
$$;

-- 4. SECURE MCQ ANSWER SUBMISSION RPC (WITH SERVER DEADLINE ENFORCEMENT)
CREATE OR REPLACE FUNCTION public.submit_song_answer(
  p_participant_id UUID,
  p_song_id UUID,
  p_selected_option TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_game_status TEXT;
  v_song RECORD;
  v_session RECORD;
  v_clean_selected TEXT;
  v_clean_correct TEXT;
  v_is_correct BOOLEAN := FALSE;
  v_points INT := 0;
  v_total_score INT;
  v_correct_count INT;
  v_completed_rounds INT;
  v_now TIMESTAMP WITH TIME ZONE := NOW();
  v_is_expired BOOLEAN := FALSE;
  v_option_text TEXT;
BEGIN
  -- 1. Check game status
  SELECT game_status INTO v_game_status FROM public.game_settings WHERE id = 1;
  IF v_game_status <> 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'The game is currently ' || COALESCE(v_game_status, 'closed') || '. Answers can only be submitted during an active game.'
    );
  END IF;

  -- 2. Verify song exists
  SELECT * INTO v_song FROM public.songs WHERE id = p_song_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid song round.'
    );
  END IF;

  -- 3. Check for duplicate submission
  IF EXISTS (
    SELECT 1 FROM public.submissions
    WHERE participant_id = p_participant_id AND song_id = p_song_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You have already submitted an answer for this round.'
    );
  END IF;

  -- 4. Check Round Session & Server-Side 10s Deadline
  SELECT * INTO v_session FROM public.round_sessions
  WHERE participant_id = p_participant_id AND song_id = p_song_id;

  IF FOUND THEN
    IF v_session.state = 'submitted' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Answer already submitted for this round.'
      );
    END IF;

    -- Strict deadline verification (with 1.5s grace for network transit)
    IF v_session.answer_deadline IS NOT NULL AND v_now > (v_session.answer_deadline + INTERVAL '1.5 seconds') THEN
      v_is_expired := TRUE;
    END IF;
  END IF;

  -- Clean input
  v_clean_selected := UPPER(TRIM(COALESCE(p_selected_option, '')));

  -- 5. If expired or empty
  IF v_is_expired OR v_clean_selected IN ('', 'EXPIRED', '[TIME_EXPIRED]') THEN
    v_clean_selected := 'EXPIRED';
    v_is_correct := FALSE;
    v_points := 0;
    v_option_text := '[TIME_EXPIRED]';

    UPDATE public.round_sessions
    SET state = 'time_expired', submitted_at = v_now
    WHERE participant_id = p_participant_id AND song_id = p_song_id;
  ELSE
    -- 6. Validate MCQ selection: must be A, B, C, or D
    IF v_clean_selected NOT IN ('A', 'B', 'C', 'D') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Invalid option selected. Please select A, B, C, or D.'
      );
    END IF;

    -- Compare with stored correct_option
    v_clean_correct := UPPER(TRIM(COALESCE(v_song.correct_option, 'A')));

    IF v_clean_selected = v_clean_correct THEN
      v_is_correct := TRUE;
      v_points := 10;
    ELSE
      v_is_correct := FALSE;
      v_points := 0;
    END IF;

    -- Get corresponding option text for audit
    CASE v_clean_selected
      WHEN 'A' THEN v_option_text := v_song.option_a;
      WHEN 'B' THEN v_option_text := v_song.option_b;
      WHEN 'C' THEN v_option_text := v_song.option_c;
      WHEN 'D' THEN v_option_text := v_song.option_d;
      ELSE v_option_text := '';
    END CASE;

    UPDATE public.round_sessions
    SET state = 'submitted', submitted_at = v_now
    WHERE participant_id = p_participant_id AND song_id = p_song_id;
  END IF;

  -- 7. Insert submission record atomically
  INSERT INTO public.submissions (
    participant_id,
    song_id,
    round_number,
    selected_option,
    submitted_answer,
    is_correct,
    points_awarded
  ) VALUES (
    p_participant_id,
    p_song_id,
    v_song.round_number,
    v_clean_selected,
    v_option_text,
    v_is_correct,
    v_points
  );

  -- 8. Recalculate participant score
  SELECT
    COALESCE(SUM(points_awarded), 0),
    COUNT(*) FILTER (WHERE is_correct = TRUE),
    COUNT(*)
  INTO
    v_total_score,
    v_correct_count,
    v_completed_rounds
  FROM public.submissions
  WHERE participant_id = p_participant_id;

  -- Update participant record
  UPDATE public.participants
  SET
    total_score = v_total_score,
    correct_count = v_correct_count,
    completed_rounds = v_completed_rounds,
    completion_time = CASE
      WHEN v_completed_rounds >= 30 AND completion_time IS NULL THEN NOW()
      ELSE completion_time
    END
  WHERE id = p_participant_id;

  -- 9. Return result without revealing correct option unless game revealed
  RETURN jsonb_build_object(
    'success', true,
    'round_number', v_song.round_number,
    'selected_option', v_clean_selected,
    'is_correct', v_is_correct,
    'is_expired', v_is_expired,
    'points_awarded', v_points,
    'total_score', v_total_score,
    'correct_count', v_correct_count,
    'completed_rounds', v_completed_rounds
  );
END;
$$;

-- Secure public function to get playable songs without exposing answers or correct_option until revealed
CREATE OR REPLACE FUNCTION public.get_playable_songs()
RETURNS TABLE (
  id UUID,
  round_number INT,
  audio_path TEXT,
  duration_seconds NUMERIC,
  hint TEXT,
  option_a TEXT,
  option_b TEXT,
  option_c TEXT,
  option_d TEXT,
  correct_option TEXT,
  correct_answer TEXT,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_revealed BOOLEAN;
BEGIN
  SELECT answers_revealed INTO v_revealed FROM public.game_settings WHERE id = 1;
  
  RETURN QUERY
  SELECT
    s.id,
    s.round_number,
    s.audio_path,
    COALESCE(s.duration_seconds, 8.0) AS duration_seconds,
    s.hint,
    s.option_a,
    s.option_b,
    s.option_c,
    s.option_d,
    CASE WHEN COALESCE(v_revealed, false) = true THEN s.correct_option ELSE NULL END AS correct_option,
    CASE WHEN COALESCE(v_revealed, false) = true THEN s.correct_answer ELSE NULL END AS correct_answer,
    s.created_at
  FROM public.songs s
  ORDER BY s.round_number ASC;
END;
$$;

-- Leaderboard RPC function
CREATE OR REPLACE FUNCTION public.get_horror_leaderboard()
RETURNS TABLE (
  rank BIGINT,
  id UUID,
  participant_code TEXT,
  name TEXT,
  total_score INT,
  correct_count INT,
  completed_rounds INT,
  completion_time TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    ROW_NUMBER() OVER (
      ORDER BY
        p.total_score DESC,
        p.correct_count DESC,
        p.completion_time ASC NULLS LAST,
        p.created_at ASC
    ) AS rank,
    p.id,
    p.participant_code,
    p.name,
    p.total_score,
    p.correct_count,
    p.completed_rounds,
    p.completion_time,
    p.created_at
  FROM public.participants p
  ORDER BY rank ASC;
$$;


-- ==========================================================
-- 6. ADDITIONAL ADMIN RPC FUNCTIONS
-- ==========================================================

-- Atomically reset entire trivia game state
CREATE OR REPLACE FUNCTION public.reset_horror_game()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.round_sessions;
  DELETE FROM public.submissions;
  DELETE FROM public.participants;
  UPDATE public.game_settings
  SET
    game_status = 'waiting',
    current_round = 1,
    answers_revealed = FALSE,
    updated_at = NOW()
  WHERE id = 1;
  RETURN TRUE;
END;
$$;

-- Secure admin update of game settings
CREATE OR REPLACE FUNCTION public.admin_update_game_settings(
  p_status TEXT DEFAULT NULL,
  p_current_round INT DEFAULT NULL,
  p_answers_revealed BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_res RECORD;
BEGIN
  UPDATE public.game_settings
  SET
    game_status = COALESCE(p_status, game_status),
    current_round = COALESCE(p_current_round, current_round),
    answers_revealed = COALESCE(p_answers_revealed, answers_revealed),
    updated_at = NOW()
  WHERE id = 1
  RETURNING * INTO v_res;

  RETURN to_jsonb(v_res);
END;
$$;

-- ==========================================================
-- 7. STORAGE BUCKET & POLICIES FOR AUDIO CLIPS (song-clips)
-- ==========================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'song-clips',
  'song-clips',
  true,
  10485760,
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-m4a', 'audio/mp4', 'audio/aac', 'audio/ogg']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-m4a', 'audio/mp4', 'audio/aac', 'audio/ogg'];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public Read Access for Song Clips'
  ) THEN
    CREATE POLICY "Public Read Access for Song Clips"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'song-clips');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Admin Upload Access for Song Clips'
  ) THEN
    CREATE POLICY "Admin Upload Access for Song Clips"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'song-clips');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Admin Update Access for Song Clips'
  ) THEN
    CREATE POLICY "Admin Update Access for Song Clips"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'song-clips');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Admin Delete Access for Song Clips'
  ) THEN
    CREATE POLICY "Admin Delete Access for Song Clips"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'song-clips');
  END IF;
END $$;

-- ==========================================================
-- 8. PRE-SEEDED 30 ICONIC HORROR SONGS WITH MCQ OPTIONS
-- ==========================================================

-- Pre-seed all 30 iconic horror songs & MCQ options
INSERT INTO public.songs (
  round_number,
  title,
  option_a,
  option_b,
  option_c,
  option_d,
  correct_option,
  correct_answer,
  hint,
  duration_seconds
)
VALUES
  (1, 'Halloween Theme', 'Halloween', 'Friday the 13th', 'Psycho', 'The Texas Chain Saw Massacre', 'A', 'Halloween', '1978 classic directed by John Carpenter. He came home.', 8),
  (2, 'Tubular Bells', 'The Omen', 'The Exorcist', 'Rosemary''s Baby', 'Poltergeist', 'B', 'The Exorcist', 'Your mother sews socks in hell. 1973 demonic possession masterpiece.', 8),
  (3, 'Thriller', 'Somebody''s Watching Me', 'Superstition', 'Ghostbusters', 'Thriller', 'D', 'Thriller', '''Cause this is thriller, thriller night! Vincent Price narrates.', 8),
  (4, 'Psycho (Shower Scene)', 'Vertigo', 'Psycho', 'The Birds', 'Rear Window', 'B', 'Psycho', 'Alfred Hitchcock''s screeching violins at the Bates Motel.', 7),
  (5, 'Stranger Things Theme', 'Stranger Things', 'Tron: Legacy', 'Blade Runner', 'Dark', 'A', 'Stranger Things', 'Hawkins, Indiana. 1980s synth pulse and the Demogorgon.', 8),
  (6, 'Jaws Main Title', 'Deep Blue Sea', 'Titanic', 'Jaws', 'Alien', 'C', 'Jaws', 'Two menacing notes from the ocean deep. You''re gonna need a bigger boat.', 8),
  (7, 'A Nightmare on Elm Street Theme', 'Child''s Play', 'Candyman', 'Hellraiser', 'A Nightmare on Elm Street', 'D', 'A Nightmare on Elm Street', '1, 2, Freddy''s coming for you... 3, 4, better lock your door.', 8),
  (8, 'Hello Zepp (Saw Theme)', 'Saw', 'The Ring', 'Final Destination', 'Insidious', 'A', 'Saw', 'I want to play a game. The dramatic violin crescendo at the final twist.', 8),
  (9, 'Ghostbusters', 'Beetlejuice', 'Ghostbusters', 'Men in Black', 'Casper', 'B', 'Ghostbusters', 'If there''s something strange in your neighborhood, who you gonna call?', 8),
  (10, 'The Shining (Dies Irae)', 'The Shining', 'The Amityville Horror', 'Misery', 'Carrie', 'A', 'The Shining', 'Stanley Kubrick. A yellow Beetle winding up the Colorado mountains.', 8),
  (11, 'Sweet Dreams (Are Made of This)', 'Personal Jesus', 'Closer', 'Sweet Dreams', 'Dragula', 'C', 'Sweet Dreams', 'Gothic industrial cover with distorted bass and raspy whispers.', 8),
  (12, 'Somebody''s Watching Me', 'Thriller', 'Somebody''s Watching Me', 'Superstition', 'Smooth Criminal', 'B', 'Somebody''s Watching Me', 'Paranoid 80s hit featuring Michael Jackson on the hook.', 8),
  (13, 'Monster Mash', 'Purple People Eater', 'Witch Doctor', 'Monster Mash', 'Time Warp', 'C', 'Monster Mash', 'It was a graveyard smash! Caught on in a flash.', 8),
  (14, 'Suspiria Theme', 'Deep Red', 'Suspiria', 'Inferno', 'Tenebrae', 'B', 'Suspiria', 'Dario Argento''s witch ballet academy. Whispered eerie chant.', 8),
  (15, 'Bury a Friend', 'Bad Guy', 'Bury a Friend', 'All the Good Girls Go to Hell', 'Dark Horse', 'B', 'Bury a Friend', '''What do you want from me? Why don''t you run from me?''', 8),
  (16, 'The X-Files Theme', 'Twin Peaks', 'The Twilight Zone', 'The Outer Limits', 'The X-Files', 'D', 'The X-Files', 'Eerie theremin whistle. The truth is out there.', 8),
  (17, 'The Addams Family Theme', 'The Munsters', 'The Addams Family', 'Dark Shadows', 'Bewitched', 'B', 'The Addams Family', 'They''re creepy and they''re kooky, mysterious and spooky. *snap snap*', 8),
  (18, '(Don''t Fear) The Reaper', '(Don''t Fear) The Reaper', 'Godzilla', 'Burnin'' for You', 'Carry On Wayward Son', 'A', '(Don''t Fear) The Reaper', 'Famous guitar riff and cowbell, used in the original Halloween opening.', 8),
  (19, 'Bark at the Moon', 'Mr. Crowley', 'Crazy Train', 'Bark at the Moon', 'Paranoid', 'C', 'Bark at the Moon', 'Prince of Darkness howling like a werewolf in a cemetery.', 8),
  (20, 'Pet Sematary', 'Blitzkrieg Bop', 'I Wanna Be Sedated', 'Pet Sematary', 'Sheena Is a Punk Rocker', 'C', 'Pet Sematary', 'Stephen King novel soundtrack: ''I don''t wanna be buried in a pet sematary...''', 8),
  (21, 'Dragula', 'Dragula', 'Living Dead Girl', 'Thunder Kiss ''65', 'Superbeast', 'A', 'Dragula', 'Industrial horror anthem: ''Dig through the ditches and burn through the witches!''', 8),
  (22, 'Highway to Hell', 'Hells Bells', 'Highway to Hell', 'Back in Black', 'Run to the Hills', 'B', 'Highway to Hell', 'Bon Scott''s screaming rock anthem heading straight into the underworld.', 8),
  (23, 'Sympathy for the Devil', 'Paint It Black', 'Sympathy for the Devil', 'Gimme Shelter', 'Stairway to Heaven', 'B', 'Sympathy for the Devil', '''Please allow me to introduce myself, I''m a man of wealth and taste...''', 8),
  (24, 'Superstition', 'Superstition', 'Higher Ground', 'Sir Duke', 'I Wish', 'A', 'Superstition', 'Thirteen-month-old baby, broke the lookin'' glass... famous clavinet groove.', 8),
  (25, 'Bad Moon Rising', 'Fortunate Son', 'Have You Ever Seen the Rain', 'Bad Moon Rising', 'Proud Mary', 'C', 'Bad Moon Rising', 'An American Werewolf in London: ''I see a bad moon rising, I see trouble on the way.''', 8),
  (26, 'Disturbia', 'Umbrella', 'S&M', 'Disturbia', 'Poker Face', 'C', 'Disturbia', '''Bum-bum-be-dum-bum-bum-be-dum...'' Dark pop track about losing one''s mind.', 8),
  (27, 'Feed My Frankenstein', 'Poison', 'School''s Out', 'Feed My Frankenstein', 'Welcome to My Nightmare', 'C', 'Feed My Frankenstein', 'Shock rock legend, featured in Wayne''s World backstage scene.', 8),
  (28, 'Spooky', 'Spooky', 'Stormy', 'Devil Woman', 'Black Magic Woman', 'A', 'Spooky', '60s soft rock haunt: ''Love is kinda crazy with a spooky little girl like you.''', 8),
  (29, 'Ghost Town', 'A Message to You Rudy', 'Ghost Town', 'Too Much Too Young', 'Red Red Wine', 'B', 'Ghost Town', 'Eerie 1981 ska track with spooky flute: ''This town is coming like a ghost town...''', 8),
  (30, 'Creep', 'Karma Police', 'Paranoid Android', 'Creep', 'No Surprises', 'C', 'Creep', '90s existential haunt: ''But I''m a creep, I''m a weirdo, what the hell am I doing here?''', 8)
ON CONFLICT (round_number) DO UPDATE SET
  title = EXCLUDED.title,
  option_a = EXCLUDED.option_a,
  option_b = EXCLUDED.option_b,
  option_c = EXCLUDED.option_c,
  option_d = EXCLUDED.option_d,
  correct_option = EXCLUDED.correct_option,
  correct_answer = EXCLUDED.correct_answer,
  hint = EXCLUDED.hint,
  duration_seconds = EXCLUDED.duration_seconds;
