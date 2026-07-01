import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const MANIFEST_PATH = 'bucket/git-kura.json';
const REPOSITORY = 'tooppoo/git-kura';

type Args = {
  version: string | null;
};

type ArchitectureManifest = {
  url?: unknown;
  hash?: unknown;
};

type ScoopManifest = {
  version?: unknown;
  architecture?: {
    '64bit'?: ArchitectureManifest;
    arm64?: ArchitectureManifest;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

await main();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifestVersion = normalizeVersion(args.version);
  const releaseTag = `v${manifestVersion}`;
  const releaseBaseUrl = `https://github.com/${REPOSITORY}/releases/download/${releaseTag}`;
  const checksumsUrl = `${releaseBaseUrl}/checksums.txt`;

  const x64AssetName = `git-kura_${releaseTag}_Windows_x86_64.zip`;
  const arm64AssetName = `git-kura_${releaseTag}_Windows_arm64.zip`;
  const x64Url = `${releaseBaseUrl}/${x64AssetName}`;
  const arm64Url = `${releaseBaseUrl}/${arm64AssetName}`;

  console.log(`Fetching checksums from ${checksumsUrl}`);
  const checksums = await fetchText(checksumsUrl);
  const x64Hash = getChecksum(checksums, x64AssetName);
  const arm64Hash = getChecksum(checksums, arm64AssetName);

  assertSha256('x86_64 hash', x64Hash);
  assertSha256('arm64 hash', arm64Hash);

  const rawManifest = readFileSync(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(rawManifest) as ScoopManifest;
  assertManifestShape(manifest);

  manifest.version = manifestVersion;
  manifest.architecture['64bit'].url = x64Url;
  manifest.architecture['64bit'].hash = x64Hash;
  manifest.architecture.arm64.url = arm64Url;
  manifest.architecture.arm64.hash = arm64Hash;

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const updatedManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ScoopManifest;
  assertManifestShape(updatedManifest);

  if (updatedManifest.version !== manifestVersion) {
    fail('Updated manifest version does not match expected version.');
  }
  if (updatedManifest.architecture['64bit'].url !== x64Url) {
    fail('Updated x86_64 URL does not match expected URL.');
  }
  if (updatedManifest.architecture.arm64.url !== arm64Url) {
    fail('Updated arm64 URL does not match expected URL.');
  }

  assertSha256('updated x86_64 hash', updatedManifest.architecture['64bit'].hash);
  assertSha256('updated arm64 hash', updatedManifest.architecture.arm64.hash);

  writeGitHubOutput({
    manifest_version: manifestVersion,
    release_tag: releaseTag,
  });

  console.log(`Updated ${MANIFEST_PATH} to git-kura ${manifestVersion}`);
  console.log(`x86_64: ${x64Hash}`);
  console.log(`arm64 : ${arm64Hash}`);
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const result: Args = {
    version: process.env.GIT_KURA_VERSION ?? null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--version') {
      if (!next) {
        fail('--version requires a value.');
      }
      result.version = next;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return result;
}

function normalizeVersion(rawVersion: string | null): string {
  if (rawVersion === null) {
    fail('Version is required. Pass --version or set GIT_KURA_VERSION.');
  }

  const trimmed = rawVersion.trim().replace(/^v/, '');

  if (trimmed.length === 0) {
    fail('Version must not be empty.');
  }

  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(trimmed)) {
    fail(`Version must look like a git-kura release version, for example 0.1.3 or v0.1.3. Actual: '${rawVersion}'`);
  }

  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getChecksum(checksums: string, fileName: string): string {
  const escapedFileName = escapeRegExp(fileName);
  const pattern = new RegExp(`^([a-fA-F0-9]{64})\\s+\\*?${escapedFileName}$`, 'm');
  const match = checksums.match(pattern);

  if (match === null) {
    fail(`Checksum for '${fileName}' was not found in checksums.txt.`);
  }

  return match[1].toLowerCase();
}

function assertSha256(name: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    fail(`${name} must be a lowercase SHA-256 hex string. Actual: '${String(value)}'`);
  }
}

function assertRecord(name: string, value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object.`);
  }
}

function assertManifestShape(manifest: ScoopManifest): asserts manifest is ScoopManifest & {
  architecture: {
    '64bit': ArchitectureManifest;
    arm64: ArchitectureManifest;
  };
} {
  assertRecord('Manifest root', manifest);
  assertRecord('Manifest architecture', manifest.architecture);
  assertRecord('Manifest architecture.64bit', manifest.architecture['64bit']);
  assertRecord('Manifest architecture.arm64', manifest.architecture.arm64);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    fail(`Failed to fetch ${url}. HTTP status: ${response.status}`);
  }

  return response.text();
}

function writeGitHubOutput(values: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    return;
  }

  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}
