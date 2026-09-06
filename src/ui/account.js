export function registerAccountForm(request, showNotice, setBusy) {
	document.getElementById('administrator-form').addEventListener('submit', async (event) => {
		event.preventDefault();
		const form = event.currentTarget;
		const data = new FormData(form);
		const newPassword = data.get('newPassword');
		if (newPassword !== data.get('confirmPassword')) {
			showNotice('The new passwords do not match.', 'error');
			return;
		}
		setBusy(form, true);
		try {
			await request('/config/administrator', {
				method: 'PUT',
				body: JSON.stringify({
					username: data.get('username'),
					currentPassword: data.get('currentPassword'),
					...(newPassword ? { newPassword } : {}),
				}),
			});
			form.reset();
			window.location.replace('/config/login?updated=1');
		} catch (error) {
			showNotice(error.message, 'error');
		} finally {
			setBusy(form, false);
		}
	});
}
