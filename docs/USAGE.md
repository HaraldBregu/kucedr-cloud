# Using kucedr-cloud over A2A

This guide shows how to configure kucedr-cloud, register a calling agent, obtain a short-lived OAuth token, send prompts through A2A, continue a conversation, and manage tasks. kucedr-cloud provides a private browser interface at `/config` for administration; external applications use the separate public A2A 1.0 HTTP+JSON service for every agent operation.

## Prerequisites

You need:

- Docker with Docker Compose;
- an Anthropic, OpenAI, or DeepSeek API key and current model ID;
- Node.js to generate and sign the calling agent's Ed25519 key; and
- an HTTPS hostname and reverse proxy for a production server.

Forward the public HTTPS reverse proxy to the A2A listener only. Keep the application listener private as described under [API boundaries](#understand-the-api-boundaries).

## Configure and start kucedr-cloud

Clone the repository and create the local environment file:

```bash
git clone https://github.com/HaraldBregu/kucedr-cloud.git
cd kucedr-cloud
cp .env.example .env
chmod 600 .env
```

Generate two independent 32-byte values:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Copy them into `.env`:

```dotenv
KUCEDR_CLOUD_PUBLIC_URL=https://agent.example.com
KUCEDR_CLOUD_APP_URL=http://127.0.0.1:3001
KUCEDR_CLOUD_ADMIN_TOKEN=<first-generated-value>
KUCEDR_CLOUD_CONFIG_KEY=<second-generated-value>
```

`KUCEDR_CLOUD_PUBLIC_URL` is the public A2A origin only. Do not add `/a2a` to it. Production public URLs must use HTTPS; client assertions and A2A access tokens must not cross an unencrypted network. `KUCEDR_CLOUD_APP_URL` is the separate browser application origin, defaulting to `http://127.0.0.1:3001`; it must differ from `KUCEDR_CLOUD_PUBLIC_URL`. Loopback HTTP is suitable for local administration or access through an encrypted SSH tunnel. Keep both generated secrets out of calling-agent environments.

Back up the exact `KUCEDR_CLOUD_CONFIG_KEY` in a protected secret manager before starting kucedr-cloud. It encrypts the persisted provider and token-signing secrets. Losing or replacing it makes the existing secure configuration unreadable and prevents startup. Online rotation of this key is not currently supported.

Validate and start the container:

```bash
docker compose config --quiet
docker compose up --build --wait -d
docker compose ps
```

The HTTP endpoint is ready when Compose reports it as healthy. The health check reads the standard Agent Card rather than a separate health API. Agent runs are ready only after a model provider is configured.

## Understand the API boundaries

kucedr-cloud uses separate listeners for browser administration and machine access:

| Listener            | Surface                   | Authentication                       | Purpose                                            |
| ------------------- | ------------------------- | ------------------------------------ | -------------------------------------------------- |
| Public A2A          | `/.well-known/*`          | Public                               | Agent Card and OAuth discovery                     |
| Public A2A          | `/a2a/oauth/token`        | Registered Ed25519 `private_key_jwt` | Issue a short-lived A2A access token               |
| Public A2A          | `/a2a` and `/a2a/*`       | A2A bearer token with `a2a.invoke`   | Send messages and manage caller-owned tasks        |
| Private application | `/config` and `/config/*` | Administrator browser session        | Sign in and manage the provider and calling agents |

The public listener uses port 3000 by default and does not register browser pages, authentication, or configuration routes. `/`, `/config`, and `/config/auth/*` return `404` there, regardless of submitted headers or credentials. Public reverse proxies must forward only to this listener.

The private application listener uses port 3001 by default. Native startup binds it to `127.0.0.1`; Docker Compose publishes it only on the host's `127.0.0.1`. Keep that port off public proxies and public interfaces. `KUCEDR_CLOUD_APP_PORT` selects its port, `KUCEDR_CLOUD_APP_URL` selects its browser origin, and `KUCEDR_CLOUD_APP_LISTEN_ADDRESS` selects the native listener address. The container binds internally to `0.0.0.0` so the loopback-only host publication can reach it. If you change the application port, update `KUCEDR_CLOUD_APP_URL` and any SSH forwarding to match. A private HTTPS reverse proxy or VPN may use its own explicitly configured application URL.

The configuration and authentication APIs support the built-in browser application. They reject every `Authorization` header, including administrator and A2A bearer tokens. Configuration data requires a valid session cookie. API reads require same-origin request metadata; registration, login, logout, and configuration changes require an `Origin` matching `KUCEDR_CLOUD_APP_URL`. Authenticated changes also require the session's CSRF token. The browser supplies these automatically.

`KUCEDR_CLOUD_ADMIN_TOKEN` is the one-time setup credential for creating the administrator. It cannot authorize configuration changes or invoke A2A. `KUCEDR_CLOUD_CONFIG_KEY` continues to encrypt administrator credentials and provider secrets at rest. Both remain deployment secrets.

The listener split prevents public A2A callers from reaching administration routes. Origin, Fetch Metadata, and CSRF checks additionally protect the private browser flow against cross-site use. These headers do not establish cryptographic application identity: a non-browser client with access to the private listener can spoof them. Administrator credentials and session cookies remain secrets, and exposing the private listener publicly would remove the network boundary.

## Create the administrator

For a local deployment, open `http://127.0.0.1:3001/config` in a browser. For a remote deployment, open a tunnel from your own computer and leave it running:

```bash
ssh -N -L 3001:127.0.0.1:3001 user@server
```

Then open the same local browser URL. The SSH connection encrypts traffic between your computer and the remote server. A private HTTPS proxy may instead use the origin configured in `KUCEDR_CLOUD_APP_URL`.

On the first visit, enter the value of `KUCEDR_CLOUD_ADMIN_TOKEN` in **Setup token**, choose a username, and create a password of at least 12 characters. The form submits the setup credential as `setupToken`; it is never embedded in the page. Registration requires this secret and is available only once. The setup token cannot create another administrator or replace an existing account after registration.

The next setup page requires the model provider, model ID, and API key before the configuration dashboard opens. Later visits use the administrator username and password, without the setup token. Existing administrator accounts and saved configuration are retained; sign in on the private application origin after switching from the previous shared listener.

Browser sessions last 12 hours, use an HTTP-only same-site cookie, and are revoked when you log out. Passwords, setup tokens, and provider API keys are never stored in browser storage. Keep the deployment setup token out of calling-agent environments.

## Configure the model provider

Configure the provider in the browser after signing in at `/config` on the private application origin. Provider, model, API key, base URL, and model-option environment fallbacks are not supported.

1. On the initial setup page, select **Provider**, enter the model ID and API key, then choose **Finish setup**.
2. Confirm that the dashboard's **Provider** summary shows the selected provider and model.
3. To update the model later, edit the **Provider** form and choose **Save provider**. Leave the API key blank to retain the saved key for the same provider. Changing providers requires a new API key.
4. To remove the configuration, choose **Remove provider** and confirm. New agent runs remain unavailable until another provider is configured.

The dashboard also displays registered clients and OAuth connection details. The API key is never returned to the browser; kucedr-cloud encrypts it with `KUCEDR_CLOUD_CONFIG_KEY` before writing it to the data volume. Administrator bearer-token automation is no longer supported.

## Verify discovery

Set the public URL in the calling-agent shell, then fetch the Agent Card and OAuth documents before requesting a token:

```bash
export KUCEDR_CLOUD_URL='https://agent.example.com'

curl --fail-with-body "$KUCEDR_CLOUD_URL/.well-known/agent-card.json"
curl --fail-with-body "$KUCEDR_CLOUD_URL/.well-known/oauth-authorization-server"
curl --fail-with-body "$KUCEDR_CLOUD_URL/.well-known/oauth-protected-resource/a2a"
curl --fail-with-body "$KUCEDR_CLOUD_URL/.well-known/jwks.json"
```

Verify that the documents advertise:

- `HTTP+JSON` protocol binding and protocol version `1.0`;
- the exact interface URL `$KUCEDR_CLOUD_URL/a2a`;
- the exact OAuth issuer `$KUCEDR_CLOUD_URL` and the metadata-provided token endpoint;
- `private_key_jwt` client authentication with EdDSA;
- the exact protected resource `$KUCEDR_CLOUD_URL/a2a` and scope `a2a.invoke`; and
- streaming support.

An unauthenticated request to the exact A2A resource returns the protected-resource discovery challenge. The `401 Unauthorized` response is expected:

```bash
curl -i "$KUCEDR_CLOUD_URL/a2a"
```

Calling agents should follow the Agent Card's `oauth2MetadataUrl` and use the returned `token_endpoint` instead of assuming kucedr-cloud's endpoint path.

## Register a calling agent

Generate an Ed25519 key pair in a trusted client environment. The private JWK remains on that client; only the public JWK is registered with kucedr-cloud:

```js
// save as generate-key.mjs and run: node generate-key.mjs
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
writeFileSync('client-private.jwk', JSON.stringify(privateKey.export({ format: 'jwk' })), {
	flag: 'wx',
	mode: 0o600,
});
writeFileSync('client-public.jwk', JSON.stringify(publicKey.export({ format: 'jwk' })), {
	flag: 'wx',
});
```

Transfer only `client-public.jwk` to the trusted operator environment. `client-private.jwk` must remain on the calling-agent host and should be stored in a platform keystore or secret manager when available. The script refuses to overwrite an existing key file.

Sign in to `/config` on the private application origin and locate **Registered clients**. Enter a descriptive **Client name**, paste the contents of `client-public.jwk` into **Ed25519 public JWK**, and choose **Register client**. Confirm the new entry appears in the table, then copy its **Client ID**.

Return the client ID and public kucedr-cloud URL to the calling-agent environment through a trusted channel:

```bash
export KUCEDR_CLOUD_URL='https://agent.example.com'
export KUCEDR_CLOUD_CLIENT_ID='<registered-client-id>'
```

Registering the same public key again creates a new client identity; it does not restore access to tasks owned by a deleted identity. Calling agents do not receive the administrator password, setup token, or browser session.

## Obtain an A2A access token

Install JOSE in the calling-agent project and create `get-token.mjs`:

```bash
npm install jose
```

```js
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { importJWK, SignJWT } from 'jose';

const configuredUrl = process.env.KUCEDR_CLOUD_URL;
const clientId = process.env.KUCEDR_CLOUD_CLIENT_ID;
if (!configuredUrl || !clientId) throw new Error('KUCEDR_CLOUD_URL and KUCEDR_CLOUD_CLIENT_ID are required.');

const baseUrl = new URL(configuredUrl).origin;
const cardResponse = await fetch(`${baseUrl}/.well-known/agent-card.json`);
if (!cardResponse.ok) throw new Error(await cardResponse.text());
const card = await cardResponse.json();
const metadataUrl = card.securitySchemes?.oauth2?.oauth2SecurityScheme?.oauth2MetadataUrl;
if (typeof metadataUrl !== 'string') throw new Error('Agent Card has no OAuth metadata URL.');
if (new URL(metadataUrl).origin !== baseUrl) {
	throw new Error('OAuth metadata URL does not match KUCEDR_CLOUD_URL.');
}

const metadataResponse = await fetch(metadataUrl);
if (!metadataResponse.ok) throw new Error(await metadataResponse.text());
const metadata = await metadataResponse.json();
if (
	metadata.issuer !== baseUrl ||
	typeof metadata.token_endpoint !== 'string' ||
	new URL(metadata.token_endpoint).origin !== baseUrl
) {
	throw new Error('OAuth metadata does not match KUCEDR_CLOUD_URL.');
}
if (!metadata.token_endpoint_auth_methods_supported?.includes('private_key_jwt')) {
	throw new Error('kucedr-cloud does not advertise private_key_jwt.');
}

const resourceResponse = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/a2a`);
if (!resourceResponse.ok) throw new Error(await resourceResponse.text());
const resourceMetadata = await resourceResponse.json();
if (
	resourceMetadata.resource !== `${baseUrl}/a2a` ||
	!resourceMetadata.authorization_servers?.includes(baseUrl) ||
	!resourceMetadata.scopes_supported?.includes('a2a.invoke')
) {
	throw new Error('Protected-resource metadata does not match KUCEDR_CLOUD_URL.');
}

const tokenEndpoint = metadata.token_endpoint;
const now = Math.floor(Date.now() / 1000);
const privateJwk = JSON.parse(readFileSync('client-private.jwk', 'utf8'));
const assertion = await new SignJWT()
	.setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
	.setIssuer(clientId)
	.setSubject(clientId)
	.setAudience(tokenEndpoint)
	.setIssuedAt(now)
	.setExpirationTime(now + 120)
	.setJti(randomUUID())
	.sign(await importJWK(privateJwk, 'EdDSA'));

const response = await fetch(tokenEndpoint, {
	method: 'POST',
	headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
	body: new URLSearchParams({
		grant_type: 'client_credentials',
		client_id: clientId,
		client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
		client_assertion: assertion,
		scope: 'a2a.invoke',
		resource: `${baseUrl}/a2a`,
	}),
});
if (!response.ok) throw new Error(await response.text());
const token = await response.json();
if (
	typeof token.access_token !== 'string' ||
	token.access_token.length === 0 ||
	token.token_type?.toLowerCase() !== 'bearer' ||
	token.scope !== 'a2a.invoke' ||
	!Number.isInteger(token.expires_in) ||
	token.expires_in <= 0
) {
	throw new Error('Token response is invalid.');
}
process.stdout.write(token.access_token);
```

Acquire a token immediately before calling A2A:

```bash
export KUCEDR_CLOUD_TOKEN="$(node get-token.mjs)"
```

The token expires after five minutes and there is no refresh token. Generate a fresh assertion with a unique `jti` for every token request. kucedr-cloud persists a SHA-256 digest of the client ID and assertion `jti`, then rejects reuse across normal restarts.

`private_key_jwt` protects token acquisition, but the resulting access token is an ordinary bearer credential. Keep it in memory, never log or persist it, discard it at expiry, and send it only over HTTPS. Run a single kucedr-cloud replica. Multi-replica operation requires coordinated signing keys and shared transactional client, assertion-replay, task, and conversation state.

## Send your first prompt

Use `message:stream` to receive Server-Sent Events while kucedr-cloud works:

```bash
curl -N "$KUCEDR_CLOUD_URL/a2a/message:stream" \
  -H 'A2A-Version: 1.0' \
  -H "Authorization: Bearer $KUCEDR_CLOUD_TOKEN" \
  -H 'Content-Type: application/a2a+json' \
  -H 'Accept: text/event-stream' \
  --data '{
    "message": {
      "messageId": "request-1",
      "role": "ROLE_USER",
      "parts": [
        {
          "text": "Summarize the files in your workspace.",
          "mediaType": "text/plain"
        }
      ]
    }
  }'
```

Use a unique `messageId` for every message. A streamed run normally produces events in this order:

1. `task` — contains the new task `id` and conversation `contextId`;
2. `statusUpdate` — reports `TASK_STATE_WORKING`;
3. one or more `artifactUpdate` events — contain kucedr-cloud's text response; and
4. a terminal `statusUpdate` — reports `TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, or `TASK_STATE_CANCELED`.

Internal reasoning and tool details are not returned through A2A.

## Continue the same conversation

Copy the `contextId` from the first task event and include it in the next message:

```bash
curl -N "$KUCEDR_CLOUD_URL/a2a/message:stream" \
  -H 'A2A-Version: 1.0' \
  -H "Authorization: Bearer $KUCEDR_CLOUD_TOKEN" \
  -H 'Content-Type: application/a2a+json' \
  -H 'Accept: text/event-stream' \
  --data '{
    "message": {
      "messageId": "request-2",
      "contextId": "<context-id-from-first-task>",
      "role": "ROLE_USER",
      "parts": [
        {
          "text": "Now create a short summary file.",
          "mediaType": "text/plain"
        }
      ]
    }
  }'
```

kucedr-cloud creates a new task for each message but reuses the conversation associated with the supplied `contextId`. Omit `contextId` to start a new conversation. Conversations are scoped to the authenticated client; learning another client's `contextId` does not grant access to it.

## Send without streaming

Use `message:send` when you prefer one JSON response instead of an SSE stream:

```bash
curl --fail-with-body "$KUCEDR_CLOUD_URL/a2a/message:send" \
  -H 'A2A-Version: 1.0' \
  -H "Authorization: Bearer $KUCEDR_CLOUD_TOKEN" \
  -H 'Content-Type: application/a2a+json' \
  --data '{
    "message": {
      "messageId": "request-3",
      "role": "ROLE_USER",
      "parts": [
        {
          "text": "List the files in the workspace.",
          "mediaType": "text/plain"
        }
      ]
    },
    "configuration": {
      "returnImmediately": false
    }
  }'
```

With `returnImmediately: false`, the request waits for the task to reach a terminal state. Set it to `true` to receive the initial task immediately and then poll or subscribe for updates.

## Manage tasks

All commands in this section require the A2A version and bearer token headers. Tasks are scoped to the authenticated client; a task ID is not an authorization credential.

### List tasks

```bash
curl --fail-with-body "$KUCEDR_CLOUD_URL/a2a/tasks" \
  -H 'A2A-Version: 1.0' \
  -H "Authorization: Bearer $KUCEDR_CLOUD_TOKEN"
```

### Get one task

```bash
export TASK_ID='<task-id>'

curl --fail-with-body "$KUCEDR_CLOUD_URL/a2a/tasks/$TASK_ID" \
  -H 'A2A-Version: 1.0' \
  -H "Authorization: Bearer $KUCEDR_CLOUD_TOKEN"
```

### Subscribe to an active task

```bash
curl -N -X POST "$KUCEDR_CLOUD_URL/a2a/tasks/$TASK_ID:subscribe" \
  -H 'A2A-Version: 1.0' \
  -H "Authorization: Bearer $KUCEDR_CLOUD_TOKEN" \
  -H 'Accept: text/event-stream'
```

### Cancel an active task

```bash
curl --fail-with-body -X POST "$KUCEDR_CLOUD_URL/a2a/tasks/$TASK_ID:cancel" \
  -H 'A2A-Version: 1.0' \
  -H "Authorization: Bearer $KUCEDR_CLOUD_TOKEN"
```

Cancellation can fail if the task is already terminal or is no longer active.

## Revoke a calling agent

Sign in to the private application at `/config`, find the client in **Registered clients**, and choose **Revoke**. Confirm the prompt and verify that its row disappears from the table.

Subsequent requests using that client's access tokens are rejected immediately. Revocation does not terminate an already admitted HTTP request, active stream, or running task. Deleting a client also makes its existing tasks and conversations inaccessible through the API; the stored records remain until their normal retention cleanup, and registering a new client does not inherit them.

## Use the official JavaScript client

Install the official A2A SDK in your client project:

```bash
npm install @a2a-js/sdk jose
```

Create a client that discovers kucedr-cloud from its Agent Card and streams a prompt:

```js
import { randomUUID } from 'node:crypto';
import { Role } from '@a2a-js/sdk';
import { ClientFactory, RestTransportFactory } from '@a2a-js/sdk/client';

const baseUrl = process.env.KUCEDR_CLOUD_URL;
const token = process.env.KUCEDR_CLOUD_TOKEN;

if (!baseUrl || !token) {
	throw new Error('KUCEDR_CLOUD_URL and KUCEDR_CLOUD_TOKEN are required.');
}

const client = await new ClientFactory({
	transports: [new RestTransportFactory()],
}).createFromUrl(baseUrl);

const request = {
	tenant: '',
	message: {
		messageId: randomUUID(),
		contextId: '',
		taskId: '',
		role: Role.ROLE_USER,
		parts: [
			{
				content: { $case: 'text', value: 'Summarize the workspace.' },
				mediaType: 'text/plain',
				filename: '',
				metadata: {},
			},
		],
		metadata: {},
		extensions: [],
		referenceTaskIds: [],
	},
	configuration: undefined,
	metadata: {},
};

const options = {
	serviceParameters: {
		Authorization: `Bearer ${token}`,
	},
};

for await (const event of client.sendMessageStream(request, options)) {
	console.log(JSON.stringify(event, null, 2));
}
```

Pass the `contextId` from the first task in a later request to continue that conversation.

## Understand the workspace and limits

kucedr-cloud's persistent workspace is `/data/workspace` inside the container. The A2A agent can use only three workspace-bound tools:

- `read` reads a workspace file;
- `write` creates or replaces a workspace file; and
- `edit` changes an existing workspace file.

Shell commands, MCP servers, subagents, administrative APIs, and configuration changes are unavailable through A2A. Put durable behavioral instructions in the workspace's `AGENTS.md` file by asking kucedr-cloud to create or update it.

Message text is limited to 32 KiB, general HTTP request bodies are limited to 100 KiB, and only `text/plain` message parts are accepted. The token form has a smaller 8 KiB and 12-parameter limit. Task-list `pageSize` and `historyLength` cannot exceed 100. Terminal task records are retained for 30 days, and task/conversation data persists in the `kucedr-cloud-data` Docker volume.

The in-memory rate limits are 30 configuration requests per minute per source IP, 10 token requests per minute per source IP and client, 60 authenticated A2A requests per minute per client, and 600 pre-authentication A2A requests per minute per network source. A limited response returns `429 Too Many Requests` and `Retry-After: 60`. Limits reset when kucedr-cloud restarts.

## Stop, restart, or update kucedr-cloud

Restart without deleting data:

```bash
docker compose restart
```

Stop the service while keeping its volume:

```bash
docker compose down
```

Update the checked-out source and recreate the container:

```bash
git pull --ff-only
docker compose up --build --wait -d
```

Do not use `docker compose down --volumes` unless you intend to delete the workspace, conversations, and task history.

## Troubleshooting

### Compose reports a missing variable

`KUCEDR_CLOUD_PUBLIC_URL`, `KUCEDR_CLOUD_ADMIN_TOKEN`, and `KUCEDR_CLOUD_CONFIG_KEY` must have non-empty values. Provider, model, and API key values are entered in the browser setup page after administrator registration. Check the file, then run:

```bash
docker compose config --quiet
```

### The server exits during startup

Inspect the container log:

```bash
docker compose logs app
```

Common causes are a deployment setup token shorter than 32 bytes, a configuration key that does not encode exactly 32 bytes, replacing the key that encrypted the existing `secure-config.json`, an invalid `KUCEDR_CLOUD_PUBLIC_URL` or `KUCEDR_CLOUD_APP_URL`, or configuring both origins to the same value. Restore the exact backed-up configuration key when persisted data already exists. Production public URLs must use HTTPS and must not contain a path, query, credentials, or fragment.

### An A2A request returns `401 Unauthorized`

Acquire a fresh token with `get-token.mjs` and confirm that the request uses `Authorization: Bearer <token>`. Ask the administrator to sign in to the private application at `/config` and verify that the client still appears in **Registered clients**. An A2A access token cannot perform this configuration check.

### The browser cannot register or configure the server

Open `/config` on the exact origin in `KUCEDR_CLOUD_APP_URL`, normally `http://127.0.0.1:3001`. For a remote server, confirm the SSH tunnel is active. A `404` from the public A2A origin is expected because administration routes are absent there. On a new installation, **Setup token** must match `KUCEDR_CLOUD_ADMIN_TOKEN`; after registration, sign in with the administrator username and password. An existing administrator account cannot be replaced with the setup token.

A `401` response can mean the browser session expired or an `Authorization` header was supplied. Administrator bearer-token scripts must use the browser workflow instead. A `403` response means the application origin, Fetch Metadata, or CSRF check failed. Reload the page to refresh its session state and verify that the reverse proxy preserves the browser's `Origin` and `Sec-Fetch-Site` headers. Cross-origin administration is unsupported.

### The token endpoint returns `invalid_client`

Confirm that the request uses the registered private key and `clientId`; `iss` and `sub` both equal that `clientId`; `aud` exactly equals the discovered token endpoint; the assertion is currently valid; its `jti` has not been used; and the client clock is synchronized. Create a new assertion rather than retrying the same one.

### An A2A request returns a version error

Add `A2A-Version: 1.0`. Missing, `0.3`, and unsupported future versions are rejected.

### Opening the public server URL returns `404`

This is expected. The public A2A listener has no home page, login page, or configuration API. A2A clients use `/.well-known/agent-card.json` for discovery and `/a2a` for agent operations. Open the separate private application origin to administer the server; its `/` redirects to administrator registration on a new installation and login after an account exists.

### Streaming arrives all at once

Disable response buffering in the HTTPS reverse proxy and increase its idle timeout. A2A streaming uses `text/event-stream`.

### A request returns `429 Too Many Requests`

Wait for the number of seconds in `Retry-After` before retrying. Repeated immediate retries extend load without bypassing the limit.

### The task fails after reaching `WORKING`

The A2A response intentionally hides internal provider errors. Sign in to the private application at `/config` and check the **Provider** summary to verify the configured provider and model, then check the provider API key, model availability, account limits, and provider status. `docker compose logs app` is useful for server lifecycle failures but may not contain the underlying model-run error.
