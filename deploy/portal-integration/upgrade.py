#!/usr/bin/env python3
"""Upgrade an installed v1 API without replacing credentials or other Portal code."""
import datetime, hashlib, pathlib, shutil, sys
crm=pathlib.Path(__file__).resolve().parents[2]
portal=pathlib.Path(sys.argv[1]).expanduser().resolve() if len(sys.argv)==2 else None
if not portal: sys.exit('Provide the Portal project directory.')
route=portal/'server/routes/crmIntegration.js'
if not route.is_file() or hashlib.sha256(route.read_bytes()).hexdigest()!='61f5da05213d501810c5ebf062c8d77448c8705ad0d3f5c43b7eeb1deecd080e':
 sys.exit('Stopped: Portal API is not the reviewed v1 version. No files changed.')
def env(file):
 return dict(line.split('=',1) for line in file.read_text().splitlines() if '=' in line and not line.startswith('#'))
a,b=env(crm/'.env'),env(portal/'.env')
if a.get('PORTAL_SYNC_ENABLED')!='false': sys.exit('Disable CRM sync before upgrading.')
if not a.get('PORTAL_SYNC_TOKEN') or a['PORTAL_SYNC_TOKEN']!=b.get('CRM_SYNC_TOKEN'): sys.exit('Existing integration keys do not match. No files changed.')
migration=portal/'server/db/migrations/202610120002_customer_sync_bidirectional.sql'
if migration.exists():sys.exit('Two-way migration already exists. Stop and review.')
backup=portal.parent/'backups'/('crm-portal-v2_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'))
backup.mkdir(parents=True,mode=0o700)
shutil.copy2(route,backup/'crmIntegration.js')
shutil.copy2(crm/'deploy/portal-integration/crmIntegration.js',route)
shutil.copy2(crm/'deploy/portal-integration/202610120002_customer_sync_bidirectional.sql',migration)
print('Two-way API files installed. Existing keys preserved. Containers have not been restarted.')
print('Backup:',backup)
