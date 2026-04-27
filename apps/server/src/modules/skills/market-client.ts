import {
  marketSkillListResponseSchema,
  marketSkillVersionSchema,
  marketSkillVersionsResponseSchema,
  parseSkillManifest,
  splitSkillId,
  type MarketSkillListResponse,
  type MarketSkillVersion,
  type SkillId,
  type SkillManifest,
} from '@qizhi/skill-spec';

const requireOk = async (response: Response, fallback: string) => {
  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => '');
  throw new Error(body ? `${fallback}: ${response.status} ${body}` : `${fallback}: ${response.status}`);
};

export class MarketClient {
  constructor(private readonly baseUrl: string) {}

  async listSkills(): Promise<MarketSkillListResponse> {
    const response = await fetch(this.url('/api/v1/skills'));
    await requireOk(response, 'Failed to list market skills');
    return marketSkillListResponseSchema.parse(await response.json());
  }

  async getVersion(id: SkillId, version?: string): Promise<MarketSkillVersion> {
    if (version) {
      const manifest = await this.getManifest(id, version);
      const { publisher, name } = splitSkillId(id);
      const packageUrl = this.url(`/api/v1/skills/${publisher}/${name}/versions/${version}/package`);
      return marketSkillVersionSchema.parse({
        id,
        version,
        manifest,
        packageUrl,
        publishedAt: new Date().toISOString(),
      });
    }

    const { publisher, name } = splitSkillId(id);
    const response = await fetch(this.url(`/api/v1/skills/${publisher}/${name}/versions`));
    await requireOk(response, 'Failed to list skill versions');
    const versions = marketSkillVersionsResponseSchema.parse(await response.json()).versions;
    const latest = versions[0];
    if (!latest) {
      throw new Error(`No versions available for ${id}`);
    }
    return marketSkillVersionSchema.parse(latest);
  }

  async getManifest(id: SkillId, version: string): Promise<SkillManifest> {
    const { publisher, name } = splitSkillId(id);
    const response = await fetch(this.url(`/api/v1/skills/${publisher}/${name}/versions/${version}/manifest`));
    await requireOk(response, 'Failed to fetch skill manifest');
    return parseSkillManifest(await response.json());
  }

  async downloadPackage(packageUrl: string): Promise<Uint8Array> {
    const response = await fetch(new URL(packageUrl, this.baseUrl));
    await requireOk(response, 'Failed to download skill package');
    return new Uint8Array(await response.arrayBuffer());
  }

  private url(route: string) {
    return new URL(route, this.baseUrl).toString();
  }
}
