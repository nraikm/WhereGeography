/**
 * Event Page JS - Interactive Map & Participant Updates
 */
document.addEventListener('DOMContentLoaded', () => {
  // 1. Get Event ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  const eventId = urlParams.get('id');

  if (!eventId) {
    // No ID provided, redirect back to creation page
    window.location.href = 'index.html';
    return;
  }

  // 2. UI Elements
  const loadingOverlay = document.getElementById('loading-overlay');
  const eventInterface = document.getElementById('event-interface');
  const eventTitle = document.getElementById('event-title');
  const eventDescription = document.getElementById('event-description');
  const shareLinkInput = document.getElementById('share-link-input');
  const copyShareBtn = document.getElementById('copy-share-btn');

  const signedOutControls = document.getElementById('signed-out-controls');
  const signedInControls = document.getElementById('signed-in-controls');
  const joinForm = document.getElementById('join-form');
  const userNameInput = document.getElementById('user-name');
  const userPinInput = document.getElementById('user-pin');

  const currentUserLabel = document.getElementById('current-user-name');
  const placedLatLabel = document.getElementById('placed-lat');
  const placedLngLabel = document.getElementById('placed-lng');
  const signOutBtn = document.getElementById('sign-out-btn');
  const saveLocationBtn = document.getElementById('save-location-btn');

  const participantCountBadge = document.getElementById('participant-count');
  const participantsListContainer = document.getElementById('participants-list');

  // 3. Application State
  let eventData = null;
  let currentUser = null; // { name, pin }
  let map = null;
  let participantMarkers = {}; // { [name]: L.Marker }
  let placementMarker = null; // Marker showing where the active user clicked
  let placedCoords = null; // { lat, lng }
  let pollInterval = null;

  // LocalStorage keys
  const storageKey = `wheregeography_user_${eventId}`;

  // 4. Initialize page
  async function init() {
    try {
      // Set link value in share input
      shareLinkInput.value = window.location.href;

      // Check if user is already signed in
      const storedUser = localStorage.getItem(storageKey);
      if (storedUser) {
        try {
          currentUser = JSON.parse(storedUser);
        } catch (e) {
          localStorage.removeItem(storageKey);
        }
      }

      // Fetch event data
      eventData = await WhereApi.getEvent(eventId);

      // Populate metadata
      eventTitle.textContent = eventData.name;
      eventDescription.textContent = eventData.description || 'No description provided.';
      document.title = `${eventData.name} - WhereGeography`;

      // Hide loading spinner, display main page
      loadingOverlay.style.display = 'none';
      eventInterface.style.display = 'grid';

      // Setup Leaflet map centered at default event center
      initMap();

      // Render participants & update controls
      updateUI();

      // Start background polling
      startPolling();

    } catch (error) {
      console.error(error);
      loadingOverlay.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
          <h2 style="color: var(--danger); margin-bottom: 1rem;">Event Not Found</h2>
          <p style="color: var(--text-muted); margin-bottom: 2rem;">The map event you are looking for does not exist or may have been deleted.</p>
          <a href="index.html" class="btn btn-primary">Return to Home</a>
        </div>
      `;
    }
  }

  // 5. Setup Leaflet Map
  function initMap() {
    const center = eventData.defaultCenter || { lat: 20, lng: 0 };
    const zoom = eventData.defaultZoom !== undefined ? eventData.defaultZoom : 2;

    map = L.map('event-map', {
      zoomControl: true,
      minZoom: 1.5,
      maxZoom: 18
    }).setView([center.lat, center.lng], zoom);

    // Add CartoDB Voyager tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    // Listen to clicks on the map to position placement pin if signed in
    map.on('click', (e) => {
      if (!currentUser) {
        // Encourage sign-in
        userNameInput.focus();
        // Add a temporary subtle shake or visual indicator to join form
        joinForm.style.animation = 'none';
        setTimeout(() => {
          joinForm.style.animation = 'shake 0.5s ease-in-out';
        }, 10);
        return;
      }
      handleMapClick(e.latlng.lat, e.latlng.lng);
    });
  }

  // 6. User Click Placement
  function handleMapClick(lat, lng) {
    placedCoords = { lat, lng };
    placedLatLabel.textContent = lat.toFixed(5);
    placedLngLabel.textContent = lng.toFixed(5);

    // Render/update temporary helper marker
    if (placementMarker) {
      placementMarker.setLatLng([lat, lng]);
    } else {
      const placementIcon = L.divIcon({
        html: `
          <div class="custom-marker">
            <div class="marker-pin-wrapper active-placer" style="background-color: #ffffff; color: #000; border-color: var(--primary); box-shadow: 0 0 15px var(--primary);">
              ?
            </div>
          </div>
        `,
        className: 'leaflet-div-icon',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      placementMarker = L.marker([lat, lng], { icon: placementIcon }).addTo(map);
    }
  }

  // 7. Render dynamic marker styling
  // Generates initials from username
  function getInitials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // Hashes username to a vibrant, glowing HSL color
  function getHashColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    // Lock saturation and lightness for clean aesthetics that pop against dark maps
    return `hsl(${hue}, 85%, 60%)`;
  }

  // 8. Update map markers and sidebar UI
  function updateUI() {
    if (!eventData) return;

    // Toggle Join Form vs User Profile
    if (currentUser) {
      signedOutControls.style.display = 'none';
      signedInControls.style.display = 'block';
      currentUserLabel.textContent = currentUser.name;

      // If they already have a pin stored, fetch it and highlight/place active placer there
      const me = eventData.participants.find(p => p.name.toLowerCase() === currentUser.name.toLowerCase());
      if (me && !placedCoords) {
        handleMapClick(me.lat, me.lng);
      }
    } else {
      signedOutControls.style.display = 'block';
      signedInControls.style.display = 'none';
      if (placementMarker) {
        map.removeLayer(placementMarker);
        placementMarker = null;
      }
      placedCoords = null;
      placedLatLabel.textContent = '--';
      placedLngLabel.textContent = '--';
    }

    // Refresh Participant Count Badge
    participantCountBadge.textContent = eventData.participants.length;

    // Redraw Markers on Map
    // Keep track of current names to delete markers of removed participants (if database clears)
    const activeNames = new Set(eventData.participants.map(p => p.name));
    
    // Clear removed markers
    Object.keys(participantMarkers).forEach(name => {
      if (!activeNames.has(name)) {
        map.removeLayer(participantMarkers[name]);
        delete participantMarkers[name];
      }
    });

    // Add/Update markers
    eventData.participants.forEach(p => {
      const color = getHashColor(p.name);
      const initials = getInitials(p.name);

      const markerHtml = `
        <div class="custom-marker" data-participant-name="${p.name}">
          <div class="marker-pin-wrapper" style="background-color: ${color}; box-shadow: 0 0 10px ${color}; border-color: white;">
            ${initials}
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: markerHtml,
        className: 'leaflet-div-icon',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const popupHtml = `
        <div class="popup-details">
          <div class="popup-name">
            <div class="popup-name-dot" style="background-color: ${color}"></div>
            ${p.name}
          </div>
          <div class="popup-coords">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>
          <div class="popup-time">Last Pinned: ${new Date(p.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
        </div>
      `;

      if (participantMarkers[p.name]) {
        // Update existing marker coordinate position
        participantMarkers[p.name].setLatLng([p.lat, p.lng]);
        // Update popup content in case location details changed
        participantMarkers[p.name].setPopupContent(popupHtml);
      } else {
        // Create new marker
        const marker = L.marker([p.lat, p.lng], { icon: customIcon })
          .addTo(map)
          .bindPopup(popupHtml);
        
        participantMarkers[p.name] = marker;
      }
    });

    // Populate Sidebar Participant List
    participantsListContainer.innerHTML = '';
    if (eventData.participants.length === 0) {
      participantsListContainer.innerHTML = `
        <div class="no-participants">No locations pinned yet. Be the first!</div>
      `;
    } else {
      // Sort participants by update time (most recent first)
      const sorted = [...eventData.participants].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      sorted.forEach(p => {
        const color = getHashColor(p.name);
        const timeAgo = formatTimeAgo(p.updatedAt);

        const item = document.createElement('div');
        item.className = 'participant-item';
        item.innerHTML = `
          <div class="participant-meta">
            <div class="participant-dot" style="background-color: ${color}"></div>
            <div>
              <div class="participant-name">${p.name}</div>
              <div class="participant-time">${timeAgo}</div>
            </div>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-dim);"><polyline points="9 18 15 12 9 6"></polyline></svg>
        `;

        // Bind clicking and hovering on list items to highlight markers on the map
        item.addEventListener('click', () => {
          const marker = participantMarkers[p.name];
          if (marker) {
            map.setView([p.lat, p.lng], Math.max(map.getZoom(), 7));
            marker.openPopup();
          }
        });

        item.addEventListener('mouseenter', () => {
          const marker = participantMarkers[p.name];
          if (marker) {
            const el = marker.getElement();
            if (el) el.classList.add('marker-highlighted');
          }
        });

        item.addEventListener('mouseleave', () => {
          const marker = participantMarkers[p.name];
          if (marker) {
            const el = marker.getElement();
            if (el) el.classList.remove('marker-highlighted');
          }
        });

        participantsListContainer.appendChild(item);
      });
    }
  }

  // 9. Time formatter helper
  function formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);

    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    
    // Fallback: standard localized time string
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // 10. Copy Link button handler
  copyShareBtn.addEventListener('click', () => {
    shareLinkInput.select();
    shareLinkInput.setSelectionRange(0, 99999); // For mobile devices
    navigator.clipboard.writeText(shareLinkInput.value).then(() => {
      copyShareBtn.textContent = 'Copied!';
      copyShareBtn.style.background = 'rgba(52, 211, 153, 0.2)';
      copyShareBtn.style.borderColor = 'rgba(52, 211, 153, 0.4)';
      
      setTimeout(() => {
        copyShareBtn.textContent = 'Copy Link';
        copyShareBtn.style.background = 'var(--panel-bg)';
        copyShareBtn.style.borderColor = 'var(--panel-border)';
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  });

  // 11. Join Form Submit Handler
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = userNameInput.value.trim();
    const pin = userPinInput.value;

    if (!name) return;

    currentUser = { name, pin };
    localStorage.setItem(storageKey, JSON.stringify(currentUser));
    
    // Clear inputs
    userNameInput.value = '';
    userPinInput.value = '';

    updateUI();
  });

  // 12. Sign Out Handler
  signOutBtn.addEventListener('click', () => {
    localStorage.removeItem(storageKey);
    currentUser = null;
    updateUI();
  });

  // 13. Save Location Handler
  saveLocationBtn.addEventListener('click', async () => {
    if (!currentUser) return;
    if (!placedCoords) {
      alert('Please click a point on the map first to select your location.');
      return;
    }

    saveLocationBtn.disabled = true;
    const originalText = saveLocationBtn.textContent;
    saveLocationBtn.textContent = 'Saving...';

    try {
      // Send location coordinates to backend database
      eventData = await WhereApi.addParticipantLocation(
        eventId,
        currentUser.name,
        currentUser.pin,
        placedCoords.lat,
        placedCoords.lng
      );

      // Successfully saved! Remove placement helper pin since it is now permanently rendered
      if (placementMarker) {
        map.removeLayer(placementMarker);
        placementMarker = null;
      }

      updateUI();
      
      // Flash the button green briefly for success feedback
      saveLocationBtn.textContent = 'Saved!';
      saveLocationBtn.style.background = 'var(--success)';
      setTimeout(() => {
        saveLocationBtn.disabled = false;
        saveLocationBtn.textContent = originalText;
        saveLocationBtn.style.background = ''; // reset styles
      }, 1500);

    } catch (error) {
      alert(error.message);
      saveLocationBtn.disabled = false;
      saveLocationBtn.textContent = originalText;
    }
  });

  // 14. Real-time background update polling
  function startPolling() {
    // Poll updates every 8 seconds when window is active/visible
    pollInterval = setInterval(async () => {
      if (document.hidden) return; // Skip fetch if page is backgrounded
      
      try {
        const data = await WhereApi.getEvent(eventId);
        eventData = data;
        updateUI();
      } catch (error) {
        console.warn('Silent refresh error:', error);
      }
    }, 8000);
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (pollInterval) clearInterval(pollInterval);
  });

  // 15. Start the engine
  init();
});

// CSS shake animation injected dynamically for UX
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-6px); }
    40%, 80% { transform: translateX(6px); }
  }
`;
document.head.appendChild(style);
