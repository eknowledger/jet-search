---
type: note
project: "[[Home Server]]"
tags:
  - homelab
  - docker
---

# Docker Compose stack

Everything on the server runs as containers from one `docker-compose.yml` in `/opt/stack`, which is itself in git and in the nightly backup ([[Backups with restic]]). Five services: **Jellyfin**, **Pi-hole**, **Nextcloud**, **Home Assistant** and **Uptime Kuma**.

Web ports are bound to the LAN address `192.168.1.20` only ([[Network and static IP]]), so nothing listens on anything else by accident.

## docker-compose.yml (excerpt)

```yaml
services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: jellyfin
    user: "1000:1000"
    volumes:
      - ./jellyfin/config:/config
      - ./jellyfin/cache:/cache
      - /srv/media:/media:ro
    ports:
      - "192.168.1.20:8096:8096"
    restart: unless-stopped

  pihole:
    image: pihole/pihole:latest
    container_name: pihole
    environment:
      TZ: Europe/Lisbon
      FTLCONF_webserver_api_password: ${PIHOLE_PASSWORD}
      FTLCONF_dns_upstreams: "9.9.9.9;149.112.112.112"
    volumes:
      - ./pihole/etc-pihole:/etc/pihole
    ports:
      - "192.168.1.20:53:53/tcp"
      - "192.168.1.20:53:53/udp"
      - "192.168.1.20:8080:80/tcp"
    restart: unless-stopped

  nextcloud-db:
    image: mariadb:11
    container_name: nextcloud-db
    environment:
      MARIADB_DATABASE: nextcloud
      MARIADB_USER: nextcloud
      MARIADB_PASSWORD_FILE: /run/secrets/db_password
      MARIADB_ROOT_PASSWORD_FILE: /run/secrets/db_root_password
    volumes:
      - ./nextcloud/db:/var/lib/mysql
    secrets: [db_password, db_root_password]
    restart: unless-stopped

  nextcloud:
    image: nextcloud:30-apache
    container_name: nextcloud
    depends_on: [nextcloud-db]
    environment:
      MYSQL_HOST: nextcloud-db
      MYSQL_DATABASE: nextcloud
      MYSQL_USER: nextcloud
      MYSQL_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - /srv/nextcloud:/var/www/html
      - /srv/photos:/photos
    ports:
      - "192.168.1.20:8081:80"
    secrets: [db_password]
    restart: unless-stopped

  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    container_name: homeassistant
    network_mode: host
    volumes:
      - ./homeassistant:/config
      - /etc/localtime:/etc/localtime:ro
    restart: unless-stopped

  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: uptime-kuma
    volumes:
      - ./uptime-kuma:/app/data
    ports:
      - "192.168.1.20:3001:3001"
    restart: unless-stopped

secrets:
  db_password:
    file: ./secrets/db_password.txt
  db_root_password:
    file: ./secrets/db_root_password.txt
```

Passwords live in `.env` and `./secrets/`, both `chmod 600` and not in git.

## Everyday commands

```bash
cd /opt/stack
docker compose pull            # fetch new images
docker compose up -d           # apply changes
docker compose ps              # what's running
docker compose logs -f pihole  # follow one service
docker image prune -f          # clean up old images
```

## Notes per service

- **Jellyfin**: media mounted read-only, so a bad plugin can't delete films. Layout in [[Jellyfin library layout]].
- **Pi-hole**: binds port 53 on the LAN address only, see [[Pi-hole notes]].
- **Nextcloud**: before major upgrades, `docker compose exec -u www-data nextcloud php occ maintenance:mode --on`, then back up, then upgrade one major version at a time.
- **Home Assistant**: needs `network_mode: host` to find devices on the LAN.
- **Uptime Kuma**: checks every service every 60 s and the RAID push check; alerts go to my phone.

## Update routine

First Saturday of the month, with coffee: read release notes, `pull`, `up -d`, check Uptime Kuma is all green. Pin a version if something breaks.

Back to [[Home Server]]
