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
