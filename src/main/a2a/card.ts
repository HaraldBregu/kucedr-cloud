import type { AgentCard } from '@a2a-js/sdk';

export function createAgentCard(
	publicUrl: string,
	oauth?: { metadataUrl: string; tokenEndpoint: string; scope: string }
): AgentCard {
	return {
		name: 'kucedr-cloud',
		description: 'A personal assistant that can work with files in its private workspace.',
		supportedInterfaces: [
			{
				url: `${publicUrl}/a2a`,
				protocolBinding: 'HTTP+JSON',
				protocolVersion: '1.0',
				tenant: '',
			},
		],
		provider: undefined,
		version: '1.0.2',
		capabilities: {
			streaming: true,
			pushNotifications: false,
			extendedAgentCard: false,
			extensions: [],
		},
		securitySchemes: oauth
			? {
					oauth2: {
						scheme: {
							$case: 'oauth2SecurityScheme',
							value: {
								description: 'OAuth 2.0 client credentials using private_key_jwt.',
								oauth2MetadataUrl: oauth.metadataUrl,
								flows: {
									flow: {
										$case: 'clientCredentials',
										value: {
											tokenUrl: oauth.tokenEndpoint,
											refreshUrl: '',
											scopes: {
												[oauth.scope]: 'Invoke kucedr-cloud and access caller-owned tasks.',
											},
										},
									},
								},
							},
						},
					},
				}
			: {
					bearerAuth: {
						scheme: {
							$case: 'httpAuthSecurityScheme',
							value: {
								description: 'Dedicated kucedr-cloud agent token.',
								scheme: 'Bearer',
								bearerFormat: '',
							},
						},
					},
				},
		securityRequirements: [
			{ schemes: oauth ? { oauth2: { list: [oauth.scope] } } : { bearerAuth: { list: [] } } },
		],
		defaultInputModes: ['text/plain'],
		defaultOutputModes: ['text/plain'],
		skills: [
			{
				id: 'workspace-assistance',
				name: 'Workspace assistance',
				description: 'Answer questions and read, create, or edit files in a private workspace.',
				tags: ['assistant', 'files', 'workspace'],
				examples: ['Summarize the files in the workspace.'],
				inputModes: ['text/plain'],
				outputModes: ['text/plain'],
				securityRequirements: [],
			},
		],
		signatures: [],
	};
}
