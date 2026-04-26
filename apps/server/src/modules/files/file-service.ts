import fs from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime-types';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import type { FileRecord, FileBucket, SessionFileContext } from '@skillchat/shared';
import type { MultipartFile } from '@fastify/multipart';
import type { AppConfig } from '../../config/env.js';
import type { AppDatabase } from '../../db/database.js';
import { assertPathInside, sanitizeFilename, uniqueFileName } from '../../core/storage/fs-utils.js';
import {
  getSessionOutputsRoot,
  getSessionUploadsRoot,
  getSharedRoot,
  getUserRoot,
  resolveUserPath,
} from '../../core/storage/paths.js';

type FileRow = {
  id: string;
  user_id: string;
  session_id: string | null;
  display_name: string;
  relative_path: string;
  mime_type: string | null;
  size: number;
  bucket: FileBucket;
  source: 'upload' | 'generated' | 'shared';
  created_at: string;
};

const toFileRecord = (row: FileRow): FileRecord => ({
  id: row.id,
  userId: row.user_id,
  sessionId: row.session_id,
  displayName: row.display_name,
  relativePath: row.relative_path,
  mimeType: row.mime_type,
  size: row.size,
  bucket: row.bucket,
  source: row.source,
  createdAt: row.created_at,
  downloadUrl: `/api/files/${row.id}/download`,
  ...(row.mime_type?.startsWith('image/')
    ? { thumbnailUrl: `/api/files/${row.id}/thumbnail` }
    : {}),
});

const isImage = (file: Pick<FileRecord, 'mimeType'>) =>
  Boolean(file.mimeType?.startsWith('image/'));

const isResizableImage = (file: Pick<FileRecord, 'mimeType'>) =>
  isImage(file) && file.mimeType !== 'image/svg+xml';

const fileExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export class FileService {
  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig,
  ) {}

  list(userId: string, filters: { sessionId?: string; bucket?: FileBucket; type?: string } = {}): FileRecord[] {
    const clauses = ['user_id = ?'];
    const params: unknown[] = [userId];

    if (filters.sessionId) {
      clauses.push('session_id = ?');
      params.push(filters.sessionId);
    }

    if (filters.bucket) {
      clauses.push('bucket = ?');
      params.push(filters.bucket);
    }

    const rows = this.db
      .prepare(
        `SELECT id, user_id, session_id, display_name, relative_path, mime_type, size, bucket, source, created_at
         FROM files
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC`,
      )
      .all(...params) as FileRow[];

    let files = rows.map(toFileRecord);

    if (filters.type) {
      files = files.filter((file) => file.mimeType?.includes(filters.type!) || file.displayName.toLowerCase().includes(filters.type!));
    }

    return files;
  }

  getById(userId: string, fileId: string): FileRecord {
    const row = this.db
      .prepare(
        'SELECT id, user_id, session_id, display_name, relative_path, mime_type, size, bucket, source, created_at FROM files WHERE id = ? AND user_id = ?',
      )
      .get(fileId, userId) as FileRow | undefined;

    if (!row) {
      throw new Error('文件不存在');
    }

    return toFileRecord(row);
  }

  async saveUpload(userId: string, sessionId: string, file: MultipartFile): Promise<FileRecord> {
    const uploadRoot = getSessionUploadsRoot(this.config, userId, sessionId);
    await fs.mkdir(uploadRoot, { recursive: true });

    const originalName = file.filename || 'upload.bin';
    const storedName = uniqueFileName(originalName);
    const targetPath = path.join(uploadRoot, storedName);
    const buffer = await file.toBuffer();

    await fs.writeFile(targetPath, buffer);

    return this.insertRecord({
      userId,
      sessionId,
      displayName: originalName,
      absolutePath: targetPath,
      mimeType: file.mimetype || mime.lookup(originalName) || 'application/octet-stream',
      bucket: 'uploads',
      source: 'upload',
    });
  }

  async recordGeneratedFile(args: {
    userId: string;
    sessionId: string;
    absolutePath: string;
    displayName?: string;
  }): Promise<FileRecord> {
    return this.insertRecord({
      userId: args.userId,
      sessionId: args.sessionId,
      displayName: args.displayName ?? path.basename(args.absolutePath),
      absolutePath: args.absolutePath,
      mimeType: mime.lookup(args.absolutePath) || 'application/octet-stream',
      bucket: 'outputs',
      source: 'generated',
    });
  }

  async saveGeneratedBinary(args: {
    userId: string;
    sessionId: string;
    displayName: string;
    mimeType: string;
    content: Buffer;
  }): Promise<FileRecord> {
    const outputsRoot = getSessionOutputsRoot(this.config, args.userId, args.sessionId);
    await fs.mkdir(outputsRoot, { recursive: true });

    const storedName = uniqueFileName(sanitizeFilename(args.displayName));
    const targetPath = path.join(outputsRoot, storedName);
    await fs.writeFile(targetPath, args.content);

    return this.insertRecord({
      userId: args.userId,
      sessionId: args.sessionId,
      displayName: sanitizeFilename(args.displayName),
      absolutePath: targetPath,
      mimeType: args.mimeType,
      bucket: 'outputs',
      source: 'generated',
    });
  }

  async shareFile(userId: string, fileId: string): Promise<FileRecord> {
    const file = this.getById(userId, fileId);
    const sourcePath = resolveUserPath(this.config, userId, file.relativePath);
    const sharedRoot = getSharedRoot(this.config, userId);
    await fs.mkdir(sharedRoot, { recursive: true });

    const targetPath = path.join(sharedRoot, uniqueFileName(file.displayName));
    await fs.copyFile(sourcePath, targetPath);

      return this.insertRecord({
        userId,
        sessionId: null,
        displayName: file.displayName,
        absolutePath: targetPath,
        mimeType: file.mimeType ?? (mime.lookup(file.displayName) || 'application/octet-stream'),
        bucket: 'shared',
        source: 'shared',
      });
  }

  getFileContext(userId: string, sessionId: string): SessionFileContext[] {
    const rows = this.db
      .prepare(
        `SELECT id, display_name, mime_type, size, bucket, relative_path
         FROM files
         WHERE user_id = ? AND (session_id = ? OR bucket = 'shared')
         ORDER BY created_at DESC`,
      )
      .all(userId, sessionId) as Array<{
        id: string;
        display_name: string;
        mime_type: string | null;
        size: number;
        bucket: FileBucket;
        relative_path: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.display_name,
      mimeType: row.mime_type,
      size: row.size,
      bucket: row.bucket,
      relativePath: row.relative_path,
    }));
  }

  async resolveDownloadPath(userId: string, fileId: string) {
    const file = this.getById(userId, fileId);
    const absolutePath = resolveUserPath(this.config, userId, file.relativePath);
    return {
      file,
      absolutePath,
    };
  }

  async resolveThumbnailPath(userId: string, fileId: string) {
    const file = this.getById(userId, fileId);
    const absolutePath = resolveUserPath(this.config, userId, file.relativePath);

    if (!isImage(file)) {
      throw new Error('文件不是可预览图片');
    }

    if (!isResizableImage(file) || file.size <= this.config.IMAGE_THUMBNAIL_THRESHOLD_BYTES) {
      return {
        file,
        absolutePath,
        mimeType: file.mimeType ?? 'application/octet-stream',
      };
    }

    const thumbnailPath = await this.ensureThumbnail(file, absolutePath);
    return {
      file,
      absolutePath: thumbnailPath ?? absolutePath,
      mimeType: thumbnailPath ? 'image/webp' : (file.mimeType ?? 'application/octet-stream'),
    };
  }

  private async insertRecord(args: {
    userId: string;
    sessionId: string | null;
    displayName: string;
    absolutePath: string;
    mimeType: string;
    bucket: FileBucket;
    source: 'upload' | 'generated' | 'shared';
  }): Promise<FileRecord> {
    const userRoot = getUserRoot(this.config, args.userId);
    assertPathInside(userRoot, args.absolutePath);

    const stat = await fs.stat(args.absolutePath);
    const relativePath = path.relative(userRoot, args.absolutePath);
    const id = nanoid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO files
          (id, user_id, session_id, display_name, relative_path, mime_type, size, bucket, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        args.userId,
        args.sessionId,
        args.displayName,
        relativePath,
        args.mimeType,
        stat.size,
        args.bucket,
        args.source,
        now,
      );

    const record: FileRecord = {
      id,
      userId: args.userId,
      sessionId: args.sessionId,
      displayName: args.displayName,
      relativePath,
      mimeType: args.mimeType,
      size: stat.size,
      bucket: args.bucket,
      source: args.source,
      createdAt: now,
      downloadUrl: `/api/files/${id}/download`,
      ...(args.mimeType.startsWith('image/')
        ? { thumbnailUrl: `/api/files/${id}/thumbnail` }
        : {}),
    };

    await this.createThumbnailBestEffort(record, args.absolutePath);

    return record;
  }

  private getThumbnailPath(file: FileRecord, absolutePath: string) {
    const thumbnailName = `${file.id}-${this.config.IMAGE_THUMBNAIL_MAX_WIDTH}x${this.config.IMAGE_THUMBNAIL_MAX_HEIGHT}.webp`;
    return path.join(path.dirname(absolutePath), '.thumbnails', thumbnailName);
  }

  private async createThumbnailBestEffort(file: FileRecord, absolutePath: string) {
    if (!isResizableImage(file) || file.size <= this.config.IMAGE_THUMBNAIL_THRESHOLD_BYTES) {
      return;
    }

    try {
      await this.ensureThumbnail(file, absolutePath);
    } catch {
      // Thumbnail generation is an optimization. The original file remains
      // authoritative and preview endpoints fall back to it if conversion fails.
    }
  }

  private async ensureThumbnail(file: FileRecord, absolutePath: string) {
    const userRoot = getUserRoot(this.config, file.userId);
    assertPathInside(userRoot, absolutePath);

    const thumbnailPath = this.getThumbnailPath(file, absolutePath);
    assertPathInside(userRoot, thumbnailPath);

    if (await fileExists(thumbnailPath)) {
      return thumbnailPath;
    }

    await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });

    try {
      await sharp(absolutePath, { animated: false })
        .rotate()
        .resize({
          width: this.config.IMAGE_THUMBNAIL_MAX_WIDTH,
          height: this.config.IMAGE_THUMBNAIL_MAX_HEIGHT,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: this.config.IMAGE_THUMBNAIL_QUALITY })
        .toFile(thumbnailPath);
      return thumbnailPath;
    } catch {
      await fs.rm(thumbnailPath, { force: true });
      return null;
    }
  }
}
