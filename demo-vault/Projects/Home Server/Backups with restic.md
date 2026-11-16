---
type: note
project: "[[Home Server]]"
tags:
  - homelab
  - backup
---

# Backups with restic

**restic** runs every night at **02:00** and sends an encrypted, deduplicated backup to **Backblaze B2**. RAID protects against a dead disk; this protects against everything else: a deleted folder, a burst pipe, a burglar, me.

## What gets backed up

| Path | What | Size |
|---|---|---|
| `/srv/photos` | all our photos, the [[Photography]] archive | ~120 GB |
| `/srv/nextcloud` | files, calendars, phone uploads, the novel drafts | ~85 GB |
| `/opt/stack` | compose file, configs, Home Assistant | ~2 GB |
| Nextcloud database dump | made just before each run | ~300 MB |

Not backed up: `/srv/media` (films and series). Too big, and it can all be found again.

## Setup

```bash
# /etc/restic/env   (chmod 600, root only)
export RESTIC_REPOSITORY="b2:marques-home-backup:/pi"
export RESTIC_PASSWORD_FILE="/etc/restic/password"
export B2_ACCOUNT_ID="<key id>"
export B2_ACCOUNT_KEY="<application key>"
```

```bash
source /etc/restic/env
restic init
```

The repository password is also written on paper in the drawer with the passports. Without it the backup is useless.

## The nightly run

`/usr/local/bin/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
source /etc/restic/env

docker compose -f /opt/stack/docker-compose.yml exec -T nextcloud-db \
  sh -c 'mariadb-dump -u root -p"$(cat /run/secrets/db_root_password)" nextcloud' \
  > /srv/nextcloud/db-dump.sql

restic backup /srv/photos /srv/nextcloud /opt/stack \
  --exclude-file=/etc/restic/excludes --tag nightly

restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune
restic check --read-data-subset=2%

curl -fsS "http://192.168.1.20:3001/api/push/restic-ok" > /dev/null
```

Started by a systemd timer:

```ini
# /etc/systemd/system/restic-backup.timer
[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
```

If the push to Uptime Kuma doesn't arrive by 04:00, my phone buzzes.

## Retention

Keep **7 daily, 4 weekly, 12 monthly** snapshots. A year back, at most 23 snapshots, and deduplication keeps them cheap.

## Cost

Backblaze B2 charges about **$6 per TB per month**. The repository is about 0.21 TB, so roughly **$1.30 a month**. Downloads for a full restore cost a little extra, which I'm happy to pay if I ever need it.

## Restore test, 2026-09-27

A backup you haven't restored is a hope, not a backup. On Sunday 27 September I restored all the photos to a spare folder and compared them.

```bash
restic snapshots --tag nightly
restic restore latest --target /mnt/restore-test --include /srv/photos
diff -rq /srv/photos /mnt/restore-test/srv/photos
```

| | |
|---|---|
| Data | **120 GB of photos**, 38,412 files |
| Time | **41 minutes** |
| Speed | ~49 MB/s over the 1 Gbps fibre |
| `diff` | no differences |
| Spot check | opened 30 random photos, including old film scans; all fine |

Next restore test: March 2027, before we leave for [[Japan Trip 2027]].

## To do

- [ ] Second copy somewhere else? See [[Ideas for the server]]
- [ ] Rotate the B2 application key once a year (next: September 2027)

Back to [[Home Server]]
