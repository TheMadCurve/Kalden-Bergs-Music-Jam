// Supabase Configuration
// Store your Supabase credentials in a separate file for easier management
const SUPABASE_CONFIG = {
  url: 'https://vfkalemgmhobyuqvzreh.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZma2FsZW1nbWhvYnl1cXZ6cmVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxMTkzMTksImV4cCI6MjA2MzY5NTMxOX0.oLcwsfd7ZAXaWilOmFxkRZs59qD54G4-geS3YMm2v5M',
  redirectUrl: 'https://themadcurve.github.io/Kalden-Bergs-Music-Jam/'
};

// Application Configuration
const APP_CONFIG = {
  maxVotesPerUser: 10,
  maxVotesPerSong: 5,
  minVotes: 1,
  maxVotes: 5,
  debounceDelay: 300,
  toastDuration: 3000,
  retryAttempts: 3,
  retryDelay: 1000
};