#!/usr/bin/env python3
"""Install the reviewed integration patch; does not start or stop containers."""
import hashlib, os, pathlib, re, secrets, shutil, sys, datetime

crm = pathlib.Path(__file__).resolve().parents[2]
portal = pathlib.Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) == 2 else None
if not portal or not (portal / 'server/server.js').is_file():
    sys.exit('Usage: python3 deploy/portal-integration/install.py /home/ubuntu/Portal.ekovits.com')
expected = {
    'server/server.js': 'b08bf3c168461d138a1e737d82d6a4c829d8d2d007788247fc0109559221f366',
    'server/services/customerService.js': '7332d1135d07cce1df7b0ef0af4eaa38974d660c8f3bc08b2d135ab73ba14d38',
    'server/db/schema.sql': '5ba43ebde5617e397dd1c543199d79b8731cd3db98ceeb4b89bdbe1de183a68b',
    'server/db/migrations/202609160002_crm_customer_fields.sql': '0559f5c57bd4943acebc10047706461ac3c22b34792ea1a0d4746a28d38a27d0'
}
for file,digest in expected.items():
    if hashlib.sha256((portal/file).read_bytes()).hexdigest() != digest:
        sys.exit('Stopped: Portal source differs from the reviewed version: '+file)
for folder in (crm,portal):
    if not (folder/'.env').is_file(): sys.exit('Missing .env in '+str(folder))
compose_path = portal/'docker-compose.yml'
compose = compose_path.read_text()
needle = '      PORT: 5000'
if compose.count(needle)!=1 or 'CRM_SYNC_TOKEN' in compose: sys.exit('Stopped: Portal compose needs manual review.')
route = portal/'server/routes/crmIntegration.js'
migration = portal/'server/db/migrations/202610120001_crm_sync.sql'
if route.exists() or migration.exists(): sys.exit('Integration files already exist; stop and review.')
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
backup=portal.parent/'backups'/('crm-portal-integration_'+stamp)
backup.mkdir(parents=True,mode=0o700)
for name in ('server/server.js','docker-compose.yml','.env'):
    dest=backup/name
    dest.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(portal/name,dest)
shutil.copy2(crm/'.env',backup/'crm.env')
token=secrets.token_hex(32)
def update_env(file,values):
    text=file.read_text()
    for key,value in values.items():
        text=re.sub(r'^'+key+r'=.*\n?', '', text, flags=re.M)
        text=text.rstrip()+'\n'+key+'='+value+'\n'
    file.write_text(text)
    os.chmod(file,0o600)
shutil.copy2(crm/'deploy/portal-integration/crmIntegration.js',route)
shutil.copy2(crm/'deploy/portal-integration/202610120001_crm_sync.sql',migration)
shutil.copy2(crm/'deploy/portal-integration/link-customer.js',portal/'server/scripts/link-crm-customer.js')
entry=portal/'server/server.js'
text=entry.read_text()
text='import { crmIntegrationRouter } from "./routes/crmIntegration.js";\n'+text
text=text.replace('app.use("/api", requireAuth);','app.use("/api/integrations/crm", crmIntegrationRouter);\napp.use("/api", requireAuth);')
entry.write_text(text)
compose_path.write_text(compose.replace(needle,needle+'\n      CRM_SYNC_TOKEN: ${CRM_SYNC_TOKEN:?Configure CRM integration}'))
update_env(portal/'.env',{'CRM_SYNC_TOKEN':token})
# Disabled until Portal is deployed and its endpoint checked.
update_env(crm/'.env',{'PORTAL_SYNC_TOKEN':token,'PORTAL_SYNC_URL':'https://portal.ekovits.com/api/integrations/crm/customers','PORTAL_SYNC_ENABLED':'false'})
print('Integration patch installed. Containers have not been restarted.')
print('Protected configuration backup:',backup)
print('Deploy Portal first, then migrate CRM and enable its worker as documented.')
