---
type: note
project: "[[Home Server]]"
tags:
  - homelab
  - idea
---

# Ideas for the server

A parking place for "wouldn't it be nice if". Nothing here is promised. One idea per winter is plenty; the Pi only has 8 GB.

## Shortlist

| Idea | For | Effort | RAM | Verdict |
|---|---|---|---|---|
| Immich for photos | [[Photography]] | medium | ~1.5 GB | **next winter's project** |
| Second Pi-hole on a Pi Zero 2 W | DNS survives reboots | small | separate box | yes, cheap |
| Terrace sensors in Home Assistant | [[Rooftop Garden]] | small | none | yes |
| Off-site second backup copy | [[Backups with restic]] | medium | none | maybe |
| Paperless-ngx for receipts | [[Finances]] | medium | ~1 GB | maybe |
| Mealie for recipes | [[Cooking]] | small | ~300 MB | maybe |
| Audiobookshelf | [[Reading]] | small | ~200 MB | later |

## The ideas, in more words

### Immich for photos
Phone uploads go into Nextcloud now, but browsing twenty years of photos there is slow. Immich has face search, a map and a timeline. It would read `/srv/photos` read-only, so nothing changes in the backup. Would help pick the shots for the Alfama photo book for [[Sofia]]'s birthday.

### Terrace sensors
- Soil moisture sensor in the basil pot: the basil keeps dying from overwatering, and a number beats my guess
- Temperature on the terrace: Home Assistant sends a notification when it drops below **12 °C**, the signal to bring the basil inside
- Show the drip irrigation timer (6:30, 12 minutes) on a dashboard, with a button to double it in a heat wave

### Second Pi-hole
A Pi Zero 2 W at `192.168.1.21` running only Pi-hole, synced from the main one. The router hands out both. After the [[Power outage 2026-08-04]] this is the most useful €20 I could spend.

### Off-site second copy
A small drive at Sofia's place in Porto, restic copying to it over the VPN once a week. Two clouds is one too many; one cloud plus one sister seems right.

### Paperless-ngx
Scan every invoice from the [[Kitchen Renovation]] (Ortega & Filhos, Nordhaus, the stone yard) and the warranty papers for the appliances. Search them by text. Tax time would be easier too.

### Manuscript safety
The novel drafts for [[The Lighthouse Keeper]] already sync through Nextcloud. Turn on file versioning with a longer history for that one folder, so a bad Sunday revision is never final.

### Running data
Export runs from the watch into a small database, chart weekly kilometres for the [[Half Marathon]] plan. Honestly the watch app already does this. Probably not.

## Rejected

- ~~Minecraft server~~ nobody here plays it
- ~~Self-hosted email~~ no, never
- ~~Exposing Jellyfin to the internet~~ the VPN is enough

Back to [[Home Server]]
