const pages = {
	'/config': ['dashboard-page', 'Dashboard', 'Manage your workspace and connection settings.'],
	'/config/clients': [
		'clients-panel',
		'Clients',
		'Register and manage the agents that can connect to your workspace.',
	],
	'/config/provider': [
		'provider-panel',
		'Provider',
		'Save multiple providers and choose the active model for agent runs.',
	],
	'/config/a2a': ['connection-panel', 'A2A Config', 'Connection settings for your calling agents.'],
};

export function showPage(view) {
	const page = pages[window.location.pathname] || pages['/config'];
	const title =
		view === 'config' ? page[1] : view === 'register' ? 'Create your account' : 'Welcome back';
	document.title = `${title} · Kucedr Cloud`;
	document.getElementById('page-title').textContent = title;
	document.getElementById('page-description').textContent =
		view === 'config'
			? page[2]
			: view === 'register'
				? 'Create an administrator account to open your dashboard.'
				: 'Log in to open your dashboard.';
	document
		.getElementById('application-layout')
		.classList.toggle('authenticated', view === 'config');
	for (const [url, [id]] of Object.entries(pages)) {
		document.getElementById(id).hidden = view !== 'config' || id !== page[0];
		const link = document.querySelector(`#section-nav a[href="${url}"]`);
		if (id === page[0]) link.setAttribute('aria-current', 'page');
		else link.removeAttribute('aria-current');
	}
}
