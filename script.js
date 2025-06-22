// Initialize Supabase client
const supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

// Application state management
class AppState {
  constructor() {
    this.user = null;
    this.userVotes = new Map(); // songId -> points
    this.totalVotesUsed = 0;
    this.selectedArtist = null;
    this.selectedPoints = 0;
    this.isLoading = false;
    this.artists = [];
    this.voteQueue = new Map(); // For optimistic updates
  }

  reset() {
    this.user = null;
    this.userVotes.clear();
    this.voteQueue.clear();
    this.totalVotesUsed = 0;
    this.selectedArtist = null;
    this.selectedPoints = 0;
    this.artists = [];
  }

  getRemainingVotes() {
    return APP_CONFIG.maxVotesPerUser - this.totalVotesUsed;
  }

  canVoteForSong(songId) {
    const currentVotes = this.userVotes.get(songId) || 0;
    const pendingVotes = this.voteQueue.get(songId) || 0;
    const totalVotesForSong = currentVotes + pendingVotes;
    
    return this.getRemainingVotes() > 0 && totalVotesForSong < APP_CONFIG.maxVotesPerSong;
  }

  getVotesForSong(songId) {
    return this.userVotes.get(songId) || 0;
  }

  getMaxAdditionalVotes(songId) {
    const currentVotes = this.getVotesForSong(songId);
    const remainingForSong = APP_CONFIG.maxVotesPerSong - currentVotes;
    const remainingTotal = this.getRemainingVotes();
    return Math.min(remainingForSong, remainingTotal, APP_CONFIG.maxVotes);
  }
}

// Initialize app state
const appState = new AppState();

// Cache DOM elements
const elements = {};

// Initialize DOM elements after page load
function initializeElements() {
  elements.loginBtn = document.getElementById('login-btn');
  elements.logoutBtn = document.getElementById('logout-btn');
  elements.votesRemaining = document.getElementById('votes-remaining');
  elements.votesCount = document.querySelector('.votes-count');
  elements.mainContent = document.getElementById('main-content');
  elements.loadingState = document.getElementById('loading-state');
  elements.voteModal = document.getElementById('vote-modal');
  elements.modalArtistName = document.getElementById('modal-artist-name');
  elements.modalVoteInfo = document.getElementById('modal-vote-info');
  elements.modalCancel = document.getElementById('modal-cancel');
  elements.modalConfirm = document.getElementById('modal-confirm');
  elements.voteOptionBtns = document.querySelectorAll('.vote-option-btn');
  elements.thankYouModal = document.getElementById('thank-you-modal');
  elements.thankYouClose = document.getElementById('thank-you-close');
  elements.toastContainer = document.getElementById('toast-container');
  elements.userInfo = document.getElementById('user-info');
  elements.usernameDisplay = document.getElementById('username-display');
}

// Utility functions
const utils = {
  // Enhanced debounce with immediate option
  debounce(func, wait, immediate = false) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        timeout = null;
        if (!immediate) func(...args);
      };
      const callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func(...args);
    };
  },

  // Sanitize HTML to prevent XSS
  sanitizeHTML(str) {
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
  },

  // Format numbers with proper pluralization
  pluralize(count, singular, plural = null) {
    return count === 1 ? singular : (plural || `${singular}s`);
  },

  // Retry function for network operations
  async retry(fn, retries = APP_CONFIG.retryAttempts, delay = APP_CONFIG.retryDelay) {
    try {
      return await fn();
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        return utils.retry(fn, retries - 1, delay * 2);
      }
      throw error;
    }
  },

  // Get Twitch username from provider info
  getTwitchUsername(user) {
    return user?.user_metadata?.preferred_username || 
           user?.user_metadata?.name || 
           'User';
  }
};

// Toast notification system
const toast = {
  show(message, type = 'info', duration = APP_CONFIG.toastDuration) {
    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;
    toastEl.textContent = message;
    toastEl.setAttribute('role', 'alert');
    
    elements.toastContainer.appendChild(toastEl);
    
    // Trigger animation
    requestAnimationFrame(() => {
      toastEl.classList.add('show');
    });
    
    // Auto remove
    setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => toastEl.remove(), 300);
    }, duration);
  },
  
  success(message) { this.show(message, 'success'); },
  error(message) { this.show(message, 'error'); },
  info(message) { this.show(message, 'info'); }
};

// Event handlers
const handlers = {
  login: utils.debounce(handleLogin, 1000),
  logout: utils.debounce(handleLogout, 1000),
  vote: utils.debounce(handleVote, 500)
};

// Setup all event listeners
function setupEventListeners() {
  // Auth buttons
  elements.loginBtn?.addEventListener('click', handlers.login);
  elements.logoutBtn?.addEventListener('click', handlers.logout);

  // Modal controls
  elements.modalCancel?.addEventListener('click', closeVoteModal);
  elements.modalConfirm?.addEventListener('click', handlers.vote);
  elements.thankYouClose?.addEventListener('click', closeThankYouModal);

  // Vote option buttons
  elements.voteOptionBtns?.forEach(btn => {
    btn.addEventListener('click', () => selectVoteOption(parseInt(btn.dataset.points)));
  });

  // Modal backdrop clicks
  [elements.voteModal, elements.thankYouModal].forEach(modal => {
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal === elements.voteModal ? closeVoteModal() : closeThankYouModal();
      }
    });
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (elements.voteModal?.style.display === 'flex') closeVoteModal();
      if (elements.thankYouModal?.style.display === 'flex') closeThankYouModal();
    }
  });

  // Prevent audio from playing simultaneously
  document.addEventListener('play', (e) => {
    const audios = document.querySelectorAll('audio');
    audios.forEach(audio => {
      if (audio !== e.target) audio.pause();
    });
  }, true);
}

// Authentication handlers
async function handleLogin() {
  if (appState.isLoading) return;
  
  try {
    appState.isLoading = true;
    elements.loginBtn.disabled = true;
    elements.loginBtn.innerHTML = '<span class="loading-spinner"></span> Connecting to Twitch...';

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'twitch',
      options: {
        redirectTo: SUPABASE_CONFIG.redirectUrl,
        scopes: 'user:read:email'
      }
    });

    if (error) throw error;

  } catch (error) {
    console.error('Login error:', error);
    toast.error('Failed to connect to Twitch. Please try again.');
  } finally {
    appState.isLoading = false;
    elements.loginBtn.disabled = false;
    elements.loginBtn.innerHTML = `
      <svg class="twitch-icon" viewBox="0 0 24 24" width="20" height="20">
        <path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
      </svg>
      Sign in with Twitch
    `;
  }
}

async function handleLogout() {
  if (appState.isLoading) return;
  
  try {
    appState.isLoading = true;
    elements.logoutBtn.disabled = true;
    elements.logoutBtn.innerHTML = '<span class="loading-spinner"></span>';

    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    toast.info('Logged out successfully');
  } catch (error) {
    console.error('Logout error:', error);
    toast.error('Failed to logout. Please try again.');
  } finally {
    appState.isLoading = false;
    elements.logoutBtn.disabled = false;
    elements.logoutBtn.textContent = 'Logout';
  }
}

// Update UI based on auth state
function updateAuthUI(session) {
  if (session?.user) {
    appState.user = session.user;
    const username = utils.getTwitchUsername(session.user);
    
    // Update UI elements
    elements.loginBtn.style.display = 'none';
    elements.logoutBtn.style.display = 'block';
    elements.votesRemaining.style.display = 'block';
    elements.userInfo.style.display = 'block';
    elements.usernameDisplay.textContent = `@${username}`;
    
    loadUserVotes();
  } else {
    appState.reset();
    
    elements.loginBtn.style.display = 'block';
    elements.logoutBtn.style.display = 'none';
    elements.votesRemaining.style.display = 'none';
    elements.userInfo.style.display = 'none';
  }
  
  loadArtists();
}

// Load user's votes
async function loadUserVotes() {
  if (!appState.user) return;
  
  try {
    const { data: votes, error } = await utils.retry(async () => {
      return await supabase
        .from('votes')
        .select('song_id, points')
        .eq('user_id', appState.user.id);
    });

    if (error) throw error;

    // Reset and recalculate votes
    appState.userVotes.clear();
    appState.totalVotesUsed = 0;

    votes?.forEach(vote => {
      appState.userVotes.set(vote.song_id, vote.points);
      appState.totalVotesUsed += vote.points;
    });

    updateVotesDisplay();
  } catch (error) {
    console.error('Error loading votes:', error);
    toast.error('Failed to load your votes');
  }
}

// Update votes display
function updateVotesDisplay() {
  const remaining = appState.getRemainingVotes();
  elements.votesCount.textContent = remaining;
  elements.votesRemaining.classList.toggle('low-votes', remaining <= 3);
  
  if (remaining === 0 && !elements.thankYouModal.style.display === 'flex') {
    setTimeout(showThankYouModal, 500);
  }
}

// Load and display artists
async function loadArtists() {
  try {
    showLoadingState(true);

    const { data: artists, error } = await utils.retry(async () => {
      return await supabase
        .from('artists')
        .select('*')
        .order('display_name');
    });

    if (error) throw error;

    appState.artists = artists || [];

    if (!appState.user) {
      showLoginPrompt();
    } else if (appState.artists.length === 0) {
      showEmptyState();
    } else {
      renderArtists(appState.artists);
    }
  } catch (error) {
    console.error('Error loading artists:', error);
    showErrorState();
  } finally {
    showLoadingState(false);
  }
}

// UI state management
function showLoadingState(show) {
  elements.loadingState.style.display = show ? 'flex' : 'none';
}

function showLoginPrompt() {
  elements.mainContent.innerHTML = `
    <div class="login-prompt">
      <div class="login-prompt-icon">🎵</div>
      <h2>Welcome to Kalden's Music Jam!</h2>
      <p>Sign in with your Twitch account to vote for your favorite artists</p>
      
      <div class="how-it-works">
        <h3>How Voting Works:</h3>
        <ul>
          <li>🗳️ You get <strong>10 total votes</strong> to distribute</li>
          <li>🎯 Give up to <strong>5 votes per song</strong></li>
          <li>🎧 Listen to each song before voting</li>
          <li>🏆 Help your favorite artists win!</li>
        </ul>
      </div>
      
      <button onclick="handlers.login()" class="login-prompt-btn">
        <svg class="twitch-icon" viewBox="0 0 24 24" width="24" height="24">
          <path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
        </svg>
        Sign in with Twitch to Vote
      </button>
      
      <p class="login-note">Safe & secure - we only access your public Twitch profile</p>
    </div>
  `;
}

function showEmptyState() {
  elements.mainContent.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">🎤</div>
      <h2>No Artists Yet</h2>
      <p>Check back soon for amazing music!</p>
    </div>
  `;
}

function showErrorState() {
  elements.mainContent.innerHTML = `
    <div class="error-state">
      <div class="error-state-icon">⚠️</div>
      <h2>Something went wrong</h2>
      <p>We couldn't load the artists. Please try again.</p>
      <button onclick="location.reload()" class="retry-btn">Retry</button>
    </div>
  `;
}

// Render artist cards
function renderArtists(artists) {
  const grid = document.createElement('div');
  grid.className = 'artist-grid';

  artists.forEach(artist => {
    const card = createArtistCard(artist);
    grid.appendChild(card);
  });

  elements.mainContent.innerHTML = '';
  elements.mainContent.appendChild(grid);
}

// Create individual artist card
function createArtistCard(artist) {
  const card = document.createElement('div');
  card.className = 'artist-card';
  card.dataset.artistId = artist.song_id; // Use song_id consistently
  
  const userVotes = appState.getVotesForSong(artist.song_id);
  const canVote = appState.canVoteForSong(artist.song_id);
  const maxAdditional = appState.getMaxAdditionalVotes(artist.song_id);
  
  // Get song URL from Supabase storage
  const songURL = supabase.storage
    .from('songs')
    .getPublicUrl(`${artist.twitch_username}.mp3`).data.publicUrl;
  
  // Create card content
  const artistImage = artist.image_url || 'images/default-artist.png';
  const displayName = utils.sanitizeHTML(artist.display_name);
  const songTitle = artist.song_title ? utils.sanitizeHTML(artist.song_title) : '';
  
  card.innerHTML = `
    <div class="artist-image-container">
      <a href="${artist.twitch_url || '#'}" target="_blank" rel="noopener noreferrer" class="artist-link">
        <img src="${artistImage}" 
             alt="${displayName}" 
             class="artist-img" 
             loading="lazy"
             onerror="this.src='images/default-artist.png'">
        <div class="artist-overlay">
          <svg class="twitch-icon" viewBox="0 0 24 24" width="24" height="24">
            <path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
          </svg>
          <span>View on Twitch</span>
        </div>
      </a>
    </div>
    
    <div class="artist-info">
      <h3 class="artist-name">${displayName}</h3>
      ${songTitle ? `<p class="song-title">"${songTitle}"</p>` : ''}
    </div>
    
    <div class="audio-container">
      <audio controls class="artist-audio" preload="none">
        <source src="${songURL}" type="audio/mpeg">
        Your browser does not support the audio element.
      </audio>
    </div>
    
    <div class="vote-section">
      ${userVotes > 0 ? `
        <div class="votes-given">
          <span class="vote-icon">✓</span>
          You gave ${userVotes} ${utils.pluralize(userVotes, 'vote')}
        </div>
      ` : ''}
      
      <button 
        class="vote-btn ${!canVote ? 'vote-btn-disabled' : ''}" 
        onclick="openVoteModal('${artist.song_id}', '${displayName.replace(/'/g, "\\'")}')"
        ${!canVote ? 'disabled' : ''}
        aria-label="Vote for ${displayName}"
      >
        ${getVoteButtonText(artist.song_id)}
      </button>
    </div>
  `;
  
  return card;
}

// Get appropriate button text
function getVoteButtonText(artistId) {
  const userVotes = appState.getVotesForSong(artistId);
  const remaining = appState.getRemainingVotes();
  const maxForSong = appState.getMaxAdditionalVotes(artistId);
  
  if (remaining === 0) return 'No Votes Left';
  if (userVotes >= APP_CONFIG.maxVotesPerSong) return 'Max Votes Given';
  if (userVotes > 0) return `Vote Again (${maxForSong} left)`;
  return 'Vote';
}

// Vote modal functions
function openVoteModal(artistId, artistName) {
  if (!appState.canVoteForSong(artistId)) {
    toast.error('Cannot vote for this song anymore');
    return;
  }
  
  appState.selectedArtist = artistId;
  const currentVotes = appState.getVotesForSong(artistId);
  const maxAdditional = appState.getMaxAdditionalVotes(artistId);
  
  // Update modal content
  elements.modalArtistName.textContent = artistName;
  elements.modalVoteInfo.innerHTML = `
    ${currentVotes > 0 ? `<p>You've already given ${currentVotes} ${utils.pluralize(currentVotes, 'vote')} to this song.</p>` : ''}
    <p>You can give up to ${maxAdditional} more ${utils.pluralize(maxAdditional, 'vote')}.</p>
  `;
  
  // Update vote buttons
  elements.voteOptionBtns.forEach(btn => {
    const points = parseInt(btn.dataset.points);
    btn.disabled = points > maxAdditional;
    btn.classList.remove('selected');
  });
  
  // Reset state
  appState.selectedPoints = 0;
  elements.modalConfirm.disabled = true;
  elements.modalConfirm.querySelector('.button-text').textContent = 'Confirm Vote';
  
  // Show modal
  elements.voteModal.style.display = 'flex';
  elements.voteModal.setAttribute('aria-hidden', 'false');
  
  // Focus management
  elements.modalCancel.focus();
}

function closeVoteModal() {
  elements.voteModal.style.display = 'none';
  elements.voteModal.setAttribute('aria-hidden', 'true');
  appState.selectedArtist = null;
  appState.selectedPoints = 0;
  
  // Clear selections
  elements.voteOptionBtns.forEach(btn => btn.classList.remove('selected'));
}

function selectVoteOption(points) {
  if (points < 1 || points > 5) return;
  
  appState.selectedPoints = points;
  
  // Update button states
  elements.voteOptionBtns.forEach(btn => {
    const btnPoints = parseInt(btn.dataset.points);
    btn.classList.toggle('selected', btnPoints === points);
  });
  
  elements.modalConfirm.disabled = false;
  elements.modalConfirm.querySelector('.button-text').textContent = 
    `Confirm ${points} ${utils.pluralize(points, 'Vote')}`;
}

// Handle vote submission
async function handleVote() {
  if (!appState.selectedArtist || !appState.selectedPoints || appState.isLoading) {
    return;
  }
  
  try {
    appState.isLoading = true;
    elements.modalConfirm.disabled = true;
    elements.modalConfirm.innerHTML = '<span class="loading-spinner"></span> Submitting...';
    
    // Add to queue for optimistic update
    appState.voteQueue.set(appState.selectedArtist, appState.selectedPoints);
    
    const existingVotes = appState.getVotesForSong(appState.selectedArtist);
    const newTotalVotes = existingVotes + appState.selectedPoints;
    
    console.log('Submitting vote:', {
      user_id: appState.user.id,
      song_id: appState.selectedArtist,
      existingVotes,
      newVotes: appState.selectedPoints,
      newTotal: newTotalVotes
    });
    
    let result;
    if (existingVotes > 0) {
      // Update existing vote
      result = await supabase
        .from('votes')
        .update({ 
          points: newTotalVotes
        })
        .eq('user_id', appState.user.id)
        .eq('song_id', appState.selectedArtist)
        .select();
    } else {
      // Insert new vote
      result = await supabase
        .from('votes')
        .insert([{
          user_id: appState.user.id,
          song_id: appState.selectedArtist,
          points: appState.selectedPoints
        }])
        .select();
    }
    
    console.log('Vote result:', result);
    
    if (result.error) throw result.error;
    
    // Update local state
    appState.userVotes.set(appState.selectedArtist, newTotalVotes);
    appState.totalVotesUsed += appState.selectedPoints;
    appState.voteQueue.delete(appState.selectedArtist);
    
    // Close modal and update UI
    closeVoteModal();
    updateVotesDisplay();
    
    // Update the specific artist card
    updateArtistCard(appState.selectedArtist);
    
    // Show success message
    toast.success(`Successfully gave ${appState.selectedPoints} ${utils.pluralize(appState.selectedPoints, 'vote')}!`);
    
  } catch (error) {
    console.error('Vote error details:', error);
    appState.voteQueue.delete(appState.selectedArtist);
    
    // More specific error messages
    let errorMessage = 'Failed to submit vote. Please try again.';
    
    if (error.code === '23505') {
      errorMessage = 'You have already voted for this song. Please refresh the page.';
    } else if (error.code === '23503') {
      errorMessage = 'Invalid song selection. Please refresh and try again.';
    } else if (error.code === '42501') {
      errorMessage = 'Permission denied. Please sign in again.';
    } else if (error.message?.includes('JWT')) {
      errorMessage = 'Your session has expired. Please sign in again.';
    } else if (error.message?.includes('network')) {
      errorMessage = 'Network error. Please check your connection.';
    }
    
    toast.error(errorMessage);
    
    // Restore button
    elements.modalConfirm.innerHTML = '<span class="button-text">Confirm Vote</span>';
    elements.modalConfirm.disabled = false;
  } finally {
    appState.isLoading = false;
  }
}

// Update a specific artist card without reloading all
function updateArtistCard(artistId) {
  const card = document.querySelector(`[data-artist-id="${artistId}"]`);
  if (!card) return;
  
  const artist = appState.artists.find(a => a.song_id === artistId);
  if (!artist) return;
  
  const newCard = createArtistCard(artist);
  card.replaceWith(newCard);
}

// Modal functions
function showThankYouModal() {
  elements.thankYouModal.style.display = 'flex';
  elements.thankYouModal.setAttribute('aria-hidden', 'false');
  elements.thankYouClose.focus();
}

function closeThankYouModal() {
  elements.thankYouModal.style.display = 'none';
  elements.thankYouModal.setAttribute('aria-hidden', 'true');
}

// Make functions globally accessible
window.openVoteModal = openVoteModal;
window.closeVoteModal = closeVoteModal;
window.handlers = handlers;

// Auth state listener
supabase.auth.onAuthStateChange((event, session) => {
  console.log('Auth state changed:', event);
  updateAuthUI(session);
});

// Initialize application
async function init() {
  try {
    initializeElements();
    setupEventListeners();
    
    // Check for existing session
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    
    updateAuthUI(session);
  } catch (error) {
    console.error('Initialization error:', error);
    toast.error('Failed to initialize. Please refresh the page.');
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Handle page visibility for auto-refresh
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && appState.user) {
    loadUserVotes(); // Refresh votes when page becomes visible
  }
});