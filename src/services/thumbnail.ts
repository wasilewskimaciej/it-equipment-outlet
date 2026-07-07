import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { getImagesWithoutThumbnails, updateImageThumbnail } from '../db';

// Thumbnail configuration
const THUMB_WIDTH = 400;
const THUMB_HEIGHT = 300;
const THUMB_QUALITY = 80;

/**
 * Generate a thumbnail for an image file
 * @param originalImagePath - The URL path of the original image (e.g., /images/item-123.jpg)
 * @returns The URL path of the generated thumbnail
 */
export async function generateThumbnail(originalImagePath: string): Promise<string> {
  const basename = path.basename(originalImagePath);
  const extension = path.extname(basename);
  const nameWithoutExt = path.basename(basename, extension);

  // Generate thumbnail filename (always JPEG for smaller size)
  const thumbName = `thumb-${nameWithoutExt}.jpg`;
  const thumbFullPath = path.join(config.paths.uploads, thumbName);
  const inputFullPath = path.join(config.paths.uploads, basename);

  // Check if input file exists
  if (!fs.existsSync(inputFullPath)) {
    throw new Error(`Original image not found: ${inputFullPath}`);
  }

  // Generate thumbnail using sharp
  await sharp(inputFullPath)
    .resize(THUMB_WIDTH, THUMB_HEIGHT, {
      fit: 'cover',
      position: 'center'
    })
    .jpeg({ quality: THUMB_QUALITY })
    .toFile(thumbFullPath);

  return `/images/${thumbName}`;
}

/**
 * Generate thumbnails for all images that don't have one yet
 * Used for migrating existing images
 */
export async function generateAllMissingThumbnails(): Promise<{ success: number; failed: number }> {
  const images = getImagesWithoutThumbnails();
  let success = 0;
  let failed = 0;

  console.log(`Found ${images.length} images without thumbnails`);

  for (const image of images) {
    try {
      const thumbPath = await generateThumbnail(image.imagePath);
      updateImageThumbnail(image.id, thumbPath);
      success++;
      console.log(`Generated thumbnail for image #${image.id}: ${thumbPath}`);
    } catch (error) {
      failed++;
      console.error(`Failed to generate thumbnail for image #${image.id}:`, error);
    }
  }

  console.log(`Thumbnail migration complete: ${success} success, ${failed} failed`);
  return { success, failed };
}

/**
 * Delete a thumbnail file
 * @param thumbnailPath - The URL path of the thumbnail
 */
export function deleteThumbnail(thumbnailPath: string): void {
  if (!thumbnailPath) return;

  const fullPath = path.join(config.paths.uploads, path.basename(thumbnailPath));
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}
