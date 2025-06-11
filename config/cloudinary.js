// config/cloudinary.js
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer with Cloudinary Storage for blog images
const blogStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'blog-images',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [
      { width: 1200, height: 630, crop: 'fill' },
      { quality: 'auto' }
    ]
  }
});

// Create multer upload instance for blogs
const uploadBlogImage = multer({ 
  storage: blogStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// You can add more storage configurations for different use cases
const profileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'profile-images',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'svg'],
    transformation: [
      { width: 400, height: 400, crop: 'fill' },
      { quality: 'auto' }
    ]
  }
});

const uploadProfileImage = multer({ 
  storage: profileStorage,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB limit
  }
});

// Export cloudinary instance and upload configurations
module.exports = {
  cloudinary,
  uploadBlogImage,
  uploadProfileImage,
  // Export individual storage configs if needed
  blogStorage,
  profileStorage
};