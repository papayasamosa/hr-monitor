package com.papayasamosa.hrmonitor

import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.PermissionState
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Native Android BLE + recording plugin backing services/bluetooth/androidBluetooth.js
 * and services/session/androidSessionRecorder.js on the JS side. Uses Android's
 * BluetoothGatt APIs directly (via BleManager) rather than Web Bluetooth inside
 * the WebView, and persists sessions/readings to SQLite (via HrDatabaseHelper)
 * through a foreground service (HrRecordingService) so recording survives the
 * app being backgrounded or the screen turning off.
 *
 * NOTE: written and reviewed carefully but not yet compiled or run on-device -
 * this sandbox has no Java/Android SDK. Validate in Android Studio before relying
 * on it; see README's Android section for exactly what's unverified.
 */
@CapacitorPlugin(
    name = "HrRecorder",
    permissions = [
        Permission(strings = [Manifest.permission.BLUETOOTH_SCAN], alias = "bluetoothScan"),
        Permission(strings = [Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetoothConnect"),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "location"),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")
    ]
)
class HrRecorderPlugin : Plugin() {

    private var activeRecordingSessionId: String? = null
    private var recordingStartedAtMs = 0L
    private var recordingDeviceLabel = "Heart Rate Monitor"

    override fun load() {
        HrDatabaseHelper.init(context)
        DevicePrefs.init(context)

        BleManager.onReading = { reading ->
            val data = JSObject()
            data.put("heartRate", reading.heartRate)
            if (reading.rrIntervals.isNotEmpty()) {
                data.put("rrIntervals", JSONArray(reading.rrIntervals))
            }
            notifyListeners("heartRateReading", data)
        }

        BleManager.onDisconnected = { deviceId ->
            val data = JSObject()
            data.put("deviceId", deviceId)
            notifyListeners("deviceDisconnected", data)
        }

        BleManager.onRecordingStats = { sessionId, average, min, max, count ->
            val data = JSObject()
            data.put("sessionId", sessionId)
            data.put("average", average)
            data.put("min", min)
            data.put("max", max)
            data.put("count", count)
            notifyListeners("recordingStats", data)

            val elapsedMs = System.currentTimeMillis() - recordingStartedAtMs
            HrRecordingService.updateNotification(context, recordingDeviceLabel, average, elapsedMs)
        }

        HrRecordingService.onStopRequested = {
            val sessionId = activeRecordingSessionId
            if (sessionId != null) finalizeRecording(sessionId, "completed")
        }
    }

    // --- Permissions -------------------------------------------------------

    private fun requiredPermissionAliases(): Array<String> {
        val aliases = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            aliases.add("bluetoothScan")
            aliases.add("bluetoothConnect")
        } else {
            aliases.add("location")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            aliases.add("notifications")
        }
        return aliases.toTypedArray()
    }

    private fun hasAllBlePermissions(): Boolean =
        requiredPermissionAliases().all { getPermissionState(it) == PermissionState.GRANTED }

    // --- Connection ----------------------------------------------------------

    @PluginMethod
    fun connect(call: PluginCall) {
        if (!hasAllBlePermissions()) {
            requestPermissionForAliases(requiredPermissionAliases(), call, "connectPermissionCallback")
            return
        }
        doConnect(call)
    }

    @PermissionCallback
    private fun connectPermissionCallback(call: PluginCall) {
        if (hasAllBlePermissions()) {
            doConnect(call)
        } else {
            call.reject("Bluetooth permission was not granted")
        }
    }

    private fun doConnect(call: PluginCall) {
        BleManager.startScanAndConnect(context) { deviceId, deviceName, error ->
            if (error != null || deviceId == null) {
                call.reject(error ?: "Failed to connect")
                return@startScanAndConnect
            }
            DevicePrefs.remember(deviceId, deviceName)
            val result = JSObject()
            result.put("deviceId", deviceId)
            result.put("deviceName", deviceName)
            call.resolve(result)
        }
    }

    /**
     * Silent reconnect to the last device the user explicitly connected to -
     * called by the JS layer on app launch/resume instead of leading with a
     * Connect button every time. Never prompts for permission and never
     * rejects: "not connected" is a normal outcome here, not an error.
     */
    @PluginMethod
    fun autoReconnect(call: PluginCall) {
        val deviceId = DevicePrefs.getRememberedDeviceId()
        if (deviceId == null || !hasAllBlePermissions()) {
            val result = JSObject()
            result.put("connected", false)
            call.resolve(result)
            return
        }

        BleManager.connectToKnownDevice(context, deviceId) { id, name, error ->
            val result = JSObject()
            if (error != null || id == null) {
                result.put("connected", false)
            } else {
                result.put("connected", true)
                result.put("deviceId", id)
                result.put("deviceName", name)
            }
            call.resolve(result)
        }
    }

    @PluginMethod
    fun getRememberedDevice(call: PluginCall) {
        val result = JSObject()
        val deviceId = DevicePrefs.getRememberedDeviceId()
        result.put("deviceId", deviceId)
        result.put("deviceName", DevicePrefs.getRememberedDeviceName())
        call.resolve(result)
    }

    @PluginMethod
    fun forgetDevice(call: PluginCall) {
        if (BleManager.connectedDeviceId != null) {
            BleManager.disconnect()
        }
        DevicePrefs.forget()
        call.resolve()
    }

    @PluginMethod
    fun startNotifications(call: PluginCall) {
        BleManager.startNotifications()
        call.resolve()
    }

    @PluginMethod
    fun stopNotifications(call: PluginCall) {
        BleManager.stopNotifications()
        call.resolve()
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        BleManager.disconnect()
        call.resolve()
    }

    @PluginMethod
    fun readBattery(call: PluginCall) {
        BleManager.readBattery { level ->
            val result = JSObject()
            result.put("level", level)
            call.resolve(result)
        }
    }

    // --- Recording -----------------------------------------------------------

    @PluginMethod
    fun startRecording(call: PluginCall) {
        val deviceName = call.getString("deviceName") ?: BleManager.connectedDeviceName ?: "Unknown Device"
        val sessionType = call.getString("sessionType")

        val sessionId = UUID.randomUUID().toString()
        val startedAt = isoNow()
        val session = JSONObject()
        session.put("id", sessionId)
        session.put("startedAt", startedAt)
        session.put("deviceName", deviceName)
        session.put("sessionType", sessionType)
        session.put("status", "recording")
        HrDatabaseHelper.createSession(session)

        activeRecordingSessionId = sessionId
        recordingStartedAtMs = System.currentTimeMillis()
        recordingDeviceLabel = deviceName
        BleManager.beginRecordingStats(sessionId, recordingStartedAtMs)

        val intent = Intent(context, HrRecordingService::class.java)
        intent.putExtra(HrRecordingService.EXTRA_DEVICE_NAME, deviceName)
        ContextCompat.startForegroundService(context, intent)

        val result = JSObject()
        result.put("sessionId", sessionId)
        call.resolve(result)
    }

    @PluginMethod
    fun stopRecording(call: PluginCall) {
        val sessionId = call.getString("sessionId") ?: activeRecordingSessionId
        val status = call.getString("status") ?: "completed"
        if (sessionId != null) {
            finalizeRecording(sessionId, status)
        }

        val stopIntent = Intent(context, HrRecordingService::class.java).apply {
            action = HrRecordingService.ACTION_STOP
        }
        context.startService(stopIntent)
        call.resolve()
    }

    private fun finalizeRecording(sessionId: String, status: String) {
        val stats = BleManager.currentStatsSnapshot()
        val endedAt = isoNow()
        val durationMs = System.currentTimeMillis() - recordingStartedAtMs
        HrDatabaseHelper.finalizeSession(
            sessionId, endedAt, durationMs, status, stats[0], stats[1], stats[2], stats[3]
        )
        BleManager.endRecordingStats()
        activeRecordingSessionId = null
    }

    // --- Storage (read/delete) -------------------------------------------------

    @PluginMethod
    fun listSessions(call: PluginCall) {
        val result = JSObject()
        result.put("sessions", HrDatabaseHelper.listSessions().toString())
        call.resolve(result)
    }

    @PluginMethod
    fun getSession(call: PluginCall) {
        val sessionId = call.getString("sessionId")
        if (sessionId == null) {
            call.reject("sessionId is required")
            return
        }
        val result = JSObject()
        result.put("session", HrDatabaseHelper.getSession(sessionId)?.toString())
        call.resolve(result)
    }

    @PluginMethod
    fun getReadings(call: PluginCall) {
        val sessionId = call.getString("sessionId")
        if (sessionId == null) {
            call.reject("sessionId is required")
            return
        }
        val result = JSObject()
        result.put("readings", HrDatabaseHelper.getReadings(sessionId).toString())
        call.resolve(result)
    }

    @PluginMethod
    fun deleteSession(call: PluginCall) {
        val sessionId = call.getString("sessionId")
        if (sessionId == null) {
            call.reject("sessionId is required")
            return
        }
        HrDatabaseHelper.deleteSession(sessionId)
        call.resolve()
    }

    @PluginMethod
    fun updateEffectiveEndTime(call: PluginCall) {
        val sessionId = call.getString("sessionId")
        val effectiveEndedAt = call.getString("effectiveEndedAt")
        if (sessionId == null || effectiveEndedAt == null) {
            call.reject("sessionId and effectiveEndedAt are required")
            return
        }
        HrDatabaseHelper.updateEffectiveEndTime(sessionId, effectiveEndedAt)
        call.resolve()
    }

    @PluginMethod
    fun findActiveSession(call: PluginCall) {
        val result = JSObject()
        result.put("session", HrDatabaseHelper.findActiveSession()?.toString())
        call.resolve(result)
    }

    @PluginMethod
    fun findSessionByImportFingerprint(call: PluginCall) {
        val fingerprint = call.getString("fingerprint")
        if (fingerprint == null) {
            call.reject("fingerprint is required")
            return
        }
        val result = JSObject()
        result.put("session", HrDatabaseHelper.findSessionByImportFingerprint(fingerprint)?.toString())
        call.resolve(result)
    }

    // --- Speed events ----------------------------------------------------------

    @PluginMethod
    fun getSpeedEventsForSession(call: PluginCall) {
        val sessionId = call.getString("sessionId")
        if (sessionId == null) {
            call.reject("sessionId is required")
            return
        }
        val result = JSObject()
        result.put("speedEvents", HrDatabaseHelper.getSpeedEventsForSession(sessionId).toString())
        call.resolve(result)
    }

    @PluginMethod
    fun addSpeedEvent(call: PluginCall) {
        val eventJson = call.getString("event")
        if (eventJson == null) {
            call.reject("event is required")
            return
        }
        HrDatabaseHelper.addSpeedEvent(JSONObject(eventJson))
        call.resolve()
    }

    @PluginMethod
    fun updateSpeedEvent(call: PluginCall) {
        val eventId = call.getString("eventId")
        val updatesJson = call.getString("updates")
        if (eventId == null || updatesJson == null) {
            call.reject("eventId and updates are required")
            return
        }
        HrDatabaseHelper.updateSpeedEvent(eventId, JSONObject(updatesJson))
        call.resolve()
    }

    @PluginMethod
    fun deleteSpeedEvent(call: PluginCall) {
        val eventId = call.getString("eventId")
        if (eventId == null) {
            call.reject("eventId is required")
            return
        }
        HrDatabaseHelper.deleteSpeedEvent(eventId)
        call.resolve()
    }

    /** Called once at app startup - see webSessionRecorder.js's equivalent for why. */
    @PluginMethod
    fun recoverInterruptedSessions(call: PluginCall) {
        val active = HrDatabaseHelper.findActiveSession()
        val result = JSObject()
        if (active == null) {
            result.put("sessionId", JSONObject.NULL)
            call.resolve(result)
            return
        }

        val sessionId = active.getString("id")
        val startedAtMs = parseIso(active.getString("startedAt"))
        val readings = HrDatabaseHelper.getReadings(sessionId)

        var sum = 0L
        var count = 0
        var min = Int.MAX_VALUE
        var max = Int.MIN_VALUE
        for (i in 0 until readings.length()) {
            val hr = readings.getJSONObject(i).getInt("heartRate")
            sum += hr
            count += 1
            if (hr < min) min = hr
            if (hr > max) max = hr
        }
        val average = if (count > 0) (sum / count).toInt() else 0
        if (min == Int.MAX_VALUE) min = 0
        if (max == Int.MIN_VALUE) max = 0

        val endedAt = isoNow()
        val durationMs = System.currentTimeMillis() - startedAtMs
        HrDatabaseHelper.finalizeSession(sessionId, endedAt, durationMs, "interrupted", average, min, max, count)

        result.put("sessionId", sessionId)
        call.resolve(result)
    }

    private fun isoNow(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }

    private fun parseIso(iso: String): Long = try {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        sdf.parse(iso)?.time ?: System.currentTimeMillis()
    } catch (e: Exception) {
        System.currentTimeMillis()
    }
}
