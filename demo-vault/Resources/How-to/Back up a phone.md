---
type: how-to
tags: [how-to, tech]
---
# Back up a phone

My phone holds the photos, the two-factor codes, the Japanese flashcards and half my life. The plan follows the **3-2-1 rule**: three copies, on two kinds of storage, one of them outside the house.

## What goes where

| What | Copy 1 | Copy 2 | Off-site |
|---|---|---|---|
| Photos and videos | phone | Nextcloud on the [[Home Server]] (auto-upload) | restic → Backblaze B2, nightly at 02:00 |
| Contacts, calendars | phone | Nextcloud (CardDAV/CalDAV sync) | the same nightly restic run |
| Everything else (apps, settings, messages) | phone | encrypted backup on the laptop | a second drive, swapped at Sofia's in Porto on every visit |
| Two-factor codes | authenticator app | exported, encrypted file on the laptop | printed recovery codes in the drawer |

## Monthly: full backup to the laptop

1. Plug the phone into the laptop with the cable.
2. Open the phone in the file manager / Finder, tick **"Back up all data to this computer"**.
3. Tick **"Encrypt local backup"** and use the password from the password manager. Without encryption the backup skips saved passwords and health data.
4. **Back Up Now**. About 20 minutes.
5. Check the date of the latest backup afterwards — it should say today.

## Photos: check the auto-upload

- Nextcloud app → Auto upload → the camera folder is on, "only on Wi-Fi" on.
- Once a month, open the Nextcloud web page and look for the newest photo. If it's from last week, the app stopped in the background again.
- Only after I see a photo on the server *and* in last night's restic snapshot do I delete it from the phone.

## Before travelling (and before any big phone update)

- [ ] Full encrypted backup to the laptop
- [ ] Export the authenticator codes; check the recovery codes on paper are the current ones
- [ ] All photos uploaded to Nextcloud
- [ ] Offline copies of bookings, tickets and passport scan in the files app
- [ ] For [[Japan Trip 2027]]: also the JR Pass voucher and the ryokan address in Japanese

## Once a year: test a restore

A backup you've never restored is a hope, not a backup. On 2026-09-27 I restored 120 GB of photos from B2 to the Pi: 41 minutes, nothing missing. Next: restore one old phone backup onto the spare phone and see if the flashcard app comes back with its history.

## If the phone is lost

1. Lock and locate it from the laptop.
2. Change the password manager master password.
3. Log in to the important accounts with the recovery codes from the drawer.
4. New phone → restore from the last laptop backup → photos come back from Nextcloud.

Related: [[Git basics for my notes]] for the notes themselves.
