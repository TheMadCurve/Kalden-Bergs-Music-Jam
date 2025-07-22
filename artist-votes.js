/**
 * Artist Vote Display Script
 * 
 * INSTRUCTIONS FOR ARTISTS:
 * 1. Replace the ARTIST_KEY below with your unique song_id from Supabase
 * 2. This key will be provided to you by the event organizer
 * 3. Keep this key private - don't share it publicly
 * 4. Save the file and use it in OBS as a browser source
 */

// ============================================
// ARTIST CONFIGURATION - EDIT THIS SECTION
// ============================================

const ARTIST_KEY = 'bdafd171-e880-4df7-8cb8-fe3d94867a80'; // Replace with your song_id (UUID)

// Optional: Set display mode ('normal', 'minimal', or 'ultra-minimal')
const DISPLAY_MODE = 'normal';

// ============================================
// DO NOT EDIT BELOW THIS LINE
// ============================================

// Validate artist key format (basic UUID check)
function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

// Apply display mode
if (DISPLAY_MODE === 'minimal') {
  document.getElementById('container').classList.add('minimal');
} else if (DISPLAY_MODE === 'ultra-minimal') {
  document.getElementById('container').classList.add('minimal', 'ultra-minimal');
}

// Initialize Supabase
const supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

// State
let currentVotes = 0;
let artistData = null;
let updateTimer = null;

// Load artist votes
async function loadVotes() {
  try {
    // Validate artist key
    if (!ARTIST_KEY || ARTIST_KEY === 'YOUR-SONG-ID-HERE') {
      throw new Error('NOT_CONFIGURED');
    }

    if (!isValidUUID(ARTIST_KEY)) {
      throw new Error('INVALID_KEY');
    }

    // Get artist info if we don't have it yet
    if (!artistData) {
      const { data: artist, error: artistError } = await supabase
        .from('artists')
        .select('song_id, display_name, twitch_username')
        .eq('song_id', ARTIST_KEY)
        .single();

      if (artistError || !artist) {
        throw new Error('ARTIST_NOT_FOUND');
      }
      
      artistData = artist;
      
      // Add artist-specific class for colors
      const username = artistData.twitch_username.toLowerCase();
      document.getElementById('container').classList.add(`artist-${username}`);
    }

    // Get total votes for this artist
    const { data: votes, error: votesError } = await supabase
      .from('votes')
      .select('points')
      .eq('song_id', ARTIST_KEY);

    if (votesError) throw votesError;

    // Calculate total
    const newTotal = votes.reduce((sum, vote) => sum + vote.points, 0);
    
    // Update display with animation if count changed
    if (newTotal !== currentVotes) {
      updateVoteDisplay(newTotal);
      currentVotes = newTotal;
    }

  } catch (error) {
    console.error('Error loading votes:', error);
    showError(error.message);
  }
}

// Update vote display with animation
function updateVoteDisplay(count) {
  const content = document.getElementById('content');
  const wasFirstLoad = content.classList.contains('loading');
  
  content.innerHTML = `
    ${artistData && DISPLAY_MODE === 'normal' ? `<div class="artist-name">${artistData.display_name}</div>` : ''}
    <div class="vote-count ${!wasFirstLoad ? 'pulse' : ''}" id="vote-count">${count}</div>
    <div class="vote-label">vote${count !== 1 ? 's' : ''}</div>
  `;
  
  content.classList.remove('loading');
}

// Show error state with helpful messages
function showError(errorType) {
  const content = document.getElementById('content');
  let errorContent = '';

  switch(errorType) {
    case 'NOT_CONFIGURED':
      errorContent = `
        <div class="error">
          <div class="error-title">Not Configured</div>
          <div class="error-message">Please add your artist key</div>
          <div class="error-instructions">
            Edit <code>artist-votes.js</code> and replace<br>
            <code>YOUR-SONG-ID-HERE</code> with your unique key
          </div>
        </div>
      `;
      break;
    
    case 'INVALID_KEY':
      errorContent = `
        <div class="error">
          <div class="error-title">Invalid Key</div>
          <div class="error-message">The artist key format is incorrect</div>
          <div class="error-instructions">
            Make sure your key looks like:<br>
            <code>12345678-1234-1234-1234-123456789012</code>
          </div>
        </div>
      `;
      break;
    
    case 'ARTIST_NOT_FOUND':
      errorContent = `
        <div class="error">
          <div class="error-title">Artist Not Found</div>
          <div class="error-message">Invalid or expired artist key</div>
          <div class="error-instructions">
            Please contact the event organizer<br>
            for your correct artist key
          </div>
        </div>
      `;
      break;
    
    default:
      errorContent = `
        <div class="error">
          <div class="error-title">Connection Error</div>
          <div class="error-message">Unable to load vote count</div>
          <div class="error-instructions">
            Please check your internet connection<br>
            and refresh the browser source
          </div>
        </div>
      `;
  }

  content.innerHTML = errorContent;
  content.classList.remove('loading');
}

// Setup real-time subscription
function setupRealtimeUpdates() {
  if (!artistData) return;

  const channel = supabase
    .channel(`artist-votes-${ARTIST_KEY}`)
    .on('postgres_changes', 
      { 
        event: '*', 
        schema: 'public', 
        table: 'votes',
        filter: `song_id=eq.${ARTIST_KEY}`
      }, 
      (payload) => {
        console.log('Vote change detected:', payload);
        // Debounce updates
        clearTimeout(updateTimer);
        updateTimer = setTimeout(loadVotes, 500);
      }
    )
    .subscribe();
}

// Initialize
async function init() {
  await loadVotes();
  
  // Only setup realtime if we successfully loaded artist data
  if (artistData) {
    setupRealtimeUpdates();
    
    // Fallback polling every 10 seconds
    setInterval(loadVotes, 10000);
  }
}

// Start the app
init();