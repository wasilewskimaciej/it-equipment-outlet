#!/bin/bash

# Daily Backup Script
# Runs at 3:00 AM via cron
# Retention: 30 days

set -e

# Configuration
APP_DIR="/home/app/shop"
BACKUP_DIR="/home/app/backups"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
BACKUP_FILE="shop-backup-${TIMESTAMP}.tar.gz"
RETENTION_DAYS=30

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting backup..."

# Create backup archive
tar -czf "${BACKUP_DIR}/${BACKUP_FILE}" \
  -C "${APP_DIR}" \
  data/database.db \
  public/images \
  logs \
  2>/dev/null || true

# Check if backup was created successfully
if [ -f "${BACKUP_DIR}/${BACKUP_FILE}" ]; then
  BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
  echo "[$(date)] Backup created successfully: ${BACKUP_FILE} (${BACKUP_SIZE})"
else
  echo "[$(date)] ERROR: Backup creation failed!"
  exit 1
fi

# Remove backups older than retention period
echo "[$(date)] Cleaning up old backups (older than ${RETENTION_DAYS} days)..."
find "${BACKUP_DIR}" -name "shop-backup-*.tar.gz" -type f -mtime +${RETENTION_DAYS} -delete

# Count remaining backups
BACKUP_COUNT=$(find "${BACKUP_DIR}" -name "shop-backup-*.tar.gz" -type f | wc -l)
echo "[$(date)] Backup completed. Total backups: ${BACKUP_COUNT}"

# Calculate total size
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" | cut -f1)
echo "[$(date)] Total backup size: ${TOTAL_SIZE}"
