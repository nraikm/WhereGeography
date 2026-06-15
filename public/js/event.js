/**
 * Event Page JS - Interactive Map, Grid Snapping, & Country Statistics
 */
document.addEventListener('DOMContentLoaded', () => {
  // 1. Get Event ID from URL (support query param ?id=... or path /meet/:id)
  let eventId = null;
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('id')) {
    eventId = urlParams.get('id');
  } else {
    // Match /meet/xxxx
    const match = window.location.pathname.match(/\/meet\/([^/]+)/);
    if (match) {
      eventId = match[1];
    }
  }

  if (!eventId) {
    // No ID provided, redirect back to creation page
    window.location.href = '/index.html';
    return;
  }

  // 2. UI Elements
  const loadingOverlay = document.getElementById('loading-overlay');
  const eventInterface = document.getElementById('event-interface');
  const eventTitle = document.getElementById('event-title');
  const eventDescription = document.getElementById('event-description');
  const shareLinkInput = document.getElementById('share-link-input');
  const copyShareBtn = document.getElementById('copy-share-btn');
  const exportJsonBtn = document.getElementById('export-json-btn');
  const exportCsvBtn = document.getElementById('export-csv-btn');

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
  const btnCurrentLocation = document.getElementById('btn-current-location');

  const participantCountBadge = document.getElementById('participant-count');
  const participantsListContainer = document.getElementById('participants-list');
  const statsListContainer = document.getElementById('stats-list');

  // 3. Application State
  let eventData = null;
  let currentUser = null; // { name, pin }
  let map = null;
  let participantMarkers = {}; // { [name]: L.Marker }
  let participantRectangles = []; // Shaded grid squares for participants
  let placementMarker = null; // Marker showing where the active user clicked (snapped)
  let placementRectangle = null; // Bounding box outline for selection grid square
  let placedCoords = null; // { lat, lng } (snapped)
  let pollInterval = null;

  // LocalStorage keys
  const storageKey = `where2meet_user_${eventId}`;

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
      document.title = `${eventData.name} - where2meet`;

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

    // Add CartoDB Positron tile layer for a crisp, light, document-app look
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    // Listen to clicks on the map to position placement pin
    map.on('click', (e) => {
      if (!currentUser) {
        const name = userNameInput.value.trim();
        const pin = userPinInput.value;

        if (!name) {
          // Encourage typing name first
          userNameInput.focus();
          // Shake the join form
          joinForm.style.animation = 'none';
          setTimeout(() => {
            joinForm.style.animation = 'shake 0.5s ease-in-out';
          }, 10);
          return;
        }

        // Auto-join user
        currentUser = { name, pin };
        localStorage.setItem(storageKey, JSON.stringify(currentUser));
        updateUI();
      }
      handleMapClick(e.latlng.lat, e.latlng.lng);
      saveLocation(e.latlng.lat, e.latlng.lng);
    });
  }

  // Helper: Snaps coordinates to a 30-mile grid and returns grid metadata
  function snapCoordinates(lat, lng, blockSizeMiles = 30) {
    const milesPerDegreeLat = 69.172;
    const latStep = blockSizeMiles / milesPerDegreeLat;
    const snappedLat = Math.round(lat / latStep) * latStep;

    const latRad = (snappedLat * Math.PI) / 180;
    const cosLat = Math.max(Math.cos(latRad), 0.05); // Prevent divide by zero near poles
    const lngStep = blockSizeMiles / (milesPerDegreeLat * cosLat);
    const snappedLng = Math.round(lng / lngStep) * lngStep;

    return {
      lat: Math.min(Math.max(snappedLat, -90), 90),
      lng: Math.min(Math.max(snappedLng, -180), 180),
      latStep,
      lngStep
    };
  }

  // Helper: Generates country emoji flag using ISO country code
  function getCountryEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '📍';
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    try {
      return String.fromCodePoint(...codePoints);
    } catch (e) {
      return '📍';
    }
  }

  // Helper: Deterministic hash function for usernames
  function nameHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
  }

  // 6. User Click Placement
  function handleMapClick(lat, lng) {
    const snapped = snapCoordinates(lat, lng, 30);
    placedCoords = { lat: snapped.lat, lng: snapped.lng };
    placedLatLabel.textContent = snapped.lat.toFixed(5);
    placedLngLabel.textContent = snapped.lng.toFixed(5);

    // Calculate grid box coordinates
    const south = snapped.lat - snapped.latStep / 2;
    const north = snapped.lat + snapped.latStep / 2;
    const west = snapped.lng - snapped.lngStep / 2;
    const east = snapped.lng + snapped.lngStep / 2;

    // Draw/update placement grid cell rectangle
    if (placementRectangle) {
      placementRectangle.setBounds([[south, west], [north, east]]);
    } else {
      placementRectangle = L.rectangle([[south, west], [north, east]], {
        color: '#6366f1',
        weight: 1.5,
        dashArray: '5,5',
        fillColor: '#6366f1',
        fillOpacity: 0.1,
        interactive: false
      }).addTo(map);
    }

    // Render/update temporary helper marker
    if (placementMarker) {
      placementMarker.setLatLng([snapped.lat, snapped.lng]);
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

      placementMarker = L.marker([snapped.lat, snapped.lng], { icon: placementIcon }).addTo(map);
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

  // Hashes username to a HSL color
  function getHashColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    // Dark HSL for bright map readability
    return `hsl(${hue}, 75%, 45%)`;
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
      if (placementRectangle) {
        map.removeLayer(placementRectangle);
        placementRectangle = null;
      }
      placedCoords = null;
      placedLatLabel.textContent = '--';
      placedLngLabel.textContent = '--';
    }

    // Refresh Participant Count Badge
    participantCountBadge.textContent = eventData.participants.length;

    // Clear old participant block rectangles
    participantRectangles.forEach(rect => map.removeLayer(rect));
    participantRectangles = [];

    // Redraw Markers on Map
    const activeNames = new Set(eventData.participants.map(p => p.name));
    
    // Clear removed markers
    Object.keys(participantMarkers).forEach(name => {
      if (!activeNames.has(name)) {
        map.removeLayer(participantMarkers[name]);
        delete participantMarkers[name];
      }
    });

    // Add/Update markers and blocks
    eventData.participants.forEach(p => {
      const color = getHashColor(p.name);
      const initials = getInitials(p.name);
      const flag = getCountryEmoji(p.countryCode);

      // A. Draw Snapped Grid block rectangle
      const snapped = snapCoordinates(p.lat, p.lng, 30);
      const south = p.lat - snapped.latStep / 2;
      const north = p.lat + snapped.latStep / 2;
      const west = p.lng - snapped.lngStep / 2;
      const east = p.lng + snapped.lngStep / 2;

      const blockRect = L.rectangle([[south, west], [north, east]], {
        color: color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.06,
        interactive: false
      }).addTo(map);
      participantRectangles.push(blockRect);

      // B. Compute deterministic jitter offset so overlapping block markers are distinct
      const hashVal = nameHash(p.name);
      // Offset circle radius (approx 1.2 miles / 0.018 degrees)
      const angle = (hashVal % 8) * (Math.PI / 4) + (hashVal % 3) * 0.1;
      const radius = 0.016; 
      const jitteredLat = p.lat + Math.sin(angle) * radius;
      const jitteredLng = p.lng + Math.cos(angle) * radius * Math.max(Math.cos(p.lat * Math.PI / 180), 0.1);

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
          <div style="font-size: 0.8rem; font-weight: 500; display: flex; align-items: center; gap: 0.35rem; color: var(--text-muted); margin-bottom: 0.15rem;">
            <span>${flag}</span>
            <span>${p.country || 'Unknown'} (Grid Snapped)</span>
          </div>
          <div class="popup-coords">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div>
          <div class="popup-time">Last Pinned: ${new Date(p.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
        </div>
      `;

      if (participantMarkers[p.name]) {
        // Update existing marker coordinate position (with jitter)
        participantMarkers[p.name].setLatLng([jitteredLat, jitteredLng]);
        participantMarkers[p.name].setPopupContent(popupHtml);
      } else {
        // Create new marker (with jitter)
        const marker = L.marker([jitteredLat, jitteredLng], { icon: customIcon })
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
      const sorted = [...eventData.participants].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      sorted.forEach(p => {
        const color = getHashColor(p.name);
        const timeAgo = formatTimeAgo(p.updatedAt);
        const flag = getCountryEmoji(p.countryCode);

        const item = document.createElement('div');
        item.className = 'participant-item';
        item.innerHTML = `
          <div class="participant-meta">
            <div class="participant-dot" style="background-color: ${color}"></div>
            <div>
              <div class="participant-name">${p.name} <span style="font-size: 0.85rem; margin-left: 0.25rem;">${flag}</span></div>
              <div class="participant-time">${timeAgo} &bull; ${p.country || 'Unknown'}</div>
            </div>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-dim);"><polyline points="9 18 15 12 9 6"></polyline></svg>
        `;

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

    // Populate Sidebar Statistics Panel
    renderStatistics();
  }

  // 9. Location Statistics Render
  function renderStatistics() {
    statsListContainer.innerHTML = '';
    const total = eventData.participants.length;

    if (total === 0) {
      statsListContainer.innerHTML = `
        <div class="no-participants">No stats available</div>
      `;
      return;
    }

    // Group countries
    const statsMap = {};
    eventData.participants.forEach(p => {
      const country = p.country || 'Unknown';
      const code = p.countryCode || '';
      if (!statsMap[country]) {
        statsMap[country] = { count: 0, code: code };
      }
      statsMap[country].count++;
    });

    // Sort by count descending
    const sortedCountries = Object.keys(statsMap).sort(
      (a, b) => statsMap[b].count - statsMap[a].count
    );

    sortedCountries.forEach(country => {
      const count = statsMap[country].count;
      const code = statsMap[country].code;
      const percent = (count / total) * 100;
      const flag = getCountryEmoji(code);

      const statsItem = document.createElement('div');
      statsItem.className = 'stats-item';
      statsItem.innerHTML = `
        <div class="stats-item-header">
          <div class="stats-country-info">
            <span class="stats-flag">${flag}</span>
            <span>${country}</span>
          </div>
          <span class="stats-count-label">${count} (${percent.toFixed(0)}%)</span>
        </div>
        <div class="stats-bar-bg">
          <div class="stats-bar-fill" style="width: ${percent}%"></div>
        </div>
      `;

      statsListContainer.appendChild(statsItem);
    });
  }

  // 10. Time formatter helper
  function formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);

    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // 11. Copy Link button handler
  copyShareBtn.addEventListener('click', () => {
    shareLinkInput.select();
    shareLinkInput.setSelectionRange(0, 99999);
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

  // 11b. Data Export Handlers
  exportJsonBtn.addEventListener('click', () => {
    if (!eventData) return;
    try {
      const blob = new Blob([JSON.stringify(eventData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = url;
      
      const sanitizedTitle = eventData.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      downloadAnchor.download = `${sanitizedTitle}_export.json`;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('JSON export failed:', err);
      alert('Failed to export JSON data');
    }
  });

  exportCsvBtn.addEventListener('click', () => {
    if (!eventData || !eventData.participants) return;
    try {
      const headers = ['Participant Name', 'Latitude', 'Longitude', 'Country', 'Country Code', 'Last Updated'];
      const rows = eventData.participants.map(p => [
        p.name,
        p.lat,
        p.lng,
        p.country || 'Unknown',
        p.countryCode || '',
        p.updatedAt || ''
      ]);
      
      const csvContent = [
        headers.join(','),
        ...rows.map(r => r.map(val => {
          const stringVal = String(val);
          if (stringVal.includes(',') || stringVal.includes('"') || stringVal.includes('\n')) {
            return `"${stringVal.replace(/"/g, '""')}"`;
          }
          return stringVal;
        }).join(','))
      ].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = url;
      
      const sanitizedTitle = eventData.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      downloadAnchor.download = `${sanitizedTitle}_export.csv`;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('CSV export failed:', err);
      alert('Failed to export CSV data');
    }
  });

  // 12. Join Form Submit Handler
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

  // 13. Sign Out Handler
  signOutBtn.addEventListener('click', () => {
    localStorage.removeItem(storageKey);
    currentUser = null;
    updateUI();
  });

  // Helper: Save participant location to backend database
  async function saveLocation(lat, lng) {
    if (!currentUser) return;

    // Use snapCoordinates to display/log correctly
    const snapped = snapCoordinates(lat, lng, 30);

    saveLocationBtn.disabled = true;
    const originalText = saveLocationBtn.textContent;
    saveLocationBtn.textContent = 'Saving...';

    try {
      // Send location coordinates to backend database
      eventData = await WhereApi.addParticipantLocation(
        eventId,
        currentUser.name,
        currentUser.pin,
        snapped.lat,
        snapped.lng
      );

      // Successfully saved! Clean placement graphics
      if (placementMarker) {
        map.removeLayer(placementMarker);
        placementMarker = null;
      }
      if (placementRectangle) {
        map.removeLayer(placementRectangle);
        placementRectangle = null;
      }
      placedCoords = null;
      placedLatLabel.textContent = '--';
      placedLngLabel.textContent = '--';

      updateUI();
      
      // Flash the button green briefly
      saveLocationBtn.textContent = 'Saved!';
      saveLocationBtn.style.background = 'var(--success)';
      setTimeout(() => {
        saveLocationBtn.disabled = false;
        saveLocationBtn.textContent = originalText;
        saveLocationBtn.style.background = '';
      }, 1500);

    } catch (error) {
      alert(error.message);
      saveLocationBtn.disabled = false;
      saveLocationBtn.textContent = originalText;

      // If saving failed due to incorrect PIN or name taken, clear login state
      if (error.message.includes('PIN') || error.message.includes('taken')) {
        localStorage.removeItem(storageKey);
        currentUser = null;
        updateUI();
      }
    }
  }

  // 14. Save Location Handler
  saveLocationBtn.addEventListener('click', async () => {
    if (!currentUser) return;
    if (!placedCoords) {
      alert('Please click a point on the map first to select your location.');
      return;
    }
    await saveLocation(placedCoords.lat, placedCoords.lng);
  });

  // 15. HTML5 Geolocation API Handler
  if (btnCurrentLocation) {
    btnCurrentLocation.addEventListener('click', () => {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
      }

      btnCurrentLocation.disabled = true;
      const originalText = btnCurrentLocation.innerHTML;
      btnCurrentLocation.innerHTML = 'Locating...';

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          
          // Trigger the snap coordinates map click handler
          handleMapClick(lat, lng);
          
          // Center the map view on the selected grid center
          map.setView([placedCoords.lat, placedCoords.lng], Math.max(map.getZoom(), 8));

          // Auto-save the location immediately!
          saveLocation(lat, lng);

          btnCurrentLocation.disabled = false;
          btnCurrentLocation.innerHTML = originalText;
        },
        (error) => {
          console.warn('Geolocation error:', error);
          alert('Could not retrieve your location. Please check your browser permissions.');
          btnCurrentLocation.disabled = false;
          btnCurrentLocation.innerHTML = originalText;
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    });
  }

  // 15. Background updates polling
  function startPolling() {
    pollInterval = setInterval(async () => {
      if (document.hidden) return;
      
      try {
        const data = await WhereApi.getEvent(eventId);
        eventData = data;
        updateUI();
      } catch (error) {
        console.warn('Silent refresh error:', error);
      }
    }, 8000);
  }

  window.addEventListener('beforeunload', () => {
    if (pollInterval) clearInterval(pollInterval);
  });

  // 16. Start engine
  init();
});

// CSS shake animation
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-6px); }
    40%, 80% { transform: translateX(6px); }
  }
`;
document.head.appendChild(style);
