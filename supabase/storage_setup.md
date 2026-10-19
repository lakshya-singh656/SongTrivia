# Supabase Storage Setup: `song-clips` Bucket

This guide explains how to set up the audio storage bucket for Horror Song Trivia in Supabase.

## 1. Create the Storage Bucket in Supabase Dashboard
1. Go to your **Supabase Dashboard** -> **Storage**.
2. Click **New Bucket**.
3. Name the bucket: `song-clips`.
4. Check **Public bucket** (so audio files can be streamed by participants without expiring signed tokens).
5. File size limit: `10MB` (recommended for 5-10s audio clips).
6. Allowed MIME types: `audio/mpeg, audio/mp3, audio/wav, audio/x-m4a, audio/mp4, audio/aac, audio/ogg`.

---

## 2. Supabase Storage SQL Policies
Run the following SQL in your **Supabase SQL Editor** to configure security policies for the `song-clips` bucket:

```sql
-- Allow public access to listen/stream audio files
CREATE POLICY "Public Read Access for Song Clips"
ON storage.objects FOR SELECT
USING (bucket_id = 'song-clips');

-- Allow authenticated organizers/admins to upload audio clips
CREATE POLICY "Admin Upload Access for Song Clips"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'song-clips');

-- Allow authenticated organizers/admins to update or replace audio clips
CREATE POLICY "Admin Update Access for Song Clips"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'song-clips');

-- Allow authenticated organizers/admins to delete audio clips
CREATE POLICY "Admin Delete Access for Song Clips"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'song-clips');
```

---

## 3. Supported File Types & Best Practices
- **Recommended**: MP3, WAV, M4A, OGG
- **Duration**: 5–10 seconds snippet
- **Audio Validation**: The frontend checks file size (< 10MB) and valid audio MIME types before initiating the upload.
