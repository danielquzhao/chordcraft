import { useState, useEffect } from 'react';
import { musicService } from '../services/music';
import ABCJS from 'abcjs';
import { toast } from 'react-toastify';
import { useAuth } from '../contexts/AuthContext';

const Saved = () => {
    const [savedPieces, setSavedPieces] = useState([]);
    const { user } = useAuth();

    useEffect(() => {
        if (!user) return;

        // Fetch all saved music from API
        const fetchMusic = async () => {
            try {
                const data = await musicService.getAllMusic();
                setSavedPieces(data);
            } catch (error) {
                console.error('Error fetching music:', error);
                toast.error('Failed to load saved music');
                setSavedPieces([]);
            }
        };

        fetchMusic();
    }, [user]);

    // Render sheet music for each piece
    useEffect(() => {
        savedPieces.forEach(piece => {
            const pieceId = piece._id || piece.id;
            const abcString = `X:1\nM:4/4\nL:1/4\nK:C\n${piece.notation}`;
            ABCJS.renderAbc(`sheet-music-${pieceId}`, abcString, {
                responsive: 'resize',
                staffwidth: 300, // Smaller width for preview
                wrap: {
                    preferredMeasuresPerLine: 2, // Show only first 2 measures
                    minSpacing: 2.7,
                    maxSpacing: 3.0
                },
                format: {
                    gchordfont: "italic 12px Arial",
                    measurebox: true,
                }
            });
        });
    }, [savedPieces]);

    const handleDelete = async (id) => {
        try {
            await musicService.deleteMusic(id);
            // Update local state to remove the deleted piece
            // MongoDB uses _id, but support both _id and id for compatibility
            setSavedPieces(prev => prev.filter(piece => (piece._id || piece.id) !== id));
            toast.success('Sheet music deleted successfully!');
        } catch (error) {
            console.error('Error deleting sheet music:', error);
            toast.error(error.response?.data?.message || 'Failed to delete sheet music');
        }
    };

    return (
        <div className="saved-music">
            <h1>Saved Music</h1>
            {savedPieces.length === 0 ? (
                <p>No saved music pieces yet. Create something on the keyboard!</p>
            ) : (
                <div className="music-list">
                    {savedPieces.map(piece => {
                        const pieceId = piece._id || piece.id;
                        return (
                            <div key={pieceId} className="music-item">
                                <div className="music-item-header">
                                    <h3>{piece.title}</h3>
                                    <button 
                                        onClick={() => handleDelete(pieceId)}
                                        className="delete-button"
                                    >
                                        Delete
                                    </button>
                                </div>
                                <p className="timestamp">Created: {new Date(piece.timestamp).toLocaleString()}</p>
                                {piece.description && (
                                    <p className="description">{piece.description}</p>
                                )}
                                <div id={`sheet-music-${pieceId}`}></div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default Saved; 