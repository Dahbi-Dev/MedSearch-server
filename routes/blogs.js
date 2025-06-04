// routes/blog.js
const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Blog = require('../models/Blog');
const User = require('../models/User'); // Add this import
const { auth, adminAuth } = require('../middleware/auth');
const router = express.Router();

// Get all published blogs (public route)
router.get('/', [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('category').optional().isIn([
    'health-tips', 'medical-advice', 'nutrition', 'fitness', 'mental-health',
    'diseases', 'treatments', 'lifestyle', 'research', 'general'
  ]).withMessage('Invalid category'),
  query('search').optional().isLength({ min: 1, max: 100 }).withMessage('Search term must be 1-100 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const category = req.query.category;
    const search = req.query.search;
    const skip = (page - 1) * limit;

    // Build query
    let query = { status: 'published', isApproved: true };
    
    if (category) {
      query.category = category;
    }

    if (search) {
      query.$text = { $search: search };
    }

    // Get total count for pagination
    const total = await Blog.countDocuments(query);

    const blogs = await Blog.find(query)
      .populate('author', 'name role specialty profileImage')
      .select('-comments') // Exclude comments for performance
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

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

// Get single blog by ID (public route)
router.get('/:id', async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id)
      .populate('author', 'name role specialty city profileImage')
      .populate('comments.user', 'name role profileImage');

    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    // Only show published and approved blogs to non-authors
    if (blog.status !== 'published' || !blog.isApproved) {
      // Check if user is the author or admin
      const token = req.header('Authorization')?.replace('Bearer ', '');
      let isAuthorized = false;
      
      if (token) {
        try {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
          const user = await User.findById(decoded.userId);
          
          if (user && (user._id.toString() === blog.author._id.toString() || user.role === 'admin')) {
            isAuthorized = true;
          }
        } catch (err) {
          // Token invalid, continue as unauthorized
        }
      }

      if (!isAuthorized) {
        return res.status(404).json({ message: 'Blog not found' });
      }
    }

    // Increment views
    blog.views += 1;
    await blog.save();

    res.json(blog);
  } catch (error) {
    console.error('Get blog error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ message: 'Blog not found' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new blog (authenticated users only)
router.post('/', auth, [
  body('title').trim().isLength({ min: 5, max: 200 }).withMessage('Title must be 5-200 characters'),
  body('content').trim().isLength({ min: 10 }).withMessage('Content must be at least 10 characters'),
  body('summary').trim().isLength({ min: 10, max: 500 }).withMessage('Summary must be 10-500 characters'),
  body('category').isIn([
    'health-tips', 'medical-advice', 'nutrition', 'fitness', 'mental-health',
    'diseases', 'treatments', 'lifestyle', 'research', 'general'
  ]).withMessage('Invalid category'),
  body('tags').optional().isArray().withMessage('Tags must be an array'),
  body('tags.*').optional().trim().isLength({ min: 1, max: 30 }).withMessage('Each tag must be 1-30 characters'),
  body('featuredImage').optional().isURL().withMessage('Featured image must be a valid URL'),
  body('status').optional().isIn(['draft', 'published']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, content, summary, category, tags, featuredImage, status } = req.body;

    // Create blog with proper isApproved logic
    const blog = new Blog({
      title,
      content,
      summary,
      author: req.user._id,
      category,
      tags: tags || [],
      featuredImage: featuredImage || null,
      status: status || 'draft'
    });

    // Set approval status based on user role
    if (req.user.role === 'doctor' || req.user.role === 'admin') {
      blog.isApproved = true;
      if (blog.status === 'published') {
        blog.approvedBy = req.user._id;
        blog.approvedAt = new Date();
      }
    } else {
      blog.isApproved = false;
    }

    await blog.save();
    await blog.populate('author', 'name role specialty profileImage');

    res.status(201).json({
      message: 'Blog created successfully',
      blog
    });
  } catch (error) {
    console.error('Create blog error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update blog (author only)
router.put('/:id', auth, [
  body('title').optional().trim().isLength({ min: 5, max: 200 }).withMessage('Title must be 5-200 characters'),
  body('content').optional().trim().isLength({ min: 10 }).withMessage('Content must be at least 10 characters'),
  body('summary').optional().trim().isLength({ min: 10, max: 500 }).withMessage('Summary must be 10-500 characters'),
  body('category').optional().isIn([
    'health-tips', 'medical-advice', 'nutrition', 'fitness', 'mental-health',
    'diseases', 'treatments', 'lifestyle', 'research', 'general'
  ]).withMessage('Invalid category'),
  body('tags').optional().isArray().withMessage('Tags must be an array'),
  body('tags.*').optional().trim().isLength({ min: 1, max: 30 }).withMessage('Each tag must be 1-30 characters'),
  body('featuredImage').optional().isURL().withMessage('Featured image must be a valid URL'),
  body('status').optional().isIn(['draft', 'published', 'archived']).withMessage('Invalid status')
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

    // Check if user is the author or admin
    if (blog.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. You can only edit your own blogs.' });
    }

    // Update fields
    const updateFields = ['title', 'content', 'summary', 'category', 'tags', 'featuredImage', 'status'];
    updateFields.forEach(field => {
      if (req.body[field] !== undefined) {
        blog[field] = req.body[field];
      }
    });

    // Handle approval logic
    if (req.user.role === 'doctor' || req.user.role === 'admin') {
      blog.isApproved = true;
      if (blog.status === 'published') {
        blog.approvedBy = req.user._id;
        blog.approvedAt = new Date();
      }
    } else if (blog.status === 'published' && !blog.isApproved) {
      // Regular user publishing - needs approval
      blog.isApproved = false;
    }

    blog.updatedAt = new Date();
    await blog.save();
    await blog.populate('author', 'name role specialty profileImage');

    res.json({
      message: 'Blog updated successfully',
      blog
    });
  } catch (error) {
    console.error('Update blog error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ message: 'Blog not found' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete blog (author only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);

    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    // Check if user is the author or admin
    if (blog.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. You can only delete your own blogs.' });
    }

    // Optional: Delete associated featured image from filesystem
    if (blog.featuredImage) {
      try {
        const path = require('path');
        const fs = require('fs');
        const url = new URL(blog.featuredImage);
        const filename = path.basename(url.pathname);
        
        // Try to delete from uploads directory
        const uploadDir = path.join(__dirname, '../uploads');
        const subdirs = ['images', 'videos', 'others'];
        
        for (const subdir of subdirs) {
          const filePath = path.join(uploadDir, subdir, filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            break;
          }
        }
      } catch (deleteError) {
        console.warn('Could not delete associated image file:', deleteError.message);
      }
    }

    await Blog.findByIdAndDelete(req.params.id);

    res.json({ message: 'Blog deleted successfully' });
  } catch (error) {
    console.error('Delete blog error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ message: 'Blog not found' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's own blogs (authenticated users)
router.get('/my/blogs', auth, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('status').optional().isIn(['draft', 'published', 'archived']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;
    const skip = (page - 1) * limit;

    let query = { author: req.user._id };
    if (status) {
      query.status = status;
    }

    const blogs = await Blog.find(query)
      .populate('author', 'name role specialty profileImage')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Blog.countDocuments(query);

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
    console.error('Get my blogs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Like/Unlike blog
router.post('/:id/like', auth, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);

    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    if (blog.status !== 'published' || !blog.isApproved) {
      return res.status(400).json({ message: 'Cannot like unpublished blog' });
    }

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
      return res.status(404).json({ message: 'Blog not found' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Add comment to blog
router.post('/:id/comment', auth, [
  body('content').trim().isLength({ min: 1, max: 1000 }).withMessage('Comment must be 1-1000 characters')
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

    if (blog.status !== 'published' || !blog.isApproved) {
      return res.status(400).json({ message: 'Cannot comment on unpublished blog' });
    }

    const comment = {
      user: req.user._id,
      content: req.body.content,
      createdAt: new Date()
    };

    blog.comments.push(comment);
    await blog.save();
    
    // Populate the new comment
    await blog.populate('comments.user', 'name role profileImage');
    const newComment = blog.comments[blog.comments.length - 1];

    res.status(201).json({
      message: 'Comment added successfully',
      comment: newComment
    });
  } catch (error) {
    console.error('Add comment error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ message: 'Blog not found' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete comment (comment author or blog author or admin)
router.delete('/:blogId/comment/:commentId', auth, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.blogId);

    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    const comment = blog.comments.id(req.params.commentId);

    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Check if user can delete comment (comment author, blog author, or admin)
    const canDelete = comment.user.toString() === req.user._id.toString() ||
                     blog.author.toString() === req.user._id.toString() ||
                     req.user.role === 'admin';

    if (!canDelete) {
      return res.status(403).json({ message: 'Access denied' });
    }

    blog.comments.pull(req.params.commentId);
    await blog.save();

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Delete comment error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ message: 'Blog or comment not found' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Get blog statistics (for author dashboard)
router.get('/stats/overview', auth, async (req, res) => {
  try {
    const authorId = req.user._id;

    const stats = await Blog.aggregate([
      { $match: { author: authorId } },
      {
        $group: {
          _id: null,
          totalBlogs: { $sum: 1 },
          publishedBlogs: {
            $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] }
          },
          draftBlogs: {
            $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] }
          },
          totalViews: { $sum: '$views' },
          totalLikes: { $sum: { $size: '$likes' } },
          totalComments: { $sum: { $size: '$comments' } }
        }
      }
    ]);

    const result = stats[0] || {
      totalBlogs: 0,
      publishedBlogs: 0,
      draftBlogs: 0,
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0
    };

    res.json(result);
  } catch (error) {
    console.error('Get blog stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin routes for blog approval
router.get('/admin/pending', adminAuth, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const pendingBlogs = await Blog.find({ isApproved: false, status: 'published' })
      .populate('author', 'name email role profileImage')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Blog.countDocuments({ isApproved: false, status: 'published' });

    res.json({
      blogs: pendingBlogs,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get pending blogs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/admin/:id/approve', adminAuth, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);

    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    blog.isApproved = true;
    blog.approvedBy = req.user._id;
    blog.approvedAt = new Date();

    await blog.save();

    res.json({ 
      message: 'Blog approved successfully',
      blog: {
        id: blog._id,
        title: blog.title,
        isApproved: blog.isApproved,
        approvedAt: blog.approvedAt
      }
    });
  } catch (error) {
    console.error('Approve blog error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ message: 'Blog not found' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/admin/:id/reject', adminAuth, [
  body('reason').optional().trim().isLength({ max: 500 }).withMessage('Rejection reason must not exceed 500 characters')
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

    blog.status = 'draft';
    blog.isApproved = false;
    blog.rejectionReason = req.body.reason || 'Blog content needs revision';
    blog.rejectedBy = req.user._id;
    blog.rejectedAt = new Date();

    await blog.save();

    res.json({ 
      message: 'Blog rejected successfully',
      blog: {
        id: blog._id,
        title: blog.title,
        status: blog.status,
        rejectionReason: blog.rejectionReason
      }
    });
  } catch (error) {
    console.error('Reject blog error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ message: 'Blog not found' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Get featured blogs (top liked/viewed blogs)
router.get('/featured', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;

    const featuredBlogs = await Blog.find({ 
      status: 'published', 
      isApproved: true 
    })
      .populate('author', 'name role specialty profileImage')
      .select('-comments -content') // Exclude heavy fields
      .sort({ views: -1, 'likes.length': -1 })
      .limit(limit);

    res.json(featuredBlogs);
  } catch (error) {
    console.error('Get featured blogs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get related blogs (same category, exclude current blog)
router.get('/:id/related', async (req, res) => {
  try {
    const currentBlog = await Blog.findById(req.params.id).select('category');
    
    if (!currentBlog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    const limit = parseInt(req.query.limit) || 4;

    const relatedBlogs = await Blog.find({
      _id: { $ne: req.params.id },
      category: currentBlog.category,
      status: 'published',
      isApproved: true
    })
      .populate('author', 'name role specialty profileImage')
      .select('-comments -content')
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json(relatedBlogs);
  } catch (error) {
    console.error('Get related blogs error:', error);
    if (error.name === 'CastError') {
      return res.status(404).json({ message: 'Blog not found' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;