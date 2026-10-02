# Backups

Every hour the production database is dumped, checked, **encrypted** and copied **off the server**.
Local: last 48 hours + 14 days. Off-site: 35 days (matches the Terms). Once a day the env file
(your secrets) is backed up too, encrypted.

## One-time setup (on the VPS, as root)

1. Encryption key (keep a copy in your password manager, without it backups can't be opened):
   ```bash
   install -d -m 700 /etc/wyndos
   openssl rand -base64 48 > /etc/wyndos/backup.key && chmod 600 /etc/wyndos/backup.key
   cat /etc/wyndos/backup.key   # copy into your password manager now
   ```
2. Off-site storage. Free options: **Cloudflare R2** (10 GB free) or **Backblaze B2** (10 GB free).
   Create a private bucket called `wyndos-backups` and an access key for that bucket only, then:
   ```bash
   apt install rclone
   rclone config     # new remote, name it "r2" (type s3, provider Cloudflare) or "b2"
   ```
3. Settings file `/etc/wyndos/backup.conf`:
   ```bash
   BACKUP_REMOTE="r2:wyndos-backups"
   # optional, free alert if a backup fails: https://healthchecks.io
   BACKUP_PING_URL="https://hc-ping.com/your-check-id"
   ```
4. Install the script (root-owned copy, so the app user can't change what root runs) and the timer:
   ```bash
   install -m 700 -o root -g root /opt/wyndos/current/deploy/backup/wyndos-backup.sh /usr/local/sbin/wyndos-backup
   cp /opt/wyndos/current/deploy/systemd/wyndos-backup.{service,timer} /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now wyndos-backup.timer
   systemctl start wyndos-backup && journalctl -u wyndos-backup -n 20 --no-pager
   ```
   Re-run the `install` line whenever `wyndos-backup.sh` changes.

## Check it works

- `systemctl list-timers wyndos-backup.timer` shows the next run.
- `ls -lh /var/backups/wyndos/hourly | tail` and `rclone ls r2:wyndos-backups | tail`.
- Once a month: `sudo /opt/wyndos/current/deploy/backup/wyndos-restore-test.sh` restores the newest backup into
  a throwaway database, counts rows and deletes it.

## Restore for real (disaster)

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/etc/wyndos/backup.key \
  -in wyndos-YYYYMMDD-HHMM.dump.enc -out /tmp/wyndos.dump
systemctl stop wyndos
sudo -u postgres pg_restore --clean --if-exists --no-owner --role=app_user -d window_cleaning_app /tmp/wyndos.dump
systemctl start wyndos && shred -u /tmp/wyndos.dump
```
Single businesses can also be restored from their own download in Settings, then Data.
