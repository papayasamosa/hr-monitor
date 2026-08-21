package com.papayasamosa.hrmonitor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service whose only job is to keep the app process alive at
 * foreground priority while a recording is active. BleManager (a singleton
 * shared across the whole process, not tied to this Service or the
 * Activity) does the actual BLE + SQLite work and keeps running as long as
 * the process isn't killed - background, screen off, or not.
 *
 * Notification building is exposed as companion functions so
 * HrRecorderPlugin can push progress updates (BPM, elapsed time) without
 * needing a bound reference to the running Service instance.
 */
class HrRecordingService : Service() {

    companion object {
        const val CHANNEL_ID = "hr_recording"
        const val NOTIFICATION_ID = 1001
        const val ACTION_STOP = "com.papayasamosa.hrmonitor.action.STOP_RECORDING"
        const val EXTRA_DEVICE_NAME = "deviceName"

        /** Set by HrRecorderPlugin so the notification's Stop action can finalize the recording. */
        var onStopRequested: (() -> Unit)? = null

        fun createChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID, "Heart rate recording", NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "Shows recording progress while a session is active"
                    setShowBadge(false)
                }
                val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.createNotificationChannel(channel)
            }
        }

        fun buildNotification(context: Context, deviceLabel: String, bpm: Int, elapsedMs: Long): Notification {
            val stopIntent = Intent(context, HrRecordingService::class.java).apply { action = ACTION_STOP }
            val stopPendingIntent = PendingIntent.getService(
                context, 0, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            return NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle("Recording heart rate")
                .setContentText("$deviceLabel · $bpm BPM · ${formatElapsed(elapsedMs)}")
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(0, "Stop", stopPendingIntent)
                .build()
        }

        /** Push a progress update to the already-showing foreground notification. */
        fun updateNotification(context: Context, deviceLabel: String, bpm: Int, elapsedMs: Long) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.notify(NOTIFICATION_ID, buildNotification(context, deviceLabel, bpm, elapsedMs))
        }

        private fun formatElapsed(ms: Long): String {
            val totalSeconds = ms / 1000
            val h = totalSeconds / 3600
            val m = (totalSeconds % 3600) / 60
            val s = totalSeconds % 60
            return if (h > 0) String.format("%d:%02d:%02d", h, m, s) else String.format("%d:%02d", m, s)
        }
    }

    private var deviceLabel: String = "Heart Rate Monitor"

    override fun onCreate() {
        super.onCreate()
        createChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            onStopRequested?.invoke()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        deviceLabel = intent?.getStringExtra(EXTRA_DEVICE_NAME) ?: deviceLabel
        startForeground(NOTIFICATION_ID, buildNotification(this, deviceLabel, 0, 0L))
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
