const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;

// Enable CORS and JSON body parsing
app.use(cors());
app.use(express.json());

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// Create a new event
app.post('/api/events', (req, res) => {
  const { name, description, defaultCenter, defaultZoom } = req.body;
  
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Event name is required' });
  }

  try {
    const event = db.createEvent(name, description, defaultCenter, defaultZoom);
    return res.status(201).json(event);
  } catch (error) {
    console.error('Error creating event:', error);
    return res.status(500).json({ error: 'Failed to create event' });
  }
});

// Get event by ID (with sanitized participants list)
app.get('/api/events/:id', (req, res) => {
  const { id } = req.params;

  try {
    const event = db.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    return res.json(event);
  } catch (error) {
    console.error('Error fetching event:', error);
    return res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// Join or update location for a participant
app.post('/api/events/:id/participants', (req, res) => {
  const { id } = req.params;
  const { name, pin, lat, lng } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'Location coordinates (lat, lng) are required' });
  }

  // Basic coordinate bounds checking
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  if (isNaN(latitude) || latitude < -90 || latitude > 90) {
    return res.status(400).json({ error: 'Invalid latitude value' });
  }
  if (isNaN(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Invalid longitude value' });
  }

  try {
    const updatedEvent = db.addOrUpdateParticipant(id, name, pin, latitude, longitude);
    return res.json(updatedEvent);
  } catch (error) {
    console.warn(`Join warning for event ${id}: ${error.message}`);
    return res.status(400).json({ error: error.message });
  }
});

// Fallback: serve event.html for sub-routes or query routes if necessary
app.get('/event', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'event.html'));
});

// Export app for serverless function platforms like Vercel
module.exports = app;

// Start the server only if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`  WhereGeography Server is running!`);
    console.log(`  Local Address: http://localhost:${PORT}`);
    console.log(`===================================================`);
  });
}
