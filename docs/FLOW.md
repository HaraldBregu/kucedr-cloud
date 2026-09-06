# Application flow

The private application opens account creation on first startup. Creating the account signs the administrator in and opens the dashboard immediately. Provider configuration is a separate task and never blocks navigation.

## Account and startup

1. Open the private application origin. Without an administrator, `/` and protected pages lead to `/config/register`.
2. Choose any nonblank username, including spaces, punctuation, or Unicode, up to 100 characters. Leading and trailing whitespace is removed and sign-in remains case-insensitive. No email address is required.
3. Enter a password of at least 12 characters (at most 1024 UTF-8 bytes). Registration creates the sole administrator and a browser session.
4. Open `/config`, the dashboard, even when no provider or clients exist.
5. Later visits open the dashboard while the session is valid, or `/config/login` when signed out. Logging in returns to the dashboard. Logging out invalidates the session and opens login.

Registration uses only the chosen username and password and is available until the first administrator is created. Password hashing, encrypted persistence, session cookies, origin checks, CSRF protection, and the separate private listener remain in place. Existing accounts need no migration.

## Navigation and pages

The signed-in application has a persistent left sidebar and one main content area. Each item is a real page URL, supports direct opening, refresh, and browser history, and identifies the current page with `aria-current="page"`.

| Sidebar item | URL | Contents and actions |
| --- | --- | --- |
| Dashboard | `/config` | Provider status, client count, signed-in username, and links to configuration pages. An unconfigured provider offers a setup link. |
| Clients | `/config/clients` | Register a calling agent with a name and public Ed25519 JWK, list client IDs, and revoke access with confirmation. |
| Provider | `/config/provider` | Select a provider, enter a model and API key, save changes, or remove the provider with confirmation. |
| A2A Config | `/config/a2a` | Review OAuth issuer, token endpoint, A2A resource, scope, and authentication method used by clients. Link to client registration. |

A2A connection values come from deployment configuration and are read-only in the browser. Changing the public origin uses `KUCEDR_CLOUD_PUBLIC_URL` and a service restart; this flow does not introduce a second source of connection settings. “AUA config” is interpreted as the existing A2A connection configuration.

The previous `/config/setup` URL redirects authenticated users to Provider. The JSON API at `GET /config` remains available for same-origin authenticated requests accepting JSON. Browser navigation receives HTML; configuration mutations keep their existing URLs and methods.

## Layout and interaction

Reuse the existing CSS tokens, typography, buttons, cards, fields, and table styling. The sidebar remains on the left at desktop widths; at narrow widths it becomes a wrapping navigation row above the content. Account creation and login show a focused form without the sidebar.

Each page has a descriptive document title and heading. Navigation uses native links for keyboard and browser behavior. Fields have visible labels, focus remains visible, and the skip link targets the main content. Long usernames, client IDs, and connection URLs wrap without widening the page.

## States

- Startup shows a session check before exposing authenticated content. A failed load displays an error and a reload action.
- Registration and login show inline errors and disable form controls while submitting.
- The dashboard explicitly shows an unconfigured provider and zero clients. Agent runs require a provider, but all configuration pages remain available.
- Provider and client pages show saving feedback, success, validation errors, and empty states. Errors retain entered values. API keys are cleared after a successful save and never returned by the API.
- Removing a provider stays on Provider. Registering or revoking a client stays on Clients.
- An expired session sends the user to login. Protected pages never return configuration data to signed-out visitors.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run build`. Authentication tests cover chosen usernames, first registration, repeat-registration rejection, login/logout, restart persistence, session and CSRF enforcement, every page guard, and dashboard access without a provider. Browser verification covers registration to dashboard, sidebar navigation and refresh, provider save/remove, client register/revoke, logout/login, and desktop/narrow layouts.

See [the usage guide](USAGE.md) for deployment and configuration instructions.
