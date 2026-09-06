#!/bin/sh

main() {
	set -eu
	umask 077
	export LC_ALL=C

	if [ "$#" -ne 0 ]; then
		printf '%s\n' 'Configure installation with KUCEDR_CLOUD_INSTALL_DIR and KUCEDR_CLOUD_PUBLIC_URL.' >&2
		exit 1
	fi
	if [ "$(uname -s)" != Linux ]; then
		printf '%s\n' 'Kucedr Cloud requires a Linux server.' >&2
		exit 1
	fi
	case "$(uname -m)" in
		x86_64|aarch64|arm64) ;;
		*) printf '%s\n' 'Supported server architectures: amd64 and arm64.' >&2; exit 1 ;;
	esac
	for dependency in curl tar openssl docker awk mktemp; do
		if ! command -v "$dependency" >/dev/null 2>&1; then
			printf 'Required command is missing: %s\n' "$dependency" >&2
			exit 1
		fi
	done
	if [ -n "${DOCKER_CONTEXT:-}" ]; then
		docker_endpoint=$(docker context inspect "$DOCKER_CONTEXT" --format '{{.Endpoints.docker.Host}}')
	else
		docker_endpoint=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}
	fi
	case "$docker_endpoint" in
		unix://*) ;;
		*) printf '%s\n' 'Select a local Docker daemon before installing on this server.' >&2; exit 1 ;;
	esac
	if ! docker info >/dev/null 2>&1; then
		printf '%s\n' 'Docker is unavailable. Start the local daemon and grant this user access.' >&2
		exit 1
	fi
	if ! compose_help=$(docker compose up --help 2>/dev/null); then
		printf '%s\n' 'Install the Docker Compose plugin before running this installer.' >&2
		exit 1
	fi
	case "$compose_help" in
		*--wait-timeout*) ;;
		*) printf '%s\n' 'Update Docker Compose to a version supporting --wait and --wait-timeout.' >&2; exit 1 ;;
	esac

	revision=4939625e4e7df4159ed6e9fd8f6fed3b20288790
	if [ "$(id -u)" = 0 ]; then
		install_dir=${KUCEDR_CLOUD_INSTALL_DIR:-/opt/kucedr-cloud}
	else
		install_dir=${KUCEDR_CLOUD_INSTALL_DIR:-${HOME:?HOME is required}/.local/share/kucedr-cloud}
	fi
	case "$install_dir" in
		/*) ;;
		*) printf '%s\n' 'KUCEDR_CLOUD_INSTALL_DIR must be an absolute path.' >&2; exit 1 ;;
	esac
	install_dir=${install_dir%/}
	if [ -z "$install_dir" ] || [ -L "$install_dir" ]; then
		printf '%s\n' 'Choose an installation directory other than / or a symbolic link.' >&2
		exit 1
	fi
	public_url=${KUCEDR_CLOUD_PUBLIC_URL:-}
	unset KUCEDR_CLOUD_PUBLIC_URL KUCEDR_CLOUD_ENCRYPTION_KEY KUCEDR_CLOUD_BIND_ADDRESS
	unset KUCEDR_CLOUD_PORT KUCEDR_CLOUD_APP_URL KUCEDR_CLOUD_APP_PORT
	unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_ENV_FILES COMPOSE_PROFILES

	parent=$(dirname "$install_dir")
	mkdir -p "$parent"
	if ! mkdir "$install_dir.lock" 2>/dev/null; then
		printf 'Installation is locked: %s.lock. Another installer may be running.\n' "$install_dir" >&2
		exit 1
	fi
	stage=''
	trap 'result=$?; if [ -n "$stage" ]; then rm -rf -- "$stage"; fi; rmdir "$install_dir.lock" 2>/dev/null || :; exit "$result"' 0
	trap 'exit 130' INT
	trap 'exit 143' TERM

	if [ -e "$install_dir" ]; then
		if [ ! -f "$install_dir/.kucedr-revision" ] || [ ! -f "$install_dir/compose.yaml" ] || [ ! -f "$install_dir/src/main/index.ts" ]; then
			printf 'Refusing to overwrite an unmanaged directory: %s\n' "$install_dir" >&2
			exit 1
		fi
		printf 'Resuming the existing installation in %s.\n' "$install_dir"
	fi
	if [ -L "$install_dir/.env" ]; then
		printf '%s\n' 'The installation .env must be a regular file, not a symbolic link.' >&2
		exit 1
	fi
	if [ ! -f "$install_dir/.env" ]; then
		volumes=$(docker volume ls --format '{{.Name}}')
		if printf '%s\n' "$volumes" | awk '$0 == "kucedr-cloud-data" { found = 1 } END { exit !found }'; then
			printf '%s\n' 'Existing kucedr-cloud-data volume found without its configuration. Restore the original .env and encryption key before proceeding.' >&2
			exit 1
		fi
		if [ -z "$public_url" ]; then
			if ! { printf 'Public A2A origin (for example https://agent.example.com): ' >/dev/tty; IFS= read -r public_url </dev/tty; } 2>/dev/null; then
				printf '%s\n' 'Set KUCEDR_CLOUD_PUBLIC_URL on the sh command when no terminal is available.' >&2
				exit 1
			fi
		fi
		if ! printf '%s\n' "$public_url" | awk '
			NR > 1 { invalid = 1 }
			/^https:\/\/([A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\])(:[0-9]+)?\/?$/ { valid = 1 }
			/^http:\/\/(localhost|127\.[0-9]+\.[0-9]+\.[0-9]+|\[::1\])(:[0-9]+)?\/?$/ { valid = 1 }
			END { exit !(valid && !invalid) }
		'; then
			printf '%s\n' 'KUCEDR_CLOUD_PUBLIC_URL must be an HTTPS origin without credentials, path, query, or fragment. HTTP is allowed only for loopback access.' >&2
			exit 1
		fi
	fi

	stage=$(mktemp -d "$parent/.kucedr-install.XXXXXX")
	if [ ! -d "$install_dir" ]; then
		printf 'Downloading Kucedr Cloud snapshot %s...\n' "$revision"
		curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 300 --retry 3 \
			"https://codeload.github.com/HaraldBregu/kucedr-cloud/tar.gz/$revision" --output "$stage/source.tar.gz"
		mkdir "$stage/source"
		tar -xzf "$stage/source.tar.gz" -C "$stage/source" --strip-components=1
		for required_file in Dockerfile compose.yaml package.json package-lock.json src/main/index.ts src/main/a2a/secure_config.ts; do
			if [ ! -f "$stage/source/$required_file" ]; then
				printf 'Downloaded snapshot is incomplete: %s\n' "$required_file" >&2
				exit 1
			fi
		done
		printf '%s\n' "$revision" >"$stage/source/.kucedr-revision"
		mv "$stage/source" "$install_dir"
	fi
	cd "$install_dir"
	if [ ! -f .env ]; then
		encryption_key=$(openssl rand -hex 32)
		if [ "${#encryption_key}" -ne 64 ]; then
			printf '%s\n' 'Failed to generate the configuration encryption key.' >&2
			exit 1
		fi
		case "$encryption_key" in
			*[!0-9a-fA-F]*) printf '%s\n' 'Failed to generate the configuration encryption key.' >&2; exit 1 ;;
		esac
		{
			printf 'KUCEDR_CLOUD_PUBLIC_URL=%s\n' "$public_url"
			printf 'KUCEDR_CLOUD_ENCRYPTION_KEY=%s\n' "$encryption_key"
			printf '%s\n' 'KUCEDR_CLOUD_BIND_ADDRESS=127.0.0.1' 'KUCEDR_CLOUD_PORT=3000' 'KUCEDR_CLOUD_APP_URL=http://127.0.0.1:3001' 'KUCEDR_CLOUD_APP_PORT=3001'
		} >"$stage/environment"
		chmod 600 "$stage/environment"
		mv "$stage/environment" .env
		unset encryption_key
	fi
	chmod 600 .env
	docker compose --env-file .env -f compose.yaml config --quiet
	printf '%s\n' 'Building Kucedr Cloud...'
	docker compose --env-file .env -f compose.yaml build
	docker compose --env-file .env -f compose.yaml run --rm --no-deps -T app node --import tsx --input-type=module -e \
		'import { resolveSecureA2aConfig } from "./src/main/a2a/secure_config.ts"; resolveSecureA2aConfig({ dataDirectory: "/data" });'
	if ! docker compose --env-file .env -f compose.yaml up --build --wait --wait-timeout 180 -d; then
		printf 'Startup failed. Configuration and data were retained. Inspect logs in %s with: docker compose logs app\n' "$install_dir" >&2
		exit 1
	fi
	printf '\nKucedr Cloud is healthy. Installation directory: %s\n' "$install_dir"
	printf '%s\n' 'Back up .env securely: the original encryption key is required to recover your data.'
	printf '%s\n' 'Run docker compose logs app, docker compose restart app, or docker compose ps from that directory.'
	printf '%s\n' 'Default proxy target: 127.0.0.1:3000. Configure your HTTPS proxy before using the public URL.'
	printf '%s\n' 'Default administration access, from your computer:' '  ssh -N -L 3001:127.0.0.1:3001 user@server' '  Open http://127.0.0.1:3001/config, create the administrator, and configure a provider.'
	printf '%s\n' 'If you customized .env, use its ports and application origin instead. Keep administration private.'
}

main "$@" </dev/null
