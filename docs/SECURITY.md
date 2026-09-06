# Security Policy

## Supported versions

Security fixes are provided for the latest tagged release only.

| Release                                           | Supported |
| ------------------------------------------------- | --------- |
| `v1.0.2`                                          | Yes       |
| Earlier releases, development branches, and forks | No        |

Before reporting a vulnerability, confirm that it can be reproduced on the latest release or the current default branch.

## Report a vulnerability

Do not disclose suspected vulnerabilities in a public GitHub issue, discussion, or pull request.

Email **harald.bregu@gmail.com** with:

- a concise description of the vulnerability and its impact;
- the affected kucedr-cloud version or commit;
- the deployment environment and relevant configuration;
- reproducible steps or a minimal proof of concept;
- any privileges, user interaction, or preconditions required; and
- suggested remediation, if known.

Remove API keys, access keys, tokens, personal data, and other secrets from the report. The maintainer may request additional information while validating the finding. No response or resolution time is guaranteed.

## Scope

Relevant reports include vulnerabilities in kucedr-cloud that could cause:

- authentication or authorization bypass in the browser console, administrative APIs, or A2A interface;
- exposure or unauthorized use of access keys, bearer tokens, provider credentials, MCP configuration, conversations, or workspace data;
- escape from storage or workspace path boundaries;
- unintended command execution or access beyond the permissions granted to the agent; or
- an exploitable security failure in a direct dependency as used by kucedr-cloud.

The following are outside this policy:

- vulnerabilities in AI providers, MCP servers, container runtimes, operating systems, or other third-party services that kucedr-cloud does not maintain;
- model quality issues or prompt injection that does not cross an kucedr-cloud authentication, authorization, data, or execution boundary;
- findings that require prior full control of the kucedr-cloud host or data volume and do not provide additional access; and
- unsupported releases or modified forks that cannot be reproduced in the supported kucedr-cloud release.

Test only against systems and data you own or are explicitly authorized to assess. Do not disrupt services, access other users' data, or retain sensitive data beyond what is necessary to demonstrate the issue.

## Disclosure

Keep the report and supporting details private while the finding is investigated and, when applicable, a fix is prepared. Coordinate the timing and content of any public disclosure with the maintainer. A confirmed issue may be documented in a release note or GitHub security advisory when appropriate.

kucedr-cloud does not claim certification for regulated or sensitive-data workloads. Data sent to an AI provider or connected MCP service is subject to that service's security and privacy practices.

For deployment and usage guidance, see the [documentation index](README.md).
