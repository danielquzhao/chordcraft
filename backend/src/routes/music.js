const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Music = require('../models/Music');

// @desc    Get all music for user
// @route   GET /api/music
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        const music = await Music.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json(music);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Create music
// @route   POST /api/music
// @access  Private
router.post('/', protect, async (req, res) => {
    const { notation, title, description, timestamp } = req.body;

    if (!notation || !title) {
        return res.status(400).json({ message: 'Please add notation and title' });
    }

    try {
        const music = await Music.create({
            userId: req.user.id,
            notation,
            title,
            description,
            timestamp,
        });

        res.status(201).json(music);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Update music
// @route   PUT /api/music/:id
// @access  Private
router.put('/:id', protect, async (req, res) => {
    try {
        const music = await Music.findById(req.params.id);

        if (!music) {
            return res.status(404).json({ message: 'Music not found' });
        }

        // Make sure user owns music
        if (music.userId.toString() !== req.user.id) {
            return res.status(401).json({ message: 'User not authorized' });
        }

        const updatedMusic = await Music.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
        });

        res.json(updatedMusic);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Delete music
// @route   DELETE /api/music/:id
// @access  Private
router.delete('/:id', protect, async (req, res) => {
    try {
        const music = await Music.findById(req.params.id);

        if (!music) {
            return res.status(404).json({ message: 'Music not found' });
        }

        // Make sure user owns music
        if (music.userId.toString() !== req.user.id) {
            return res.status(401).json({ message: 'User not authorized' });
        }

        await music.deleteOne();

        res.json({ message: 'Music removed' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

module.exports = router;
