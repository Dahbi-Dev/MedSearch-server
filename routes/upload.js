// routes/upload.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp'); // For image optimization
const { auth } = require('../middleware/auth');

const router = express.Router();

// Create uploads directory structure if it doesn't exist
const uploadDir = path.join(__dirname, '../uploads');
const createDirStructure = () => {
  const dirs = [
    uploadDir,
    path.join(uploadDir, 'images'),
    path.join(uploadDir, 'images', 'blog'),
    path.join(uploadDir, 'images', 'profile'),
    path.join(uploadDir, 'images', 'thumbnails'),
    path.join(uploadDir, 'videos'),
    path.join(uploadDir, 'documents')
  ];

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

createDirStructure();

// Enhanced multer configuration with better organization
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let subDir = 'documents'; // default
    
    // Determine subdirectory based on file type and purpose
    if (file.mimetype.startsWith('image/')) {
      if (req.route.path.includes('blog')) {
        subDir = 'images/blog';
      } else if (req.route.path.includes('profile')) {
        subDir = 'images/profile';
      } else {
        subDir = 'images';
      }
    } else if (file.mimetype.startsWith('video/')) {
      subDir = 'videos';
    }
    
    const fullPath = path.join(uploadDir, subDir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    
    cb(null, fullPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with user ID and timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const prefix = req.user ? req.user._id.toString().slice(-6) : 'anon';
    cb(null, `${prefix}-${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// Enhanced file filter with better validation
const fileFilter = (req, file, cb) => {
  const allowedTypes = {
    images: [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml'
    ],
    videos: [
      'video/mp4',
      'video/avi',
      'video/mov',
      'video/wmv',
      'video/webm',
      'video/quicktime'
    ],
    documents: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/rtf'
    ]
  };

  const allAllowedTypes = [...allowedTypes.images, ...allowedTypes.videos, ...allowedTypes.documents];

  if (allAllowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type '${file.mimetype}' not allowed. Allowed types: images, videos, and documents.`), false);
  }
};

// Configure multer with enhanced settings
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit (increased for better blog images)
    files: 10 // Maximum files in multiple upload
  },
  fileFilter: fileFilter
});

// Utility function to optimize images
const optimizeImage = async (inputPath, outputPath, maxWidth = 1200, quality = 85) => {
  try {
    await sharp(inputPath)
      .resize(maxWidth, null, { 
        withoutEnlargement: true,
        fit: 'inside'
      })
      .jpeg({ quality })
      .toFile(outputPath);
    
    // Delete original if optimization was successful
    if (inputPath !== outputPath) {
      fs.unlinkSync(inputPath);
    }
    
    return true;
  } catch (error) {
    console.error('Image optimization error:', error);
    return false;
  }
};

// Generate thumbnail for images
const generateThumbnail = async (inputPath, outputPath, size = 300) => {
  try {
    await sharp(inputPath)
      .resize(size, size, { 
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 80 })
      .toFile(outputPath);
    
    return true;
  } catch (error) {
    console.error('Thumbnail generation error:', error);
    return false;
  }
};

// Blog featured image upload with optimization
router.post('/blog-image', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    // Ensure it's an image
    if (!req.file.mimetype.startsWith('image/')) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Only image files are allowed' });
    }

    const originalPath = req.file.path;
    const optimizedPath = originalPath.replace(/\.[^/.]+$/, '-optimized.jpg');
    const thumbnailPath = path.join(path.dirname(originalPath), '../thumbnails', path.basename(originalPath).replace(/\.[^/.]+$/, '-thumb.jpg'));

    // Optimize main image
    const optimized = await optimizeImage(originalPath, optimizedPath);
    
    // Generate thumbnail
    const thumbnailGenerated = await generateThumbnail(optimized ? optimizedPath : originalPath, thumbnailPath);

    const finalPath = optimized ? optimizedPath : originalPath;
    const relativePath = finalPath.replace(path.join(__dirname, '../'), '');
    const imageUrl = `${req.protocol}://${req.get('host')}/${relativePath.replace(/\\/g, '/')}`;
    
    let thumbnailUrl = null;
    if (thumbnailGenerated) {
      const thumbnailRelativePath = thumbnailPath.replace(path.join(__dirname, '../'), '');
      thumbnailUrl = `${req.protocol}://${req.get('host')}/${thumbnailRelativePath.replace(/\\/g, '/')}`;
    }

    // Get file stats
    const stats = fs.statSync(finalPath);

    res.json({
      message: 'Blog image uploaded successfully',
      image: {
        url: imageUrl,
        thumbnailUrl: thumbnailUrl,
        filename: path.basename(finalPath),
        originalName: req.file.originalname,
        size: stats.size,
        mimetype: 'image/jpeg', // Always JPEG after optimization
        optimized: optimized
      }
    });
  } catch (error) {
    console.error('Blog image upload error:', error);
    res.status(500).json({ message: 'Blog image upload failed', error: error.message });
  }
});

// Profile image upload with circular thumbnail generation
router.post('/profile-image', auth, upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    if (!req.file.mimetype.startsWith('image/')) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Only image files are allowed' });
    }

    const originalPath = req.file.path;
    const optimizedPath = originalPath.replace(/\.[^/.]+$/, '-profile.jpg');
    const thumbnailPath = path.join(path.dirname(originalPath), '../thumbnails', path.basename(originalPath).replace(/\.[^/.]+$/, '-profile-thumb.jpg'));

    // Optimize for profile (smaller size, square crop)
    try {
      await sharp(originalPath)
        .resize(400, 400, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 90 })
        .toFile(optimizedPath);
      
      fs.unlinkSync(originalPath);
    } catch (optimizeError) {
      console.warn('Profile image optimization failed, using original');
    }

    // Generate small circular thumbnail
    try {
      await sharp(fs.existsSync(optimizedPath) ? optimizedPath : originalPath)
        .resize(150, 150, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 85 })
        .toFile(thumbnailPath);
    } catch (thumbError) {
      console.warn('Profile thumbnail generation failed');
    }

    const finalPath = fs.existsSync(optimizedPath) ? optimizedPath : originalPath;
    const relativePath = finalPath.replace(path.join(__dirname, '../'), '');
    const imageUrl = `${req.protocol}://${req.get('host')}/${relativePath.replace(/\\/g, '/')}`;
    
    let thumbnailUrl = null;
    if (fs.existsSync(thumbnailPath)) {
      const thumbnailRelativePath = thumbnailPath.replace(path.join(__dirname, '../'), '');
      thumbnailUrl = `${req.protocol}://${req.get('host')}/${thumbnailRelativePath.replace(/\\/g, '/')}`;
    }

    // TODO: Update user profile image in database
    // const User = require('../models/User');
    // await User.findByIdAndUpdate(req.user._id, { 
    //   profileImage: imageUrl,
    //   profileImageThumbnail: thumbnailUrl 
    // });

    res.json({
      message: 'Profile image uploaded successfully',
      image: {
        url: imageUrl,
        thumbnailUrl: thumbnailUrl,
        filename: path.basename(finalPath),
        originalName: req.file.originalname
      }
    });
  } catch (error) {
    console.error('Profile image upload error:', error);
    res.status(500).json({ message: 'Profile image upload failed', error: error.message });
  }
});

// Multiple files upload with better categorization
router.post('/multiple', auth, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const processedFiles = [];

    for (const file of req.files) {
      const relativePath = file.path.replace(path.join(__dirname, '../'), '');
      const fileUrl = `${req.protocol}://${req.get('host')}/${relativePath.replace(/\\/g, '/')}`;
      
      let thumbnailUrl = null;
      
      // Generate thumbnail for images
      if (file.mimetype.startsWith('image/')) {
        const thumbnailPath = path.join(path.dirname(file.path), '../thumbnails', 
          path.basename(file.path).replace(/\.[^/.]+$/, '-thumb.jpg'));
        
        const thumbnailGenerated = await generateThumbnail(file.path, thumbnailPath);
        if (thumbnailGenerated) {
          const thumbnailRelativePath = thumbnailPath.replace(path.join(__dirname, '../'), '');
          thumbnailUrl = `${req.protocol}://${req.get('host')}/${thumbnailRelativePath.replace(/\\/g, '/')}`;
        }
      }

      processedFiles.push({
        filename: file.filename,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        url: fileUrl,
        thumbnailUrl: thumbnailUrl,
        type: file.mimetype.startsWith('image/') ? 'image' : 
              file.mimetype.startsWith('video/') ? 'video' : 'document'
      });
    }

    res.json({
      message: 'Files uploaded successfully',
      files: processedFiles,
      count: processedFiles.length
    });
  } catch (error) {
    console.error('Multiple upload error:', error);
    res.status(500).json({ message: 'Upload failed', error: error.message });
  }
});

// Single file upload (general purpose)
router.post('/single', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const relativePath = req.file.path.replace(path.join(__dirname, '../'), '');
    const fileUrl = `${req.protocol}://${req.get('host')}/${relativePath.replace(/\\/g, '/')}`;

    let thumbnailUrl = null;
    
    // Generate thumbnail for images
    if (req.file.mimetype.startsWith('image/')) {
      const thumbnailPath = path.join(path.dirname(req.file.path), '../thumbnails', 
        path.basename(req.file.path).replace(/\.[^/.]+$/, '-thumb.jpg'));
      
      const thumbnailGenerated = await generateThumbnail(req.file.path, thumbnailPath);
      if (thumbnailGenerated) {
        const thumbnailRelativePath = thumbnailPath.replace(path.join(__dirname, '../'), '');
        thumbnailUrl = `${req.protocol}://${req.get('host')}/${thumbnailRelativePath.replace(/\\/g, '/')}`;
      }
    }

    res.json({
      message: 'File uploaded successfully',
      file: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        url: fileUrl,
        thumbnailUrl: thumbnailUrl,
        type: req.file.mimetype.startsWith('image/') ? 'image' : 
              req.file.mimetype.startsWith('video/') ? 'video' : 'document'
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Upload failed', error: error.message });
  }
});

// Get user's uploaded files
router.get('/my-files', auth, async (req, res) => {
  try {
    const userPrefix = req.user._id.toString().slice(-6);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const type = req.query.type; // 'image', 'video', 'document'
    
    // This is a simplified version - in production, you'd want to store file metadata in database
    const allFiles = [];
    const subdirs = ['images', 'images/blog', 'images/profile', 'videos', 'documents'];
    
    for (const subdir of subdirs) {
      const dirPath = path.join(uploadDir, subdir);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        const userFiles = files.filter(file => file.startsWith(userPrefix));
        
        for (const file of userFiles) {
          const filePath = path.join(dirPath, file);
          const stats = fs.statSync(filePath);
          const relativePath = filePath.replace(path.join(__dirname, '../'), '');
          const fileUrl = `${req.protocol}://${req.get('host')}/${relativePath.replace(/\\/g, '/')}`;
          
          const fileType = file.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? 'image' :
                          file.match(/\.(mp4|avi|mov|wmv|webm)$/i) ? 'video' : 'document';
          
          if (!type || fileType === type) {
            allFiles.push({
              filename: file,
              url: fileUrl,
              size: stats.size,
              type: fileType,
              createdAt: stats.birthtime,
              category: subdir
            });
          }
        }
      }
    }
    
    // Sort by creation date (newest first)
    allFiles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Paginate
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedFiles = allFiles.slice(startIndex, endIndex);
    
    res.json({
      files: paginatedFiles,
      pagination: {
        current: page,
        pages: Math.ceil(allFiles.length / limit),
        total: allFiles.length,
        hasNext: endIndex < allFiles.length,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get user files error:', error);
    res.status(500).json({ message: 'Failed to retrieve files', error: error.message });
  }
});

// Enhanced delete file endpoint with cleanup
router.delete('/file/:filename', auth, async (req, res) => {
  try {
    const { filename } = req.params;
    const userPrefix = req.user._id.toString().slice(-6);
    
    // Security check - ensure user can only delete their own files
    if (!filename.startsWith(userPrefix) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. You can only delete your own files.' });
    }
    
    // Search for the file in all subdirectories
    const subdirs = ['images', 'images/blog', 'images/profile', 'videos', 'documents', 'images/thumbnails'];
    let deletedFiles = [];
    
    for (const subdir of subdirs) {
      const filePath = path.join(uploadDir, subdir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deletedFiles.push(`${subdir}/${filename}`);
      }
      
      // Also check for related files (thumbnails, optimized versions)
      const baseName = path.parse(filename).name;
      const relatedPatterns = [
        `${baseName}-optimized.jpg`,
        `${baseName}-thumb.jpg`,
        `${baseName}-profile.jpg`,
        `${baseName}-profile-thumb.jpg`
      ];
      
      for (const pattern of relatedPatterns) {
        const relatedPath = path.join(uploadDir, subdir, pattern);
        if (fs.existsSync(relatedPath)) {
          fs.unlinkSync(relatedPath);
          deletedFiles.push(`${subdir}/${pattern}`);
        }
      }
    }
    
    if (deletedFiles.length === 0) {
      return res.status(404).json({ message: 'File not found' });
    }
    
    res.json({ 
      message: 'File(s) deleted successfully',
      deletedFiles: deletedFiles
    });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ message: 'Failed to delete file', error: error.message });
  }
});

// Get file info endpoint
router.get('/file/:filename/info', auth, async (req, res) => {
  try {
    const { filename } = req.params;
    const userPrefix = req.user._id.toString().slice(-6);
    
    // Security check for non-admin users
    if (!filename.startsWith(userPrefix) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Search for the file
    const subdirs = ['images', 'images/blog', 'images/profile', 'videos', 'documents'];
    let fileInfo = null;
    
    for (const subdir of subdirs) {
      const filePath = path.join(uploadDir, subdir, filename);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const relativePath = filePath.replace(path.join(__dirname, '../'), '');
        const fileUrl = `${req.protocol}://${req.get('host')}/${relativePath.replace(/\\/g, '/')}`;
        
        fileInfo = {
          filename: filename,
          url: fileUrl,
          size: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime,
          category: subdir,
          type: filename.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? 'image' :
                filename.match(/\.(mp4|avi|mov|wmv|webm)$/i) ? 'video' : 'document'
        };
        break;
      }
    }
    
    if (!fileInfo) {
      return res.status(404).json({ message: 'File not found' });
    }
    
    res.json(fileInfo);
  } catch (error) {
    console.error('Get file info error:', error);
    res.status(500).json({ message: 'Failed to get file info', error: error.message });
  }
});

// Enhanced error handling middleware
router.use((error, req, res, next) => {
  // Clean up any uploaded files on error
  if (req.file) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (cleanupError) {
      console.error('Failed to cleanup file on error:', cleanupError);
    }
  }
  
  if (req.files) {
    req.files.forEach(file => {
      try {
        fs.unlinkSync(file.path);
      } catch (cleanupError) {
        console.error('Failed to cleanup file on error:', cleanupError);
      }
    });
  }

  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({ message: 'File too large. Maximum size is 15MB.' });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({ message: 'Too many files. Maximum is 10 files.' });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({ message: 'Unexpected field name.' });
      default:
        return res.status(400).json({ message: 'Upload error: ' + error.message });
    }
  }
  
  if (error.message.includes('File type') && error.message.includes('not allowed')) {
    return res.status(400).json({ message: error.message });
  }
  
  console.error('Upload middleware error:', error);
  res.status(500).json({ message: 'Upload error', error: error.message });
});

module.exports = router;