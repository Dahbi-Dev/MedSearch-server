// routes/blogs.js
const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult, query } = require('express-validator');
const Blog = require('../models/Blog');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { cloudinary, uploadBlogImage } = require('../config/cloudinary');

const router = express.Router();

// Optional auth middleware - sets req.user if token is present but doesn't require it
const optionalAuth = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '') || 
                req.header('x-auth-token');
  
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.userId).select('-password');
    } catch (error) {
      // Token invalid, but continue without user
      req.user = null;
    }
  }
  next();
};

// Middleware to check if user is doctor or admin
const checkDoctorOrAdmin = (req, res, next) => {
  if (req.user.role !== 'doctor' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Only doctors and admins can create blogs.' });
  }
  next();
};

// CREATE - Create a new blog post
router.post('/', auth, checkDoctorOrAdmin, uploadBlogImage.single('featuredImage'), [
  body('title').trim().isLength({ min: 5, max: 200 }).withMessage('Title must be between 5 and 200 characters'),
  body('content').trim().isLength({ min: 50 }).withMessage('Content must be at least 50 characters'),
  body('summary').trim().isLength({ min: 10, max: 500 }).withMessage('Summary must be between 10 and 500 characters'),
  body('category').isIn([
    'health-tips', 'medical-advice', 'nutrition', 'fitness', 'mental-health',
    'diseases', 'treatments', 'lifestyle', 'research', 'general'
  ]).withMessage('Invalid category'),
  body('tags').optional().custom((value) => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed);
      } catch {
        return false;
      }
    }
    return Array.isArray(value);
  }).withMessage('Tags must be a valid JSON array'),
  body('status').optional().isIn(['draft', 'published']).withMessage('Status must be draft or published')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // If there's an uploaded file and validation fails, delete it from Cloudinary
      if (req.file) {
        await cloudinary.uploader.destroy(req.file.filename);
      }
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, content, summary, category, tags, status } = req.body;
    
    // Parse tags if it's a string
    let parsedTags = [];
    if (tags) {
      parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
    }

    const blogData = {
      title,
      content,
      summary,
      category,
      tags: parsedTags,
      author: req.user._id,
      status: status || 'draft',
      isApproved: req.user.role === 'admin' // Auto-approve if admin
    };

    // Add featured image if uploaded
    if (req.file) {
      blogData.featuredImage = req.file.path;
    }

    // Auto-approve if admin, otherwise set approval fields
    if (req.user.role === 'admin') {
      blogData.approvedBy = req.user._id;
      blogData.approvedAt = new Date();
    }

    const blog = new Blog(blogData);
    await blog.save();

    // Populate author info
    await blog.populate('author', 'name email role specialty');

    res.status(201).json({
      message: 'Blog created successfully',
      blog
    });
  } catch (error) {
    console.error('Create blog error:', error);
    // If there's an uploaded file and an error occurs, delete it from Cloudinary
    if (req.file) {
      await cloudinary.uploader.destroy(req.file.filename);
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// READ - Get all blogs with filtering and pagination (PUBLIC + OPTIONAL AUTH)
router.get('/', optionalAuth, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('category').optional().isIn([
    'health-tips', 'medical-advice', 'nutrition', 'fitness', 'mental-health',
    'diseases', 'treatments', 'lifestyle', 'research', 'general'
  ]).withMessage('Invalid category'),
  query('status').optional().isIn(['draft', 'published', 'archived']).withMessage('Invalid status'),
  query('author').optional().isMongoId().withMessage('Invalid author ID'),
  query('search').optional().isString().withMessage('Search must be a string')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};
    
    // Only show approved and published blogs for non-admin users
    // If no user is logged in, only show approved and published blogs
    if (!req.user || req.user.role !== 'admin') {
      filter.isApproved = true;
      filter.status = 'published';
    }

    if (req.query.category) filter.category = req.query.category;
    if (req.query.status && req.user && req.user.role === 'admin') filter.status = req.query.status;
    if (req.query.author) filter.author = req.query.author;

    // Search functionality
    if (req.query.search) {
      filter.$text = { $search: req.query.search };
    }

    const blogs = await Blog.find(filter)
      .populate('author', 'name email role specialty city')
      .populate('likes.user', 'name')
      .populate('comments.user', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Blog.countDocuments(filter);

    res.json({
      blogs,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get blogs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// READ - Get single blog by ID (PUBLIC + OPTIONAL AUTH)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id)
      .populate('author', 'name email role specialty city experience rating')
      .populate('likes.user', 'name')
      .populate('comments.user', 'name')
      .populate('approvedBy', 'name')
      .populate('rejectedBy', 'name');

    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    // Check if user can view this blog
    const isAuthor = req.user && blog.author._id.toString() === req.user._id.toString();
    const isAdmin = req.user && req.user.role === 'admin';
    const isPublishedAndApproved = blog.status === 'published' && blog.isApproved;

    // Allow access if:
    // 1. User is the author
    // 2. User is admin
    // 3. Blog is published and approved (public access)
    if (!isAuthor && !isAdmin && !isPublishedAndApproved) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Increment views if not the author
    if (!isAuthor) {
      await Blog.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });
      blog.views += 1;
    }

    res.json(blog);
  } catch (error) {
    console.error('Get blog error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid blog ID' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// UPDATE - Update a blog post
router.put('/:id', auth, uploadBlogImage.single('featuredImage'), [
  body('title').optional().trim().isLength({ min: 5, max: 200 }).withMessage('Title must be between 5 and 200 characters'),
  body('content').optional().trim().isLength({ min: 50 }).withMessage('Content must be at least 50 characters'),
  body('summary').optional().trim().isLength({ min: 10, max: 500 }).withMessage('Summary must be between 10 and 500 characters'),
  body('category').optional().isIn([
    'health-tips', 'medical-advice', 'nutrition', 'fitness', 'mental-health',
    'diseases', 'treatments', 'lifestyle', 'research', 'general'
  ]).withMessage('Invalid category'),
  body('tags').optional().custom((value) => {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed);
      } catch {
        return false;
      }
    }
    return Array.isArray(value);
  }).withMessage('Tags must be a valid JSON array'),
  body('status').optional().isIn(['draft', 'published', 'archived']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      if (req.file) {
        await cloudinary.uploader.destroy(req.file.filename);
      }
      return res.status(400).json({ errors: errors.array() });
    }

    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      if (req.file) {
        await cloudinary.uploader.destroy(req.file.filename);
      }
      return res.status(404).json({ message: 'Blog not found' });
    }

    // Check if user can update this blog
    const isAuthor = blog.author.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isAuthor && !isAdmin) {
      if (req.file) {
        await cloudinary.uploader.destroy(req.file.filename);
      }
      return res.status(403).json({ message: 'Access denied' });
    }

    const { title, content, summary, category, tags, status } = req.body;
    
    // Parse tags if it's a string
    let parsedTags = blog.tags;
    if (tags !== undefined) {
      parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
    }

    // Update fields
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (summary !== undefined) updateData.summary = summary;
    if (category !== undefined) updateData.category = category;
    if (tags !== undefined) updateData.tags = parsedTags;
    if (status !== undefined) updateData.status = status;

    // Handle featured image update
    if (req.file) {
      // Delete old image if exists
      if (blog.featuredImage) {
        const publicId = blog.featuredImage.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`blog-images/${publicId}`);
      }
      updateData.featuredImage = req.file.path;
    }

    // Reset approval if content changed (unless admin)
    if ((title || content || summary) && !isAdmin) {
      updateData.isApproved = false;
      updateData.approvedBy = undefined;
      updateData.approvedAt = undefined;
      updateData.rejectionReason = undefined;
      updateData.rejectedBy = undefined;
      updateData.rejectedAt = undefined;
    }

    const updatedBlog = await Blog.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('author', 'name email role specialty');

    res.json({
      message: 'Blog updated successfully',
      blog: updatedBlog
    });
  } catch (error) {
    console.error('Update blog error:', error);
    if (req.file) {
      await cloudinary.uploader.destroy(req.file.filename);
    }
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid blog ID' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE - Delete a blog post
router.delete('/:id', auth, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    // Check if user can delete this blog
    const isAuthor = blog.author.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isAuthor && !isAdmin) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Delete featured image from Cloudinary if exists
    if (blog.featuredImage) {
      const publicId = blog.featuredImage.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(`blog-images/${publicId}`);
    }

    await Blog.findByIdAndDelete(req.params.id);

    res.json({ message: 'Blog deleted successfully' });
  } catch (error) {
    console.error('Delete blog error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid blog ID' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// LIKE/UNLIKE - Toggle like on a blog
router.post('/:id/like', auth, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    // Check if user already liked this blog
    const existingLike = blog.likes.find(like => like.user.toString() === req.user._id.toString());

    if (existingLike) {
      // Unlike
      blog.likes = blog.likes.filter(like => like.user.toString() !== req.user._id.toString());
    } else {
      // Like
      blog.likes.push({ user: req.user._id });
    }

    await blog.save();

    res.json({
      message: existingLike ? 'Blog unliked' : 'Blog liked',
      likes: blog.likes.length,
      isLiked: !existingLike
    });
  } catch (error) {
    console.error('Like blog error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid blog ID' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// COMMENT - Add a comment to a blog
router.post('/:id/comment', auth, [
  body('content').trim().isLength({ min: 1, max: 1000 }).withMessage('Comment must be between 1 and 1000 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    const comment = {
      user: req.user._id,
      content: req.body.content
    };

    blog.comments.push(comment);
    await blog.save();

    // Populate the new comment
    await blog.populate('comments.user', 'name');

    const newComment = blog.comments[blog.comments.length - 1];

    res.status(201).json({
      message: 'Comment added successfully',
      comment: newComment
    });
  } catch (error) {
    console.error('Add comment error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid blog ID' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// ADMIN ROUTES - Approve/Reject blogs (Admin only)
router.post('/:id/approve', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    blog.isApproved = true;
    blog.approvedBy = req.user._id;
    blog.approvedAt = new Date();
    blog.rejectionReason = undefined;
    blog.rejectedBy = undefined;
    blog.rejectedAt = undefined;

    await blog.save();

    res.json({
      message: 'Blog approved successfully',
      blog
    });
  } catch (error) {
    console.error('Approve blog error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/reject', auth, [
  body('reason').trim().isLength({ min: 1, max: 500 }).withMessage('Rejection reason is required and must be less than 500 characters')
], async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    blog.isApproved = false;
    blog.rejectionReason = req.body.reason;
    blog.rejectedBy = req.user._id;
    blog.rejectedAt = new Date();
    blog.approvedBy = undefined;
    blog.approvedAt = undefined;

    await blog.save();

    res.json({
      message: 'Blog rejected successfully',
      blog
    });
  } catch (error) {
    console.error('Reject blog error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's own blogs
router.get('/my/blogs', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = { author: req.user._id };
    if (req.query.status) filter.status = req.query.status;

    const blogs = await Blog.find(filter)
      .populate('author', 'name email role specialty')
      .populate('approvedBy', 'name')
      .populate('rejectedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Blog.countDocuments(filter);

    res.json({
      blogs,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get my blogs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;