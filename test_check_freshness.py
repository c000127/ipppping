import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from check_freshness import check


class FreshnessInventoryTests(unittest.TestCase):
    def test_retired_inventory_rows_are_not_monitored(self):
        inventory = [
            {'alias': 'active', 'monitor_ipv6': ''},
            {'alias': 'retired', 'monitor_ipv6': '2001:db8::1'},
        ]
        with patch('check_freshness.subprocess.run', return_value=SimpleNamespace(stdout=str(int(time.time())))) as run:
            records = check(Path('/unused'), inventory, 600, {'active'})
        self.assertEqual([record['node'] for record in records], ['active', 'active'])
        self.assertTrue(all(record['ok'] for record in records))
        self.assertEqual(run.call_count, 2)

    def test_active_slave_missing_from_inventory_fails(self):
        with patch('check_freshness.subprocess.run', return_value=SimpleNamespace(stdout=str(int(time.time())))):
            records = check(Path('/unused'), [{'alias': 'active', 'monitor_ipv6': ''}], 600,
                            {'active', 'missing'})
        self.assertIn({'node': 'missing', 'probe': 'inventory', 'age_seconds': None, 'ok': False}, records)


if __name__ == '__main__':
    unittest.main()
