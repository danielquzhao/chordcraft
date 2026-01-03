import { useState } from 'react';
import { musicService } from '../services/music';
import Modal from './Modal';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';

const Keyboard = ({ activeKeys, onClear, abcNotation, setIsModalOpen, isModalOpen }) => {
    const { user } = useAuth();

    const keyLabels = {
        "C": "a",
        "^C": "w",
        "D": "s",
        "^D": "e",
        "E": "d",
        "F": "f",
        "^F": "t",
        "G": "g",
        "^G": "y",
        "A": "h",
        "^A": "u",
        "B": "j",
        "c": "k",
        "^c": "o",
        "d": "l",
        "^d": "p",
        "e": ";"
    };

    const pianoKeys = [
        { note: "C", type: "white" },
        { note: "^C", type: "black" },
        { note: "D", type: "white" },
        { note: "^D", type: "black" },
        { note: "E", type: "white" },
        { note: "F", type: "white" },
        { note: "^F", type: "black" },
        { note: "G", type: "white" },
        { note: "^G", type: "black" },
        { note: "A", type: "white" },
        { note: "^A", type: "black" },
        { note: "B", type: "white" },
        { note: "c", type: "white" },
        { note: "^c", type: "black" },
        { note: "d", type: "white" },
        { note: "^d", type: "black" },
        { note: "e", type: "white" }
    ];

    const handleSaveClick = (e) => {
        e.preventDefault();
        if (!abcNotation) return;
        
        setIsModalOpen(true);
        
        activeKeys.forEach(key => {
            const audio = new Audio(`/sounds/${fileNameMap[key]}.mp3`);
            audio.pause();
        });
    };

    const handleModalClose = () => {
        setIsModalOpen(false);
    };

    const handleSaveConfirm = async (title, description) => {
        try {
            await musicService.saveMusic({
                notation: abcNotation,
                title,
                description
            });
            setIsModalOpen(false);
            onClear();
        } catch (error) {
            console.error('Error saving sheet music:', error);
            toast.error(error.response?.data?.message || 'Failed to save sheet music');
        }
    };

    return (
        <div>
            <div className="container">
                {pianoKeys.map((key, index) => (
                    <div
                        key={index}
                        className={`${key.type}-key ${
                            activeKeys.includes(key.note) ? "active" : ""
                        } ${isModalOpen ? 'disabled' : ''}`}
                    >
                        <div className="key-label">{keyLabels[key.note]}</div>
                    </div>
                ))}
            </div>
            <div className="button-container">
                <button onClick={onClear} className="clear-button">Clear</button>
                <button onClick={handleSaveClick} className="save-button">Save</button>
            </div>
            <Modal
                isOpen={isModalOpen}
                onClose={handleModalClose}
                onConfirm={handleSaveConfirm}
            />
        </div>
    );
};

export default Keyboard;
