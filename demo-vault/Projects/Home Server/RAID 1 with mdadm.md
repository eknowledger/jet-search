---
type: note
project: "[[Home Server]]"
tags:
  - homelab
  - storage
  - linux
---

# RAID 1 with mdadm

Two **4 TB** drives in a mirror (**RAID 1**), managed by **mdadm** on the Pi. The USB enclosure's own RAID is switched off; it just presents two disks. Mounted at `/srv`, which holds media, photos and Nextcloud data.

> RAID 1 is **not a backup**. It survives a dead disk, not a deleted folder. Backups: [[Backups with restic]].

## Setup (done once)

Partition both disks with one partition each:

```bash
sudo parted /dev/sda --script mklabel gpt mkpart primary 0% 100% set 1 raid on
sudo parted /dev/sdb --script mklabel gpt mkpart primary 0% 100% set 1 raid on
```

Create the mirror, format it, mount it:

```bash
sudo mdadm --create /dev/md0 --level=1 --raid-devices=2 /dev/sda1 /dev/sdb1
sudo mkfs.ext4 -L srv /dev/md0
sudo mkdir -p /srv
sudo mount /dev/md0 /srv
```

Make it survive a reboot:

```bash
sudo mdadm --detail --scan | sudo tee -a /etc/mdadm/mdadm.conf
sudo update-initramfs -u
# /etc/fstab
LABEL=srv  /srv  ext4  defaults,noatime,nofail  0  2
```

`nofail` matters: without it a missing USB enclosure stops the Pi from booting at all.

## Checking on it

```bash
cat /proc/mdstat
```

Healthy output:

```text
Personalities : [raid1]
md0 : active raid1 sdb1[1] sda1[0]
      3906885632 blocks super 1.2 [2/2] [UU]
      bitmap: 0/30 pages [0KB], 65536KB chunk

unused devices: <none>
```

`[UU]` = both disks up. `[U_]` = one disk missing, time to act.

After the [[Power outage 2026-08-04]] it looked like this for most of the evening:

```text
md0 : active raid1 sdb1[1] sda1[0]
      3906885632 blocks super 1.2 [2/2] [UU]
      [=====>...............]  resync = 27.4% (1070487424/3906885632) finish=262.1min speed=180344K/sec
```

The full resync took about 7 hours. The write-intent bitmap should have made it shorter; it turns out the enclosure dropped both disks at slightly different moments.

More detail:

```bash
sudo mdadm --detail /dev/md0
#     State : clean
#  Active Devices : 2
#  Failed Devices : 0
#   Spare Devices : 0
```

## Monitoring

- Debian's `checkarray` runs on the first Sunday of every month and reads every block of both disks
- `mdadm --monitor` runs as a service; Uptime Kuma has a push check that turns red if `/proc/mdstat` shows `_`
- SMART checks with `smartctl -a /dev/sda`, once a month by hand

## If a disk dies

```bash
sudo mdadm /dev/md0 --fail /dev/sdb1 --remove /dev/sdb1
# swap the disk, partition it like above, then:
sudo mdadm /dev/md0 --add /dev/sdb1
watch cat /proc/mdstat
```

Serial numbers are on a label on the front of the enclosure, so I know which one to pull.

Back to [[Home Server]] · [[Hardware — Raspberry Pi 5]]
