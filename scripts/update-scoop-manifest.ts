import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

declare const manifestVersionBrand: unique symbol;
declare const sha256Brand: unique symbol;

export type ManifestVersion = string & { readonly [manifestVersionBrand]: true };
export type Sha256 = string & { readonly [sha256Brand]: true };

export type ReleaseContext = {
  version: ManifestVersion;
  releaseTag: string;
};

export type ReleaseAssetDefinition = {
  architecture: string;
  fileName: (context: ReleaseContext) => string;
};

export type ManifestUpdateConfig = {
  applicationName: string;
  manifestPath: string;
  repository: string;
  versionEnvironmentVariable: string;
  versionExample: string;
  releaseTag: (version: ManifestVersion) => string;
  assets: readonly ReleaseAssetDefinition[];
};

export type ResolvedReleaseAsset = {
  architecture: string;
  url: string;
  hash: Sha256;
};

type ArchitectureManifest = Record<string, unknown> & {
  url?: unknown;
  hash?: unknown;
};

type ParsedManifest = {
  document: Record<string, unknown>;
  architectures: ReadonlyMap<string, ArchitectureManifest>;
};

/**
 * Parses a release version into the normalized version used by Scoop manifests.
 * @param rawVersion Version from a CLI argument or environment variable; a leading `v` is allowed.
 * @param applicationName Application name used in parse errors.
 * @param versionExample Accepted-version example used in parse errors.
 * @returns A normalized semantic release version without a leading `v`.
 * @throws {Error} When the value is absent or is not a supported semantic release version.
 */
export function parseManifestVersion(
  rawVersion: string | null | undefined,
  applicationName: string,
  versionExample: string,
): ManifestVersion {
  if (rawVersion === null || rawVersion === undefined) {
    throw new Error(
      `Version is required. Pass --version or set the ${applicationName} version environment variable.`,
    );
  }

  const normalized = rawVersion.trim().replace(/^v/, '');

  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(
      `Version must look like a ${applicationName} release version, for example ${versionExample}. Actual: '${rawVersion}'`,
    );
  }

  return normalized as ManifestVersion;
}

/**
 * Parses the requested version from CLI arguments, falling back to an environment value.
 * @param argv CLI arguments excluding the runtime and script path.
 * @param environmentVersion Fallback version supplied through the application-specific environment variable.
 * @param applicationName Application name used in parse errors.
 * @param versionExample Accepted-version example used in parse errors.
 * @returns The normalized manifest version selected by the caller.
 * @throws {Error} When arguments are unknown, `--version` has no value, or the selected version is invalid.
 */
export function parseRequestedVersion(
  argv: readonly string[],
  environmentVersion: string | undefined,
  applicationName: string,
  versionExample: string,
): ManifestVersion {
  let rawVersion: string | null | undefined = environmentVersion;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument !== '--version') {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error('--version requires a value.');
    }

    rawVersion = value;
    index += 1;
  }

  return parseManifestVersion(rawVersion, applicationName, versionExample);
}

/**
 * Finds and parses an asset SHA-256 checksum from a standard checksum file.
 * @param checksums Full text of the checksum file.
 * @param fileName Exact release asset name whose checksum is required.
 * @returns The normalized lowercase SHA-256 checksum.
 * @throws {Error} When the asset has no valid SHA-256 entry.
 */
export function findChecksum(checksums: string, fileName: string): Sha256 {
  const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = checksums.match(new RegExp(`^([a-fA-F0-9]{64})\\s+\\*?${escapedFileName}$`, 'm'));

  if (match === null) {
    throw new Error(`Checksum for '${fileName}' was not found in checksums.txt.`);
  }

  return parseSha256(match[1], `${fileName} hash`);
}

/**
 * Updates a Scoop manifest JSON document with a version and resolved architecture assets.
 * @param rawManifest Existing Scoop manifest JSON text.
 * @param version Parsed version to write to the manifest.
 * @param assets Release assets resolved to URLs and checksums by architecture.
 * @returns Pretty-printed manifest JSON ending with a newline.
 * @throws {Error} When the JSON or any required architecture section has an incompatible shape.
 */
export function updateManifestJson(
  rawManifest: string,
  version: ManifestVersion,
  assets: readonly ResolvedReleaseAsset[],
): string {
  const manifest = parseManifest(
    rawManifest,
    assets.map(({ architecture }) => architecture),
  );
  manifest.document.version = version;

  for (const asset of assets) {
    const architecture = manifest.architectures.get(asset.architecture);
    if (architecture === undefined) {
      throw new Error(`Manifest architecture.${asset.architecture} was not parsed.`);
    }

    architecture.url = asset.url;
    architecture.hash = asset.hash;
  }

  return `${JSON.stringify(manifest.document, null, 2)}\n`;
}

/**
 * Runs the shared Scoop manifest updater and reports failures as a CLI exit status.
 * @param config Product-specific release and manifest configuration.
 * @returns A promise that settles after the update or error reporting completes.
 * @remarks Failures are printed to stderr and represented by `process.exitCode = 1`.
 */
export async function runScoopManifestUpdateCli(config: ManifestUpdateConfig): Promise<void> {
  try {
    await updateScoopManifest(config);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  }
}

async function updateScoopManifest(config: ManifestUpdateConfig): Promise<void> {
  const version = parseRequestedVersion(
    process.argv.slice(2),
    process.env[config.versionEnvironmentVariable],
    config.applicationName,
    config.versionExample,
  );
  const releaseTag = config.releaseTag(version);
  const releaseBaseUrl = `https://github.com/${config.repository}/releases/download/${releaseTag}`;
  const checksumsUrl = `${releaseBaseUrl}/checksums.txt`;
  const context: ReleaseContext = { version, releaseTag };

  console.log(`Fetching checksums from ${checksumsUrl}`);
  const checksums = await fetchText(checksumsUrl);
  const assets = config.assets.map((definition): ResolvedReleaseAsset => {
    const fileName = definition.fileName(context);
    return {
      architecture: definition.architecture,
      url: `${releaseBaseUrl}/${fileName}`,
      hash: findChecksum(checksums, fileName),
    };
  });

  const rawManifest = readFileSync(config.manifestPath, 'utf8');
  const updatedManifest = updateManifestJson(rawManifest, version, assets);
  writeFileSync(config.manifestPath, updatedManifest, 'utf8');

  const verifiedManifest = updateManifestJson(
    readFileSync(config.manifestPath, 'utf8'),
    version,
    assets,
  );
  if (verifiedManifest !== updatedManifest) {
    throw new Error('Updated manifest does not match the expected content.');
  }

  writeGitHubOutput({
    manifest_version: version,
    release_tag: releaseTag,
  });

  console.log(`Updated ${config.manifestPath} to ${config.applicationName} ${version}`);
  for (const asset of assets) {
    console.log(`${asset.architecture}: ${asset.hash}`);
  }
}

function parseSha256(value: string, label: string): Sha256 {
  const normalized = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a SHA-256 hex string. Actual: '${value}'`);
  }

  return normalized as Sha256;
}

function parseManifest(
  rawManifest: string,
  requiredArchitectures: readonly string[],
): ParsedManifest {
  let value: unknown;
  try {
    value = JSON.parse(rawManifest) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Manifest must be valid JSON: ${detail}`);
  }

  const document = parseRecord(value, 'Manifest root');
  const architectureValue = parseRecord(document.architecture, 'Manifest architecture');
  const architectures = new Map<string, ArchitectureManifest>();

  for (const architecture of new Set(requiredArchitectures)) {
    architectures.set(
      architecture,
      parseRecord(architectureValue[architecture], `Manifest architecture.${architecture}`),
    );
  }

  return { document, architectures };
}

function parseRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}. HTTP status: ${response.status}`);
  }

  return response.text();
}

function writeGitHubOutput(values: Readonly<Record<string, string>>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath === undefined || outputPath.length === 0) {
    return;
  }

  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}
