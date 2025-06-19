// Initialize Supabase client
const supabase = window.supabase.createClient(
  'https://vfkalemgmhobyuqvzreh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZma2FsZW1nbWhvYnl1cXZ6cmVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxMTkzMTksImV4cCI6MjA2MzY5NTMxOX0.oLcwsfd7ZAXaWilOmFxkRZs59qD54G4-geS3YMm2v5M'
);

// Application state
class AppState {
  constructor() {
    this.user = null;
    this.userVotes = new Map(); // songId -> points given by user
    this.totalVotesUsed = 0;
    this.selectedArtist = null;
    this.selectedPoints = 0;
    this.isLoading = false;
    this.artists = [];
    this.maxVotesPerUser = 10;
    this.maxVotesPerSong = 5;
  }

  reset() {
    this.user = null;
    this.userVotes.clear();
    this.totalVotesUsed = 0;
    this.selectedArtist = null;
    this.selectedPoints = 0;
    this.artists = [];
  }

  getRemainingVotes() {
    return this.maxVotesPerUser - this.totalVotesUsed;
  }

  canVoteForSong(songId) {
    const userVotesForSong = this.userVotes.get(songId) || 0;
    return this.getRemainingVotes() > 0 && userVotesForSong < this.maxVotesPerSong;
  }

  getMaxAdditionalVotes(songId) {
    const userVotesForSong = this.userVotes.get(songId) || 0;
    return Math.min(this.getRemainingVotes(), this.maxVotesPerSong - userVotesForSong);
  }
}

// Initialize app state
const appState = new AppState();

// DOM elements - with null checks
const elements = {
  loginBtn: document.getElementById('login-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  votesRemaining: document.getElementById('votes-remaining'),
  mainContent: document.getElementById('main-content'),
  voteModal: document.getElementById('vote-modal'),
  modalArtistName: document.getElementById('modal-artist-name'),
  modalCancel: document.getElementById('modal-cancel'),
  modalConfirm: document.getElementById('modal-confirm'),
  voteOptionBtns: document.querySelectorAll('.vote-option-btn'),
  thankYouModal: document.getElementById('thank-you-modal'),
  thankYouClose: document.getElementById('thank-you-close')
};

// Validate required elements exist
function validateElements() {
  const required = ['loginBtn', 'logoutBtn', 'votesRemaining', 'mainContent'];
  const missing = required.filter(key => !elements[key]);
  
  if (missing.length > 0) {
    console.error('Missing required DOM elements:', missing);
    showError('Application failed to initialize. Please refresh the page.');
    return false;
  }
  return true;
}

// Utility functions
const utils = {
  // Debounce function to prevent rapid clicking
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Sanitize string for display
  sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>&"']/g, (match) => {
      const escape = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return escape[match];
    });
  },

  // Validate vote points
  isValidVotePoints(points) {
    return Number.isInteger(points) && points >= 1 && points <= 5;
  },

  // Format error message for user
  formatErrorMessage(error) {
    if (!error) return 'An unexpected error occurred';
    
    // Handle Supabase errors
    if (error.message) {
      if (error.message.includes('JWT')) {
        return 'Your session has expired. Please sign in again.';
      }
      if (error.message.includes('network')) {
        return 'Network error. Please check your connection and try again.';
      }
      if (error.message.includes('duplicate')) {
        return 'You have already voted for this song.';
      }
    }
    
    return error.message || 'An unexpected error occurred';
  }
};

// Event handlers with debouncing
const handlers = {
  login: utils.debounce(handleLogin, 1000),
  logout: utils.debounce(handleLogout, 1000),
  confirmVote: utils.debounce(confirmVote, 1000)
};

// Setup event listeners
function setupEventListeners() {
  if (!validateElements()) return;

  // Auth buttons
  elements.loginBtn?.addEventListener('click', handlers.login);
  elements.logoutBtn?.addEventListener('click', handlers.logout);

  // Modal controls
  elements.modalCancel?.addEventListener('click', closeVoteModal);
  elements.modalConfirm?.addEventListener('click', handlers.confirmVote);
  elements.thankYouClose?.addEventListener('click', closeThankYouModal);

  // Vote option buttons
  elements.voteOptionBtns?.forEach(btn => {
    btn.addEventListener('click', () => {
      const points = parseInt(btn.dataset.points);
      if (utils.isValidVotePoints(points)) {
        selectVoteOption(points);
      }
    });
  });

  // Close modals on background click
  elements.voteModal?.addEventListener('click', (e) => {
    if (e.target === elements.voteModal) closeVoteModal();
  });
  
  elements.thankYouModal?.addEventListener('click', (e) => {
    if (e.target === elements.thankYouModal) closeThankYouModal();
  });

  // Handle keyboard events
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (elements.voteModal?.style.display === 'flex') closeVoteModal();
      if (elements.thankYouModal?.style.display === 'flex') closeThankYouModal();
    }
  });
}

// Handle Twitch OAuth login
async function handleLogin() {
  if (appState.isLoading) return;
  
  try {
    appState.isLoading = true;
    elements.loginBtn.disabled = true;
    elements.loginBtn.innerHTML = '<span class="loading-spinner"></span> Connecting...';

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'twitch',
      options: {
        redirectTo: 'https://themadcurve.github.io/Kalden-Bergs-Music-Jam/'
      }
    });

    if (error) throw error;

  } catch (error) {
    console.error('Login error:', error);
    showError(utils.formatErrorMessage(error));
  } finally {
    appState.isLoading = false;
    elements.loginBtn.disabled = false;
    elements.loginBtn.textContent = 'Sign in with Twitch';
  }
}

// Handle logout
async function handleLogout() {
  if (appState.isLoading) return;
  
  try {
    appState.isLoading = true;
    elements.logoutBtn.disabled = true;
    elements.logoutBtn.innerHTML = '<span class="loading-spinner"></span>';

    const { error } = await supabase.auth.signOut();
    if (error) throw error;

  } catch (error) {
    console.error('Logout error:', error);
    showError(utils.formatErrorMessage(error));
  } finally {
    appState.isLoading = false;
    elements.logoutBtn.disabled = false;
    elements.logoutBtn.textContent = 'Logout';
  }
}

// Update UI based on authentication state
function updateAuthUI(session) {
  try {
    if (session?.user) {
      appState.user = session.user;
      
      // Show logged-in state
      elements.loginBtn.style.display = 'none';
      elements.logoutBtn.style.display = 'block';
      elements.votesRemaining.style.display = 'block';
      
      // Load user data
      loadUserVotes();
    } else {
      // Reset state and show logged-out state
      appState.reset();
      
      elements.loginBtn.style.display = 'block';
      elements.logoutBtn.style.display = 'none';
      elements.votesRemaining.style.display = 'none';
    }
    
    loadArtists();
  } catch (error) {
    console.error('Error updating auth UI:', error);
    showError('Failed to update user interface');
  }
}

// Load user's existing votes with retry logic
async function loadUserVotes(retryCount = 0) {
  if (!appState.user) return;
  
  try {
    const { data: votes, error } = await supabase
      .from('votes')
      .select('song_id, points')
      .eq('user_id', appState.user.id);

    if (error) throw error;

    // Reset vote tracking
    appState.userVotes.clear();
    appState.totalVotesUsed = 0;

    // Process votes
    if (votes && Array.isArray(votes)) {
      votes.forEach(vote => {
        if (vote.song_id && typeof vote.points === 'number') {
          appState.userVotes.set(vote.song_id, vote.points);
          appState.totalVotesUsed += vote.points;
        }
      });
    }

    updateVotesDisplay();
  } catch (error) {
    console.error('Error loading user votes:', error);
    
    // Retry logic for network errors
    if (retryCount < 2 && error.message?.includes('network')) {
      setTimeout(() => loadUserVotes(retryCount + 1), 1000 * (retryCount + 1));
      return;
    }
    
    showError('Failed to load your votes. Some features may not work correctly.');
  }
}

// Update votes remaining display
function updateVotesDisplay() {
  try {
    const remaining = appState.getRemainingVotes();
    elements.votesRemaining.textContent = `${remaining} vote${remaining !== 1 ? 's' : ''} left`;
    
    if (remaining === 0) {
      setTimeout(showThankYouModal, 500); // Small delay for better UX
    }
  } catch (error) {
    console.error('Error updating votes display:', error);
  }
}

// Load and display artists with better error handling
async function loadArtists(retryCount = 0) {
  try {
    elements.mainContent.innerHTML = '<div style="text-align: center; padding: 2rem; color: #a0a0a0;"><span class="loading-spinner"></span> Loading artists...</div>';

    const { data: artists, error } = await supabase
      .from('artists')
      .select('*')
      .order('display_name');

    if (error) throw error;

    appState.artists = artists || [];

    if (!appState.user) {
      showLoginPrompt();
      return;
    }

    if (appState.artists.length === 0) {
      elements.mainContent.innerHTML = '<div style="text-align: center; padding: 2rem; color: #a0a0a0;">No artists found. Check back later!</div>';
      return;
    }

    renderArtists(appState.artists);
  } catch (error) {
    console.error('Error loading artists:', error);
    
    // Retry logic
    if (retryCount < 2) {
      setTimeout(() => loadArtists(retryCount + 1), 2000 * (retryCount + 1));
      return;
    }
    
    showError('Failed to load artists. Please refresh the page to try again.');
  }
}

// Show login prompt with better messaging
function showLoginPrompt() {
  elements.mainContent.innerHTML = `
    <div class="login-prompt">
      <h2>🎵 Welcome to Kalden's Music Jam!</h2>
      <p>Sign in with your Twitch account to listen to amazing music and vote for your favorite artists.</p>
      <div style="margin: 2rem 0; padding: 1.5rem; background: rgba(145, 70, 255, 0.1); border-radius: 0.75rem; border: 1px solid rgba(145, 70, 255, 0.3);">
        <h3 style="margin: 0 0 1rem 0; color: #9146FF;">How it works:</h3>
        <p>🗳️ You get <strong>10 total votes</strong> to distribute</p>
        <p>🎯 Give up to <strong>5 votes per song</strong></p>
        <p>🎧 Listen first, then vote for your favorites</p>
        <p>🏆 Help your favorite artists win!</p>
      </div>
      <p style="color: #666; font-size: 0.9rem;">Safe & secure - we only access your public Twitch profile</p>
    </div>
  `;
}

// Render artist grid with better error handling
function renderArtists(artists) {
  if (!Array.isArray(artists)) {
    console.error('Invalid artists data:', artists);
    showError('Invalid artist data received');
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'artist-grid';
  grid.id = 'artist-grid';

  artists.forEach(artist => {
    try {
      if (!artist.id || !artist.display_name) {
        console.warn('Invalid artist data:', artist);
        return;
      }

      const userVotesForSong = appState.userVotes.get(artist.id) || 0;
      const canVote = appState.canVoteForSong(artist.id);
      const remainingVotes = appState.getRemainingVotes();
      
      const card = document.createElement('div');
      card.className = 'artist-card';

      // Get song URL from Supabase storage
      const songURL = supabase.storage
        .from('songs')
        .getPublicUrl(`${artist.twitch_username}.mp3`).data.publicUrl;

      // Sanitize data for display
      const displayName = utils.sanitizeString(artist.display_name);
      const songTitle = utils.sanitizeString(artist.song_title || '');
      const twitchUrl = artist.twitch_url || '#';

      // Determine button state and text
      let buttonText = 'Vote';
      let buttonDisabled = false;

      if (remainingVotes === 0) {
        buttonText = 'No Votes Left';
        buttonDisabled = true;
      } else if (userVotesForSong >= appState.maxVotesPerSong) {
        buttonText = 'Max Votes Used';
        buttonDisabled = true;
      } else if (userVotesForSong > 0) {
        buttonText = 'Vote Again';
      }

      card.innerHTML = `
        <a href="${twitchUrl}" target="_blank" rel="noopener noreferrer">
          <img src="${artist.image_url || 'images/default-artist.png'}" 
               alt="${displayName}" 
               class="artist-img" 
               onerror="this.src='images/default-artist.png'" />
        </a>
        <h3 class="artist-name">${displayName}</h3>
        ${songTitle ? `<p class="song-title">"${songTitle}"</p>` : ''}
        <audio controls class="artist-audio" preload="metadata">
          <source src="${songURL}" type="audio/mpeg">
          Your browser does not support the audio element.
        </audio>
        <div class="vote-section">
          ${userVotesForSong > 0 ? `<div class="user-votes">You gave ${userVotesForSong} vote${userVotesForSong !== 1 ? 's' : ''}</div>` : ''}
          <button 
            class="vote-btn" 
            onclick="openVoteModal('${artist.id}', '${displayName.replace(/'/g, "\\'")}')"
            ${buttonDisabled ? 'disabled' : ''}
          >
            ${buttonText}
          </button>
        </div>
      `;

      grid.appendChild(card);
    } catch (error) {
      console.error('Error rendering artist card:', error, artist);
    }
  });

  elements.mainContent.innerHTML = '';
  elements.mainContent.appendChild(grid);
}

// Open vote modal with validation
function openVoteModal(artistId, artistName) {
  try {
    if (!artistId || !artistName) {
      console.error('Invalid modal parameters:', { artistId, artistName });
      return;
    }

    const maxAdditionalVotes = appState.getMaxAdditionalVotes(artistId);
    
    if (maxAdditionalVotes <= 0) {
      showError('Cannot vote for this song');
      return;
    }

    appState.selectedArtist = artistId;
    elements.modalArtistName.textContent = artistName;
    
    // Update vote option buttons
    elements.voteOptionBtns.forEach(btn => {
      const points = parseInt(btn.dataset.points);
      if (utils.isValidVotePoints(points) && points <= maxAdditionalVotes) {
        btn.disabled = false;
        btn.classList.remove('selected');
      } else {
        btn.disabled = true;
        btn.classList.remove('selected');
      }
    });

    appState.selectedPoints = 0;
    elements.modalConfirm.disabled = true;
    elements.voteModal.style.display = 'flex';
    
    // Focus management for accessibility
    elements.voteModal.setAttribute('aria-hidden', 'false');
  } catch (error) {
    console.error('Error opening vote modal:', error);
    showError('Failed to open voting interface');
  }
}

// Close vote modal
function closeVoteModal() {
  try {
    elements.voteModal.style.display = 'none';
    elements.voteModal.setAttribute('aria-hidden', 'true');
    appState.selectedArtist = null;
    appState.selectedPoints = 0;
    
    // Clear selection
    elements.voteOptionBtns.forEach(btn => btn.classList.remove('selected'));
  } catch (error) {
    console.error('Error closing vote modal:', error);
  }
}

// Select vote option
function selectVoteOption(points) {
  try {
    if (!utils.isValidVotePoints(points)) {
      console.error('Invalid vote points:', points);
      return;
    }

    appState.selectedPoints = points;
    
    // Update button states
    elements.voteOptionBtns.forEach(btn => {
      if (parseInt(btn.dataset.points) === points) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });
    
    elements.modalConfirm.disabled = false;
  } catch (error) {
    console.error('Error selecting vote option:', error);
  }
}

// Confirm vote with comprehensive error handling
async function confirmVote() {
  if (!appState.selectedArtist || !appState.selectedPoints || appState.isLoading) {
    return;
  }

  // Validate vote before submitting
  if (!utils.isValidVotePoints(appState.selectedPoints)) {
    showError('Invalid vote amount selected');
    return;
  }

  const maxAdditional = appState.getMaxAdditionalVotes(appState.selectedArtist);
  if (appState.selectedPoints > maxAdditional) {
    showError('Cannot vote more than allowed');
    return;
  }

  try {
    appState.isLoading = true;
    
    // Show loading state
    elements.modalConfirm.innerHTML = '<span class="loading-spinner"></span> Voting...';
    elements.modalConfirm.disabled = true;

    const existingVotes = appState.userVotes.get(appState.selectedArtist) || 0;
    const newTotalVotes = existingVotes + appState.selectedPoints;

    let result;
    if (existingVotes > 0) {
      // Update existing vote
      result = await supabase
        .from('votes')
        .update({ 
          points: newTotalVotes,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', appState.user.id)
        .eq('song_id', appState.selectedArtist);
    } else {
      // Insert new vote
      result = await supabase
        .from('votes')
        .insert([{
          user_id: appState.user.id,
          song_id: appState.selectedArtist,
          points: appState.selectedPoints,
          created_at: new Date().toISOString()
        }]);
    }

    if (result.error) throw result.error;

    // Update local state
    appState.userVotes.set(appState.selectedArtist, newTotalVotes);
    appState.totalVotesUsed += appState.selectedPoints;
    
    // Close modal and refresh display
    closeVoteModal();
    updateVotesDisplay();
    loadArtists();

    // Show success feedback
    showSuccess(`Successfully voted with ${appState.selectedPoints} point${appState.selectedPoints !== 1 ? 's' : ''}!`);

  } catch (error) {
    console.error('Vote error:', error);
    showError(utils.formatErrorMessage(error));
    
    // Restore button state
    elements.modalConfirm.textContent = 'Vote';
    elements.modalConfirm.disabled = false;
  } finally {
    appState.isLoading = false;
  }
}

// Show thank you modal
function showThankYouModal() {
  try {
    elements.thankYouModal.style.display = 'flex';
    elements.thankYouModal.setAttribute('aria-hidden', 'false');
  } catch (error) {
    console.error('Error showing thank you modal:', error);
  }
}

// Close thank you modal
function closeThankYouModal() {
  try {
    elements.thankYouModal.style.display = 'none';
    elements.thankYouModal.setAttribute('aria-hidden', 'true');
  } catch (error) {
    console.error('Error closing thank you modal:', error);
  }
}

// Show error message with auto-dismiss
function showError(message) {
  try {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    errorDiv.setAttribute('role', 'alert');
    
    // Remove existing error messages
    document.querySelectorAll('.error-message').forEach(el => el.remove());
    
    // Insert error message
    document.body.insertBefore(errorDiv, elements.mainContent);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.remove();
      }
    }, 5000);
  } catch (error) {
    console.error('Error showing error message:', error);
  }
}

// Show success message
function showSuccess(message) {
  try {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.style.cssText = `
      background-color: #c6f6d5;
      color: #2f855a;
      padding: 1rem;
      border-radius: 0.5rem;
      margin: 1rem;
      text-align: center;
      border: 1px solid #9ae6b4;
    `;
    successDiv.textContent = message;
    successDiv.setAttribute('role', 'status');
    
    // Remove existing success messages
    document.querySelectorAll('.success-message').forEach(el => el.remove());
    
    // Insert success message
    document.body.insertBefore(successDiv, elements.mainContent);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      if (successDiv.parentNode) {
        successDiv.remove();
      }
    }, 3000);
  } catch (error) {
    console.error('Error showing success message:', error);
  }
}

// Listen for auth state changes
supabase.auth.onAuthStateChange((event, session) => {
  console.log('Auth state changed:', event);
  updateAuthUI(session);
});

// Initialize app with error handling
async function init() {
  try {
    if (!validateElements()) return;
    
    setupEventListeners();
    
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    
    updateAuthUI(session);
  } catch (error) {
    console.error('Initialization error:', error);
    showError('Failed to initialize app. Please refresh the page.');
  }
}

// Make functions globally accessible for onclick handlers
window.openVoteModal = openVoteModal;

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  // Cleanup any pending operations
  appState.isLoading = false;
});