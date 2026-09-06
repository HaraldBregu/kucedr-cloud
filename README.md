# kucedr-cloud documentation

Use these guides to deploy, operate, secure, and contribute to kucedr-cloud:

- [Server installer](docs/USAGE.md#install-with-the-server-script) sets up the application on a Linux server with Docker Compose.
- [Application flow](docs/FLOW.md) defines first-start account creation, the dashboard, and separate sidebar configuration pages.
- [A2A client integration](docs/CLIENT.md) explains how clients discover, authenticate with, and invoke the agent.
- [Using kucedr-cloud over A2A](docs/USAGE.md) covers deployment, provider configuration, client registration, OAuth token acquisition, A2A operations, and troubleshooting.
- [Contributing to kucedr-cloud](CONTRIBUTING.md) covers local development, repository conventions, verification, and pull requests.
- [Security policy](docs/SECURITY.md) defines supported versions, vulnerability scope, and private reporting instructions.
- [Changelog](CHANGELOG.md) records release changes.

Once the installer domain is published, install on your server with:

```sh
curl -fsSL https://kucedr.app/install.sh | sh
```

Docker Compose and an HTTPS reverse proxy are prerequisites. The installer prompts for the public A2A origin and keeps browser administration private. See the [installation guide](docs/USAGE.md#install-with-the-server-script) for unattended installation and the direct GitHub command available before domain setup.

For the project overview and deployment quick start, see the [project README](../README.md). kucedr-cloud is distributed under the [MIT License](../LICENSE).
