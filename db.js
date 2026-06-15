const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables from .env if running locally
if (fs.existsSync(path.join(__dirname, '.env'))) {
  try {
    process.loadEnvFile(path.join(__dirname, '.env'));
  } catch (e) {
    console.warn('Failed to load local .env file:', e.message);
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: Supabase URL and Publishable Key must be configured!');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

// Simple SHA-256 hash helper for PINs
function hashPin(pin) {
  if (!pin) return '';
  return crypto.createHash('sha256').update(pin.toString()).digest('hex');
}

// Snap coordinates to approximately X-mile blocks
function snapToGrid(lat, lng, blockSizeMiles = 30) {
  const milesPerDegreeLat = 69.172;
  const latStep = blockSizeMiles / milesPerDegreeLat;
  const snappedLat = Math.round(lat / latStep) * latStep;

  // Snapped longitude uses the cosine of latitude to adjust block size
  const latRad = (snappedLat * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(latRad), 0.05); // Prevent divide by zero near poles
  const lngStep = blockSizeMiles / (milesPerDegreeLat * cosLat);
  const snappedLng = Math.round(lng / lngStep) * lngStep;

  return {
    lat: Math.min(Math.max(snappedLat, -90), 90),
    lng: Math.min(Math.max(snappedLng, -180), 180)
  };
}

// Fetch country details using OpenStreetMap Nominatim reverse geocoding API
async function fetchCountry(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=5`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'where2meetApp/1.0'
      },
      signal: AbortSignal.timeout(3000) // 3-second timeout
    });
    if (!response.ok) {
      return { country: 'Unknown', countryCode: '' };
    }
    const data = await response.json();
    if (data.error === 'Unable to geocode') {
      return { country: 'International Waters', countryCode: '' };
    }
    if (data && data.address) {
      return {
        country: data.address.country || 'Unknown',
        countryCode: data.address.country_code || ''
      };
    }
  } catch (error) {
    console.error('Nominatim API reverse geocoding failed:', error.message);
  }
  return { country: 'Unknown', countryCode: '' };
}

/**
 * Creates a new event
 * @param {string} name 
 * @param {string} description 
 * @param {object} defaultCenter { lat, lng }
 * @param {number} defaultZoom 
 */
async function createEvent(name, description, defaultCenter, defaultZoom, customId) {
  const id = customId || uuidv4();
  const center = defaultCenter || { lat: 20, lng: 0 };
  const zoom = defaultZoom !== undefined ? defaultZoom : 2;

  const { data, error } = await supabase
    .from('events')
    .insert([
      {
        id,
        name: name || 'Unnamed Map Event',
        description: description || '',
        default_center_lat: center.lat,
        default_center_lng: center.lng,
        default_zoom: zoom
      }
    ])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Event ID already exists');
    }
    console.error('Error inserting event to Supabase:', error);
    throw new Error(`Failed to create event: ${error.message}`);
  }

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    defaultCenter: { lat: data.default_center_lat, lng: data.default_center_lng },
    defaultZoom: data.default_zoom,
    createdAt: data.created_at,
    participants: []
  };
}

/**
 * Gets an event by ID (sanitized of PINs)
 * @param {string} id 
 */
async function getEvent(id) {
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (eventError) {
    console.error('Error fetching event from Supabase:', eventError);
    throw new Error('Failed to fetch event');
  }
  if (!event) return null;

  const { data: participants, error: participantsError } = await supabase
    .from('participants')
    .select('*')
    .eq('event_id', id);

  if (participantsError) {
    console.error('Error fetching participants from Supabase:', participantsError);
    throw new Error('Failed to fetch event participants');
  }

  const sanitizedParticipants = (participants || []).map(p => ({
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    country: p.country || 'Unknown',
    countryCode: p.country_code || '',
    updatedAt: p.updated_at
  }));

  return {
    id: event.id,
    name: event.name,
    description: event.description,
    defaultCenter: { lat: event.default_center_lat, lng: event.default_center_lng },
    defaultZoom: event.default_zoom,
    createdAt: event.created_at,
    participants: sanitizedParticipants
  };
}

/**
 * Adds or updates a participant's location in an event
 * @param {string} eventId 
 * @param {string} name 
 * @param {string} pin 
 * @param {number} lat 
 * @param {number} lng 
 */
async function addOrUpdateParticipant(eventId, name, pin, lat, lng) {
  const cleanedName = name.trim();
  if (!cleanedName) {
    throw new Error('Name cannot be empty');
  }

  // Check if the event exists
  const { data: eventExists, error: checkError } = await supabase
    .from('events')
    .select('id')
    .eq('id', eventId)
    .maybeSingle();

  if (checkError || !eventExists) {
    throw new Error('Event not found');
  }

  const hashed = hashPin(pin);
  const snapped = snapToGrid(lat, lng, 30);

  // Resolve country
  let countryInfo = { country: 'Unknown', countryCode: '' };
  try {
    countryInfo = await fetchCountry(snapped.lat, snapped.lng);
  } catch (error) {
    console.warn('Country resolution warning:', error);
  }

  // Find existing participant case-insensitively
  const { data: existing, error: existingError } = await supabase
    .from('participants')
    .select('*')
    .eq('event_id', eventId)
    .ilike('name', cleanedName)
    .maybeSingle();

  if (existingError) {
    console.error('Error checking existing participant in Supabase:', existingError);
    throw new Error('Failed to check existing participant');
  }

  if (existing) {
    if (existing.pin_hash && existing.pin_hash !== hashed) {
      throw new Error('Incorrect PIN. This name is already taken.');
    }

    const { error: updateError } = await supabase
      .from('participants')
      .update({
        name: cleanedName, // Normalise case if case changed
        lat: snapped.lat,
        lng: snapped.lng,
        country: countryInfo.country,
        country_code: countryInfo.countryCode,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);

    if (updateError) {
      console.error('Error updating participant in Supabase:', updateError);
      throw new Error('Failed to update participant location');
    }
  } else {
    const { error: insertError } = await supabase
      .from('participants')
      .insert([
        {
          event_id: eventId,
          name: cleanedName,
          lat: snapped.lat,
          lng: snapped.lng,
          country: countryInfo.country,
          country_code: countryInfo.countryCode,
          pin_hash: hashed,
          updated_at: new Date().toISOString()
        }
      ]);

    if (insertError) {
      console.error('Error inserting participant in Supabase:', insertError);
      throw new Error('Failed to add participant location');
    }
  }

  return await getEvent(eventId);
}

module.exports = {
  createEvent,
  getEvent,
  addOrUpdateParticipant
};
