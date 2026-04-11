import fs from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime-types';
import { nanoid } from 'nanoid';
import type { FileRecord, FileBucket, SessionFileContext } from '@skillchat/shared';
import type { MultipartFile } from '@fastify/multipart';
import type { AppConfig } from '../../config/env.js';
import type { AppDatabase } from '../../db/database.js';
import { assertPathInside, uniqueFileName } from '../../core/storage/fs-utils.js';
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
});

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

    return {
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
    };
  }
}
