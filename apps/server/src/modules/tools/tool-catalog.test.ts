import { describe, expect, it } from 'vitest';
import { buildAssistantToolCatalog, findAssistantToolDefinition, toResponsesFunctionTool } from './tool-catalog.js';

describe('tool-catalog', () => {
  it('builds the assistant-facing tool catalog from config and enabled skills', () => {
    const catalog = buildAssistantToolCatalog({
      assistantToolsEnabled: true,
      webSearchMode: 'live',
      enabledSkillNames: ['pdf'],
    });

    expect(catalog.map((tool) => tool.name)).toEqual([
      'web_search',
      'web_fetch',
      'list_files',
      'read_file',
      'list_workspace_paths',
      'read_workspace_path_slice',
      'write_artifact_file',
      'run_workspace_script',
    ]);

    expect(findAssistantToolDefinition(catalog, 'web_search')).toEqual(expect.objectContaining({
      executionKind: 'service',
      supportsParallelToolCalls: true,
    }));
    expect(findAssistantToolDefinition(catalog, 'run_workspace_script')).toEqual(expect.objectContaining({
      executionKind: 'runner',
      supportsParallelToolCalls: false,
    }));
  });

  it('removes web_search from the exposed catalog when disabled', () => {
    const catalog = buildAssistantToolCatalog({
      assistantToolsEnabled: true,
      webSearchMode: 'disabled',
      enabledSkillNames: [],
    });

    expect(catalog.map((tool) => tool.name)).not.toContain('web_search');
    expect(catalog.map((tool) => tool.name)).toEqual([
      'web_fetch',
      'list_files',
      'read_file',
      'list_workspace_paths',
      'read_workspace_path_slice',
      'write_artifact_file',
    ]);
  });

  it('keeps skill script execution available even when generic assistant tools are disabled', () => {
    const catalog = buildAssistantToolCatalog({
      assistantToolsEnabled: false,
      webSearchMode: 'live',
      enabledSkillNames: ['xlsx'],
    });

    expect(catalog.map((tool) => tool.name)).toEqual(['run_workspace_script']);
  });

  it('converts catalog entries to Responses function tools', () => {
    const catalog = buildAssistantToolCatalog({
      assistantToolsEnabled: true,
      webSearchMode: 'live',
      enabledSkillNames: [],
    });

    const webFetch = findAssistantToolDefinition(catalog, 'web_fetch');
    expect(webFetch).toBeDefined();

    expect(toResponsesFunctionTool(webFetch!)).toEqual(expect.objectContaining({
      type: 'function',
      name: 'web_fetch',
      strict: false,
    }));
  });
});
