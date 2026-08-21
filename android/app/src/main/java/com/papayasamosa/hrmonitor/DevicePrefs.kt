package com.papayasamosa.hrmonitor

import android.content.Context
import android.content.SharedPreferences

/**
 * Remembers the last heart-rate monitor the user explicitly connected to, so
 * the app can attempt a silent reconnect on launch instead of leading with a
 * big Connect button every time (see BleManager.autoReconnect).
 */
object DevicePrefs {
    private const val PREFS_NAME = "hr_monitor_device"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_DEVICE_NAME = "device_name"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun remember(deviceId: String, deviceName: String?) {
        prefs.edit()
            .putString(KEY_DEVICE_ID, deviceId)
            .putString(KEY_DEVICE_NAME, deviceName ?: "Unknown Device")
            .apply()
    }

    fun getRememberedDeviceId(): String? = prefs.getString(KEY_DEVICE_ID, null)

    fun getRememberedDeviceName(): String? = prefs.getString(KEY_DEVICE_NAME, null)

    fun forget() {
        prefs.edit().clear().apply()
    }
}
