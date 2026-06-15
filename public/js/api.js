/**
 * where2meet API Client Helper
 */
const WhereApi = {
  // Base URL is empty since we serve static files from the same server
  baseUrl: '',

  /**
   * Creates a new map event
   * @param {string} name 
   * @param {string} description 
   * @param {object} defaultCenter { lat, lng }
   * @param {number} defaultZoom 
   */
  async createEvent(name, description, defaultCenter, defaultZoom, id) {
    try {
      const response = await fetch(`${this.baseUrl}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, description, defaultCenter, defaultZoom, id })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create event');
      }
      return data;
    } catch (error) {
      console.error('API createEvent error:', error);
      throw error;
    }
  },

  /**
   * Retrieves an existing event's info and participants
   * @param {string} id 
   */
  async getEvent(id) {
    try {
      const response = await fetch(`${this.baseUrl}/api/events/${id}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch event');
      }
      return data;
    } catch (error) {
      console.error(`API getEvent error for ID ${id}:`, error);
      throw error;
    }
  },

  /**
   * Adds a new participant or updates an existing one's location
   * @param {string} eventId 
   * @param {string} name 
   * @param {string} pin 
   * @param {number} lat 
   * @param {number} lng 
   */
  async addParticipantLocation(eventId, name, pin, lat, lng) {
    try {
      const response = await fetch(`${this.baseUrl}/api/events/${eventId}/participants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, pin, lat, lng })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update location');
      }
      return data;
    } catch (error) {
      console.error('API addParticipantLocation error:', error);
      throw error;
    }
  }
};
