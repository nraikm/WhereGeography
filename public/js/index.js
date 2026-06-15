/**
 * Landing Page JS - Event Creation
 */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('create-event-form');
  const eventNameInput = document.getElementById('event-name');
  const eventDescInput = document.getElementById('event-desc');
  
  const latInput = document.getElementById('default-lat');
  const lngInput = document.getElementById('default-lng');
  const zoomInput = document.getElementById('default-zoom');
  const submitBtn = document.getElementById('submit-btn');

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

  // Form submit handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = eventNameInput.value.trim();
    const description = eventDescInput.value.trim();
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);
    const zoom = parseInt(zoomInput.value, 10);

    if (!name) return;

    // Show loading state
    submitBtn.disabled = true;
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = `
      <svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite; margin-right: 0.5rem;">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M4 12a8 8 0 0 1 8-8"></path>
      </svg>
      Creating Map...
    `;

    try {
      const event = await WhereApi.createEvent(name, description, { lat, lng }, zoom);
      // Success: Redirect to event.html with event ID query parameter
      window.location.href = `event.html?id=${event.id}`;
    } catch (error) {
      alert(`Error creating event: ${error.message}`);
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  });

  // Inject spinner animation style dynamically if needed
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
});
