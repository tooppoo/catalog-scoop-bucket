import { runScoopManifestUpdateCli } from './update-scoop-manifest.js';

void runScoopManifestUpdateCli({
  applicationName: 'git-kura',
  manifestPath: 'bucket/git-kura.json',
  repository: 'tooppoo/git-kura',
  versionEnvironmentVariable: 'GIT_KURA_VERSION',
  versionExample: '0.1.3 or v0.1.3',
  releaseTag: (version) => `v${version}`,
  assets: [
    {
      architecture: '64bit',
      fileName: ({ releaseTag }) => `git-kura_${releaseTag}_Windows_x86_64.zip`,
    },
    {
      architecture: 'arm64',
      fileName: ({ releaseTag }) => `git-kura_${releaseTag}_Windows_arm64.zip`,
    },
  ],
});
