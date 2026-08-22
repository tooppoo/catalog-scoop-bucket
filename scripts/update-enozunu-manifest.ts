import { runScoopManifestUpdateCli } from './update-scoop-manifest.js';

void runScoopManifestUpdateCli({
  applicationName: 'enozunu',
  manifestPath: 'bucket/enozunu.json',
  repository: 'tooppoo/enozunu',
  versionEnvironmentVariable: 'ENOZUNU_VERSION',
  versionExample: '0.4.0 or v0.4.0',
  releaseTag: (version) => version,
  assets: [
    {
      architecture: '64bit',
      fileName: ({ version }) => `enozunu_${version}_Windows_x86_64.tar.gz`,
    },
  ],
});
