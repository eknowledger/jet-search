---
project: "[[Home Server]]"
tags: [todo]
---
Uptime Kuma has pinged me five nights running: Nextcloud down at about 02:03, back by about 02:25. That's exactly when the restic backup to B2 starts (02:00). My guess: restic reads the RAID 1 so hard that Nextcloud times out on the health check.

To look at:

- [ ] Put `ionice -c3 nice -n 19` in front of the restic command
- [ ] Raise the Kuma timeout for Nextcloud a little
- [ ] Check whether Jellyfin's scheduled library scan also runs in the night
- [ ] One night, run `docker stats` at 02:05 and see who's eating the disk
