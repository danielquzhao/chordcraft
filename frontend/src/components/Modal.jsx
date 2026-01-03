import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';

const Modal = ({ isOpen, onClose, onConfirm, initialTitle = '', initialDescription = '', header = 'Save Sheet Music' }) => {
    const [title, setTitle] = useState(initialTitle);
    const [description, setDescription] = useState(initialDescription);

    useEffect(() => {
        if (isOpen) {
            setTitle(initialTitle);
            setDescription(initialDescription);
        }
    }, [isOpen, initialTitle, initialDescription]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await onConfirm(title, description);
            toast.success('Successfully updated!');
            if (!initialTitle) { // Only clear if it was a new save
                setTitle('');
                setDescription('');
            }
        } catch (error) {
            toast.error('Operation failed');
            console.error('Error:', error);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>{header}</h2>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="title">Title:</label>
                        <input
                            type="text"
                            id="title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="description">Description:</label>
                        <textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows="3"
                        />
                    </div>
                    <div className="modal-buttons">
                        <button type="button" onClick={onClose} className="cancel-button">
                            Cancel
                        </button>
                        <button type="submit" className="confirm-button">
                            Confirm
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Modal; 