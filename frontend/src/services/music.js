import api from './api';

export const musicService = {
    // Get all saved sheet music for current user
    getAllMusic: async () => {
        const response = await api.get('music');
        return response.data;
    },

    // Save new sheet music
    saveMusic: async (musicData) => {
        const response = await api.post('music', {
            notation: musicData.notation,
            title: musicData.title,
            description: musicData.description,
            timestamp: Date.now()
        });
        return response.data;
    },

    // Delete sheet music by ID
    deleteMusic: async (id) => {
        const response = await api.delete(`music/${id}`);
        return response.data;
    },

    // Update sheet music by ID
    updateMusic: async (id, musicData) => {
        const response = await api.put(`music/${id}`, musicData);
        return response.data;
    }
};
