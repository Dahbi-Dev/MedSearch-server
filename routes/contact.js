// routes/contact.js
const express = require('express');
const Contact = require('../models/Contact');
const { body, validationResult } = require('express-validator');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Submit contact form (requires authentication)
router.post('/', auth, [
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('message').trim().isLength({ min: 10 }).withMessage('Message must be at least 10 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, message } = req.body;

    const contact = new Contact({
      name,
      email,
      message,
      userId: req.user._id, // Associate contact with authenticated user
      userRole: req.user.role
    });

    await contact.save();

    res.status(201).json({ 
      message: 'Contact form submitted successfully',
      contact: {
        name: contact.name,
        email: contact.email,
        message: contact.message,
        createdAt: contact.createdAt
      }
    });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all contact messages (admin only)
router.get('/', auth, adminAuth, async (req, res) => {
  try {
    const contacts = await Contact.find()
      .populate('userId', 'name email role')
      .sort({ createdAt: -1 });

    res.json(contacts);
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's own contact messages
router.get('/my-messages', auth, async (req, res) => {
  try {
    const contacts = await Contact.find({ userId: req.user._id })
      .sort({ createdAt: -1 });

    res.json(contacts);
  } catch (error) {
    console.error('Get user contacts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;