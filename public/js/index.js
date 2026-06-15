/**
 * Landing Page JS - where2meet Event Creation & Joining
 */
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const tabCreate = document.getElementById('tab-create');
  const tabJoin = document.getElementById('tab-join');
  const createForm = document.getElementById('create-event-form');
  const joinForm = document.getElementById('join-event-form');
  
  const eventNameInput = document.getElementById('event-name');
  const eventDescInput = document.getElementById('event-desc');
  const eventIdInput = document.getElementById('event-id');
  const generateIdBtn = document.getElementById('btn-generate-id');
  
  const latInput = document.getElementById('default-lat');
  const lngInput = document.getElementById('default-lng');
  const zoomInput = document.getElementById('default-zoom');
  const submitBtn = document.getElementById('submit-btn');

  const joinEventIdInput = document.getElementById('join-event-id');
  const joinSubmitBtn = document.getElementById('join-submit-btn');

  // Helper: Generates a short, clean random ID sequence
  function generateRandomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'meet-';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Set initial generated ID
  eventIdInput.value = generateRandomId();

  // Set initial focus
  joinEventIdInput.focus();

  // Bind ID generation button
  generateIdBtn.addEventListener('click', () => {
    eventIdInput.value = generateRandomId();
  });

  // Tab switching logic
  tabCreate.addEventListener('click', () => {
    tabCreate.classList.add('active');
    tabJoin.classList.remove('active');
    tabCreate.style.borderBottom = '2px solid var(--primary)';
    tabCreate.style.color = 'var(--text-main)';
    tabJoin.style.borderBottom = '2px solid transparent';
    tabJoin.style.color = 'var(--text-muted)';
    createForm.style.display = 'block';
    joinForm.style.display = 'none';
  });

  tabJoin.addEventListener('click', () => {
    tabJoin.classList.add('active');
    tabCreate.classList.remove('active');
    tabJoin.style.borderBottom = '2px solid var(--primary)';
    tabJoin.style.color = 'var(--text-main)';
    tabCreate.style.borderBottom = '2px solid transparent';
    tabCreate.style.color = 'var(--text-muted)';
    joinForm.style.display = 'block';
    createForm.style.display = 'none';
    joinEventIdInput.focus();
  });

  // Initialize Leaflet Map
  const defaultLat = 20.0;
  const defaultLng = 0.0;
  const defaultZoom = 2;

  const map = L.map('preview-map', {
    zoomControl: true,
    minZoom: 1.5,
    maxZoom: 18
  }).setView([defaultLat, defaultLng], defaultZoom);

  // Add CartoDB Positron tile layer for a crisp, light, document-app look
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // Update inputs when map changes position/zoom
  function updateMapState() {
    const center = map.getCenter();
    const zoom = map.getZoom();

    // Round for clean UI display
    latInput.value = center.lat.toFixed(5);
    lngInput.value = center.lng.toFixed(5);
    zoomInput.value = zoom;
  }

  // Bind map movements
  map.on('move', updateMapState);
  map.on('zoomend', updateMapState);

  // Form submit handler - Create Event
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = eventNameInput.value.trim();
    const description = eventDescInput.value.trim();
    const id = eventIdInput.value.trim().toLowerCase();
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);
    const zoom = parseInt(zoomInput.value, 10);

    if (!name || !id) return;

    // Validate ID characters (letters, numbers, dashes)
    if (!/^[a-z0-9\-]+$/.test(id)) {
      alert('Event ID can only contain lowercase letters, numbers, and dashes.');
      return;
    }

    // Show loading state
    submitBtn.disabled = true;
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = `
      <svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite; margin-right: 0.5rem;">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M4 12a8 8 0 0 1 8-8"></path>
      </svg>
      Creating Event...
    `;

    try {
      const event = await WhereApi.createEvent(name, description, { lat, lng }, zoom, id);
      // Redirect to event page
      window.location.href = `event.html?id=${event.id}`;
    } catch (error) {
      alert(`Error: ${error.message}`);
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  });

  // Form submit handler - Join Event
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const joinInput = joinEventIdInput.value.trim();

    if (!joinInput) return;

    let targetId = joinInput;

    // Check if the user pasted a complete URL (contains ?id=)
    try {
      if (joinInput.includes('?id=')) {
        const parsedUrl = new URL(joinInput);
        const idParam = parsedUrl.searchParams.get('id');
        if (idParam) {
          targetId = idParam;
        }
      }
    } catch (err) {
      console.warn('URL parsing failed, falling back to raw ID input');
    }

    // Clean targetId for spaces and lowercase
    targetId = targetId.trim().toLowerCase();

    // Redirect to the event details page
    window.location.href = `event.html?id=${targetId}`;
  });

  // Inject spinner animation style dynamically
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
});
