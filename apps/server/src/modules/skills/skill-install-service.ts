import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';
import {
  installSkillRequestSchema,
  parseSkillManifest,
  splitSkillId,
  type InstalledSkillRecord,
  type SkillId,
  type SkillManifest,
} from '@qizhi/skill-spec';
import type { AppConfig } from '../../config/env.js';
import { assertPathInside } from '../../core/storage/fs-utils.js';
import type { SkillRegistry } from './skill-registry.js';
import { InstalledSkillStore } from './installed-skill-store.js';
import { MarketClient } from './market-client.js';

const safeSegment = (value: string) => {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(value)) {
    throw new Error(`Unsafe skill path segment: ${value}`);
  }
  return value;
};

const safeVersionSegment = (value: string) => {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`Unsafe skill version segment: ${value}`);
  }
  return value;
};

const assertSafeArchivePath = (entryPath: string) => {
  const normalized = entryPath.replace(/\\/g, '/');
  if (
    normalized.startsWith('/')
    || /^[A-Za-z]:/.test(normalized)
    || normalized.startsWith('../')
    || normalized.includes('/../')
    || normalized === '..'
  ) {
    throw new Error(`Unsafe archive path: ${entryPath}`);
  }
};

const sameManifestIdentity = (left: SkillManifest, right: SkillManifest) =>
  left.id === right.id && left.version === right.version;

export class SkillInstallService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: InstalledSkillStore,
    private readonly skillRegistry: SkillRegistry,
  ) {}

  listInstalled(userId: string): InstalledSkillRecord[] {
    return this.store.listForUser(userId);
  }

  async install(userId: string, input: unknown): Promise<InstalledSkillRecord> {
    const request = installSkillRequestSchema.parse({
      marketBaseUrl: this.config.MARKET_BASE_URL,
      ...input as Record<string, unknown>,
    });
    const client = new MarketClient(request.marketBaseUrl);
    const marketVersion = await client.getVersion(request.id, request.version);
    const marketManifest = parseSkillManifest(marketVersion.manifest);

    const cachedPackage = this.store.getPackage(marketManifest.id, marketManifest.version);
    if (cachedPackage) {
      await this.assertCachedPackageReadable(cachedPackage.installPath);
      return this.store.upsertUserInstalled(userId, cachedPackage.id, cachedPackage.version);
    }

    const packageBytes = await client.downloadPackage(marketVersion.packageUrl);

    if (marketVersion.checksumSha256) {
      const actual = crypto.createHash('sha256').update(packageBytes).digest('hex');
      if (actual.toLowerCase() !== marketVersion.checksumSha256.toLowerCase()) {
        throw new Error('Downloaded skill package checksum mismatch');
      }
    }

    const stagingRoot = path.join(this.config.DATA_ROOT, 'skill-install-staging');
    await fs.mkdir(stagingRoot, { recursive: true });
    const stagingDir = await fs.mkdtemp(path.join(stagingRoot, 'install-'));
    const archivePath = path.join(stagingDir, 'package.tgz');
    const extractDir = path.join(stagingDir, 'extract');

    try {
      await fs.writeFile(archivePath, packageBytes);
      await fs.mkdir(extractDir, { recursive: true });
      await tar.x({
        file: archivePath,
        cwd: extractDir,
        filter: (entryPath, entry) => {
          const type = 'type' in entry ? entry.type : undefined;
          assertSafeArchivePath(entryPath);
          if (type === 'SymbolicLink' || type === 'Link') {
            throw new Error(`Archive links are not allowed: ${entryPath}`);
          }
          return true;
        },
      });

      const packageRoot = await this.resolvePackageRoot(extractDir);
      await this.assertNoSymlinks(packageRoot);
      await this.assertRequiredFiles(packageRoot);

      const installedManifest = parseSkillManifest(JSON.parse(
        await fs.readFile(path.join(packageRoot, 'skill.json'), 'utf8'),
      ));
      if (!sameManifestIdentity(marketManifest, installedManifest)) {
        throw new Error('Downloaded skill manifest does not match market manifest identity');
      }

      const installPath = await this.moveIntoInstalledRoot(request.id, installedManifest.version, packageRoot);
      const packageRecord = this.store.upsertPackage({
        manifest: installedManifest,
        installPath,
        sourceMarketUrl: request.marketBaseUrl,
      });
      await this.skillRegistry.load();
      return this.store.upsertUserInstalled(userId, packageRecord.id, packageRecord.version);
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  }

  uninstall(userId: string, input: { id: SkillId; version?: string }): InstalledSkillRecord {
    return this.store.removeUserInstalled(userId, input.id, input.version);
  }

  private async resolvePackageRoot(extractDir: string) {
    const directManifest = path.join(extractDir, 'skill.json');
    try {
      await fs.access(directManifest);
      return extractDir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const entries = await fs.readdir(extractDir, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    if (directories.length === 1) {
      const nestedRoot = path.join(extractDir, directories[0]!.name);
      await fs.access(path.join(nestedRoot, 'skill.json'));
      return nestedRoot;
    }

    throw new Error('Skill package must contain skill.json at its root');
  }

  private async assertRequiredFiles(packageRoot: string) {
    await fs.access(path.join(packageRoot, 'skill.json'));
    await fs.access(path.join(packageRoot, 'SKILL.md'));
  }

  private async assertCachedPackageReadable(installPath: string) {
    await fs.access(path.join(installPath, 'skill.json'));
    await fs.access(path.join(installPath, 'SKILL.md'));
  }

  private async assertNoSymlinks(root: string) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      const stat = await fs.lstat(fullPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symlinks are not allowed in skill packages: ${entry.name}`);
      }
      if (stat.isDirectory()) {
        await this.assertNoSymlinks(fullPath);
      }
    }
  }

  private async moveIntoInstalledRoot(id: SkillId, version: string, packageRoot: string) {
    const { publisher, name } = splitSkillId(id);
    const installPath = path.join(
      this.config.INSTALLED_SKILLS_ROOT,
      safeSegment(publisher),
      safeSegment(name),
      safeVersionSegment(version),
    );
    assertPathInside(this.config.INSTALLED_SKILLS_ROOT, installPath);

    const parent = path.dirname(installPath);
    await fs.mkdir(parent, { recursive: true });
    const tempTarget = `${installPath}.tmp-${crypto.randomUUID()}`;
    assertPathInside(this.config.INSTALLED_SKILLS_ROOT, tempTarget);
    await fs.rename(packageRoot, tempTarget);
    await fs.rm(installPath, { recursive: true, force: true });
    await fs.rename(tempTarget, installPath);
    return installPath;
  }
}
