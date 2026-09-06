import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('server installer handles piped installation, recovery, and failures without exposing secrets', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'kucedr-installer-'));
	const installer = readFileSync(new URL('../scripts/install.sh', import.meta.url), 'utf8');
	const revision = '4939625e4e7df4159ed6e9fd8f6fed3b20288790';
	const key = 'a'.repeat(64);
	const repo = fileURLToPath(new URL('..', import.meta.url));
	try {
		const bin = path.join(root, 'bin');
		const source = path.join(root, `kucedr-cloud-${revision}`);
		mkdirSync(bin);
		for (const file of [
			'Dockerfile',
			'compose.yaml',
			'package.json',
			'package-lock.json',
			'src/main/index.ts',
			'src/main/a2a/secure_config.ts',
		]) {
			mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
			writeFileSync(path.join(source, file), readFileSync(path.join(repo, file)));
		}
		const archive = path.join(root, 'source.tar.gz');
		assert.equal(spawnSync('tar', ['-czf', archive, '-C', root, path.basename(source)]).status, 0);
		const partial = path.join(root, 'partial.tar.gz');
		assert.equal(
			spawnSync('tar', ['-czf', partial, '-C', root, `${path.basename(source)}/Dockerfile`]).status,
			0
		);
		const mock = `#!/bin/sh
name=\${0##*/}
printf '%s\\n' "$name $*" >> "$FAKE_LOG"
case "$name" in
  uname)
    if [ "$FAKE_MODE" = unsupported-os ]; then printf 'Darwin\\n';
    elif [ "$1" = -m ]; then printf '%s\\n' "\${FAKE_ARCH:-x86_64}";
    else printf 'Linux\\n'; fi ;;
  id) printf '1000\\n' ;;
  openssl) printf '%s\\n' '${key}' ;;
  curl)
    [ "$FAKE_MODE" != download-failure ] || exit 22
    destination=
    while [ "$#" -gt 0 ]; do
      case "$1" in --output|-o) shift; destination=$1 ;; esac
      shift
    done
    [ -n "$destination" ] || exit 90
    cp "$FAKE_ARCHIVE" "$destination" ;;
  docker)
    case "$*" in
      *--help*|'context inspect'*|info*|'compose version'*) ;;
      *)
        [ -z "\${KUCEDR_CLOUD_ENCRYPTION_KEY:-}" ] || exit 91
        [ -z "\${KUCEDR_CLOUD_BIND_ADDRESS:-}" ] || exit 92
        [ -z "\${KUCEDR_CLOUD_PUBLIC_URL:-}" ] || exit 93 ;;
    esac
    case "$*" in
      info*) [ "$FAKE_MODE" != daemon-failure ] ;;
      'context inspect'*) printf '%s\\n' "\${FAKE_ENDPOINT:-unix:///var/run/docker.sock}" ;;
      'volume ls'*)
        if [ "$FAKE_MODE" = existing-volume ]; then printf 'kucedr-cloud-data\\n'; fi ;;
      'compose version'*) [ "$FAKE_MODE" != compose-missing ] ;;
      *--help*)
        [ "$FAKE_MODE" != compose-old ] || exit 0
        printf '%s\\n' '--wait --wait-timeout' ;;
      *' config '*) [ "$FAKE_MODE" != config-failure ] ;;
      *' build'|*' build '*) [ "$FAKE_MODE" != build-failure ] ;;
      *' run '*) [ "$FAKE_MODE" != invalid-config ] ;;
      *' up '*) [ "$FAKE_MODE" != health-failure ] ;;
      *) exit 94 ;;
    esac ;;
esac
`;
		for (const command of ['uname', 'id', 'openssl', 'curl', 'docker']) {
			writeFileSync(path.join(bin, command), mock, { mode: 0o755 });
		}
		for (const scenario of [
			'fresh',
			'arm64',
			'rerun',
			'restore-config',
			'existing-volume',
			'unrelated-directory',
			'partial-archive',
			'download-failure',
			'daemon-failure',
			'remote-daemon',
			'compose-missing',
			'compose-old',
			'config-failure',
			'build-failure',
			'invalid-config',
			'health-failure',
			'unsupported-os',
			'unsupported-arch',
			'missing-url',
			'http://example.com',
			'https://user:password@example.com',
			'https://example.com/path',
			'https://example.com?token=secret',
			'https://example.com/#fragment',
			'https://example.com\nINJECTED=value',
		]) {
			const directory = path.join(root, `case-${Math.random().toString(16).slice(2)}`);
			mkdirSync(directory);
			const install = path.join(directory, 'installation with spaces');
			const log = path.join(directory, 'commands.log');
			writeFileSync(log, '');
			const environment: NodeJS.ProcessEnv = {
				PATH: `${bin}:/usr/bin:/bin`,
				HOME: directory,
				TMPDIR: directory,
				KUCEDR_CLOUD_INSTALL_DIR: install,
				KUCEDR_CLOUD_PUBLIC_URL: scenario.includes('://') ? scenario : 'https://agent.example.com',
				KUCEDR_CLOUD_ENCRYPTION_KEY: 'must-not-override-generated-key',
				KUCEDR_CLOUD_BIND_ADDRESS: '0.0.0.0',
				FAKE_LOG: log,
				FAKE_ARCHIVE: scenario === 'partial-archive' ? partial : archive,
				FAKE_MODE: scenario,
				FAKE_ARCH:
					scenario === 'arm64' ? 'aarch64' : scenario === 'unsupported-arch' ? 'i686' : 'x86_64',
				FAKE_ENDPOINT: scenario === 'remote-daemon' ? 'ssh://remote.example.com' : undefined,
			};
			if (scenario === 'missing-url') delete environment.KUCEDR_CLOUD_PUBLIC_URL;
			if (scenario === 'unrelated-directory') {
				mkdirSync(install);
				writeFileSync(path.join(install, 'unrelated.txt'), 'preserve me');
			}
			let previousConfig = '';
			const attempts = scenario === 'rerun' || scenario === 'restore-config' ? 2 : 1;
			for (let attempt = 0; attempt < attempts; attempt++) {
				if (attempt === 1) {
					writeFileSync(log, '');
					environment.FAKE_MODE = scenario === 'rerun' ? 'download-failure' : 'existing-volume';
					environment.KUCEDR_CLOUD_PUBLIC_URL = 'https://changed.example.com';
					if (scenario === 'restore-config') rmSync(path.join(install, '.env'));
				}
				const result = spawnSync('/bin/sh', [], {
					input: installer,
					env: environment,
					encoding: 'utf8',
					detached: true,
					timeout: 10000,
				});
				const output = result.stdout + result.stderr;
				const commands = readFileSync(log, 'utf8');
				const success =
					['fresh', 'arm64', 'rerun'].includes(scenario) ||
					(scenario === 'restore-config' && attempt === 0);
				assert.ifError(result.error);
				assert.doesNotMatch(output, new RegExp(`${key}|must-not-override-generated-key`), scenario);
				if (success) {
					assert.equal(result.status, 0, `${scenario}: ${output}\n${commands}`);
					const config = readFileSync(path.join(install, '.env'), 'utf8');
					assert.match(config, /KUCEDR_CLOUD_PUBLIC_URL=['"]?https:\/\/agent\.example\.com/);
					assert.match(config, new RegExp(`KUCEDR_CLOUD_ENCRYPTION_KEY=['"]?${key}`));
					assert.match(config, /KUCEDR_CLOUD_BIND_ADDRESS=['"]?127\.0\.0\.1/);
					assert.equal(statSync(path.join(install, '.env')).mode & 0o777, 0o600);
					assert.equal(
						readFileSync(path.join(install, '.kucedr-revision'), 'utf8').trim(),
						revision
					);
					assert.match(commands, /config --quiet/);
					assert.match(commands, /run --rm --no-deps -T app node/);
					assert.match(commands, /up --build --wait --wait-timeout 180 -d/);
					assert.match(output, /http:\/\/127\.0\.0\.1:3001\/config/);
					if (attempt === 1) {
						assert.equal(config, previousConfig);
						assert.doesNotMatch(commands, /curl |openssl /);
					} else {
						assert.match(
							commands,
							new RegExp(`codeload.github.com/HaraldBregu/kucedr-cloud/tar.gz/${revision}`)
						);
						previousConfig = config;
					}
				} else {
					assert.notEqual(result.status, 0, `${scenario} unexpectedly succeeded: ${output}`);
					if (scenario !== 'health-failure') assert.doesNotMatch(commands, / up /, scenario);
					if (scenario === 'existing-volume' || scenario === 'restore-config') {
						assert.doesNotMatch(commands, /openssl /, scenario);
						assert.match(output, /restor|backup/i, scenario);
					}
				}
			}
			if (scenario === 'unrelated-directory') {
				assert.equal(readFileSync(path.join(install, 'unrelated.txt'), 'utf8'), 'preserve me');
			}
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
