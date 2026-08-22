import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findChecksum,
  parseManifestVersion,
  parseRequestedVersion,
  updateManifestJson,
  type ResolvedReleaseAsset,
} from './update-scoop-manifest.js';

describe('parseManifestVersion', () => {
  it('normalizes whitespace and a leading v', () => {
    assert.equal(parseManifestVersion(' v1.2.3-beta.1 ', 'tool', '1.2.3'), '1.2.3-beta.1');
  });

  it('rejects missing and malformed versions', () => {
    assert.throws(() => parseManifestVersion(undefined, 'tool', '1.2.3'), /Version is required/);
    assert.throws(() => parseManifestVersion('latest', 'tool', '1.2.3'), /tool release version/);
  });
});

describe('parseRequestedVersion', () => {
  it('uses the environment version when the CLI option is absent', () => {
    assert.equal(parseRequestedVersion([], 'v1.0.0', 'tool', '1.0.0'), '1.0.0');
  });

  it('uses the CLI version in preference to the environment', () => {
    assert.equal(parseRequestedVersion(['--version', '2.0.0'], '1.0.0', 'tool', '1.0.0'), '2.0.0');
  });

  it('rejects unsupported arguments and a missing option value', () => {
    assert.throws(
      () => parseRequestedVersion(['--latest'], '1.0.0', 'tool', '1.0.0'),
      /Unknown argument/,
    );
    assert.throws(
      () => parseRequestedVersion(['--version'], '1.0.0', 'tool', '1.0.0'),
      /requires a value/,
    );
  });
});

describe('findChecksum', () => {
  it('supports uppercase hashes, binary markers, and regex characters in asset names', () => {
    const uppercaseHash = 'A'.repeat(64);
    assert.equal(
      findChecksum(`${uppercaseHash} *tool.v1.0.0[x64].zip\n`, 'tool.v1.0.0[x64].zip'),
      'a'.repeat(64),
    );
  });

  it('rejects a checksum file without the requested asset', () => {
    assert.throws(
      () => findChecksum(`${'a'.repeat(64)}  other.zip\n`, 'tool.zip'),
      /was not found/,
    );
  });
});

describe('updateManifestJson', () => {
  const version = parseManifestVersion('2.0.0', 'tool', '2.0.0');
  const assets: readonly ResolvedReleaseAsset[] = [
    {
      architecture: '64bit',
      url: 'https://example.test/tool-2.0.0.zip',
      hash: findChecksum(`${'b'.repeat(64)}  tool.zip\n`, 'tool.zip'),
    },
  ];

  it('updates only the selected architecture and preserves other manifest fields', () => {
    const updated = JSON.parse(
      updateManifestJson(
        JSON.stringify({
          version: '1.0.0',
          architecture: {
            '64bit': { url: 'old-x64', hash: 'old-x64-hash' },
            arm64: { url: 'old-arm64', hash: 'old-arm64-hash' },
          },
          bin: 'tool.exe',
        }),
        version,
        assets,
      ),
    ) as Record<string, unknown>;

    assert.deepEqual(updated, {
      version: '2.0.0',
      architecture: {
        '64bit': {
          url: 'https://example.test/tool-2.0.0.zip',
          hash: 'b'.repeat(64),
        },
        arm64: { url: 'old-arm64', hash: 'old-arm64-hash' },
      },
      bin: 'tool.exe',
    });
  });

  it('rejects a manifest without a required architecture section', () => {
    assert.throws(
      () =>
        updateManifestJson(JSON.stringify({ version: '1.0.0', architecture: {} }), version, assets),
      /architecture\.64bit must be an object/,
    );
  });
});
