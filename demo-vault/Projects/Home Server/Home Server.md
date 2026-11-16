---
type: project
status: active
area: "[[Home]]"
tags:
  - homelab
  - server
---

# Home Server

A small, quiet box on the bookshelf that keeps our photos, films and the smart bits of the flat running, without paying a monthly subscription for each of them.

## At a glance

| | |
|---|---|
| Hardware | **Raspberry Pi 5, 8 GB**, boots from NVMe |
| Storage | two **4 TB** drives in **RAID 1** (mdadm) |
| Address | **192.168.1.20**, static |
| Services | Jellyfin, Pi-hole, Nextcloud, Home Assistant, Uptime Kuma, all in Docker Compose |
| Backups | restic, nightly at 02:00, to Backblaze B2 |
| Power | about 7 W at idle, on a UPS since August 2026 |

## Why

- Photos: twenty years of them, from the first digital camera to the Fujifilm (see [[Photography]]). They should not live only on a phone.
- Films and series for us and for language practice (see [[Languages]])
- Ad blocking for every device in the flat
- Home Assistant for the terrace irrigation and the heating
- Learning something with my hands that isn't flour

## Notes

**Hardware and storage**
- [[Hardware — Raspberry Pi 5]]
- [[RAID 1 with mdadm]]
- [[Network and static IP]]

**Software**
- [[Docker Compose stack]]
- [[Pi-hole notes]]
- [[Jellyfin library layout]]

**Keeping it safe**
- [[Backups with restic]]
- [[Power outage 2026-08-04]]

**Later**
- [[Ideas for the server]]

## Services

| Service | Port | What for |
|---|---|---|
| Jellyfin | 8096 | films, series, music |
| Pi-hole | 53, web on 8080 | DNS and ad blocking |
| Nextcloud | 8081 | files, photo upload from phones, calendar |
| Home Assistant | 8123 | irrigation timer, heating, the terrace sensor |
| Uptime Kuma | 3001 | watches everything above, pings my phone |

Nothing is open to the internet. From outside the flat we reach it over a private VPN only.

## Status (October 2026)

- Stable since the UPS went in; uptime 81 days at the last check
- Restore test passed on 2026-09-27: 120 GB of photos back in 41 minutes
- RAID healthy, both disks `[UU]`

## Next

- [ ] Monthly RAID check result: look at it on the 1st of November
- [ ] Update Nextcloud to the next major version (read the notes first, last time broke an app)
- [ ] Label the cables behind the bookshelf before Rui "tidies" them again
- [ ] Pick one thing from [[Ideas for the server]] for the winter
