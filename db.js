const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const isVercel = !!process.env.VERCEL;
const DATA_DIR = isVercel ? '/tmp' : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'events.json');

// Ensure database directory and file exist
function initDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 2), 'utf-8');
  }
}

// Read database file
function readDb() {
  initDb();
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to read database, resetting DB', error);
    return {};
  }
}

// Write to database file safely
function writeDb(data) {
  initDb();
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to write database', error);
    throw new Error('Database write failure');
  }
}

// Simple SHA-256 hash helper for PINs
function hashPin(pin) {
  if (!pin) return '';
  return crypto.createHash('sha256').update(pin.toString()).digest('hex');
}

/**
 * Creates a new event
 * @param {string} name 
 * @param {string} description 
 * @param {object} defaultCenter { lat, lng }
 * @param {number} defaultZoom 
 */
function createEvent(name, description, defaultCenter, defaultZoom) {
  const db = readDb();
  const id = uuidv4();
  
  const newEvent = {
    id,
    name: name || 'Unnamed Map Event',
    description: description || '',
    defaultCenter: defaultCenter || { lat: 20, lng: 0 }, // Defaults to center of earth map
    defaultZoom: defaultZoom !== undefined ? defaultZoom : 2,
    createdAt: new Date().toISOString(),
    participants: {}
  };

  db[id] = newEvent;
  writeDb(db);
  return newEvent;
}

/**
 * Gets an event by ID (sanitized of PINs)
 * @param {string} id 
 */
function getEvent(id) {
  const db = readDb();
  const event = db[id];
  if (!event) return null;

  // Sanitize event to remove PIN hashes from output
  const sanitizedParticipants = Object.keys(event.participants).map(name => ({
    name,
    lat: event.participants[name].lat,
    lng: event.participants[name].lng,
    updatedAt: event.participants[name].updatedAt
  }));

  return {
    id: event.id,
    name: event.name,
    description: event.description,
    defaultCenter: event.defaultCenter,
    defaultZoom: event.defaultZoom,
    createdAt: event.createdAt,
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
function addOrUpdateParticipant(eventId, name, pin, lat, lng) {
  const db = readDb();
  const event = db[eventId];
  if (!event) {
    throw new Error('Event not found');
  }

  const cleanedName = name.trim();
  if (!cleanedName) {
    throw new Error('Name cannot be empty');
  }

  const normalizedKey = cleanedName.toLowerCase();
  const hashed = hashPin(pin);

  // Check if a participant with this name (case-insensitive) already exists
  const existingKey = Object.keys(event.participants).find(
    k => k.toLowerCase() === normalizedKey
  );

  if (existingKey) {
    const existingParticipant = event.participants[existingKey];
    // If the participant has a PIN, verify it. 
    // (If they didn't set a pin initially, let them set one now or bypass, but let's enforce PIN verification if set)
    if (existingParticipant.pinHash && existingParticipant.pinHash !== hashed) {
      throw new Error('Incorrect PIN. This name is already taken.');
    }
    
    // Update location and time
    existingParticipant.lat = lat;
    existingParticipant.lng = lng;
    existingParticipant.updatedAt = new Date().toISOString();
    // In case key casing changed slightly, normalize to what user typed this time
    if (existingKey !== cleanedName) {
      event.participants[cleanedName] = existingParticipant;
      delete event.participants[existingKey];
    }
  } else {
    // Create new participant
    event.participants[cleanedName] = {
      lat,
      lng,
      pinHash: hashed,
      updatedAt: new Date().toISOString()
    };
  }

  writeDb(db);
  return getEvent(eventId);
}

module.exports = {
  createEvent,
  getEvent,
  addOrUpdateParticipant
};
