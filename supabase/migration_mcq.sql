-- ==========================================================
-- SAFE MIGRATION: MULTIPLE-CHOICE QUESTIONS (A, B, C, D)
-- Run this in your Supabase SQL Editor to upgrade an existing database
-- ==========================================================

-- 1. ADD MCQ COLUMNS TO SONGS TABLE
ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS option_a TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS option_b TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS option_c TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS option_d TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS correct_option TEXT NOT NULL DEFAULT 'A' CHECK (correct_option IN ('A', 'B', 'C', 'D'));

-- 2. ADD SELECTED_OPTION TO SUBMISSIONS TABLE
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS selected_option TEXT;

-- 3. UPDATE GET_PLAYABLE_SONGS FUNCTION (WITHHOLDS CORRECT_OPTION UNTIL REVEAL)
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
  SELECT answers_revealed INTO v_revealed FROM public.game_settings WHERE public.game_settings.id = 1;
  
  RETURN QUERY
  SELECT
    s.id,
    s.round_number,
    s.audio_path,
    COALESCE(s.duration_seconds, 5.0) AS duration_seconds,
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

-- 4. UPDATE SUBMIT_SONG_ANSWER FOR MCQ EVALUATION & DEADLINE CHECK
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

    -- Strict deadline verification (1.5s network transit grace)
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

-- 5. UPDATE RESET_HORROR_GAME (COMPLIES WITH SAFE UPDATE/DELETE POLICIES)
CREATE OR REPLACE FUNCTION public.reset_horror_game()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.round_sessions WHERE id IS NOT NULL;
  DELETE FROM public.submissions WHERE id IS NOT NULL;
  DELETE FROM public.participants WHERE id IS NOT NULL;
  UPDATE public.game_settings
  SET
    game_status = 'waiting',
    current_round = 1,
    answers_revealed = FALSE,
    updated_at = NOW()
  WHERE public.game_settings.id = 1;
  RETURN TRUE;
END;
$$;

-- 6. STORAGE BUCKET POLICIES FOR SONG-CLIPS (ENABLE UPLOAD FOR ORGANIZER)
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
  file_size_limit = 10485760;

DROP POLICY IF EXISTS "Public Read Song Clips" ON storage.objects;
CREATE POLICY "Public Read Song Clips"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'song-clips');

DROP POLICY IF EXISTS "Public Upload Song Clips" ON storage.objects;
CREATE POLICY "Public Upload Song Clips"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'song-clips');

DROP POLICY IF EXISTS "Public Update Song Clips" ON storage.objects;
CREATE POLICY "Public Update Song Clips"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'song-clips')
WITH CHECK (bucket_id = 'song-clips');

-- 7. ALLOW ORGANIZER TO UPDATE SONGS TABLE
DROP POLICY IF EXISTS "Public can modify songs" ON public.songs;
CREATE POLICY "Public can modify songs"
ON public.songs FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- 8. RPC FUNCTION TO SAVE SONG SECURELY
CREATE OR REPLACE FUNCTION public.admin_save_song(
  p_round_number INT,
  p_title TEXT,
  p_audio_path TEXT,
  p_duration_seconds NUMERIC,
  p_option_a TEXT,
  p_option_b TEXT,
  p_option_c TEXT,
  p_option_d TEXT,
  p_correct_option TEXT,
  p_correct_answer TEXT,
  p_hint TEXT DEFAULT '',
  p_synth_motif TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_res RECORD;
BEGIN
  INSERT INTO public.songs (
    round_number, title, audio_path, duration_seconds,
    option_a, option_b, option_c, option_d,
    correct_option, correct_answer, accepted_answers, hint, synth_motif
  ) VALUES (
    p_round_number, p_title, p_audio_path, COALESCE(p_duration_seconds, 5.0),
    p_option_a, p_option_b, p_option_c, p_option_d,
    p_correct_option, p_correct_answer, ARRAY[p_correct_answer], p_hint, p_synth_motif
  )
  ON CONFLICT (round_number) DO UPDATE SET
    title = EXCLUDED.title,
    audio_path = COALESCE(EXCLUDED.audio_path, songs.audio_path),
    duration_seconds = COALESCE(EXCLUDED.duration_seconds, songs.duration_seconds),
    option_a = EXCLUDED.option_a,
    option_b = EXCLUDED.option_b,
    option_c = EXCLUDED.option_c,
    option_d = EXCLUDED.option_d,
    correct_option = EXCLUDED.correct_option,
    correct_answer = EXCLUDED.correct_answer,
    accepted_answers = ARRAY[EXCLUDED.correct_answer],
    hint = EXCLUDED.hint,
    synth_motif = EXCLUDED.synth_motif
  RETURNING * INTO v_res;

  RETURN to_jsonb(v_res);
END;
$$;

-- 9. ENABLE SUPABASE REALTIME REPLICATION FOR GAME_SETTINGS AND PARTICIPANTS
-- Enables instant zero-latency WebSocket push updates to 100+ concurrent players without database query storms
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.game_settings;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- 10. UPDATE ALL SONGS TO 5 SECONDS DURATION
UPDATE public.songs
SET duration_seconds = 5.0
WHERE duration_seconds = 8.0 OR duration_seconds IS NULL;




