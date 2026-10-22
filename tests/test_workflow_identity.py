"""Every automated commit must use an identity GitHub credits to the owner.

Commits authored with an address that is not verified on nishants-lab (for
example a placeholder like bot@fairfund.in) never appear on the contribution
graph, and some noreply forms belong to other accounts. This guard fails the
release gate if any workflow commits or publishes under another identity.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = sorted((ROOT / '.github/workflows').glob('*.yml'))
OWNER_EMAIL = '52659071+nishants-lab@users.noreply.github.com'
FORBIDDEN = ['bot@fairfund.in', 'fairfund-bot@users.noreply.github.com',
             'nishant@users.noreply.github.com', 'nisan@amazon.com']


class WorkflowIdentityTests(unittest.TestCase):
    def test_workflows_found(self):
        self.assertGreaterEqual(len(WORKFLOWS), 5)

    def test_no_forbidden_identities(self):
        for wf in WORKFLOWS:
            text = wf.read_text(encoding='utf-8')
            for bad in FORBIDDEN:
                self.assertNotIn(bad, text, f'{wf.name} uses {bad}')

    def test_every_git_commit_step_sets_owner_email_first(self):
        for wf in WORKFLOWS:
            text = wf.read_text(encoding='utf-8')
            emails = re.findall(r'git config(?: --global)? user\.email\s+(\S+)', text)
            for email in emails:
                self.assertEqual(email.strip('"\''), OWNER_EMAIL, f'{wf.name} sets {email}')
            for m in re.finditer(r'git commit', text):
                before = text[:m.start()]
                self.assertIn(f'user.email {OWNER_EMAIL}', before,
                              f'{wf.name}: git commit at offset {m.start()} has no owner identity before it')

    def test_gh_pages_publisher_pins_owner_email(self):
        for wf in WORKFLOWS:
            text = wf.read_text(encoding='utf-8')
            for m in re.finditer(r'uses:\s*peaceiris/actions-gh-pages@\S+', text):
                block = text[m.end():].split('\n      - ', 1)[0]
                self.assertRegex(block, rf'user_email:\s*{re.escape(OWNER_EMAIL)}',
                                 f'{wf.name}: gh-pages publish must set user_email')


    def test_site_deploys_only_through_pages_artifacts(self):
        # Pages serves Actions artifacts; a gh-pages branch push is silently ignored.
        for wf in WORKFLOWS:
            text = wf.read_text(encoding='utf-8')
            self.assertNotRegex(text, r'peaceiris/actions-gh-pages', f'{wf.name} publishes to an unserved gh-pages branch')
        weekly = next(wf for wf in WORKFLOWS if wf.name == 'weekly-analytics.yml').read_text(encoding='utf-8')
        self.assertIn('gh workflow run deploy.yml', weekly)
        self.assertRegex(weekly, r'actions:\s*write')
        self.assertLess(weekly.index('git push'), weekly.index('gh workflow run deploy.yml'),
                        'deploy is dispatched after the analytics commit is pushed')


if __name__ == '__main__':
    unittest.main()
