// Initialize Supabase client
const supabase = window.supabase.createClient(
  'https://vfkalemgmhobyuqvzreh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZma2FsZW1nbWhvYnl1cXZ6cmVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxMTkzMTksImV4cCI6MjA2MzY5NTMxOX0.oLcwsfd7ZAXaWilOmFxkRZs59qD54G4-geS3YMm2v5M'
);

let user = null;
let userVotes = new Map(); // songId -> points given by user
let totalVotesUsed = 0;
let selectedArtist = null;
let selectedPoints = 0;

// DOM elements
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userDisplay = document.getElementById('user-display');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const votesRemaining = document.getElementById('votes-remaining');
const mainContent = document.getElementById('main-content');

// Modal elements
const voteModal = document.getElementById('vote-modal');
const modalArtistName = document.getElementById('modal-artist-name');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');
const voteOptionBtns = document.querySelectorAll('.vote-option-btn');
const thankYouModal = document.getElementById('thank-you-modal');
const thankYouClose = document.getElementById('thank-you-close');

// Event listeners
loginBtn.addEventListener('click', handleLogin);
logoutBtn.addEventListener('click', handleLogout);
modalCancel.addEventListener('click', closeVoteModal);
modalConfirm.addEventListener('click', confirmVote);
thankYouClose.addEventListener('click', closeThankYouModal);

// Vote option button listeners
voteOptionBtns.forEach(btn => {
  btn.addEventListener('click', () => selectVoteOption(parseInt(btn.dataset.points)));
});

// Handle Twitch OAuth login
async function handleLogin() {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'twitch',
      options: {
        redirectTo: window.location.origin
      }
    });

    if (error) {
      console.error('OAuth Error:', error);
      showError('Failed to sign in with Twitch. Please try again.');
    }
  } catch (error) {
    console.error('Login error:', error);
    showError('An unexpected error occurred during login.');
  }
}

// Handle logout
async function handleLogout() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Logout error:', error);
      showError('Failed to logout. Please try again.');
    }
  } catch (error) {
    console.error('Logout error:', error);
    showError('An unexpected error occurred during logout.');
  }
}

// Update UI based on authentication state
function updateAuthUI(session) {
  if (session?.user) {
    user = session.user;
    
    // Update header
    loginBtn.style.display = 'none';
    userDisplay.style.display = 'flex';
    userAvatar.src = user.user_metadata?.avatar_url || '';
    userName.textContent = user.user_metadata?.preferred_username || user.email;
    
    // Load user's votes
    loadUserVotes();
  } else {
    user = null;
    userVotes.clear();
    totalVotesUsed = 0;
    
    // Update header
    loginBtn.style.display = 'block';
    userDisplay.style.display = 'none';
  }
  
  loadArtists();
}

// Load user's existing votes
async function loadUserVotes() {
  if (!user) return;
  
  try {
    const { data: votes, error } = await supabase
      .from('votes')
      .select('song_id, points')
      .eq('user_id', user.id);

    if (error) {
      console.error('Error loading user votes:', error);
      return;
    }

    userVotes.clear();
    totalVotesUsed = 0;

    votes.forEach(vote => {
      userVotes.set(vote.song_id, vote.points);
      totalVotesUsed += vote.points;
    });

    updateVotesDisplay();
  } catch (error) {
    console.error('Error loading user votes:', error);
  }
}

// Update votes remaining display
function updateVotesDisplay() {
  const remaining = 10 - totalVotesUsed;
  votesRemaining.textContent = `${remaining} votes left`;
  
  if (remaining === 0) {
    showThankYouModal();
  }
}

// Load and display artists
async function loadArtists() {
  try {
    mainContent.innerHTML = '<div style="text-align: center; padding: 2rem; color: #a0a0a0;">Loading artists...</div>';

    const { data: artists, error } = await supabase
      .from('artists')
      .select('*')
      .order('display_name');

    if (error) {
      console.error('Error loading artists:', error);
      showError('Failed to load artists. Please refresh the page.');
      return;
    }

    if (!user) {
      showLoginPrompt();
      return;
    }

    if (!artists || artists.length === 0) {
      mainContent.innerHTML = '<div style="text-align: center; padding: 2rem; color: #a0a0a0;">No artists found.</div>';
      return;
    }

    renderArtists(artists);
  } catch (error) {
    console.error('Error loading artists:', error);
    showError('An unexpected error occurred while loading artists.');
  }
}

// Show login prompt
function showLoginPrompt() {
  mainContent.innerHTML = `
    <div class="login-prompt">
      <h2>Welcome to Music Jam!</h2>
      <p>Sign in with your Twitch account to listen to amazing music and vote for your favorite artists.</p>
      <p>🎵 Discover new talent • 🗳️ Cast your 10 votes • 🏆 Help artists win!</p>
      <p><strong>Rules:</strong> You have 10 total votes to distribute. You can give up to 5 votes per song.</p>
    </div>
  `;
}

// Render artist grid
function renderArtists(artists) {
  const grid = document.createElement('div');
  grid.className = 'artist-grid';
  grid.id = 'artist-grid';

  artists.forEach(artist => {
    const userVotesForSong = userVotes.get(artist.id) || 0;
    const remainingVotes = 10 - totalVotesUsed;
    const canVote = remainingVotes > 0 && userVotesForSong < 5;
    
    const card = document.createElement('div');
    card.className = 'artist-card';

    // Get song URL from Supabase storage
    const songURL = supabase.storage
      .from('songs')
      .getPublicUrl(`${artist.twitch_username}.mp3`).data.publicUrl;

    card.innerHTML = `
      <a href="${artist.twitch_url}" target="_blank" rel="noopener">
        <img src="${artist.image_url}" alt="${artist.display_name}" class="artist-img" />
      </a>
      <h3 class="artist-name">${artist.display_name}</h3>
      ${artist.song_title ? `<p class="song-title">"${artist.song_title}"</p>` : ''}
      <audio controls class="artist-audio">
        <source src="${songURL}" type="audio/mpeg">
        Your browser does not support the audio element.
      </audio>
      <div class="vote-section">
        ${userVotesForSong > 0 ? `<div class="user-votes">You gave ${userVotesForSong} vote${userVotesForSong !== 1 ? 's' : ''}</div>` : ''}
        <button 
          class="vote-btn" 
          onclick="openVoteModal('${artist.id}', '${artist.display_name.replace(/'/g, "\\'")}')"
          ${!canVote ? 'disabled' : ''}
        >
          ${remainingVotes === 0 ? 'No Votes Left' : 
            userVotesForSong >= 5 ? 'Max Votes Used' : 
            userVotesForSong > 0 ? 'Vote Again' : 'Vote'}
        </button>
      </div>
    `;

    grid.appendChild(card);
  });

  mainContent.innerHTML = '';
  mainContent.appendChild(grid);
}

// Open vote modal
function openVoteModal(artistId, artistName) {
  const remainingVotes = 10 - totalVotesUsed;
  const userVotesForSong = userVotes.get(artistId) || 0;
  const maxAdditionalVotes = Math.min(remainingVotes, 5 - userVotesForSong);
  
  if (maxAdditionalVotes <= 0) return;

  selectedArtist = artistId;
  modalArtistName.textContent = artistName;
  
  // Update vote option buttons
  voteOptionBtns.forEach(btn => {
    const points = parseInt(btn.dataset.points);
    if (points <= maxAdditionalVotes) {
      btn.disabled = false;
      btn.classList.remove('selected');
    } else {
      btn.disabled = true;
      btn.classList.remove('selected');
    }
  });

  selectedPoints = 0;
  modalConfirm.disabled = true;
  voteModal.style.display = 'flex';
}

// Close vote modal
function closeVoteModal() {
  voteModal.style.display = 'none';
  selectedArtist = null;
  selectedPoints = 0;
  
  // Clear selection
  voteOptionBtns.forEach(btn => btn.classList.remove('selected'));
}

// Select vote option
function selectVoteOption(points) {
  selectedPoints = points;
  
  // Update button states
  voteOptionBtns.forEach(btn => {
    if (parseInt(btn.dataset.points) === points) {
      btn.classList.add('selected');
    } else {
      btn.classList.remove('selected');
    }
  });
  
  modalConfirm.disabled = false;
}

// Confirm vote
async function confirmVote() {
  if (!selectedArtist || selectedPoints === 0) return;

  // Show loading state
  modalConfirm.innerHTML = '<span class="loading-spinner"></span> Voting...';
  modalConfirm.disabled = true;

  try {
    // Check if user already voted for this song
    const existingVotes = userVotes.get(selectedArtist) || 0;
    const newTotalVotes = existingVotes + selectedPoints;

    if (existingVotes > 0) {
      // Update existing vote
      const { error } = await supabase
        .from('votes')
        .update({ 
          points: newTotalVotes,
          created_at: new Date().toISOString()
        })
        .eq('user_id', user.id)
        .eq('song_id', selectedArtist);

      if (error) throw error;
    } else {
      // Insert new vote
      const { error } = await supabase
        .from('votes')
        .insert([{
          user_id: user.id,
          song_id: selectedArtist,
          points: selectedPoints,
          created_at: new Date().toISOString()
        }]);

      if (error) throw error;
    }

    // Update local state
    userVotes.set(selectedArtist, newTotalVotes);
    totalVotesUsed += selectedPoints;
    
    // Close modal and refresh display
    closeVoteModal();
    updateVotesDisplay();
    loadArtists();

  } catch (error) {
    console.error('Vote error:', error);
    showError('Failed to submit vote. Please try again.');
    
    // Restore button state
    modalConfirm.textContent = 'Vote';
    modalConfirm.disabled = false;
  }
}

// Show thank you modal
function showThankYouModal() {
  thankYouModal.style.display = 'flex';
}

// Close thank you modal
function closeThankYouModal() {
  thankYouModal.style.display = 'none';
}

// Show error message
function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;
  
  // Remove existing error messages
  const existingError = document.querySelector('.error-message');
  if (existingError) {
    existingError.remove();
  }
  
  // Insert error message
  document.body.insertBefore(errorDiv, mainContent);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    errorDiv.remove();
  }, 5000);
}

// Listen for auth state changes
supabase.auth.onAuthStateChange((event, session) => {
  console.log('Auth state changed:', event, session);
  updateAuthUI(session);
});

// Initialize app
async function init() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    updateAuthUI(session);
  } catch (error) {
    console.error('Initialization error:', error);
    showError('Failed to initialize app. Please refresh the page.');
  }
}

// Make functions globally accessible
window.openVoteModal = openVoteModal;

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}